import { Response } from "express";
import { NotificationService } from "../services/Notification.Service";
import { AuthRequest } from "../middlewares/Auth.Middleware";

export class NotificationController {
    private notificationService = new NotificationService();

    getMyNotifications = async (req: AuthRequest, res: Response) => {
        try {
            const userId = Number(req.user?.id);
            if (!userId) {
                return res.status(400).json({ message: "Không tìm thấy thông tin người dùng." });
            }
            const notifications = await this.notificationService.getMyNotifications(userId);
            res.status(200).json(notifications);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }

    markAsRead = async (req: AuthRequest, res: Response) => {
        try {
            const notificationId = Number(req.params.id);
            const notification = await this.notificationService.markAsRead(notificationId);
            res.status(200).json(notification);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}
