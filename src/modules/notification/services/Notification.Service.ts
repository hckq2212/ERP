import { AppDataSource } from "../../../data-source";
import { Notifications } from "../entities/Notification.entity";
import { Users } from "../../user/entities/User.entity";
import { EntityManager } from "typeorm";
import { SecurityService } from "../../../shared/services/Security.Service";

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
    }, manager?: EntityManager, options?: { emit?: boolean }) {
        const repo = manager ? manager.getRepository(Notifications) : this.notificationRepository;
        const notification = repo.create({
            ...data,
            isRead: false,
            ...SecurityService.getTenantWhere()
        } as any) as unknown as Notifications;

        const savedNotification = await repo.save(notification);

        // Mặc định luôn emit ngay (giữ hành vi cũ cho các nơi gọi khác).
        // Riêng nơi nào đang chạy trong transaction dài (nhiều bản ghi) nên truyền
        // { emit: false } và tự gọi emitNewNotification() sau khi transaction commit xong,
        // để tránh client nhận SSE rồi refetch nhưng dữ liệu chưa commit (phải F5 mới thấy).
        const shouldEmit = options?.emit ?? true
        if (shouldEmit) {
            this.emitNewNotification(data.recipient.id, savedNotification)
        }

        return savedNotification;
    }

    emitNewNotification(recipientId: string, notification: any) {
        notificationEmitter.emit(NOTIFICATION_EVENTS.NEW_NOTIFICATION, {
            recipientId,
            notification
        });
    }

    async getMyNotifications(userId: string) {
        return await this.notificationRepository.find({
            where: SecurityService.withTenant({ recipient: { id: userId } }),
            order: { createdAt: "DESC" }
        });
    }

    async markAsRead(id: string) {
        const notification = await this.notificationRepository.findOne({ where: SecurityService.withTenant({ id }) });
        if (notification) {
            notification.isRead = true;
            notification.readAt = new Date();
            await this.notificationRepository.save(notification);
        }
        return notification;
    }
}
