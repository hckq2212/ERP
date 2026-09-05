// import redisClient from "../config/redis";

/**
 * RedisService - TEMPORARILY DISABLED
 * All methods bypass Redis and fall through directly to the DB fetch function.
 * To re-enable, restore the original implementation from git history.
 */
export class RedisService {
    // static async getCache(key: string): Promise<any | null> {
    //     try {
    //         const data = await redisClient.get(key);
    //         if (data) {
    //             console.log(`[Redis] HIT: ${key}`);
    //             return JSON.parse(data.toString());
    //         }
    //         console.log(`[Redis] MISS: ${key}`);
    //         return null;
    //     } catch (error: any) {
    //         console.error(`[Redis] ERROR GET (${key}):`, error.message);
    //         return null;
    //     }
    // }

    // static async setCache(key: string, data: any, ttl: number = 3600): Promise<void> {
    //     try {
    //         await redisClient.setEx(key, ttl, JSON.stringify(data));
    //         console.log(`[Redis] SET: ${key} (TTL: ${ttl}s)`);
    //     } catch (error: any) {
    //         console.error(`[Redis] ERROR SET (${key}):`, error.message);
    //     }
    // }

    // static async deleteCache(pattern: string): Promise<void> {
    //     try {
    //         if (pattern.includes('*')) {
    //             const keys = await redisClient.keys(pattern);
    //             console.log(`[Redis] Keys matching pattern ${pattern}:`, keys);
    //             if (keys.length > 0) {
    //                 await redisClient.del(keys);
    //                 console.log(`[Redis] DEL PATTERN: ${pattern} (${keys.length} keys deleted)`);
    //             } else {
    //                 console.log(`[Redis] DEL PATTERN: ${pattern} (No keys matched)`);
    //             }
    //         } else {
    //             await redisClient.del(pattern);
    //             console.log(`[Redis] DEL: ${pattern}`);
    //         }
    //     } catch (error: any) {
    //         console.error(`[Redis] ERROR DEL (${pattern}):`, error.message);
    //     }
    // }

    /**
     * Cache DISABLED — always fetches directly from the DB function.
     */
    static async fetchWithCache<T>(key: string, ttlExpire: number, fetchFromDbFn: () => Promise<T>): Promise<T> {
        return await fetchFromDbFn();
    }

    /**
     * Cache DISABLED — no-op.
     */
    static async deleteCache(pattern: string): Promise<void> {
        // no-op: Redis is temporarily disabled
    }

    /**
     * Cache DISABLED — always returns null.
     */
    static async getCache(key: string): Promise<any | null> {
        return null;
    }

    /**
     * Cache DISABLED — no-op.
     */
    static async setCache(key: string, data: any, ttl: number = 3600): Promise<void> {
        // no-op: Redis is temporarily disabled
    }
}
