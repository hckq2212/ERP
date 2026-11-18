const allowed = (process.env.ALLOWED_ORIGINS ?? "")
    .split(",")
    .map(s => s.trim().replace(/\/$/, ""))
    .filter(Boolean);

const devPatterns = [
    /^http:\/\/localhost:\d+$/,
    /^http:\/\/(127\.0\.0\.1|10\.0\.2\.2|192\.168\.\d+\.\d+)(:\d+)?$/,
];

export const isProd = process.env.NODE_ENV === "production";

export function isAllowedOrigin(origin: string): boolean {
    if (!origin) return false;
    const normalized = origin.trim().replace(/\/$/, "");
    if (allowed.includes(normalized)) return true;
    return !isProd && devPatterns.some(p => p.test(normalized));
}

export function isOriginAllowed(origin?: string): boolean {
    // Cho phép request không có origin header (Mobile Native app, cURL, server-to-server)
    if (!origin) return true;
    return isAllowedOrigin(origin);
}

export const corsOptions = {
    credentials: true,
    origin: (origin: string | undefined, callback: (err: Error | null, allow?: boolean) => void) => {
        if (isOriginAllowed(origin)) {
            callback(null, true);
        } else {
            callback(new Error("Not allowed by CORS"));
        }
    }
};
