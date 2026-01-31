import { AppDataSource } from "../data-source";
import { DebtPayments } from "../entity/DebtPayment.entity";
import { Debts, DebtStatus } from "../entity/Debt.entity";
import { PaymentMilestones, MilestoneStatus } from "../entity/PaymentMilestone.entity";

export class DebtPaymentService {
    private paymentRepository = AppDataSource.getRepository(DebtPayments);
    private debtRepository = AppDataSource.getRepository(Debts);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);

    async create(data: { debtId: number, amount: number, paymentDate: Date, note?: string }) {
        const debt = await this.debtRepository.findOne({
            where: { id: data.debtId },
            relations: ["milestone", "payments"]
        });

        if (!debt) throw new Error("Không tìm thấy khoản nợ");

        // 1. Create the payment
        const payment = this.paymentRepository.create({
            debt,
            amount: data.amount,
            paymentDate: data.paymentDate,
            note: data.note
        });
        const savedPayment = await this.paymentRepository.save(payment);

        // 2. Recalculate Totals & Update Status
        await this.updateDebtStatus(debt.id);

        return savedPayment;
    }

    async updateDebtStatus(debtId: number) {
        const debt = await this.debtRepository.findOne({
            where: { id: debtId },
            relations: ["payments", "milestone"]
        });

        if (!debt) return;

        const totalPaid = (debt.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        const debtAmount = Number(debt.amount);

        let newStatus = DebtStatus.UNPAID;
        if (totalPaid >= debtAmount) {
            newStatus = DebtStatus.PAID;
        } else if (totalPaid > 0) {
            newStatus = DebtStatus.PARTIAL;
        }

        // Update Debt Status
        debt.status = newStatus;
        await this.debtRepository.save(debt);

        // Update Milestone Status if Paid
        if (newStatus === DebtStatus.PAID && debt.milestone) {
            debt.milestone.status = MilestoneStatus.COMPLETED;
            await this.milestoneRepository.save(debt.milestone);
        } else if (newStatus !== DebtStatus.PAID && debt.milestone) {
            debt.milestone.status = MilestoneStatus.PENDING;
            await this.milestoneRepository.save(debt.milestone);
        }
    }

    async delete(id: number) {
        const payment = await this.paymentRepository.findOne({
            where: { id },
            relations: ["debt"]
        });
        if (!payment) throw new Error("Không tìm thấy lượt thanh toán");

        const debtId = payment.debt.id;
        await this.paymentRepository.remove(payment);

        // Recalculate after delete
        await this.updateDebtStatus(debtId);

        return { message: "Xóa lượt thanh toán thành công" };
    }
}
