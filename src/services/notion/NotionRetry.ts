import type { APIResponseError } from "@notionhq/client";

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function getStatus(err: any): number | undefined {
    if (!err) return undefined;
    if (typeof err.status === "number") return err.status;
    if (typeof (err as APIResponseError).status === "number") return (err as APIResponseError).status;
    return undefined;
}

function getRetryAfterMs(err: any): number | undefined {
    // Notion SDK errors sometimes include headers; be defensive.
    const headers = err?.headers ?? err?.response?.headers;
    const ra = headers?.["retry-after"] ?? headers?.["Retry-After"];
    if (!ra) return undefined;
    const seconds = Number(ra);
    if (!Number.isFinite(seconds) || seconds <= 0) return undefined;
    return Math.ceil(seconds * 1000);
}

export function isRetryableNotionError(err: any): boolean {
    const status = getStatus(err);
    if (!status) return false;
    if (status === 429) return true;
    if (status === 500 || status === 502 || status === 503 || status === 504) return true;
    return false;
}

export async function withNotionRetry<T>(
    fn: () => Promise<T>,
    opts?: {
        maxRetries?: number;
        baseDelayMs?: number;
        maxDelayMs?: number;
        onRetry?: (info: { attempt: number; delayMs: number; status?: number; message?: string }) => void;
    }
): Promise<T> {
    const maxRetries = Math.max(0, opts?.maxRetries ?? 6);
    const baseDelayMs = Math.max(50, opts?.baseDelayMs ?? 500);
    const maxDelayMs = Math.max(baseDelayMs, opts?.maxDelayMs ?? 30000);

    let attempt = 0;
    while (true) {
        try {
            return await fn();
        } catch (err: any) {
            const status = getStatus(err);
            if (!isRetryableNotionError(err) || attempt >= maxRetries) throw err;

            const retryAfterMs = getRetryAfterMs(err);
            const exp = Math.min(maxDelayMs, baseDelayMs * Math.pow(2, attempt));
            const jitter = Math.floor(Math.random() * 250);
            const delayMs = Math.min(maxDelayMs, (retryAfterMs ?? exp) + jitter);

            opts?.onRetry?.({
                attempt: attempt + 1,
                delayMs,
                status,
                message: err?.message
            });

            await sleep(delayMs);
            attempt += 1;
        }
    }
}
