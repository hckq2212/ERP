import { AppDataSource } from "../../../data-source";
import { PaymentMilestones } from "../entities/PaymentMilestone.entity";
import { Contracts } from "../../contract/entities/Contract.entity";
import { Debts, DebtStatus } from "../../debt/entities/Debt.entity";
import { SecurityService } from "../../../shared/services/Security.Service";

export class PaymentMilestoneService {
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private contractRepository = AppDataSource.getRepository(Contracts);
    private debtRepository = AppDataSource.getRepository(Debts);

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
            relations: ["contract", "debt", "debt.payments"],
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

    async syncDebtsForContract(contractId: string) {
        try {
            const milestones = await this.milestoneRepository.find({
                where: { contract: { id: contractId } },
                relations: ["contract", "debt"]
            });

            for (const m of milestones) {
                if (!m.debt) {
                    const debt = this.debtRepository.create({
                        name: `Phải thu: ${m.name}`,
                        contract: m.contract,
                        milestone: m,
                        amount: m.amount,
                        dueDate: m.dueDate || new Date(),
                        status: DebtStatus.UNPAID,
                        ...SecurityService.getTenantWhere()
                    } as any);
                    await this.debtRepository.save(debt);
                }
            }
        } catch (error) {
            console.error("Error auto-syncing debts for contract:", error);
        }
    }

    async getByContract(contractId: string, userInfo?: { id: string, role: string, userId?: string, companyId?: string }) {
        await this.syncDebtsForContract(contractId);

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
            relations: ["milestones"]
        });

        if (!contract) throw new Error("Không tìm thấy hợp đồng");

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

            const milestone = this.milestoneRepository.create({
                contract,
                name: item.name,
                percentage: item.percentage,
                amount: amount,
                description: item.description,
                dueDate: item.dueDate,
                ...SecurityService.getTenantWhere()
            } as any);

            const saved: any = await this.milestoneRepository.save(milestone);
            savedMilestones.push(saved);

            // Tự động tạo bản ghi công nợ tương ứng
            const debt = this.debtRepository.create({
                name: `Phải thu: ${saved.name}`,
                contract: contract,
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
            relations: ["contract", "debt", "debt.payments"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");

        const payments = milestone.debt?.payments || [];
        const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        if (paidAmount > 0) {
            throw new Error("Không thể chỉnh sửa giai đoạn đã phát sinh thanh toán");
        }

        const contract = await this.contractRepository.findOne({
            where: SecurityService.withTenant({ id: milestone.contract.id }),
            relations: ["milestones"]
        });

        // Re-validate if percentage changes
        if (data.percentage && Number(data.percentage) !== Number(milestone.percentage)) {
            const otherMilestonesTotal = contract.milestones
                .filter(m => m.id !== id)
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
        if (data.dueDate) milestone.dueDate = data.dueDate;

        const saved = await this.milestoneRepository.save(milestone);

        // Update or create linked Debt
        if (milestone.debt) {
            milestone.debt.name = `Phải thu: ${saved.name}`;
            milestone.debt.amount = saved.amount;
            if (saved.dueDate) milestone.debt.dueDate = saved.dueDate;
            await this.debtRepository.save(milestone.debt);
        } else {
            const newDebt = this.debtRepository.create({
                name: `Phải thu: ${saved.name}`,
                contract: contract,
                milestone: saved,
                amount: saved.amount,
                dueDate: saved.dueDate || new Date(),
                status: DebtStatus.UNPAID,
                ...SecurityService.getTenantWhere()
            } as any);
            await this.debtRepository.save(newDebt);
        }

        return saved;
    }

    async delete(id: string) {
        const milestone = await this.milestoneRepository.findOne({
            where: SecurityService.withTenant({ id }),
            relations: ["debt", "debt.payments"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");

        const payments = milestone.debt?.payments || [];
        const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
        if (paidAmount > 0) {
            throw new Error("Không thể xóa giai đoạn đã phát sinh thanh toán thực tế");
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
            relations: ["milestones", "milestones.debt", "milestones.debt.payments"]
        });

        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        if (!milestones || milestones.length === 0) {
            throw new Error("Danh sách lộ trình thanh toán không được để trống");
        }

        // 1. Validate Total Percentage
        const total = milestones.reduce((sum, m) => sum + Number(m.percentage || 0), 0);
        if (Math.round(total) !== 100) {
            throw new Error(`Tổng phần trăm thanh toán phải bằng 100% (Hiện tại: ${total}%)`);
        }

        // 2. Identify locked milestones (đã phát sinh giao dịch thanh toán)
        const lockedMilestones = (contract.milestones || []).filter(m => {
            const payments = m.debt?.payments || [];
            const paidAmount = payments.reduce((sum, p) => sum + Number(p.amount || 0), 0);
            return paidAmount > 0;
        });

        // Đảm bảo tất cả các đợt đã thanh toán (locked) đều nằm trong payload gửi lên và không bị thay đổi tỷ lệ / số tiền
        for (const locked of lockedMilestones) {
            const matchInPayload = milestones.find(m => String(m.id) === String(locked.id));
            if (!matchInPayload) {
                throw new Error(`Không thể xóa đợt "${locked.name}" vì đã phát sinh thanh toán`);
            }
            if (Number(matchInPayload.percentage) !== Number(locked.percentage)) {
                throw new Error(`Không thể sửa tỷ lệ của đợt "${locked.name}" vì đã phát sinh thanh toán`);
            }
        }

        // 3. Process existing milestones not locked (unpaid milestones)
        const existingMilestoneIds = new Set(milestones.filter(m => m.id).map(m => String(m.id)));
        const milestonesToDelete = (contract.milestones || []).filter(m => {
            const isLocked = lockedMilestones.some(lm => String(lm.id) === String(m.id));
            return !isLocked && !existingMilestoneIds.has(String(m.id));
        });

        // Xóa các đợt chưa thanh toán bị loại bỏ khỏi danh sách (kèm xóa debt nếu có)
        for (const mToDelete of milestonesToDelete) {
            if (mToDelete.debt) {
                await this.debtRepository.remove(mToDelete.debt);
            }
            await this.milestoneRepository.remove(mToDelete);
        }

        // 4. Update existing or create new milestones
        const savedMilestones = [];
        for (const item of milestones) {
            const amount = Math.round((Number(contract.sellingPrice) * Number(item.percentage)) / 100);

            if (item.id) {
                const existing = (contract.milestones || []).find(m => String(m.id) === String(item.id));
                if (existing) {
                    const isLocked = lockedMilestones.some(lm => String(lm.id) === String(existing.id));
                    if (!isLocked) {
                        existing.name = item.name;
                        existing.percentage = item.percentage;
                        existing.amount = amount;
                        existing.description = item.description || null;
                        if (item.dueDate) existing.dueDate = item.dueDate;
                        const updated = await this.milestoneRepository.save(existing);

                        if (existing.debt) {
                            existing.debt.name = `Phải thu: ${existing.name}`;
                            existing.debt.amount = amount;
                            if (item.dueDate) existing.debt.dueDate = item.dueDate;
                            await this.debtRepository.save(existing.debt);
                        } else {
                            const newDebt = this.debtRepository.create({
                                name: `Phải thu: ${existing.name}`,
                                contract: contract,
                                milestone: existing,
                                amount: amount,
                                dueDate: existing.dueDate || new Date(),
                                status: DebtStatus.UNPAID,
                                ...SecurityService.getTenantWhere()
                            } as any);
                            await this.debtRepository.save(newDebt);
                        }
                        savedMilestones.push(updated);
                    } else {
                        savedMilestones.push(existing);
                    }
                }
            } else {
                const newMilestone = this.milestoneRepository.create({
                    contract,
                    name: item.name,
                    percentage: item.percentage,
                    amount: amount,
                    description: item.description || null,
                    dueDate: item.dueDate,
                    ...SecurityService.getTenantWhere()
                } as any);
                const saved: any = await this.milestoneRepository.save(newMilestone);

                const newDebt = this.debtRepository.create({
                    name: `Phải thu: ${saved.name}`,
                    contract: contract,
                    milestone: saved,
                    amount: saved.amount,
                    dueDate: saved.dueDate || new Date(),
                    status: DebtStatus.UNPAID,
                    ...SecurityService.getTenantWhere()
                } as any);
                await this.debtRepository.save(newDebt);

                savedMilestones.push(saved);
            }
        }

        await this.syncDebtsForContract(contractId);

        return savedMilestones;
    }
}
