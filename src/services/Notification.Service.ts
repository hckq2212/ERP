import { AppDataSource } from "../data-source";
import { Notifications } from "../entity/Notification.entity";
import { Users } from "../entity/User.entity";

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
    }) {
        const notification = this.notificationRepository.create({
            ...data,
            isRead: false
        });

        return await this.notificationRepository.save(notification);
    }

    async getMyNotifications(userId: number) {
        return await this.notificationRepository.find({
            where: { recipient: { id: userId } },
            order: { createdAt: "DESC" }
        });
    }

    async markAsRead(id: number) {
        const notification = await this.notificationRepository.findOneBy({ id });
        if (notification) {
            notification.isRead = true;
            notification.readAt = new Date();
            await this.notificationRepository.save(notification);
        }
        return notification;
    }
}
