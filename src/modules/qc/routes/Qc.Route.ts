import { Router } from "express";
import multer from "multer";
import { QcController } from "../controllers/Qc.Controller";

const router = Router();
const controller = new QcController();

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 500 * 1024 * 1024, files: 1 },
});

router.post("/sheets", upload.single("file"), controller.sheets);
router.post("/sheets-from-url", controller.sheetsFromUrl);
router.get("/product-info/:projectId", controller.productInfo);
router.post("/run", upload.single("file"), controller.run);
router.post("/report-pdf", controller.reportPdf);

export default router;
