import { Response } from "express";
import { NotificationService } from "../services/Notification.Service";
import { PushNotificationService } from "../services/PushNotification.Service";
import { AuthRequest } from "../../../shared/middlewares/Auth.Middleware";
import { GLOBAL_NOTIFICATION_CHANNEL, notificationManager } from "../events/NotificationEmitter";

export class NotificationController {
    private notificationService = new NotificationService();
    private pushNotificationService = new PushNotificationService();

streamNotifications = async (req: AuthRequest, res: Response) => {
        const userId = req.user?.userId || req.user?.id;
        if (!userId) {
            return res.status(401).json({ message: "Unauthorized" });
        }

        // SSE Headers
        res.setHeader("Content-Type", "text/event-stream");
        res.setHeader("Cache-Control", "no-cache");
        res.setHeader("Connection", "keep-alive");
        res.setHeader("X-Accel-Buffering", "no"); // Chống Nginx/proxy buffer, để dữ liệu đẩy realtime
        res.flushHeaders(); 

        // Keep-alive heartbeat every 30 seconds
        const heartbeat = setInterval(() => {
            res.write(": keep-alive\n\n");
        }, 30000);

        // Register connection with Singleton Manager
        notificationManager.addConnection(GLOBAL_NOTIFICATION_CHANNEL, userId, res);

        // Cleanup on connection close
        req.on("close", () => {
            clearInterval(heartbeat);
            notificationManager.removeConnection(GLOBAL_NOTIFICATION_CHANNEL, userId, res);
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

    registerDevice = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }
            const { token, deviceId, platform, deviceName } = req.body;
            if (!token || !deviceId) {
                return res.status(400).json({ message: "token và deviceId là bắt buộc." });
            }
            const saved = await this.pushNotificationService.registerDevice(userId, {
                token,
                deviceId,
                platform,
                deviceName
            });
            res.status(200).json({ success: true, data: saved });
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }

    unregisterDevice = async (req: AuthRequest, res: Response) => {
        try {
            const userId = req.user?.userId || req.user?.id;
            if (!userId) {
                return res.status(401).json({ message: "Unauthorized" });
            }
            const deviceId = req.params.deviceId as string;
            if (!deviceId) {
                return res.status(400).json({ message: "deviceId là bắt buộc." });
            }
            await this.pushNotificationService.unregisterDevice(userId, deviceId);
            res.status(200).json({ success: true });
        } catch (error: any) {
            res.status(500).json({ message: error.message });
        }
    }
}
