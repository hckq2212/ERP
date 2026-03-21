import { AppDataSource } from "../data-source";
import { Notifications } from "../entity/Notification.entity";
import { Users } from "../entity/User.entity";
import { EntityManager } from "typeorm";

import { notificationEmitter, NOTIFICATION_EVENTS } from "../events/NotificationEmitter";

export class NotificationService {
    private notificationRepository = AppDataSource.getRepository(Notifications);

    async createNotification(data: {
        title: string;
        content: string;
        type: string;
        recipient: Users;
        sender?: Users;
        link?: string;
        relatedEntityId?: string;
        relatedEntityType?: string;
    }, manager?: EntityManager) {
        const repo = manager ? manager.getRepository(Notifications) : this.notificationRepository;
        const notification = repo.create({
            ...data,
            isRead: false
        });

        const savedNotification = await repo.save(notification);

        // Emit real-time event via SSE emitter
        notificationEmitter.emit(NOTIFICATION_EVENTS.NEW_NOTIFICATION, {
            recipientId: data.recipient.id,
            notification: savedNotification
        });

        return savedNotification;
    }

    async getMyNotifications(userId: string) {
        return await this.notificationRepository.find({
            where: { recipient: { id: userId } },
            order: { createdAt: "DESC" }
        });
    }

    async markAsRead(id: string) {
        const notification = await this.notificationRepository.findOneBy({ id });
        if (notification) {
            notification.isRead = true;
            notification.readAt = new Date();
            await this.notificationRepository.save(notification);
        }
        return notification;
    }
}
