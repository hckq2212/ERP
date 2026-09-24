import { Router } from "express";
import { FinanceDocumentController } from "../controllers/FinanceDocument.Controller";

const router = Router();
const controller = new FinanceDocumentController();

router.get("/contracts/:contractId", controller.getByContract);
router.post("/acceptance-minutes", controller.createAcceptanceMinute);
router.post("/vat-invoices", controller.createVatInvoice);

export default router;
