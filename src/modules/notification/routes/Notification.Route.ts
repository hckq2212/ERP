import { Router } from "express";
import { NotificationController } from "../controllers/Notification.Controller";

const router = Router();
const notificationController = new NotificationController();

router.get("/me", notificationController.getMyNotifications);
router.get("/stream", notificationController.streamNotifications);
router.put("/:id/read", notificationController.markAsRead);

export default router;
