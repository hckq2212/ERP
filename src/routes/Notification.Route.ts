import { Router } from "express";
import { NotificationController } from "../controllers/Notification.Controller";
import { authMiddleware } from "../middlewares/Auth.Middleware";

const router = Router();
const notificationController = new NotificationController();

// Use authMiddleware for all notification routes
router.use(authMiddleware);

router.get("/me", notificationController.getMyNotifications);
router.put("/:id/read", notificationController.markAsRead);

export default router;
