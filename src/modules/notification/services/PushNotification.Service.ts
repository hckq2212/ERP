import { Expo, ExpoPushMessage, ExpoPushTicket } from "expo-server-sdk";
import { AppDataSource } from "../../../data-source";
import { UserDeviceTokens } from "../entities/UserDeviceToken.entity";

export interface RegisterDeviceDto {
    token: string;
    deviceId: string;
    platform?: string;
    deviceName?: string;
}

export interface PushNotificationPayload {
    id?: string;
    title: string;
    content: string;
    link?: string;
    relatedEntityId?: string;
    relatedEntityType?: string;
    type?: string;
}

export class PushNotificationService {
    private expo = new Expo();
    private get repo() {
        return AppDataSource.getRepository(UserDeviceTokens);
    }

    /**
     * Đăng ký hoặc làm mới token thiết bị của người dùng (Upsert)
     */
    async registerDevice(userId: string, data: RegisterDeviceDto): Promise<UserDeviceTokens | null> {
        if (!data.token || !data.deviceId) {
            throw new Error("Thiếu token hoặc deviceId.");
        }

        if (!Expo.isExpoPushToken(data.token)) {
            console.warn(`[PushNotification] Token không đúng định dạng Expo: ${data.token}`);
            return null;
        }

        // Tìm thiết bị đã đăng ký trước đó theo deviceId của user hoặc theo token
        let record = await this.repo.findOne({
            where: [
                { userId, deviceId: data.deviceId },
                { token: data.token }
            ]
        });

        if (record) {
            record.userId = userId;
            record.deviceId = data.deviceId;
            record.token = data.token;
            if (data.platform) record.platform = data.platform;
            if (data.deviceName) record.deviceName = data.deviceName;
            record.lastActiveAt = new Date();
        } else {
            record = this.repo.create({
                userId,
                deviceId: data.deviceId,
                token: data.token,
                platform: data.platform || "android",
                deviceName: data.deviceName,
                lastActiveAt: new Date()
            });
        }

        return await this.repo.save(record);
    }

    /**
     * Hủy đăng ký token khi người dùng đăng xuất khỏi thiết bị
     */
    async unregisterDevice(userId: string, deviceId: string): Promise<boolean> {
        if (!deviceId) return false;
        const result = await this.repo.delete({ userId, deviceId });
        return (result.affected ?? 0) > 0;
    }

    /**
     * Gửi Push Notification tới toàn bộ thiết bị đang kích hoạt của recipient
     */
    async sendPushNotification(recipientId: string, notification: PushNotificationPayload): Promise<void> {
        try {
            const devices = await this.repo.find({
                where: { userId: recipientId }
            });

            if (!devices.length) return;

            const messages: ExpoPushMessage[] = [];
            const tokenToDeviceMap = new Map<string, UserDeviceTokens>();

            for (const device of devices) {
                if (!Expo.isExpoPushToken(device.token)) {
                    console.warn(`[PushNotification] Bỏ qua token không hợp lệ: ${device.token}`);
                    continue;
                }

                tokenToDeviceMap.set(device.token, device);
                messages.push({
                    to: device.token,
                    sound: "default",
                    title: notification.title,
                    body: notification.content,
                    data: {
                        id: notification.id,
                        link: notification.link,
                        relatedEntityId: notification.relatedEntityId,
                        relatedEntityType: notification.relatedEntityType,
                        type: notification.type
                    },
                    priority: "high",
                    channelId: "default"
                });
            }

            if (!messages.length) return;

            const chunks = this.expo.chunkPushNotifications(messages);
            const deadTokens: string[] = [];

            for (const chunk of chunks) {
                try {
                    const tickets: ExpoPushTicket[] = await this.expo.sendPushNotificationsAsync(chunk);
                    for (let i = 0; i < tickets.length; i++) {
                        const ticket = tickets[i];
                        if (ticket.status === "error") {
                            console.error(`[PushNotification] Gửi thất bại: ${ticket.message}`);
                            if (ticket.details && ticket.details.error === "DeviceNotRegistered") {
                                const badToken = chunk[i]?.to;
                                if (typeof badToken === "string") {
                                    deadTokens.push(badToken);
                                }
                            }
                        }
                    }
                } catch (error) {
                    console.error("[PushNotification] Lỗi khi gửi chunk:", error);
                }
            }

            // Tự động dọn dẹp các token đã bị hủy/gỡ ứng dụng
            if (deadTokens.length > 0) {
                console.log(`[PushNotification] Dọn dẹp ${deadTokens.length} token không còn hoạt động...`);
                for (const token of deadTokens) {
                    await this.repo.delete({ token });
                }
            }
        } catch (error) {
            console.error("[PushNotification] Lỗi trong sendPushNotification:", error);
        }
    }
}
