import { Router } from "express";
import multer from "multer";
import path from "path";
import { SpellingCheckController } from "../controllers/SpellingCheck.Controller";

const router = Router();
const controller = new SpellingCheckController();

const ALLOWED_EXTENSIONS = new Set([".txt", ".csv", ".xlsx", ".xlsm"]);

const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 30 * 1024 * 1024, files: 1 }, // Giảm từ 500MB xuống 30MB chống DoS tràn RAM V8
    fileFilter: (_req, file, cb) => {
        const ext = path.extname(file.originalname || "").toLowerCase();
        if (!ALLOWED_EXTENSIONS.has(ext)) {
            return cb(new Error(`Định dạng tệp ${ext} không được hỗ trợ kiểm tra chính tả`));
        }
        cb(null, true);
    }
});

router.post("/sheets", upload.single("file"), controller.listSheets);
router.post("/sheets-from-url", controller.listSheetsFromUrl);
router.post("/preview-from-url", controller.previewFromUrl);
router.post("/preview", upload.single("file"), controller.preview);
router.post("/start", upload.single("file"), controller.start);
router.post("/start-from-url", controller.startFromUrl);
router.get("/:jobId", controller.getStatus);
router.get("/:jobId/pdf", controller.getPdf);
router.delete("/:jobId", controller.delete);

export default router;
