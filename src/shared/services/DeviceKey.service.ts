import crypto from 'crypto';
import redisClientProxy from '../config/redis';

const KEY_TTL_SECONDS = 30 * 24 * 3600; // 30 ngày, khớp thời hạn refresh token

export interface DeviceKeyData {
    secret: string;
    userId: string;
}

export class DeviceKeyService {
    /**
     * Cấp khóa phiên mới cho thiết bị khi login hoặc refresh
     */
    static async issue(userId: string): Promise<{ keyId: string; secret: string }> {
        const keyId = crypto.randomUUID();
        const secret = crypto.randomBytes(32).toString('base64');
        await redisClientProxy.set(
            `device:key:${keyId}`,
            JSON.stringify({ secret, userId }),
            { EX: KEY_TTL_SECONDS }
        );
        return { keyId, secret };
    }

    /**
     * Lấy thông tin khóa phiên theo keyId
     */
    static async get(keyId: string): Promise<DeviceKeyData | null> {
        try {
            const raw = await redisClientProxy.get(`device:key:${keyId}`);
            return raw ? JSON.parse(raw) : null;
        } catch {
            return null;
        }
    }

    /**
     * Thu hồi khóa phiên khi logout hoặc đổi phiên
     */
    static async revoke(keyId: string): Promise<void> {
        if (!keyId) return;
        try {
            await redisClientProxy.del(`device:key:${keyId}`);
        } catch {}
    }
}
