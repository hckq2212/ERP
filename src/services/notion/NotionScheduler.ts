type SleepFn = (ms: number) => Promise<void>;

const sleep: SleepFn = (ms) =>
    new Promise((resolve) => setTimeout(resolve, ms));

/**
 * A tiny global scheduler for Notion API calls.
 * - Serializes requests (concurrency=1) to avoid bursts.
 * - Enforces a minimum delay between starting requests.
 *
 * This is intentionally dependency-free (no p-queue/bottleneck).
 */
export class NotionScheduler {
    private chain: Promise<unknown> = Promise.resolve();
    private lastStartMs = 0;
    private readonly minDelayMs: number;

    constructor(opts?: { minDelayMs?: number }) {
        this.minDelayMs = Math.max(0, opts?.minDelayMs ?? 350);
    }

    async run<T>(fn: () => Promise<T>): Promise<T> {
        const task = async () => {
            const now = Date.now();
            const wait = Math.max(0, this.minDelayMs - (now - this.lastStartMs));
            if (wait > 0) await sleep(wait);
            this.lastStartMs = Date.now();
            return fn();
        };

        const p = this.chain.then(task, task) as Promise<T>;
        // Keep the chain alive even if a task fails.
        this.chain = p.then(
            () => undefined,
            () => undefined
        );
        return p;
    }

    /**
     * Resolves once all scheduled work (up to this call) has completed.
     */
    async onIdle(): Promise<void> {
        await this.chain;
    }
}

