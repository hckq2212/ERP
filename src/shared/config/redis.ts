import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const isEnabled = process.env.REDIS_ENABLED !== 'false';
const redisUrl = process.env.REDIS_URL || 'redis://localhost:6379';
const connectTimeoutMs = Number(process.env.REDIS_CONNECT_TIMEOUT_MS) || 5000;

const isTestEnv = process.env.NODE_ENV === 'test' || process.argv.some((arg) => arg.includes('test') || arg.includes('spec'));

let isReady = false;
let clientInstance: any = null;

if (!isTestEnv) {
    clientInstance = createClient({
        url: redisUrl,
        socket: {
            connectTimeout: connectTimeoutMs,
            reconnectStrategy: (retries: number) => {
                return Math.min(retries * 100, 3000);
            }
        }
    });

    clientInstance.on('connect', () => {
        console.log('[Redis] Connecting...');
    });

    clientInstance.on('ready', () => {
        isReady = true;
        console.log('[Redis] Client Ready');
    });

    clientInstance.on('error', (err: any) => {
        isReady = false;
        console.error('[Redis Client Error]', err.message);
    });

    clientInstance.on('reconnecting', () => {
        isReady = false;
        console.warn('[Redis] Reconnecting...');
    });

    clientInstance.on('end', () => {
        isReady = false;
        console.log('[Redis] Connection Closed');
    });

    // Non-blocking connection lúc khởi động
    if (isEnabled) {
        (async () => {
            try {
                if (!clientInstance.isOpen) {
                    await clientInstance.connect();
                }
            } catch (error: any) {
                isReady = false;
                console.error('[Redis] Không thể kết nối tới Redis lúc khởi động (Hệ thống sẽ chạy ở chế độ fallback sang DB):', error.message);
            }
        })();
    }
}

/**
 * Kiểm tra trạng thái sẵn sàng của Redis
 */
export function isRedisReady(): boolean {
    if (clientInstance && typeof clientInstance.isReady === 'boolean') {
        return isReady && clientInstance.isReady;
    }
    return isReady;
}

/**
 * Test Hooks: Cho phép inject StatefulFakeRedis hoặc toggle trạng thái ready trong Unit Test
 */
export function __setRedisReadyForTest(ready: boolean): void {
    isReady = ready;
}

export function __setRedisClientForTest(client: any): void {
    clientInstance = client;
}

// Proxy wrapper để mọi module import redisClient đều trỏ động tới clientInstance
const redisClientProxy: any = new Proxy({} as any, {
    get(_target, prop) {
        if (!clientInstance) return undefined;
        const val = clientInstance[prop];
        if (typeof val === 'function') {
            return val.bind(clientInstance);
        }
        return val;
    },
    set(_target, prop, value) {
        if (clientInstance) {
            clientInstance[prop] = value;
        }
        return true;
    }
});

export default redisClientProxy;
