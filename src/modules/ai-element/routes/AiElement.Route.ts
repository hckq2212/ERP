import { Router } from "express";
import multer from "multer";
import { AiElementController } from "../controllers/AiElement.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { sensitiveLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();

const DANGEROUS_EXTENSIONS = /\.(exe|bat|cmd|sh|php|js|mjs|cjs|vbs|msi|bin|scr|jar|apk|com|pif|reg|dll|sys|html|htm)$/i;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB cho tệp AI element
        files: 5
    },
    fileFilter: (_req, file, cb) => {
        if (DANGEROUS_EXTENSIONS.test(file.originalname || "")) {
            return cb(new Error("Định dạng tệp thực thi hoặc mã độc bị cấm tải lên"));
        }
        cb(null, true);
    }
});

const aiElementController = new AiElementController();

const aiElementRoles = roleMiddleware(["ADMIN", "BOD", "PM", "DESIGNER", "EDITOR_V"]);

router.post(
    "/create",
    aiElementRoles,
    sensitiveLimiter,
    upload.fields([
        { name: "frontalImage", maxCount: 1 },
        { name: "referImages", maxCount: 3 },
        { name: "video", maxCount: 1 },
    ]),
    aiElementController.create,
);
router.get("/history", aiElementController.getHistory);
router.get("/task/:taskId/status", aiElementController.getKlingTaskStatus);
router.get("/:id/status", aiElementController.getStatus);
router.delete("/:id", aiElementRoles, aiElementController.remove);
router.patch("/:id/favorite", aiElementRoles, aiElementController.setFavorite);

export default router;