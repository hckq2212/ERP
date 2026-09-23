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

router.post("/:id/payment-proofs", controller.uploadPaymentProof);

export default router;
