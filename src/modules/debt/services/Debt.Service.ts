import { AppDataSource } from "../../../data-source";
import { Debts, DebtStatus } from "../entities/Debt.entity";
import { PaymentMilestones, MilestoneStatus } from "../../payment-milestone/entities/PaymentMilestone.entity";
import { Users } from "../../user/entities/User.entity";

import { SecurityService } from "../../../shared/services/Security.Service";
import {
    isContractClosed,
    assertDebtNotLocked,
    assertContractNotClosed
} from "../helpers/DebtLock.helper";

export class DebtService {
    private debtRepository = AppDataSource.getRepository(Debts);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);

    async getAll(userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getDebtFilters(userInfo);
            } catch (error: any) {
                if (error.message === "FORBIDDEN_ACCESS") {
                    return [];
                }
                throw error;
            }
        }

        return await this.debtRepository.find({
            where: rbacWhere,
            relations: ["contract", "milestone", "payments"]
        });
    }

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getDebtFilters(userInfo);
            if (Array.isArray(rbacWhere)) {
                rbacWhere = rbacWhere.map(cond => ({ id, ...cond }));
            } else {
                rbacWhere = { id, ...rbacWhere };
            }
        } else {
            rbacWhere = { id };
        }

        const debt = await this.debtRepository.findOne({
            where: rbacWhere,
            relations: ["contract", "milestone", "payments"]
        });
        if (!debt) throw new Error("Không tìm thấy khoản nợ hoặc không có quyền truy cập");
        return debt;
    }

    async getByContract(contractId: string, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        try {
            const milestones = await this.milestoneRepository.find({
                where: { contract: { id: contractId } },
                relations: ["contract", "debt"]
            });

            const contract = milestones[0]?.contract;
            if (!isContractClosed(contract)) {
                for (const m of milestones) {
                    if (m.debt) continue;
                    await this.createFromMilestone(m.id);
                }
            }
        } catch (syncErr) {
            console.error("Error auto-syncing debts in getByContract:", syncErr);
        }

        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getDebtFilters(userInfo);
            if (Array.isArray(rbacWhere)) {
                rbacWhere = rbacWhere.map(cond => ({
                    ...cond,
                    contract: { ...cond.contract, id: contractId }
                }));
            } else {
                rbacWhere = {
                    ...rbacWhere,
                    contract: { ...rbacWhere.contract, id: contractId }
                };
            }
        } else {
            rbacWhere = { contract: { id: contractId } };
        }

        return await this.debtRepository.find({
            where: rbacWhere,
            relations: ["milestone", "payments"]
        });
    }

    async createFromMilestone(milestoneId: string) {
        const milestone = await this.milestoneRepository.findOne({
            where: SecurityService.withTenant({ id: milestoneId }),
            relations: ["contract", "debt"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");
        if (milestone.debt) throw new Error("Giai đoạn này đã được kích hoạt công nợ");

        // 🔒 Không kích hoạt công nợ mới cho hợp đồng đã kết thúc
        assertContractNotClosed(milestone.contract);

        const debt = this.debtRepository.create({
            name: `Phải thu: ${milestone.name}`,
            contract: milestone.contract,
            milestone: milestone,
            amount: milestone.amount,
            dueDate: milestone.dueDate || new Date(),
            status: DebtStatus.UNPAID,
            ...SecurityService.getTenantWhere()
        } as any);

        return await this.debtRepository.save(debt);
    }

    async delete(id: string) {
        const debt = await this.getOne(id);
        assertDebtNotLocked(debt);
        if (debt.payments && debt.payments.length > 0) {
            throw new Error("Không thể xóa khoản nợ đã có lượt thanh toán");
        }
        return await this.debtRepository.remove(debt);
    }

    /**
     * Mở khóa công nợ — chỉ BOD/ADMIN, BẮT BUỘC nhập lý do.
     *
     * Trạng thái sau khi mở khóa được tính lại từ các lượt thanh toán hiện có
     * (không phải luôn trả về UNPAID).
     */
    async unlockDebt(
        id: string,
        reason: string,
        actor?: { id?: string; userId?: string; role?: string; fullName?: string }
    ) {
        if (!reason || !reason.trim()) {
            const error: any = new Error("Vui lòng nhập lý do mở khóa công nợ");
            error.statusCode = 400;
            throw error;
        }

        const debt = await this.debtRepository.findOne({
            where: { id },
            relations: ["payments"]
        });
        if (!debt) {
            const error: any = new Error("Không tìm thấy khoản nợ");
            error.statusCode = 404;
            throw error;
        }
        if (debt.status !== DebtStatus.LOCKED) {
            const error: any = new Error("Khoản nợ này không ở trạng thái đã khóa");
            error.statusCode = 409;
            throw error;
        }

        const totalPaid = (debt.payments || [])
            .reduce((sum, payment) => sum + Number(payment.amount || 0), 0);
        const debtAmount = Number(debt.amount || 0);

        debt.status = totalPaid >= debtAmount && debtAmount > 0
            ? DebtStatus.PAID
            : totalPaid > 0
                ? DebtStatus.PARTIAL
                : DebtStatus.UNPAID;

        debt.unlockReason = reason.trim();
        debt.unlockedAt = new Date();

        const actorUserId = actor?.userId || actor?.id;
        if (actorUserId) {
            const user = await AppDataSource.getRepository(Users).findOneBy({ id: actorUserId });
            if (user) {
                debt.unlockedBy = user;
                debt.unlockedById = user.id;
            }
        }

        return await this.debtRepository.save(debt);
    }
}
