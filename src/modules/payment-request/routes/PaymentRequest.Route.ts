import { Router } from "express";
import multer from "multer";
import { PaymentRequestController } from "../controllers/PaymentRequest.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";

const router = Router();
const controller = new PaymentRequestController();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 15 * 1024 * 1024 },
});

router.get("/", controller.getAll);
router.get("/total-debt", controller.getTotalDebt);
router.get("/service-budget", controller.getServiceBudget);
router.get("/project-budget-summary/:projectId", controller.getProjectBudgetSummary);
router.get("/task/:taskId/spent", controller.getTaskSpent);
router.get("/next-stt", controller.getNextStt);
router.get("/download-template-word", controller.downloadTemplateWord);
router.post("/generate-word-and-upload", controller.generateWordAndUpload);
router.get("/:id", controller.getOne);
router.post("/upload-invoice", upload.single("file"), controller.uploadInvoice);
router.post("/", controller.create);
router.patch("/:id", controller.update);
router.patch("/:id/supplement", controller.supplement);
router.post("/:id/submit", controller.submit);
router.delete("/:id", controller.delete);

router.post("/:id/invoice-pdfs", controller.addInvoicePdf);

router.post(
    "/:id/review",
    roleMiddleware(["ADMIN_SALE", "BOD", "ADMIN"]),
    controller.review
);

router.post(
    "/:id/bod-decision",
    roleMiddleware(["BOD", "ADMIN"]),
    controller.bodDecision
);

router.post(
    "/:id/pay",
    roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]),
    controller.pay
);

router.post(
    "/:id/record-payment",
    roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]),
    controller.recordPayment
);

router.post(
    "/:id/submit-settlement",
    controller.submitSettlement
);

router.post(
    "/:id/approve-settlement",
    roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]),
    controller.approveSettlement
);

router.post(
    "/:id/reject-settlement",
    roleMiddleware(["BOD", "ADMIN", "ADMIN_SALE"]),
    controller.rejectSettlement
);

router.post("/:id/settlement-files", controller.addSettlementFiles);

router.post("/:id/payment-proofs", controller.uploadPaymentProof);

router.post("/:id/cancel", controller.cancel);
router.get("/:id/doc-preview", controller.getDocPreview);
router.get("/:id/download-word", controller.downloadWord);
router.post("/:id/sync-google-sheet", controller.syncGoogleSheet);

export default router;

