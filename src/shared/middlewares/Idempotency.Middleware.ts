import { createHash, randomUUID } from "crypto";
import { Request, Response, NextFunction } from "express";
import { Readable } from "stream";
import { RedisService } from "../services/Redis.Service";

const busboy = require("busboy");

const PENDING_TTL_SECONDS = 60;          // đủ cho 1 request dài nhất
const COMPLETED_TTL_SECONDS = 24 * 3600; // retry muộn vẫn nhận lại kết quả cũ
const WRITE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type IdempotencyRecord =
    | { status: "PENDING"; bodyHash: string; executionId: string }
    | { status: "COMPLETED"; bodyHash: string; statusCode: number; body: unknown; executionId: string };

export const idempotencyMiddleware = async (req: Request, res: Response, next: NextFunction) => {
    if (!WRITE_METHODS.has(req.method)) return next();

    const key = req.header("Idempotency-Key");
    if (!key) return next(); // tương thích ngược

    if (!UUID_RE.test(key)) {
        return res.status(400).json({ message: "Idempotency-Key phải là UUID hợp lệ." });
    }

    const userId = (req as any).user?.userId || (req as any).user?.id || "anon";
    const scope = `${userId}:${req.method}:${req.baseUrl || ""}${req.path || ""}`;
    const cacheKey = `idempotency:${scope}:${key}`;
    const executionId = randomUUID();

    let bodyHash: string;
    let rawBuffer: Buffer | null = null;

    if (req.headers["content-type"]?.includes("multipart/form-data")) {
        try {
            const parsed = await new Promise<{ rawBuffer: Buffer; bodyHash: string }>((resolve, reject) => {
                const chunks: Buffer[] = [];
                const parts: string[] = [];
                const filePromises: Promise<void>[] = [];
                const bb = busboy({ headers: req.headers });

                bb.on("field", (name: string, val: string) => {
                    parts.push(`field:${name}=${val}`);
                });

                bb.on("file", (name: string, fileStream: any, info: any) => {
                    const { filename, mimeType } = info;
                    const fileChunks: Buffer[] = [];
                    filePromises.push(
                        new Promise<void>((resolveFile) => {
                            fileStream.on("data", (chunk: Buffer) => fileChunks.push(chunk));
                            fileStream.on("end", () => {
                                const fileBuf = Buffer.concat(fileChunks);
                                const fileHash = createHash("sha256").update(fileBuf).digest("hex");
                                parts.push(`file:${name}:${filename || ""}:${mimeType || ""}:${fileBuf.length}:${fileHash}`);
                                resolveFile();
                            });
                            fileStream.on("error", () => resolveFile());
                        })
                    );
                });

                bb.on("close", async () => {
                    await Promise.all(filePromises);
                    const totalBuf = Buffer.concat(chunks);
                    const hash = createHash("sha256").update(parts.sort().join(";")).digest("hex");
                    resolve({ rawBuffer: totalBuf, bodyHash: hash });
                });

                bb.on("error", (err: any) => reject(err));

                req.on("data", (chunk: Buffer) => {
                    chunks.push(chunk);
                    bb.write(chunk);
                });
                req.on("end", () => {
                    bb.end();
                });
                req.on("error", (err: any) => reject(err));
            });

            rawBuffer = parsed.rawBuffer;
            bodyHash = parsed.bodyHash;

            // Re-emit stream to downstream multer middleware via monkey-patched req.pipe
            req.pipe = function <T extends NodeJS.WritableStream>(dest: T, options?: { end?: boolean }): T {
                return Readable.from(rawBuffer!).pipe(dest, options) as unknown as T;
            };
        } catch (err) {
            console.error("[idempotency] lỗi parse multipart stream:", err);
            bodyHash = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex");
        }
    } else {
        bodyHash = createHash("sha256").update(JSON.stringify(req.body ?? {})).digest("hex");
    }

    try {
        const claimed = await RedisService.setIfNotExists(
            cacheKey,
            JSON.stringify({ status: "PENDING", bodyHash, executionId } satisfies IdempotencyRecord),
            PENDING_TTL_SECONDS
        );

        if (!claimed) {
            const raw = await RedisService.get(cacheKey);
            const existing: IdempotencyRecord | null = raw ? JSON.parse(raw) : null;
            if (existing) {
                if (existing.bodyHash !== bodyHash) {
                    return res.status(422).json({
                        message: "Idempotency-Key đã được dùng với nội dung khác.",
                    });
                }
                if (existing.status === "PENDING") {
                    res.setHeader("Retry-After", "2");
                    return res.status(409).json({
                        message: "Yêu cầu đang được xử lý, vui lòng không gửi lặp lại.",
                    });
                }
                res.setHeader("Idempotent-Replayed", "true");
                return res.status(existing.statusCode).json(existing.body);
            }
            // Key vừa hết hạn giữa hai lệnh: cho xử lý như request mới
            return next();
        }
    } catch (err) {
        console.error("[idempotency] Redis lỗi, bỏ qua kiểm tra:", err);
        return next();
    }

    // Bắt body để lưu kết quả
    let capturedBody: unknown;
    let captured = false;
    let finished = false;
    let settled = false;

    let refreshCount = 0;
    const MAX_REFRESH_COUNT = 30; // tối đa 10 phút

    // Heartbeat định kỳ: Gia hạn TTL cho PENDING key mỗi 20s chừng nào request handler vẫn đang thực thi ngầm
    // Đảm bảo request chạy dài không bao giờ bị mất khóa dẫn tới bị thực thi lại đồng thời
    const refreshInterval = setInterval(async () => {
        if (!finished && !settled && refreshCount < MAX_REFRESH_COUNT) {
            refreshCount++;
            try {
                await RedisService.refreshPendingTtl(cacheKey, executionId, PENDING_TTL_SECONDS);
            } catch {
                // bỏ qua lỗi refresh
            }
        } else if (refreshCount >= MAX_REFRESH_COUNT) {
            clearInterval(refreshInterval);
        }
    }, 20000);

    const settle = async () => {
        if (settled) return;
        settled = true;
        clearInterval(refreshInterval);
        try {
            const ok = res.statusCode >= 200 && res.statusCode < 300;
            if (ok && captured) {
                // Thao tác nguyên tử (Atomic CAS): Chỉ chuyển sang COMPLETED nếu key vẫn thuộc executionId này
                await RedisService.setIfExecutionIdMatches(
                    cacheKey,
                    JSON.stringify({
                        status: "COMPLETED",
                        bodyHash,
                        statusCode: res.statusCode,
                        body: capturedBody,
                        executionId,
                    } satisfies IdempotencyRecord),
                    executionId,
                    COMPLETED_TTL_SECONDS
                );
            } else {
                // Thao tác nguyên tử (Atomic CAD): Chỉ xóa nếu key hiện tại vẫn thuộc executionId này
                await RedisService.delIfExecutionIdMatches(cacheKey, executionId);
            }
        } catch (err) {
            console.error("[idempotency] không cập nhật được key:", err);
        }
    };

    const originalJson = res.json.bind(res);
    const originalSend = res.send.bind(res);

    res.json = (body: unknown) => {
        capturedBody = body;
        captured = true;
        finished = true;
        settle();
        return originalJson(body);
    };

    res.send = (body: unknown) => {
        if (!captured) {
            capturedBody = body;
            captured = true;
        }
        finished = true;
        settle();
        return originalSend(body);
    };

    res.on("finish", () => {
        finished = true;
        settle();
    });
    res.on("close", () => {
        if (!finished) {
            // Khi kết nối đóng sớm (client disconnect / timeout mạng) trong lúc handler còn đang chạy:
            // Tuyệt đối KHÔNG xóa key ngay lập tức vì async handler trong DB/Node vẫn đang chạy ngầm.
            // Để nguyên trạng thái PENDING tự hết hạn theo PENDING_TTL_SECONDS để chống request retry tranh chấp tài nguyên.
            return;
        }
        settle();
    });

    next();
};
