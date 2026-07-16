import { NextFunction, Request, RequestHandler, Response } from "express";
import rateLimit, { ipKeyGenerator } from "express-rate-limit";

type RateLimitConfig = {
    identifier: string;
    windowMs: number;
    limit: number;
    keyGenerator: (req: Request) => string;
};

const RATE_LIMIT_MESSAGE = "Quá nhiều yêu cầu, vui lòng thử lại sau.";
const GLOBAL_NAMESPACE = "global";
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);

const getRequestPath = (req: Request): string => {
    return (req.originalUrl || req.baseUrl || req.url || "").split("?")[0];
};

const getTenantNamespace = (req: Request): string => {
    const companySlug = typeof req.params?.companySlug === "string" ? req.params.companySlug : "";

    if (companySlug) {
        return companySlug;
    }

    const segments = getRequestPath(req).split("/").filter(Boolean);

    if (segments[0] === "api") {
        return GLOBAL_NAMESPACE;
    }

    if (segments[1] === "api" && segments[0]) {
        return segments[0];
    }

    return GLOBAL_NAMESPACE;
};

const getIpKey = (req: Request): string => {
    return ipKeyGenerator(req.ip || "unknown");
};

const getAuthKey = (req: Request): string => {
    return `auth:${getTenantNamespace(req)}:${getIpKey(req)}`;
};

const getUserScopedKey = (req: Request): string => {
    const tenantNamespace = getTenantNamespace(req);
    const accountId = typeof (req as any).user?.id === "string" ? (req as any).user.id : "";

    if (accountId) {
        return `api:${tenantNamespace}:${accountId}`;
    }

    return `api:${tenantNamespace}:${getIpKey(req)}`;
};

const getRetryAfterSeconds = (req: Request): number => {
    const resetTime = (req as any).rateLimit?.resetTime;

    if (!(resetTime instanceof Date)) {
        return 0;
    }

    return Math.max(0, Math.ceil((resetTime.getTime() - Date.now()) / 1000));
};

const createRateLimitHandler = (req: Request, res: Response) => {
    const retryAfter = getRetryAfterSeconds(req);

    if (retryAfter > 0) {
        res.setHeader("Retry-After", retryAfter.toString());
    }

    res.status(429).json({
        message: RATE_LIMIT_MESSAGE,
        retryAfter
    });
};

const createLimiter = ({ identifier, windowMs, limit, keyGenerator }: RateLimitConfig): RequestHandler => {
    return rateLimit({
        identifier,
        windowMs,
        limit,
        standardHeaders: "draft-7",
        legacyHeaders: false,
        keyGenerator: (req: Request) => keyGenerator(req),
        handler: (req: Request, res: Response, _next: NextFunction) => createRateLimitHandler(req, res)
    });
};

export const globalApiLimiter = createLimiter({
    identifier: "global-api",
    windowMs: 15 * 60 * 1000,
    limit: 300,
    keyGenerator: getAuthKey
});

export const authLimiter = createLimiter({
    identifier: "auth-api",
    windowMs: 15 * 60 * 1000,
    limit: 10,
    keyGenerator: getAuthKey
});

export const writeLimiter = createLimiter({
    identifier: "write-api",
    windowMs: 15 * 60 * 1000,
    limit: 120,
    keyGenerator: getUserScopedKey
});

export const sensitiveLimiter = createLimiter({
    identifier: "sensitive-api",
    windowMs: 5 * 60 * 1000,
    limit: 30,
    keyGenerator: getUserScopedKey
});

export const writeRateLimitMiddleware: RequestHandler = (req: Request, res: Response, next: NextFunction) => {
    if (!WRITE_METHODS.has(req.method.toUpperCase())) {
        next();
        return;
    }

    writeLimiter(req, res, next);
};
