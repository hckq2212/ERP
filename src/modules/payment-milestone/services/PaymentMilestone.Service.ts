import { AppDataSource } from "../../../data-source";
import { PaymentMilestones } from "../entities/PaymentMilestone.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import { Debts, DebtStatus } from "../../debt/entities/Debt.entity";
import { ProjectStatus } from "../../project/entities/Project.entity";
import { SecurityService } from "../../../shared/services/Security.Service";

export class PaymentMilestoneService {
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private debtRepository = AppDataSource.getRepository(Debts);

    private assertContractAndProjectNotClosed(contract?: Contracts | null): void {
        if (!contract) return;
        if (contract.status === ContractStatus.COMPLETED || contract.status === ContractStatus.CANCELLED) {
            throw new Error("Hợp đồng đã hoàn tất hoặc đã hủy, không thể chỉnh sửa kế hoạch thanh toán.");
        }
        if (contract.project && (contract.project.status === ProjectStatus.COMPLETED || contract.project.status === ProjectStatus.CANCELLED)) {
            throw new Error("Dự án liên kết đã hoàn tất hoặc đã đóng, không thể chỉnh sửa kế hoạch thanh toán.");
        }
    }

    private isDebtUnmodifiable(debt?: Debts): boolean {
        if (!debt) return false;
        if (debt.status === DebtStatus.LOCKED) return true;
        if (debt.payments && debt.payments.length > 0) return true;
        if (debt.status === DebtStatus.PAID || debt.status === DebtStatus.PARTIAL) return true;
        return false;
    }

    async getAll(userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            try {
                rbacWhere = SecurityService.getPaymentMilestoneFilters(userInfo);
            } catch (error: any) {
                if (error.message === "FORBIDDEN_ACCESS") {
                    return [];
                }
                throw error;
            }
        }

        return await this.milestoneRepository.find({
            where: rbacWhere,
            relations: ["contract"],
            select: {

                contract: {
                    id: true,
                    name: true,
                    contractCode: true,
                    sellingPrice: true,
                    customer: {
                        id: true,
                        name: true,
                    },
                    createdBy: {
                        id: true,
                        fullName: true,
                    },
                },
            },
            order: { id: "ASC" }
        });
    }

    async getByContract(contractId: string, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        let rbacWhere: any = {};
        if (userInfo) {
            rbacWhere = SecurityService.getPaymentMilestoneFilters(userInfo);
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

        return await this.milestoneRepository.find({
            where: rbacWhere,
            relations: ["debt", "debt.payments"],
            order: { id: "ASC" }
        });
    }

    async create(data: { contractId: string, milestones: any[] }) {
        const { contractId, milestones } = data;

        const contract = await this.contractRepository.findOne({
            where: SecurityService.withTenant({ id: contractId }),
            relations: ["milestones", "project"]
        });

        if (!contract) throw new Error("Không tìm thấy hợp đồng");
        this.assertContractAndProjectNotClosed(contract);

        if (!milestones || milestones.length === 0) {
            throw new Error("Danh sách lộ trình thanh toán trống");
        }

        // Validate Total Percentage
        const currentTotal = contract.milestones.reduce((sum, m) => sum + Number(m.percentage), 0);
        const newTotal = milestones.reduce((sum, m) => sum + Number(m.percentage), 0);

        if (currentTotal + newTotal > 100) {
            throw new Error(`Tổng phần trăm thanh toán vượt quá 100% (Hiện tại: ${currentTotal}%, Thêm mới: ${newTotal}%)`);
        }

        const savedMilestones = [];

        for (const item of milestones) {
            const amount = (Number(contract.sellingPrice) * Number(item.percentage)) / 100;

            const milestone: PaymentMilestones = this.milestoneRepository.create({
                contract,
                name: item.name,
                percentage: item.percentage,
                amount: amount,
                description: item.description,
                dueDate: item.dueDate ? item.dueDate : null,
                ...SecurityService.getTenantWhere()
            } as object);

            const saved = await this.milestoneRepository.save(milestone);
            savedMilestones.push(saved);

            const debt = this.debtRepository.create({
                name: `Phải thu: ${saved.name}`,
                contract,
                milestone: saved,
                amount: saved.amount,
                dueDate: saved.dueDate || new Date(),
                status: DebtStatus.UNPAID,
                ...SecurityService.getTenantWhere()
            } as any);
            await this.debtRepository.save(debt);
        }

        return savedMilestones;
    }

    async update(id: string, data: any) {
        const milestone = await this.milestoneRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["contract", "contract.project", "debt", "debt.payments"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");
        this.assertContractAndProjectNotClosed(milestone.contract);

        if (this.isDebtUnmodifiable(milestone.debt)) {
            throw new Error(`Đợt thanh toán "${milestone.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể chỉnh sửa.`);
        }

        const contract = await this.contractRepository.findOne({
            where: SecurityService.withTenant({ id: milestone.contract.id }),
            relations: ["milestones"]
        });

        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        // Re-validate if percentage changes
        if (data.percentage !== undefined && data.percentage !== null && Number(data.percentage) !== Number(milestone.percentage)) {
            const otherMilestonesTotal = contract.milestones
                .filter(m => String(m.id) !== String(id))
                .reduce((sum, m) => sum + Number(m.percentage), 0);

            if (otherMilestonesTotal + Number(data.percentage) > 100) {
                throw new Error(`Tổng phần trăm thanh toán vượt quá 100%`);
            }

            // Recalculate amount
            milestone.percentage = data.percentage;
            milestone.amount = (Number(contract.sellingPrice) * Number(data.percentage)) / 100;
        }

        if (data.name) milestone.name = data.name;
        if (data.description !== undefined) milestone.description = data.description;
        if (data.dueDate !== undefined) milestone.dueDate = data.dueDate ? data.dueDate : null;

        const savedMilestone = await this.milestoneRepository.save(milestone);

        // If debt exists and has no payments, sync debt with updated milestone
        if (milestone.debt) {
            if (data.name) milestone.debt.name = `Phải thu: ${milestone.name}`;
            if (milestone.amount !== undefined) milestone.debt.amount = milestone.amount;
            if (data.dueDate !== undefined) milestone.debt.dueDate = data.dueDate ? data.dueDate : new Date();
            await this.debtRepository.save(milestone.debt);
        }

        return savedMilestone;
    }

    async delete(id: string) {
        const milestone = await this.milestoneRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["contract", "contract.project", "debt", "debt.payments"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");
        this.assertContractAndProjectNotClosed(milestone.contract);

        if (this.isDebtUnmodifiable(milestone.debt)) {
            throw new Error(`Đợt thanh toán "${milestone.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể xóa.`);
        }

        if (milestone.debt) {
            await this.debtRepository.remove(milestone.debt);
        }

        await this.milestoneRepository.remove(milestone);
        return { message: "Xóa giai đoạn thanh toán thành công" };
    }

    async bulkSave(contractId: string, milestones: any[]) {
        const contract = await this.contractRepository.findOne({
            where: SecurityService.withTenant({ id: contractId }),
            relations: ["project"]
        });

        if (!contract) throw new Error("Không tìm thấy hợp đồng");
        this.assertContractAndProjectNotClosed(contract);

        if (!milestones || milestones.length === 0) {
            throw new Error("Danh sách lộ trình thanh toán trống");
        }

        // 1. Validate Total Percentage (allow slight floating delta e.g. 99.95% - 100.05%)
        const total = milestones.reduce((sum, m) => sum + Number(m.percentage || 0), 0);
        if (Math.abs(total - 100) > 0.05) {
            throw new Error(`Tổng phần trăm thanh toán phải bằng 100% (Hiện tại: ${total}%)`);
        }

        // 2. Fetch all existing milestones for this contract with their debts and payments
        const existingMilestones = await this.milestoneRepository.find({
            where: { contract: { id: contractId } },
            relations: ["debt", "debt.payments"]
        });

        // 3. Check for existing milestones that have payments or are locked
        for (const existing of existingMilestones) {
            const isUnmodifiable = this.isDebtUnmodifiable(existing.debt);
            if (isUnmodifiable) {
                const incoming = milestones.find(m => m.id && String(m.id) === String(existing.id));
                if (!incoming) {
                    throw new Error(`Đợt thanh toán "${existing.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể xóa.`);
                }
                if (Number(incoming.percentage) !== Number(existing.percentage)) {
                    throw new Error(`Đợt thanh toán "${existing.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể thay đổi tỷ lệ.`);
                }
            }
        }

        // 4. Perform updates, deletions, and additions in a transaction
        return await AppDataSource.transaction(async (manager) => {
            const milestoneRepo = manager.getRepository(PaymentMilestones);
            const debtRepo = manager.getRepository(Debts);

            // A. Remove existing milestones that are not in incoming milestones list
            const incomingIds = new Set(milestones.filter(m => m.id).map(m => String(m.id)));
            for (const existing of existingMilestones) {
                if (!incomingIds.has(String(existing.id))) {
                    if (existing.debt) {
                        await debtRepo.remove(existing.debt);
                    }
                    await milestoneRepo.remove(existing);
                }
            }

            // B. Upsert (update existing or create new)
            const savedMilestones = [];
            for (const item of milestones) {
                const amount = (Number(contract.sellingPrice) * Number(item.percentage)) / 100;

                if (item.id) {
                    const existing = existingMilestones.find(m => String(m.id) === String(item.id));
                    if (existing) {
                        const isUnmodifiable = this.isDebtUnmodifiable(existing.debt);
                        existing.name = item.name;
                        existing.percentage = item.percentage;
                        existing.amount = amount;
                        if (item.description !== undefined) existing.description = item.description;
                        if (item.dueDate !== undefined) existing.dueDate = item.dueDate ? item.dueDate : null;

                        const saved = await milestoneRepo.save(existing);
                        savedMilestones.push(saved);

                        // If debt exists and is not unmodifiable, sync debt with updated milestone
                        if (existing.debt && !isUnmodifiable) {
                            existing.debt.name = `Phải thu: ${existing.name}`;
                            existing.debt.amount = amount;
                            if (existing.dueDate) existing.debt.dueDate = existing.dueDate;
                            await debtRepo.save(existing.debt);
                        }
                        continue;
                    }
                }

                // If new milestone (no id or not in existing)
                const newMilestone: PaymentMilestones = milestoneRepo.create({
                    contract,
                    name: item.name,
                    percentage: item.percentage,
                    amount: amount,
                    description: item.description,
                    dueDate: item.dueDate ? item.dueDate : null,
                    ...SecurityService.getTenantWhere()
                } as object);

                const saved = await milestoneRepo.save(newMilestone);
                savedMilestones.push(saved);

                // Tự động tạo bản ghi Công nợ (Debt) cho đợt mới thêm
                const newDebt = debtRepo.create({
                    name: `Phải thu: ${saved.name}`,
                    contract,
                    milestone: saved,
                    amount: saved.amount,
                    dueDate: saved.dueDate || new Date(),
                    status: DebtStatus.UNPAID,
                    ...SecurityService.getTenantWhere()
                } as any);
                await debtRepo.save(newDebt);
            }

            return savedMilestones;
        });
    }
}
