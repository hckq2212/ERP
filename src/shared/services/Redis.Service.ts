import redisClient, { isRedisReady } from '../config/redis';
import crypto from 'crypto';

interface MicroCacheItem {
    rawJson: string;
    bytes: number;
    expiresAt: number;
}

interface ResolveResult {
    rawJson: string;
    fromRedisHit: boolean;
    counted?: boolean; // Ngăn đếm trùng redisHits khi nhiều caller chung promise
}

// -----------------------------------------------------------------------------
// TIỆN ÍCH BẢO VỆ CONCURRENCY: SEMAPHORE
// -----------------------------------------------------------------------------
class ConcurrencySemaphore {
    private current = 0;
    private queue: Array<() => void> = [];

    constructor(private readonly max: number) {}

    async acquire(): Promise<void> {
        if (this.current < this.max) {
            this.current++;
            return;
        }
        return new Promise<void>((resolve) => this.queue.push(resolve));
    }

    release(): void {
        this.current--;
        const next = this.queue.shift();
        if (next) {
            this.current++;
            next();
        }
    }

    getCurrentInUse(): number {
        return this.current;
    }
}

export class RedisService {
    // -------------------------------------------------------------------------
    // BỘ ĐẾM EPOCH PHÂN TÁCH THEO TENANT:MODULE
    // -------------------------------------------------------------------------
    private static globalEpoch = 0;
    private static nsEpochs = new Map<string, number>();

    private static extractNs(k: string): string {
        const p = k.split(':');
        if (p[0] === 'erp') {
            return p.length >= 3 ? `${p[1]}:${p[2]}` : 'erp';
        }
        return p[0] || 'global';
    }

    private static snapshotEpoch(key: string): string {
        const ns = this.extractNs(key);
        return `${this.globalEpoch}.${this.nsEpochs.get(ns) ?? 0}`;
    }

    private static bumpEpoch(pattern: string): void {
        const p = pattern.split(':');
        if (pattern === '*' || p[0].includes('*')) {
            this.globalEpoch++;
            return;
        }

        if (p[0] === 'erp') {
            if (p.length < 3 || p[1].includes('*') || p[2].includes('*')) {
                this.globalEpoch++;
                return;
            }
            const ns = `${p[1]}:${p[2]}`;
            this.nsEpochs.set(ns, (this.nsEpochs.get(ns) ?? 0) + 1);
            return;
        }

        const head = p[0];
        if (head.includes('*')) {
            this.globalEpoch++;
        } else {
            this.nsEpochs.set(head, (this.nsEpochs.get(head) ?? 0) + 1);
        }
    }

    // -------------------------------------------------------------------------
    // LỚP 1: IN-PROCESS SINGLE-FLIGHT (LƯU TRỮ PROMISE<RESOLVERESULT>)
    // -------------------------------------------------------------------------
    private static inflightMap = new Map<string, Promise<ResolveResult>>();
    private static fallbackInflight = new Map<string, Promise<string>>();

    // -------------------------------------------------------------------------
    // LỚP 2: CIRCUIT BREAKER VỚI CỬA SỔ TRƯỢT THỜI GIAN
    // -------------------------------------------------------------------------
    private static readonly REDIS_CMD_TIMEOUT_MS = 500;

    private static circuit = {
        state: 'CLOSED' as 'CLOSED' | 'OPEN' | 'HALF_OPEN',
        failureTimes: [] as number[],
        failureThreshold: 5,
        windowMs: 10000,
        lastFailureTime: 0,
        cooldownMs: 30000,
        probeInFlight: false,

        allowsPassive(): boolean {
            return isRedisReady() && this.state === 'CLOSED';
        },

        canCall(): { allowed: boolean; isProbe: boolean } {
            if (!isRedisReady()) return { allowed: false, isProbe: false };
            if (this.state === 'CLOSED') return { allowed: true, isProbe: false };
            if (this.state === 'OPEN') {
                if (Date.now() - this.lastFailureTime > this.cooldownMs) {
                    this.state = 'HALF_OPEN';
                    this.probeInFlight = true;
                    return { allowed: true, isProbe: true };
                }
                return { allowed: false, isProbe: false };
            }
            if (this.probeInFlight) return { allowed: false, isProbe: false };
            this.probeInFlight = true;
            return { allowed: true, isProbe: true };
        },

        onSuccess() {
            if (this.state === 'HALF_OPEN') {
                this.state = 'CLOSED';
                this.failureTimes = [];
                this.probeInFlight = false;
            }
        },

        onFailure(isProbe: boolean = false) {
            const now = Date.now();
            this.lastFailureTime = now;
            if (isProbe) {
                this.probeInFlight = false;
            }
            this.failureTimes = this.failureTimes.filter((t) => now - t < this.windowMs);
            this.failureTimes.push(now);

            if (this.state === 'HALF_OPEN' || this.failureTimes.length >= this.failureThreshold) {
                this.state = 'OPEN';
                this.probeInFlight = false;
                console.warn('[Redis CircuitBreaker] OPEN: Tạm thời ngắt gọi Redis trong 30s');
            }
        }
    };

    private static withTimeout<T>(promise: Promise<T>, ms: number = RedisService.REDIS_CMD_TIMEOUT_MS): Promise<T> {
        let timer: NodeJS.Timeout;
        return Promise.race([
            promise,
            new Promise<T>((_, reject) => {
                timer = setTimeout(() => reject(new Error(`[RedisService] Command Timeout (>${ms}ms)`)), ms);
            })
        ]).finally(() => {
            clearTimeout(timer!);
        });
    }

    // -------------------------------------------------------------------------
    // LỚP 5: BOUNDED LRU MICRO-CACHE (HỖ TRỢ SHORT-TTL CHO ITEM LỚN)
    // -------------------------------------------------------------------------
    private static microCache = new Map<string, MicroCacheItem>();
    private static readonly MICRO_TTL_MS = 8000;
    private static readonly MICRO_SHORT_TTL_MS = 2000; // 2s cho item lớn 512KB-2MB
    private static readonly MAX_MICRO_CACHE_SIZE = 1000;
    private static readonly MAX_MICRO_ITEM_BYTES = 512 * 1024; // 512KB
    private static readonly ABSOLUTE_MAX_ITEM_BYTES = 2 * 1024 * 1024; // 2MB
    private static readonly MAX_MICRO_TOTAL_BYTES = 64 * 1024 * 1024; // 64MB
    private static microBytes = 0;

    private static getFromMicroCache(key: string): { hit: boolean; rawJson?: string } {
        const item = this.microCache.get(key);
        if (!item) return { hit: false };
        if (Date.now() > item.expiresAt) {
            this.microBytes -= item.bytes;
            this.microCache.delete(key);
            return { hit: false };
        }
        this.microCache.delete(key);
        this.microCache.set(key, item);
        return { hit: true, rawJson: item.rawJson };
    }

    private static setToMicroCache(key: string, rawJson: string): void {
        const itemBytes = Buffer.byteLength(rawJson, 'utf8');
        if (itemBytes > this.ABSOLUTE_MAX_ITEM_BYTES) return;

        const ttl = itemBytes > this.MAX_MICRO_ITEM_BYTES ? this.MICRO_SHORT_TTL_MS : this.MICRO_TTL_MS;

        const existing = this.microCache.get(key);
        if (existing) {
            this.microBytes -= existing.bytes;
            this.microCache.delete(key);
        }

        while (
            (this.microCache.size >= this.MAX_MICRO_CACHE_SIZE || this.microBytes + itemBytes > this.MAX_MICRO_TOTAL_BYTES) &&
            this.microCache.size > 0
        ) {
            const oldestKey = this.microCache.keys().next().value;
            if (!oldestKey) break;
            const oldestItem = this.microCache.get(oldestKey);
            if (oldestItem) {
                this.microBytes -= oldestItem.bytes;
            }
            this.microCache.delete(oldestKey);
        }

        this.microBytes += itemBytes;
        this.microCache.set(key, { rawJson, bytes: itemBytes, expiresAt: Date.now() + ttl });
    }

    private static async viaMicroCache<T>(key: string, loader: () => Promise<T>): Promise<string> {
        const cached = this.getFromMicroCache(key);
        if (cached.hit) {
            this.metrics.microCacheHits++;
            return cached.rawJson!;
        }

        const epochBefore = this.snapshotEpoch(key);
        const rawJson = await this.runLoader(loader);

        if (epochBefore === this.snapshotEpoch(key)) {
            this.setToMicroCache(key, rawJson);
        }
        return rawJson;
    }

    // -------------------------------------------------------------------------
    // BẢO VỆ CONCURRENCY DB (SEMAPHORE TỰ GIẢI PHÓNG SLOT KHI TIMEOUT)
    // -------------------------------------------------------------------------
    private static dbSemaphore = new ConcurrencySemaphore(10);
    private static loaderTimeoutMs = 8000; // < Lock TTL 10s

    private static async runLoader<T>(loader: () => Promise<T>): Promise<string> {
        let timer: NodeJS.Timeout | undefined;
        let abandoned = false;

        const task = (async () => {
            await this.dbSemaphore.acquire();
            try {
                if (abandoned) {
                    return null;
                }
                this.metrics.dbQueries++;
                const res = await loader();
                return JSON.stringify(res === undefined ? null : res);
            } finally {
                this.dbSemaphore.release();
            }
        })();

        try {
            const result = await Promise.race([
                task,
                new Promise<never>((_, reject) => {
                    timer = setTimeout(() => {
                        abandoned = true;
                        reject(new Error('[RedisService] DB Loader Timeout (>8s, gồm hàng đợi Semaphore)'));
                    }, this.loaderTimeoutMs);
                })
            ]);
            return result!;
        } finally {
            clearTimeout(timer);
        }
    }

    // -------------------------------------------------------------------------
    // METRICS QUAN SÁT (OBSERVABILITY)
    // -------------------------------------------------------------------------
    public static metrics = {
        totalCalls: 0,
        singleFlightHits: 0,
        redisHits: 0,
        redisMisses: 0,
        lockAcquired: 0,
        lockWaited: 0,
        lockWaitHits: 0,
        microCacheHits: 0,
        dbQueries: 0,
        redisErrors: 0,

        getStats() {
            const redisTotal = this.redisHits + this.redisMisses;
            const totalOffloaded = this.totalCalls - this.dbQueries;
            return {
                redisReady: isRedisReady(),
                circuitState: RedisService.circuit.state,
                totalCalls: this.totalCalls,
                singleFlightHits: this.singleFlightHits,
                redisHits: this.redisHits,
                redisMisses: this.redisMisses,
                redisHitRate: redisTotal > 0 ? ((this.redisHits / redisTotal) * 100).toFixed(2) + '%' : '0.00%',
                lockWaitHits: this.lockWaitHits,
                microCacheHits: this.microCacheHits,
                dbQueries: this.dbQueries,
                overallHitRate: this.totalCalls > 0 ? ((totalOffloaded / this.totalCalls) * 100).toFixed(2) + '%' : '0.00%',
                redisErrors: this.redisErrors,
                microCacheSize: RedisService.microCache.size,
                microCacheBytes: RedisService.microBytes
            };
        }
    };

    // -------------------------------------------------------------------------
    // READ PATH: ENTRYPOINT CHÍNH (fetchWithCache)
    // -------------------------------------------------------------------------
    static async fetchWithCache<T>(key: string, ttl: number = 3600, loader: () => Promise<T>): Promise<T> {
        return this.fetchInternal(key, ttl, loader, false);
    }

    private static async fetchInternal<T>(
        key: string,
        ttl: number,
        loader: () => Promise<T>,
        retried: boolean
    ): Promise<T> {
        if (!retried) {
            this.metrics.totalCalls++;
        }

        const existing = this.inflightMap.get(key);
        if (existing) {
            this.metrics.singleFlightHits++;
            return existing.then((res) => this.parseOrRecover(key, ttl, res, loader, retried));
        }

        const promise: Promise<ResolveResult> = this.resolve<T>(key, ttl, loader).finally(() => {
            if (this.inflightMap.get(key) === promise) {
                this.inflightMap.delete(key);
            }
        });

        this.inflightMap.set(key, promise);
        return promise.then((res) => this.parseOrRecover(key, ttl, res, loader, retried));
    }

    /**
     * Script Lua Compare-and-Delete: Chỉ xóa khi key Redis vẫn mang đúng chuỗi JSON hỏng
     */
    private static readonly DEL_IF_EQUALS_LUA = `
        if redis.call("get", KEYS[1]) == ARGV[1] then
            return redis.call("unlink", KEYS[1])
        end
        return 0
    `;

    private static async parseOrRecover<T>(
        key: string,
        ttl: number,
        result: ResolveResult,
        loader: () => Promise<T>,
        retried: boolean
    ): Promise<T> {
        try {
            const data = JSON.parse(result.rawJson) as T;
            if (result.fromRedisHit && !result.counted) {
                result.counted = true;
                this.metrics.redisHits++;
            }
            return data;
        } catch {
            if (retried) {
                // Khi retry vẫn gặp chuỗi hỏng (do lệnh unlink thất bại): gộp qua fallbackInflight
                console.warn(`[Redis Recovery] Lượt retry vẫn gặp lỗi, gộp fallback an toàn sang DB: ${key}`);
                let p = this.fallbackInflight.get(key);
                if (!p) {
                    p = this.viaMicroCache(key, loader).finally(() => {
                        this.fallbackInflight.delete(key);
                    });
                    this.fallbackInflight.set(key, p);
                }
                const fallbackJson = await p;
                return JSON.parse(fallbackJson) as T;
            }

            console.warn(`[Redis JSON Corrupted] Safe Unlink chuỗi hỏng và phục hồi qua Single-Flight: ${key}`);

            await this.withTimeout(
                redisClient.eval(this.DEL_IF_EQUALS_LUA, {
                    keys: [key],
                    arguments: [result.rawJson]
                })
            ).catch(() => {});

            return this.fetchInternal(key, ttl, loader, true);
        }
    }

    private static async rebuildAsHolder<T>(
        key: string,
        ttl: number,
        loader: () => Promise<T>,
        lockKey: string,
        token: string
    ): Promise<ResolveResult> {
        this.metrics.lockAcquired++;
        try {
            const epochBefore = this.snapshotEpoch(key);
            const rawJson = await this.runLoader(loader);

            if (epochBefore === this.snapshotEpoch(key)) {
                await this.safeSetRaw(key, rawJson, ttl);
            } else {
                console.warn(`[Redis Race Ignored] Bỏ qua ghi cache key ${key} vì đã có invalidate trong lúc query DB`);
            }
            return { rawJson, fromRedisHit: false };
        } finally {
            this.safeReleaseLock(lockKey, token).catch(() => {});
        }
    }

    private static async resolve<T>(key: string, ttl: number, loader: () => Promise<T>): Promise<ResolveResult> {
        const { allowed, isProbe } = this.circuit.canCall();
        if (!allowed) {
            const rawJson = await this.viaMicroCache(key, loader);
            return { rawJson, fromRedisHit: false };
        }

        // 1) ĐỌC REDIS
        let raw: string | null = null;
        try {
            raw = await this.withTimeout(redisClient.get(key));
            this.circuit.onSuccess();
        } catch (err: any) {
            this.circuit.onFailure(isProbe);
            this.metrics.redisErrors++;
            console.error(`[Redis Error] GET (${key}):`, err.message);
            const rawJson = await this.viaMicroCache(key, loader);
            return { rawJson, fromRedisHit: false };
        }

        if (raw !== null) {
            return { rawJson: raw, fromRedisHit: true };
        }
        this.metrics.redisMisses++;

        // 2) REDIS DISTRIBUTED LOCK
        const lockKey = `lock:${key}`;
        const token = crypto.randomUUID();
        let gotLock = false;

        try {
            gotLock = !!(await this.withTimeout(redisClient.set(lockKey, token, { EX: 10, NX: true })));
        } catch (err: any) {
            this.circuit.onFailure(false);
            this.metrics.redisErrors++;
            console.error(`[Redis Error] SET LOCK (${lockKey}):`, err.message);
            const rawJson = await this.viaMicroCache(key, loader);
            return { rawJson, fromRedisHit: false };
        }

        if (gotLock) {
            return this.rebuildAsHolder(key, ttl, loader, lockKey, token);
        }

        // 3) KHÔNG GIÀNH ĐƯỢC LOCK: Vòng chờ lock holder
        this.metrics.lockWaited++;
        const deadline = Date.now() + this.loaderTimeoutMs + 1000;

        while (Date.now() < deadline) {
            await new Promise((r) => setTimeout(r, 150));
            try {
                const lockHeld = await this.withTimeout(redisClient.exists(lockKey));
                const retryRaw = (await this.withTimeout(redisClient.get(key))) as string | null;

                if (retryRaw !== null) {
                    this.metrics.lockWaitHits++;
                    return { rawJson: retryRaw, fromRedisHit: false };
                }

                if (!lockHeld) {
                    const token2 = crypto.randomUUID();
                    const got = !!(await this.withTimeout(redisClient.set(lockKey, token2, { EX: 10, NX: true })));
                    if (got) {
                        return this.rebuildAsHolder(key, ttl, loader, lockKey, token2);
                    }
                    continue;
                }
            } catch (err: any) {
                this.circuit.onFailure(false);
                this.metrics.redisErrors++;
                console.error(`[Redis Error] RETRY GET (${key}):`, err.message);
                const rawJson = await this.viaMicroCache(key, loader);
                return { rawJson, fromRedisHit: false };
            }
        }

        const rawJson = await this.viaMicroCache(key, loader);
        return { rawJson, fromRedisHit: false };
    }

    // -------------------------------------------------------------------------
    // HỖ TRỢ AN TOÀN KHI GHI & NHẢ LOCK
    // -------------------------------------------------------------------------
    private static async safeSetRaw(key: string, rawJson: string, ttl: number): Promise<void> {
        try {
            const jitter = Math.floor(Math.random() * (ttl * 0.2));
            await this.withTimeout(redisClient.set(key, rawJson, { EX: ttl + jitter }));
        } catch (err: any) {
            this.metrics.redisErrors++;
            console.error(`[Redis Error] SET (${key}):`, err.message);
        }
    }

    private static async safeReleaseLock(lockKey: string, token: string): Promise<void> {
        const RELEASE_LOCK_LUA = `
            if redis.call("get", KEYS[1]) == ARGV[1] then
                return redis.call("del", KEYS[1])
            else
                return 0
            end
        `;
        try {
            await this.withTimeout(
                redisClient.eval(RELEASE_LOCK_LUA, {
                    keys: [lockKey],
                    arguments: [token]
                })
            );
        } catch (e: any) {
            this.metrics.redisErrors++;
            console.error('[Redis Lock Release Error]', e.message);
        }
    }

    // -------------------------------------------------------------------------
    // LỚP 4: XÓA CACHE AN TOÀN (SCAN + UNLINK, RETRY & BÁO CÁO COMPLETE STATUS)
    // -------------------------------------------------------------------------
    private static scanMaxDurationMs = 3000;

    static async deleteCache(pattern: string): Promise<{ complete: boolean }> {
        this.bumpEpoch(pattern);

        const escaped = pattern.replace(/[.+?^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*');
        const regex = new RegExp(`^${escaped}$`);

        for (const k of this.inflightMap.keys()) {
            if (!k.startsWith('lock:') && regex.test(k)) {
                this.inflightMap.delete(k);
            }
        }

        if (!pattern.includes('*')) {
            const item = this.microCache.get(pattern);
            if (item) {
                this.microBytes -= item.bytes;
                this.microCache.delete(pattern);
            }
        } else {
            for (const [k, item] of this.microCache.entries()) {
                if (!k.startsWith('lock:') && regex.test(k)) {
                    this.microBytes -= item.bytes;
                    this.microCache.delete(k);
                }
            }
        }

        if (!isRedisReady()) {
            return { complete: false };
        }

        let complete = true;
        const scanStart = Date.now();

        try {
            if (!pattern.includes('*')) {
                if (pattern.startsWith('lock:')) return { complete: true };
                const success = await this.executeUnlinkWithRetry([pattern]);
                return { complete: success };
            }

            let cursor = '0';
            do {
                if (Date.now() - scanStart > this.scanMaxDurationMs) {
                    console.warn(`[Redis SCAN Timeout] Quá 3s đối với pattern: ${pattern}`);
                    complete = false;
                    break;
                }

                const reply = (await this.withTimeout(
                    redisClient.scan(cursor as any, {
                        MATCH: pattern,
                        COUNT: 200
                    })
                )) as { cursor: string | number; keys: string[] };
                cursor = String(reply.cursor);

                const validKeys = reply.keys.filter((k: string) => !k.startsWith('lock:'));
                if (validKeys.length > 0) {
                    const batchSuccess = await this.executeUnlinkWithRetry(validKeys);
                    if (!batchSuccess) complete = false;
                }
            } while (cursor !== '0');
        } catch (error: any) {
            this.metrics.redisErrors++;
            console.error(`[Redis Error] deleteCache thất bại (${pattern}):`, error.message);
            complete = false;
        }

        return { complete };
    }

    private static async executeUnlinkWithRetry(keys: string[], attempts = 2): Promise<boolean> {
        for (let attempt = 1; attempt <= attempts; attempt++) {
            try {
                await this.withTimeout(redisClient.unlink(keys));
                return true;
            } catch (err: any) {
                if (attempt === attempts) {
                    this.metrics.redisErrors++;
                    return false;
                }
                await new Promise((r) => setTimeout(r, 100));
            }
        }
        return false;
    }

    static async getCache<T>(key: string): Promise<T | null> {
        if (!this.circuit.allowsPassive()) return null;
        try {
            const data = (await this.withTimeout(redisClient.get(key))) as string | null;
            if (data === null) return null;
            return JSON.parse(data) as T;
        } catch {
            return null;
        }
    }

    static async setCache(key: string, data: any, ttl: number = 3600): Promise<void> {
        if (!this.circuit.allowsPassive()) return;
        const rawJson = JSON.stringify(data === undefined ? null : data);
        await this.safeSetRaw(key, rawJson, ttl);
    }

    // -------------------------------------------------------------------------
    // TEST HOOK: CHỈ SỬ DỤNG CHO UNIT TEST
    // -------------------------------------------------------------------------
    static __resetForTest(): void {
        this.inflightMap.clear();
        this.fallbackInflight.clear();
        this.microCache.clear();
        this.microBytes = 0;
        this.nsEpochs.clear();
        this.globalEpoch = 0;
        this.loaderTimeoutMs = 8000;
        this.scanMaxDurationMs = 3000;
        this.dbSemaphore = new ConcurrencySemaphore(10);
        this.circuit.state = 'CLOSED';
        this.circuit.failureTimes = [];
        this.circuit.lastFailureTime = 0;
        this.circuit.probeInFlight = false;
        this.metrics = {
            totalCalls: 0,
            singleFlightHits: 0,
            redisHits: 0,
            redisMisses: 0,
            lockAcquired: 0,
            lockWaited: 0,
            lockWaitHits: 0,
            microCacheHits: 0,
            dbQueries: 0,
            redisErrors: 0,
            getStats: this.metrics.getStats
        };
    }

    static __setLoaderTimeoutForTest(ms: number): void {
        this.loaderTimeoutMs = ms;
    }

    static __setScanMaxDurationForTest(ms: number): void {
        this.scanMaxDurationMs = ms;
    }

    static __getSemaphoreInUseForTest(): number {
        return this.dbSemaphore.getCurrentInUse();
    }

    static __setCircuitStateForTest(state: 'CLOSED' | 'OPEN' | 'HALF_OPEN', probeInFlight = false): void {
        this.circuit.state = state;
        this.circuit.probeInFlight = probeInFlight;
        if (state === 'OPEN') {
            this.circuit.lastFailureTime = Date.now();
        }
    }

    static __getCircuitProbeInFlightForTest(): boolean {
        return this.circuit.probeInFlight;
    }

    static __getGlobalEpochForTest(): number {
        return this.globalEpoch;
    }

    static __getNsEpochForTest(ns: string): number {
        return this.nsEpochs.get(ns) ?? 0;
    }
}
