import { Router } from "express";
import { DebtController } from "../controllers/Debt.Controller";
import { DebtPaymentController } from "../controllers/DebtPayment.Controller";

const router = Router();
const debtController = new DebtController();
const paymentController = new DebtPaymentController();

// Debts
router.get("/", debtController.getAll);
router.get("/:id", debtController.getOne);
router.post("/activate", debtController.createFromMilestone);
router.delete("/:id", debtController.delete);

// Payments
router.post("/payments", paymentController.create);
router.delete("/payments/:id", paymentController.delete);

export default router;
