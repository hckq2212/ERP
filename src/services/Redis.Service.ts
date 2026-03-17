import redisClient from "../config/redis";

export class RedisService {
    /**
     * Lấy dữ liệu từ cache theo key
     */
    static async getCache(key: string): Promise<any | null> {
        try {
            const data = await redisClient.get(key);
            if (data) {
                console.log(`[Redis] HIT: ${key}`);
                return JSON.parse(data.toString());
            }
            console.log(`[Redis] MISS: ${key}`);
            return null;
        } catch (error: any) {
            console.error(`[Redis] ERROR GET (${key}):`, error.message);
            return null; // Trả về null để fallback gọi DB
        }
    }

    /**
     * Lưu dữ liệu vào cache
     * @param ttl Thời gian sống (giây)
     */
    static async setCache(key: string, data: any, ttl: number = 3600): Promise<void> {
        try {
            await redisClient.setEx(key, ttl, JSON.stringify(data));
            console.log(`[Redis] SET: ${key} (TTL: ${ttl}s)`);
        } catch (error: any) {
            console.error(`[Redis] ERROR SET (${key}):`, error.message);
        }
    }

    /**
     * Xóa cache theo key hoặc pattern (nếu cần xoá diện rộng, dùng toán tử keys)
     * Lưu ý sử dụng `KEYS` trên production có thể chậm, cân nhắc dùng SCAN hoặc DEL trực tiếp
     */
    static async deleteCache(pattern: string): Promise<void> {
        try {
            if (pattern.includes('*')) {
                const keys = await redisClient.keys(pattern);
                if (keys.length > 0) {
                    await redisClient.del(keys);
                    console.log(`[Redis] DEL PATTERN: ${pattern} (${keys.length} keys)`);
                }
            } else {
                await redisClient.del(pattern);
                console.log(`[Redis] DEL: ${pattern}`);
            }
        } catch (error: any) {
            console.error(`[Redis] ERROR DEL (${pattern}):`, error.message);
        }
    }

    /**
     * Lấy data. Chống Cache Stampede (Thundering Herd) sử dụng SETNX và cơ chế Sleep (Polling).
     * @param key Key cache
     * @param ttlExpire Thời gian hết hạn của cache chính (giây)
     * @param fetchFromDbFn Hàm lấy dữ liệu từ Backend/Database
     */
    static async fetchWithCache<T>(key: string, ttlExpire: number, fetchFromDbFn: () => Promise<T>): Promise<T> {
        try {
            // 1. Kiểm tra cache
            let data = await this.getCache(key);
            if (data) return data;

            // 2. Không có cache -> Thử lấy Lock (cho 1 request duy nhất làm leader)
            const lockKey = `lock:${key}`;
            // Lấy khóa. EX 7 -> Lock tối đa 7s. NX -> Chỉ tạo nếu khóa chưa tồn tại
            const lockAcquired = await redisClient.set(lockKey, "1", { EX: 7, NX: true });

            if (lockAcquired) {
                // ---> REQUEST ĐẦU TIÊN (LEADER)
                try {
                    // Lấy dữ liệu nặng từ Database
                    const freshData = await fetchFromDbFn();

                    // Set dữ liệu vào cache thật
                    await this.setCache(key, freshData, ttlExpire);

                    return freshData;
                } finally {
                    // Nhả khóa
                    try {
                        await redisClient.del(lockKey);
                    } catch (e) {
                        console.error("Lỗi xóa redis lock", e);
                    }
                }
            } else {
                // ---> CÁC REQUEST ĐẾN SAU (FOLLOWER) 
                const waitMaxMs = 7000;
                const sleepMs = 200;
                let waited = 0;

                while (waited < waitMaxMs) {
                    await new Promise((resolve) => setTimeout(resolve, sleepMs));
                    waited += sleepMs;

                    data = await this.getCache(key);
                    if (data) return data;
                }

                // Nếu đợi quá lâu mà vẫn không có cơm, thì tự nấu luôn (fallback DB)
                return await fetchFromDbFn();
            }
        } catch (error) {
            // ---> CƠ CHẾ RESILIENCE (fallback khi Redis sập)
            console.error(`Redis Error (fetchWithCache) for key ${key}:`, error);
            console.log("Fallback to Database query...");
            return await fetchFromDbFn();
        }
    }
}
