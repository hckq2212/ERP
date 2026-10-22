import { Router } from "express";
import { NotificationController } from "../controllers/Notification.Controller";

const router = Router();
const notificationController = new NotificationController();

router.get("/me", notificationController.getMyNotifications);
router.get("/stream", notificationController.streamNotifications);
router.put("/:id/read", notificationController.markAsRead);
router.post("/devices", notificationController.registerDevice);
router.delete("/devices/:deviceId", notificationController.unregisterDevice);

export default router;
