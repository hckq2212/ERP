import { Router } from "express";
import multer from "multer";
import { VideoGenerationController } from "../controllers/VideoGeneration.Controller";
import { MotionGenerationController } from "../controllers/MotionGeneration.Controller";
import { roleMiddleware } from "../../../shared/middlewares/Role.Middleware";
import { sensitiveLimiter } from "../../../shared/middlewares/RateLimit.Middleware";

const router = Router();

const DANGEROUS_EXTENSIONS = /\.(exe|bat|cmd|sh|php|js|mjs|cjs|vbs|msi|bin|scr|jar|apk|com|pif|reg|dll|sys|html|htm)$/i;

const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: 50 * 1024 * 1024, // 50MB cho tệp video/ảnh mẫu
        files: 2
    },
    fileFilter: (_req, file, cb) => {
        if (DANGEROUS_EXTENSIONS.test(file.originalname || "")) {
            return cb(new Error("Định dạng tệp thực thi hoặc mã độc bị cấm tải lên"));
        }
        cb(null, true);
    }
});

const videoGenerationController = new VideoGenerationController();
const motionGenerationController = new MotionGenerationController();

const aiVideoRoles = roleMiddleware(["ADMIN", "BOD", "PM", "EDITOR_V", "DESIGNER"]);

// ── Video generation (image-to-video, Kling/BytePlus) ─────────────────────
router.post(
    "/create",
    aiVideoRoles,
    sensitiveLimiter,
    upload.fields([
        { name: "startImage", maxCount: 1 },
        { name: "endImage", maxCount: 1 },
    ]),
    videoGenerationController.create,
);
router.get("/history", videoGenerationController.getHistory);
router.get("/tasks/:taskId/budget", videoGenerationController.getTaskBudget);
router.get("/:id/status", videoGenerationController.getStatus);

// ── Motion control (Kling only) ────────────────────────────────────────────
router.post(
    "/create-motion-control",
    aiVideoRoles,
    sensitiveLimiter,
    upload.fields([
        { name: "characterImage", maxCount: 1 },
        { name: "referenceVideo", maxCount: 1 },
    ]),
    motionGenerationController.create,
);
router.get("/motion-control/history", motionGenerationController.getHistory);
router.get("/motion-control/:id/status", motionGenerationController.getStatus);

export default router;
