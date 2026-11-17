import { AppDataSource } from "../../../data-source";
import { PaymentMilestones } from "../entities/PaymentMilestone.entity";
import { Contracts, ContractStatus } from "../../contract/entities/Contract.entity";
import { Debts, DebtStatus } from "../../debt/entities/Debt.entity";
import { ProjectStatus } from "../../project/entities/Project.entity";
import { SecurityService } from "../../../shared/services/Security.Service";
import Decimal from "decimal.js";
import { getContractCollectibleTotal, getContractCollectibleTotalDecimal, toDecimal } from "../../../shared/helpers/PricingTax.helper";

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

        if (!milestones || milestones.length === 0) {
            throw new Error("Danh sách lộ trình thanh toán trống");
        }

        const savedMilestones = await AppDataSource.transaction(async (manager) => {
            const contractRepo = manager.getRepository(Contracts);
            const milestoneRepo = manager.getRepository(PaymentMilestones);
            const debtRepo = manager.getRepository(Debts);

            // 1. Lock contract row to prevent concurrent milestone modifications
            const lockedContract = await contractRepo.findOne({
                where: SecurityService.withTenant({ id: contractId }),
                lock: { mode: "pessimistic_write" }
            });
            if (!lockedContract) throw new Error("Không tìm thấy hợp đồng");

            const contract = await contractRepo.findOne({
                where: SecurityService.withTenant({ id: contractId }),
                relations: ["project"]
            });
            if (contract) {
                this.assertContractAndProjectNotClosed(contract);
            }

            // 2. Fetch all existing milestones under lock
            const existingMilestones = await milestoneRepo.find({
                where: SecurityService.withTenant({ contract: { id: contractId } })
            });

            // 3. Chuẩn hóa từng milestone theo đúng độ chính xác cột DB numeric(5, 2)
            const normalizedMilestones = milestones.map(item => ({
                ...item,
                percentage: toDecimal(item.percentage || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
            }));

            // Validate Total Percentage with locked, authoritative data
            const currentTotal = existingMilestones.reduce(
                (sum, m) => sum.add(toDecimal(m.percentage || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)),
                new Decimal(0)
            );
            const newTotal = normalizedMilestones.reduce(
                (sum, m) => sum.add(toDecimal(m.percentage || 0)),
                new Decimal(0)
            );
            const combinedTotal = currentTotal.add(newTotal).toNumber();

            if (combinedTotal > 100) {
                throw new Error(`Tổng phần trăm thanh toán vượt quá 100% (Hiện tại: ${currentTotal.toNumber()}%, Thêm mới: ${newTotal.toNumber()}%)`);
            }

            const collectible = getContractCollectibleTotalDecimal(lockedContract);
            const entities = normalizedMilestones.map(item => {
                const amount = collectible
                    .mul(toDecimal(item.percentage))
                    .div(100)
                    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
                    .toNumber();
                return milestoneRepo.create({
                    contract: lockedContract,
                    name: item.name,
                    percentage: item.percentage,
                    amount: amount,
                    description: item.description,
                    dueDate: item.dueDate ? item.dueDate : null,
                    ...SecurityService.getTenantWhere()
                } as object);
            });

            const saved = await milestoneRepo.save(entities);

            const newDebts: Debts[] = saved.map(s => debtRepo.create({
                name: `Phải thu: ${s.name}`,
                contract: lockedContract,
                milestone: s,
                amount: s.amount,
                dueDate: s.dueDate || new Date(),
                status: DebtStatus.UNPAID,
                ...SecurityService.getTenantWhere()
            } as any) as unknown as Debts);

            await debtRepo.save(newDebts);

            return saved;
        });

        return savedMilestones;
    }

    async update(id: string, data: any) {
        return await AppDataSource.transaction(async (manager) => {
            const contractRepo = manager.getRepository(Contracts);
            const milestoneRepo = manager.getRepository(PaymentMilestones);
            const debtRepo = manager.getRepository(Debts);

            const milestone = await milestoneRepo.findOne({
                where: SecurityService.withTenant({ id }),
                relations: ["contract", "debt", "debt.payments"]
            });

            if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");

            // 1. Lock contract row to prevent concurrent milestone modifications
            const lockedContract = await contractRepo.findOne({
                where: SecurityService.withTenant({ id: milestone.contract.id }),
                lock: { mode: "pessimistic_write" }
            });
            if (!lockedContract) throw new Error("Không tìm thấy hợp đồng");

            const contract = await contractRepo.findOne({
                where: SecurityService.withTenant({ id: milestone.contract.id }),
                relations: ["project"]
            });
            if (contract) this.assertContractAndProjectNotClosed(contract);

            if (this.isDebtUnmodifiable(milestone.debt)) {
                throw new Error(`Đợt thanh toán "${milestone.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể chỉnh sửa.`);
            }

            // Re-validate if percentage changes
            if (data.percentage !== undefined && data.percentage !== null) {
                const normalizedNewPercentage = toDecimal(data.percentage).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber();
                if (normalizedNewPercentage !== Number(milestone.percentage)) {
                    const existingMilestones = await milestoneRepo.find({
                        where: SecurityService.withTenant({ contract: { id: milestone.contract.id } })
                    });

                    const otherMilestonesTotal = existingMilestones
                        .filter(m => String(m.id) !== String(id))
                        .reduce((sum, m) => sum.add(toDecimal(m.percentage || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP)), new Decimal(0));

                    const combined = otherMilestonesTotal.add(toDecimal(normalizedNewPercentage)).toNumber();
                    if (combined > 100) {
                        throw new Error(`Tổng phần trăm thanh toán vượt quá 100%`);
                    }

                    // Recalculate amount using Decimal
                    milestone.percentage = normalizedNewPercentage;
                    milestone.amount = getContractCollectibleTotalDecimal(lockedContract)
                        .mul(toDecimal(normalizedNewPercentage))
                        .div(100)
                        .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
                        .toNumber();
                }
            }

            if (data.name) milestone.name = data.name;
            if (data.description !== undefined) milestone.description = data.description;
            if (data.dueDate !== undefined) milestone.dueDate = data.dueDate ? data.dueDate : null;

            const savedMilestone = await milestoneRepo.save(milestone);

            // If debt exists and has no payments, sync debt with updated milestone
            if (milestone.debt) {
                if (data.name) milestone.debt.name = `Phải thu: ${milestone.name}`;
                if (milestone.amount !== undefined) milestone.debt.amount = milestone.amount;
                if (data.dueDate !== undefined) milestone.debt.dueDate = data.dueDate ? data.dueDate : new Date();
                await debtRepo.save(milestone.debt);
            }

            return savedMilestone;
        });
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
        if (!milestones || milestones.length === 0) {
            throw new Error("Danh sách lộ trình thanh toán trống");
        }

        // 1. Chuẩn hóa từng milestone theo đúng độ chính xác cột DB numeric(5, 2)
        const normalizedMilestones = milestones.map(m => ({
            ...m,
            percentage: toDecimal(m.percentage || 0).toDecimalPlaces(2, Decimal.ROUND_HALF_UP).toNumber()
        }));

        // Validate Total Percentage: Tuyệt đối không được vượt quá 100% sau khi làm tròn
        const totalDecimal = normalizedMilestones.reduce((sum, m) => sum.add(toDecimal(m.percentage)), new Decimal(0));
        const total = totalDecimal.toNumber();
        if (total > 100) {
            throw new Error(`Tổng phần trăm thanh toán không được vượt quá 100% (Hiện tại: ${total}%)`);
        }
        if (100 - total > 0.05) {
            throw new Error(`Tổng phần trăm thanh toán phải bằng 100% (Hiện tại: ${total}%)`);
        }

        return await AppDataSource.transaction(async (manager) => {
            const contractRepo = manager.getRepository(Contracts);
            const milestoneRepo = manager.getRepository(PaymentMilestones);
            const debtRepo = manager.getRepository(Debts);

            // 1. Lock contract row to prevent concurrent bulkSave
            const lockedContract = await contractRepo.findOne({
                where: SecurityService.withTenant({ id: contractId }),
                lock: { mode: "pessimistic_write" }
            });
            if (!lockedContract) throw new Error("Không tìm thấy hợp đồng");

            const contract = await contractRepo.findOne({
                where: SecurityService.withTenant({ id: contractId }),
                relations: ["project"]
            });
            if (contract) this.assertContractAndProjectNotClosed(contract);

            const totalDecimalUnderLock = normalizedMilestones.reduce((sum, m) => sum.add(toDecimal(m.percentage)), new Decimal(0));
            const totalUnderLock = totalDecimalUnderLock.toNumber();
            if (totalUnderLock > 100) {
                throw new Error(`Tổng phần trăm thanh toán không được vượt quá 100% (Hiện tại: ${totalUnderLock}%)`);
            }
            if (100 - totalUnderLock > 0.05) {
                throw new Error(`Tổng phần trăm thanh toán phải bằng 100% (Hiện tại: ${totalUnderLock}%)`);
            }

            // 2. Fetch all existing milestones for this contract with their debts and payments under lock
            const existingMilestones = await milestoneRepo.find({
                where: { contract: { id: contractId } },
                relations: ["debt", "debt.payments"]
            });

            // 3. Check for existing milestones that have payments or are locked
            for (const existing of existingMilestones) {
                const isUnmodifiable = this.isDebtUnmodifiable(existing.debt);
                if (isUnmodifiable) {
                    const incoming = normalizedMilestones.find(m => m.id && String(m.id) === String(existing.id));
                    if (!incoming) {
                        throw new Error(`Đợt thanh toán "${existing.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể xóa.`);
                    }
                    if (Number(incoming.percentage) !== Number(existing.percentage)) {
                        throw new Error(`Đợt thanh toán "${existing.name}" đã bị khóa hoặc đã phát sinh thanh toán, không thể thay đổi tỷ lệ.`);
                    }
                }
            }

            // 4. Perform updates, deletions, and additions in the transaction
            // A. Remove existing milestones that are not in incoming milestones list
            const incomingIds = new Set(normalizedMilestones.filter(m => m.id).map(m => String(m.id)));
            const debtsToRemove = [];
            const milestonesToRemove = [];
            for (const existing of existingMilestones) {
                if (!incomingIds.has(String(existing.id))) {
                    if (existing.debt) {
                        debtsToRemove.push(existing.debt);
                    }
                    milestonesToRemove.push(existing);
                }
            }
            if (debtsToRemove.length > 0) {
                await debtRepo.remove(debtsToRemove);
            }
            if (milestonesToRemove.length > 0) {
                await milestoneRepo.remove(milestonesToRemove);
            }

            // B. Upsert (update existing or create new) - Batched
            const milestonesToUpdate = [];
            const debtsToUpdate = [];
            const milestonesToCreate = [];

            const collectible = getContractCollectibleTotalDecimal(lockedContract);
            for (const item of normalizedMilestones) {
                const amount = collectible
                    .mul(toDecimal(item.percentage))
                    .div(100)
                    .toDecimalPlaces(3, Decimal.ROUND_HALF_UP)
                    .toNumber();

                if (item.id) {
                    const existing = existingMilestones.find(m => String(m.id) === String(item.id));
                    if (existing) {
                        const isUnmodifiable = this.isDebtUnmodifiable(existing.debt);
                        existing.name = item.name;
                        existing.percentage = item.percentage;
                        existing.amount = amount;
                        if (item.description !== undefined) existing.description = item.description;
                        if (item.dueDate !== undefined) existing.dueDate = item.dueDate ? item.dueDate : null;

                        milestonesToUpdate.push(existing);

                        // If debt exists and is not unmodifiable, sync debt with updated milestone
                        if (existing.debt && !isUnmodifiable) {
                            existing.debt.name = `Phải thu: ${existing.name}`;
                            existing.debt.amount = amount;
                            if (existing.dueDate) existing.debt.dueDate = existing.dueDate;
                            debtsToUpdate.push(existing.debt);
                        }
                        continue;
                    }
                }

                // If new milestone (no id or not in existing)
                const newMilestone: PaymentMilestones = milestoneRepo.create({
                    contract: lockedContract,
                    name: item.name,
                    percentage: item.percentage,
                    amount: amount,
                    description: item.description,
                    dueDate: item.dueDate ? item.dueDate : null,
                    ...SecurityService.getTenantWhere()
                } as object);
                milestonesToCreate.push(newMilestone);
            }

            const savedUpdated = milestonesToUpdate.length > 0 ? await milestoneRepo.save(milestonesToUpdate) : [];
            if (debtsToUpdate.length > 0) {
                await debtRepo.save(debtsToUpdate);
            }

            const savedCreated = milestonesToCreate.length > 0 ? await milestoneRepo.save(milestonesToCreate) : [];
            if (savedCreated.length > 0) {
                const newDebts = savedCreated.map(saved => debtRepo.create({
                    name: `Phải thu: ${saved.name}`,
                    contract: lockedContract,
                    milestone: saved,
                    amount: saved.amount,
                    dueDate: saved.dueDate || new Date(),
                    status: DebtStatus.UNPAID,
                    ...SecurityService.getTenantWhere()
                } as any) as unknown as Debts);
                await debtRepo.save(newDebts);
            }

            return [...savedUpdated, ...savedCreated];
        });
    }
}
