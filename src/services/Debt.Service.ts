import { AppDataSource } from "../data-source";
import { Debts, DebtStatus } from "../entity/Debt.entity";
import { PaymentMilestones } from "../entity/PaymentMilestone.entity";

export class DebtService {
    private debtRepository = AppDataSource.getRepository(Debts);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);

    async getAll() {
        return await this.debtRepository.find({
            relations: ["contract", "milestone", "payments"]
        });
    }

    async getOne(id: number) {
        const debt = await this.debtRepository.findOne({
            where: { id },
            relations: ["contract", "milestone", "payments"]
        });
        if (!debt) throw new Error("Không tìm thấy khoản nợ");
        return debt;
    }

    async getByContract(contractId: number) {
        return await this.debtRepository.find({
            where: { contract: { id: contractId } },
            relations: ["milestone", "payments"]
        });
    }

    async createFromMilestone(milestoneId: number) {
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

    async delete(id: number) {
        const debt = await this.getOne(id);
        if (debt.payments && debt.payments.length > 0) {
            throw new Error("Không thể xóa khoản nợ đã có lượt thanh toán");
        }
        return await this.debtRepository.remove(debt);
    }
}
