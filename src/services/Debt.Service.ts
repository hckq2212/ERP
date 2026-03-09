import { AppDataSource } from "../data-source";
import { Debts, DebtStatus } from "../entity/Debt.entity";
import { PaymentMilestones } from "../entity/PaymentMilestone.entity";

import { SecurityService } from "./Security.Service";

export class DebtService {
    private debtRepository = AppDataSource.getRepository(Debts);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);

    async getAll(userInfo?: { id: string, role: string, userId?: string }) {
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

    async getOne(id: string, userInfo?: { id: string, role: string, userId?: string }) {
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

    async getByContract(contractId: string, userInfo?: { id: string, role: string, userId?: string }) {
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
            where: { id: milestoneId },
            relations: ["contract", "debt"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");
        if (milestone.debt) throw new Error("Giai đoạn này đã được kích hoạt công nợ");

        const debt = this.debtRepository.create({
            name: `Phải thu: ${milestone.name}`,
            contract: milestone.contract,
            milestone: milestone,
            amount: milestone.amount,
            dueDate: milestone.dueDate || new Date(),
            status: DebtStatus.UNPAID
        });

        return await this.debtRepository.save(debt);
    }

    async delete(id: string) {
        const debt = await this.getOne(id);
        if (debt.payments && debt.payments.length > 0) {
            throw new Error("Không thể xóa khoản nợ đã có lượt thanh toán");
        }
        return await this.debtRepository.remove(debt);
    }
}
