import { Request, Response, NextFunction } from 'express';
import redisClientProxy, { isRedisReady } from '../config/redis';
import { isAllowedOrigin } from '../config/cors';
import { ClientSignatureHelper as Sig } from '../helpers/ClientSignature.helper';
import { DeviceKeyService } from '../services/DeviceKey.service';

const MAX_DRIFT_SECONDS = 60;
const NONCE_TTL_SECONDS = 300;
const NONCE_REGEX = /^[A-Za-z0-9-]{16,64}$/;
const PARTNER_PREFIX = process.env.PARTNER_PATH_PREFIX || '/api/partner';

// Danh sách đường dẫn công khai không yêu cầu chữ ký (bootstrap auth & health check)
const DEFAULT_PUBLIC_PATHS = [
    '/api/health',
    '/api/auth/login',
    '/api/auth/refresh'
];

const envPublicPaths = (process.env.CLIENT_INTEGRITY_PUBLIC_PATHS || '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

const PUBLIC_PATHS = Array.from(new Set([...DEFAULT_PUBLIC_PATHS, ...envPublicPaths]));

const memoryNonces = new Map<string, number>();

async function claimNonce(scope: string, nonce: string): Promise<'ok' | 'replay' | 'unavailable'> {
    const key = `client:nonce:${scope}:${nonce}`;
    if (isRedisReady()) {
        try {
            const r = await redisClientProxy.set(key, '1', { NX: true, EX: NONCE_TTL_SECONDS });
            return r === 'OK' ? 'ok' : 'replay';
        } catch {
            // Rơi xuống nhánh dưới khi Redis gặp sự cố
        }
    }

    const failClosed = process.env.NODE_ENV === 'production' && process.env.NONCE_FAIL_MODE !== 'memory';
    if (failClosed) {
        return 'unavailable';
    }

    const now = Date.now();
    for (const [k, exp] of memoryNonces) {
        if (exp < now) memoryNonces.delete(k);
    }
    if (memoryNonces.has(key)) {
        return 'replay';
    }
    memoryNonces.set(key, now + NONCE_TTL_SECONDS * 1000);
    return 'ok';
}

const fail = (res: Response, status: number, code = 'CLIENT_INTEGRITY_FAILED') => {
    res.setHeader('Date', new Date().toUTCString());
    return res.status(status).json({ code, message: 'Client integrity verification failed' });
};

function timeOk(ts: string | undefined): boolean {
    if (!ts || !/^[0-9]{9,12}$/.test(ts)) return false;
    return Math.abs(Math.floor(Date.now() / 1000) - parseInt(ts, 10)) <= MAX_DRIFT_SECONDS;
}

export const clientIntegrityMiddleware = async (
    req: Request,
    res: Response,
    next: NextFunction
): Promise<void> => {
    if (process.env.NODE_ENV !== 'production' && process.env.BYPASS_CLIENT_INTEGRITY === 'true') {
        return next();
    }

    const fullPath = req.originalUrl || req.url;
    const pathOnly = fullPath.split('?')[0];

    // Bỏ qua các endpoint public / bootstrap
    if (PUBLIC_PATHS.some(p => pathOnly === p || pathOnly.startsWith(p + '/'))) {
        return next();
    }

    const bodyHash = Sig.computeBodyHash(
        (req as any).rawBody,
        String(req.headers['content-type'] || '')
    );

    // ==========================================
    // NHÁNH 1: SERVER-TO-SERVER (RSA)
    // ==========================================
    const clientId = req.header('X-Client-Id');
    const rsaSig = req.header('X-Signature');
    if (clientId && rsaSig) {
        const ts = req.header('X-Timestamp');
        const nonce = req.header('X-Nonce');
        if (!timeOk(ts)) return fail(res, 401, 'CLOCK_SKEW') as any;
        if (!nonce || !NONCE_REGEX.test(nonce)) return fail(res, 401) as any;

        let keys: Record<string, string> = {};
        try {
            keys = JSON.parse(process.env.SERVER_PUBLIC_KEYS_JSON || '{}');
        } catch {}

        const pem = keys[clientId];
        const canonical = Sig.buildCanonicalString(req.method, fullPath, ts!, nonce, bodyHash);
        if (!pem || !Sig.verifyRsa(canonical, rsaSig, pem)) {
            return fail(res, 401) as any;
        }

        const n = await claimNonce(`s2s:${clientId}`, nonce);
        if (n === 'unavailable') return fail(res, 503, 'SERVICE_UNAVAILABLE') as any;
        if (n === 'replay') return fail(res, 401) as any;

        (req as any).clientIntegrity = { type: 'server', id: clientId };
        return next();
    }

    // ==========================================
    // NHÁNH 2: MOBILE APP (HMAC, Khóa Phiên Thiết Bị)
    // ==========================================
    const keyId = req.header('X-App-Key-Id');
    const appSig = req.header('X-App-Signature');
    if (keyId && appSig) {
        const platform = (req.header('X-App-Platform') || '').toLowerCase();
        const ts = req.header('X-App-Timestamp');
        const nonce = req.header('X-App-Nonce');
        if (!['android', 'ios'].includes(platform)) return fail(res, 401) as any;
        if (!timeOk(ts)) return fail(res, 401, 'CLOCK_SKEW') as any;
        if (!nonce || !NONCE_REGEX.test(nonce)) return fail(res, 401) as any;

        const key = await DeviceKeyService.get(keyId);
        if (!key) return fail(res, 401, 'KEY_INVALID') as any;

        const canonical = Sig.buildCanonicalString(req.method, fullPath, ts!, nonce, bodyHash);
        if (!Sig.verifyHmac(canonical, appSig, key.secret)) {
            return fail(res, 401) as any;
        }

        const n = await claimNonce(`mobile:${keyId}`, nonce);
        if (n === 'unavailable') return fail(res, 503, 'SERVICE_UNAVAILABLE') as any;
        if (n === 'replay') return fail(res, 401) as any;

        (req as any).clientIntegrity = { type: 'mobile', id: keyId, userId: key.userId };
        return next();
    }

    // ==========================================
    // NHÁNH 3: KHÔNG CÓ CHỮ KÝ
    // ==========================================
    if (pathOnly.startsWith(PARTNER_PREFIX)) {
        return fail(res, 401) as any;
    }

    const origin = req.headers.origin;
    if (origin && isAllowedOrigin(origin)) {
        // Cho qua đối với Web UI chính hãng; toàn bộ pipeline auth phía sau vẫn bắt buộc
        return next();
    }

    return fail(res, 403) as any;
};
