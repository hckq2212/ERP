const rawUrl = process.env.AI_SERVICE_URL;

if (!rawUrl || !rawUrl.trim()) {
    throw new Error("Thiếu cấu hình AI_SERVICE_URL trong .env");
}

export const AI_SERVICE_URL = rawUrl.trim().replace(/\/$/, "");

export const AI_SERVICE_MAX_FETCH_BYTES = 500 * 1024 * 1024;

export const AI_SERVICE_REQUEST_TIMEOUT_MS = 5 * 60 * 1000;

export const AI_SERVICE_POLL_INTERVAL_MS = 2000;
