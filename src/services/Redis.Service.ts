import redisClient from "../config/redis";

export class RedisService {
    /**
     * Lấy dữ liệu từ cache theo key
     */
    static async getCache(key: string): Promise<any | null> {
        try {
            const data = await redisClient.get(key);
            console.log("lấy dl từ redis")
            return data ? JSON.parse(data.toString()) : null;

        } catch (error) {
            console.error(`Lỗi Redis getCache (${key}):`, error);
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
        } catch (error) {
            console.error(`Lỗi Redis setCache (${key}):`, error);
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
                }
            } else {
                await redisClient.del(pattern);
            }
        } catch (error) {
            console.error(`Lỗi Redis deleteCache (${pattern}):`, error);
        }
    }

    /**
     * Lấy data. Chống Cache Stampede (Thundering Herd) sử dụng SETNX và cơ chế Sleep (Polling).
     * @param key Key cache
     * @param ttlExpire Thời gian hết hạn của cache chính (giây)
     * @param fetchFromDbFn Hàm lấy dữ liệu từ Backend/Database
     */
    static async fetchWithCache<T>(key: string, ttlExpire: number, fetchFromDbFn: () => Promise<T>): Promise<T> {
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
                // Nhả khóa để lỡ sau này còn xử lý tiếp, tuy nhiên lockKey cũng tự huỷ sau 7s.
                try {
                    await redisClient.del(lockKey);
                } catch (e) {
                    console.error("Lỗi xóa redis lock", e);
                }
            }
        } else {
            // ---> CÁC REQUEST ĐẾN SAU (FOLLOWER) 
            // Không lấy được lock -> Có 1 request khác đang query DB rồi. 
            // -> Chờ (Polling)
            const waitMaxMs = 7000;
            const sleepMs = 200;
            let waited = 0;

            while (waited < waitMaxMs) {
                // Ngủ 200ms
                await new Promise((resolve) => setTimeout(resolve, sleepMs));
                waited += sleepMs;

                // Thức dậy và kiểm tra lại cache thật
                data = await this.getCache(key);
                if (data) {
                    return data; // Request đầu tiên đã nấu xong cơm
                }
            }

            throw new Error("Lấy dữ liệu quá thời gian chờ (Timeout 7s)");
        }
    }
}
