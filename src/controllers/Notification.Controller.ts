import { Response } from "express";
import { NotificationService } from "../services/Notification.Service";
import { AuthRequest } from "../middlewares/Auth.Middleware";
import { notificationEmitter, NOTIFICATION_EVENTS } from "../events/NotificationEmitter";

export class NotificationController {
    private notificationService = new NotificationService();

    streamNotifications = async (req: AuthRequest, res: Response) => {
        const userId = req.user?.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // SSE Headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.flushHeaders(); // Establish the connection immediately

        // Keep-alive heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
            res.write(": keep-alive\n\n");
        }, 30000);

        // Listener function
        const onNotification = (data: { recipientId: string; notification: any }) => {
            // Check if the notification is for THIS user
            if (data.recipientId === userId) {
                res.write(`data: ${JSON.stringify(data.notification)}\n\n`);
            }
        };

        // Subscribe to events
        notificationEmitter.on(NOTIFICATION_EVENTS.NEW_NOTIFICATION, onNotification);

        // Cleanup on connection close
        req.on("close", () => {
            clearInterval(heartbeat);
            notificationEmitter.off(NOTIFICATION_EVENTS.NEW_NOTIFICATION, onNotification);
            res.end();
        });
    }

    getMyNotifications = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
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
            const notificationId = req.params.id as string;
            const notification = await this.notificationService.markAsRead(notificationId);
            res.status(200).json(notification);
        } catch (error) {
            res.status(500).json({ message: error.message });
        }
    }
}