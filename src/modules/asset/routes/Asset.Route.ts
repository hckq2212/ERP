import { Router } from "express";
import multer from "multer";
import path from "path";
import { AssetController } from "../controllers/Asset.Controller";

const router = Router();
const assetController = new AssetController();

const DANGEROUS_EXTENSIONS = /\.(exe|bat|cmd|sh|php|js|mjs|cjs|vbs|msi|bin|scr|jar|apk|com|pif|reg|dll|sys|html|htm)$/i;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 25 * 1024 * 1024, // 25MB chống tràn RAM bộ nhớ Heap
        files: 1
    },
    fileFilter: (_req, file, cb) => {
        if (DANGEROUS_EXTENSIONS.test(file.originalname || "")) {
            return cb(new Error("Định dạng tệp thực thi hoặc mã độc bị cấm tải lên"));
        }
        cb(null, true);
    }
});

// GET /api/assets?tab=creative|upload&type=all|image|video|audio&favorite=true
router.get("/", assetController.findLibrary);
router.get("/:id", assetController.getOne);
router.post("/upload", upload.single("file"), assetController.upload);
router.patch("/:id/favorite", assetController.toggleFavorite);

export default router;