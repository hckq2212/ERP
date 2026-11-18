import { Router } from "express";
import { FinanceDocumentController } from "../controllers/FinanceDocument.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new FinanceDocumentController();

const financeDocRoles = roleMiddleware(["ADMIN", "BOD", "ADMIN_SALE", "ACCOUNTANT", "PM"]);

router.get("/contracts/:contractId", controller.getByContract);
router.post("/acceptance-minutes", financeDocRoles, controller.createAcceptanceMinute);
router.post("/vat-invoices", financeDocRoles, controller.createVatInvoice);

export default router;
