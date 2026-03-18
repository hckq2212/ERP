import { createClient } from 'redis';
import dotenv from 'dotenv';

dotenv.config();

const isProduction = process.env.NODE_ENV === 'production';

const redisClient = createClient({
    url: isProduction ? process.env.REDIS_URL : 'redis://127.0.0.1:6379'
});

redisClient.on('error', (err) => console.error('Redis Client Error', err));
redisClient.on('connect', () => console.log('Redis Client Connected'));

// Khởi tạo connection
const connectRedis = async () => {
    try {
        if (!redisClient.isOpen) {
            await redisClient.connect();
        }
    } catch (error) {
        console.error('Không thể kết nối tới Redis:', error);
    }
};

connectRedis();

export default redisClient;
