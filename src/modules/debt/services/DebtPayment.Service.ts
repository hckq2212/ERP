import { AppDataSource } from "../../../data-source";
import { DebtPayments } from "../entities/DebtPayment.entity";
import { Debts, DebtStatus } from "../entities/Debt.entity";
import { PaymentMilestones, MilestoneStatus } from "../../payment-milestone/entities/PaymentMilestone.entity";
import {
    assertDebtNotLocked,
    resolveDebtStatusAfterPayment
} from "../helpers/DebtLock.helper";

export class DebtPaymentService {
    private paymentRepository = AppDataSource.getRepository(DebtPayments);
    private debtRepository = AppDataSource.getRepository(Debts);
    private milestoneRepository = AppDataSource.getRepository(PaymentMilestones);

    async create(data: { debtId: string, amount: number, paymentDate: Date, note?: string, attachments?: any[] }) {
        const debt = await this.debtRepository.findOne({
            where: { id: data.debtId },
            relations: ["milestone", "payments"]
        });

        if (!debt) throw new Error("Không tìm thấy khoản nợ");

        // 🔒 FIX #2: công nợ đã khóa thì KHÔNG ghi thanh toán.
        // Nghiệp vụ: khách thanh toán TRƯỚC ⇒ dự án đã đóng thì không thể còn
        // nợ chưa thu. Chặn ở đây để không phát sinh giao dịch trên khoản đã chốt.
        assertDebtNotLocked(debt);

        // 1. Create the payment
        const payment = this.paymentRepository.create({
            debt,
            amount: data.amount,
            paymentDate: data.paymentDate,
            note: data.note,
            attachments: data.attachments || null
        });
        const savedPayment = await this.paymentRepository.save(payment);

        // 2. Recalculate Totals & Update Status
        await this.updateDebtStatus(debt.id);

        return savedPayment;
    }

    async updateDebtStatus(debtId: string) {
        const debt = await this.debtRepository.findOne({
            where: { id: debtId },
            relations: ["payments", "milestone"]
        });

        if (!debt) return;

        const totalPaid = (debt.payments || []).reduce((sum, p) => sum + Number(p.amount), 0);
        const debtAmount = Number(debt.amount);

        const newStatus = resolveDebtStatusAfterPayment(debt.status, totalPaid, debtAmount);

        // `null` = debt LOCKED → giữ nguyên, KHÔNG ghi đè.
        // Đây là lớp bảo vệ thứ 2 (defense in depth) phòng khi có luồng khác
        // gọi trực tiếp hàm này mà bỏ qua guard ở `create()`.
        if (newStatus === null) return;

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

    async delete(id: string) {
        const payment = await this.paymentRepository.findOne({
            where: { id },
            relations: ["debt"]
        });
        if (!payment) throw new Error("Không tìm thấy lượt thanh toán");

        // 🔒 Không sửa lịch sử thu tiền của dự án đã đóng
        assertDebtNotLocked(payment.debt);

        const debtId = payment.debt.id;
        await this.paymentRepository.remove(payment);

        // Recalculate after delete
        await this.updateDebtStatus(debtId);

        return { message: "Xóa lượt thanh toán thành công" };
    }
}
