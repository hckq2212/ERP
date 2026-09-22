import { Router } from "express";
import { DebtController } from "../controllers/Debt.Controller";
import { DebtPaymentController } from "../controllers/DebtPayment.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const debtController = new DebtController();
const paymentController = new DebtPaymentController();

// Debts
router.get("/", debtController.getAll);
router.get("/:id", debtController.getOne);
router.get("/contract/:contractId", debtController.getByContract);
// 🔒 Thao tác TÀI CHÍNH (sinh khoản phải thu) — phải siết quyền.
// Trước đây route này không có middleware nào.
router.post(
    "/activate",
    roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]),
    debtController.createFromMilestone
);
// Mở khóa công nợ — chỉ BOD/ADMIN, bắt buộc nhập lý do (validate trong service)
router.post(
    "/:id/unlock",
    roleMiddleware(["BOD", "ADMIN"]),
    debtController.unlockDebt
);
router.delete("/:id", debtController.delete);

// Payments
router.post("/payments", paymentController.create);
router.delete("/payments/:id", paymentController.delete);

export default router;
