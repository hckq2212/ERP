import { Router } from "express";
import multer from "multer";
import { AiElementController } from "../controllers/AiElement.Controller";

const router = Router();
const upload = multer({ storage: multer.memoryStorage() });

const aiElementController = new AiElementController();

router.post(
    "/create",
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
router.delete("/:id", aiElementController.remove);
router.patch("/:id/favorite", aiElementController.setFavorite);

export default router;