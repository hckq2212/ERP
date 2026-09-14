import { Router } from "express";
import multer from "multer";
import { VideoGenerationController } from "../controllers/VideoGeneration.Controller";
import { MotionGenerationController } from "../controllers/MotionGeneration.Controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const videoGenerationController = new VideoGenerationController();
const motionGenerationController = new MotionGenerationController();

// ── Video generation (image-to-video, Kling/BytePlus) ─────────────────────
router.post(
    "/create",
    upload.fields([
        { name: "startImage", maxCount: 1 },
        { name: "endImage", maxCount: 1 },
    ]),
    videoGenerationController.create,
);
router.get("/history", videoGenerationController.getHistory);
router.get("/:id/status", videoGenerationController.getStatus);

// ── Motion control (Kling only) ────────────────────────────────────────────
router.post(
    "/create-motion-control",
    upload.fields([
        { name: "characterImage", maxCount: 1 },
        { name: "referenceVideo", maxCount: 1 },
    ]),
    motionGenerationController.create,
);
router.get("/motion-control/history", motionGenerationController.getHistory);
router.get("/motion-control/:id/status", motionGenerationController.getStatus);

export default router;