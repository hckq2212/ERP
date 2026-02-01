import { AppDataSource } from "../data-source";
import { PaymentMilestones } from "../entity/PaymentMilestone.entity";
import { Contracts } from "../entity/Contract.entity";

export class PaymentMilestoneService {
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);
    private contractRepository = AppDataSource.getRepository(Contracts);

    async getAll() {
        return await this.milestoneRepository.find({
            relations: ["contract"],
            order: { id: "ASC" }
        });
    }

    async getByContract(contractId: number) {
        return await this.milestoneRepository.find({
            where: { contract: { id: contractId } },
            order: { id: "ASC" }
        });
    }

    async create(data: { contractId: number, milestones: any[] }) {
        const { contractId, milestones } = data;

        const contract = await this.contractRepository.findOne({
            where: { id: contractId },
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
                dueDate: item.dueDate
            });

            savedMilestones.push(await this.milestoneRepository.save(milestone));
        }

        return savedMilestones;
    }

    async update(id: number, data: any) {
        const milestone = await this.milestoneRepository.findOne({
            where: { id },
            relations: ["contract"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");

        const contract = await this.contractRepository.findOne({
            where: { id: milestone.contract.id },
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
        if (data.description) milestone.description = data.description;
        if (data.dueDate) milestone.dueDate = data.dueDate;

        return await this.milestoneRepository.save(milestone);
    }

    async delete(id: number) {
        const milestone = await this.milestoneRepository.findOne({
            where: { id },
            relations: ["debt"]
        });

        if (!milestone) throw new Error("Không tìm thấy giai đoạn thanh toán");

        if (milestone.debt) {
            throw new Error("Không thể xóa giai đoạn đã phát sinh công nợ");
        }

        await this.milestoneRepository.remove(milestone);
        return { message: "Xóa giai đoạn thanh toán thành công" };
    }

    async bulkSave(contractId: number, milestones: any[]) {
        const contract = await this.contractRepository.findOne({
            where: { id: contractId },
            relations: ["milestones", "milestones.debt"]
        });

        if (!contract) throw new Error("Không tìm thấy hợp đồng");

        // 1. Validate Total Percentage
        const total = milestones.reduce((sum, m) => sum + Number(m.percentage), 0);
        if (total !== 100) {
            throw new Error(`Tổng phần trăm thanh toán phải bằng 100% (Hiện tại: ${total}%)`);
        }

        // 2. Check for active debts
        const lockedMilestones = contract.milestones.filter(m => m.debt);

        // Simple approach: If any debt is active, we might want to prevent bulk reset 
        // to avoid inconsistency. Or just protect the ones with debts.
        // For simplicity, let's allow bulk update ONLY if no debts are active yet.
        if (lockedMilestones.length > 0) {
            throw new Error("Không thể cập nhật hàng loạt khi đã có giai đoạn phát sinh công nợ. Vui lòng chỉnh sửa từng đợt.");
        }

        // 3. Remove old milestones
        await this.milestoneRepository.remove(contract.milestones);

        // 4. Create new ones
        const savedMilestones = [];
        for (const item of milestones) {
            const amount = (Number(contract.sellingPrice) * Number(item.percentage)) / 100;
            const milestone = this.milestoneRepository.create({
                contract,
                name: item.name,
                percentage: item.percentage,
                amount: amount,
                description: item.description,
                dueDate: item.dueDate
            });
            savedMilestones.push(await this.milestoneRepository.save(milestone));
        }

        return savedMilestones;
    }
}
