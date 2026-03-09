import { Router } from "express";
import { DebtController } from "../controllers/Debt.Controller";
import { DebtPaymentController } from "../controllers/DebtPayment.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const debtController = new DebtController();
const paymentController = new DebtPaymentController();

// Debts
router.get("/", authMiddleware, debtController.getAll);
router.get("/:id", authMiddleware, debtController.getOne);
router.get("/contract/:contractId", authMiddleware, debtController.getByContract);
router.post("/activate", authMiddleware, debtController.createFromMilestone);
router.delete("/:id", authMiddleware, debtController.delete);

// Payments
router.post("/payments", authMiddleware, paymentController.create);
router.delete("/payments/:id", authMiddleware, paymentController.delete);

export default router;
