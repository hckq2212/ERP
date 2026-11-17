import redisClient, { isRedisReady } from "../../../shared/config/redis";
import { RedisService } from "../../../shared/services/Redis.Service";

export interface TaskInvalidationPayload {
    projectId?: string;
    previousProjectId?: string;   // task chuyển dự án
    assigneeId?: string;
    previousAssigneeId?: string;  // đổi người được giao
}

const VER_SYSTEM = "ver:dashboard:system";
const VER_ALL = "ver:dashboard:all";
const verProject = (id: string) => `ver:dashboard:project:${id}`;

export class DashboardCacheCoordinator {
    private static DEBOUNCE_MS = 3000;   // trailing debounce
    private static MAX_WAIT_MS = 10000;  // tối đa chờ, tránh đói vô hạn khi event dồn dập
    private static timer: NodeJS.Timeout | null = null;
    private static firstAt = 0;

    private static pendingProjectIds = new Set<string>();
    private static pendingAssigneeIds = new Set<string>();
    private static pendingWorkloadAll = false;

    /**
     * Gọi từ subscriber của TASK. Gom cụm việc bump version và xóa workload.
     * Project detail cache được xóa NGAY (không debounce).
     */
    public static scheduleTaskInvalidation(p: TaskInvalidationPayload): void {
        const projectIds = [p.projectId, p.previousProjectId].filter(Boolean) as string[];
        const assigneeIds = [p.assigneeId, p.previousAssigneeId].filter(Boolean) as string[];

        projectIds.forEach((id) => this.pendingProjectIds.add(id));
        assigneeIds.forEach((id) => this.pendingAssigneeIds.add(id));
        // Event không biết ai là assignee (ví dụ DELETED chỉ có { id }) → dọn workload diện rộng
        if (assigneeIds.length === 0) this.pendingWorkloadAll = true;

        for (const id of projectIds) {
            RedisService.deleteCache(`projects:*:detail:${id}*`).catch(() => {});
        }

        const now = Date.now();
        if (!this.firstAt) this.firstAt = now;
        if (this.timer) clearTimeout(this.timer);
        const wait = Math.min(this.DEBOUNCE_MS, Math.max(0, this.MAX_WAIT_MS - (now - this.firstAt)));
        this.timer = setTimeout(() => {
            this.flush().catch((e) => console.error("[DashboardCacheCoordinator] flush error:", e));
        }, wait);
    }

    /**
     * Sự kiện ảnh hưởng MỌI dashboard (Contract, Addendum, định mức, cấu hình).
     * Hiếm nên bump ngay, không debounce.
     */
    public static async invalidateSystem(opts: { workloadAll?: boolean } = {}): Promise<void> {
        const jobs: Promise<any>[] = [];
        if (isRedisReady()) jobs.push(redisClient.incr(VER_SYSTEM));
        if (opts.workloadAll) jobs.push(RedisService.deleteCache("tasks:workload:*"));
        await Promise.allSettled(jobs);
    }

    /** Thực thi gom cụm. Gọi bởi timer, hoặc thủ công khi shutdown/test. */
    public static async flush(): Promise<void> {
        if (this.timer) { clearTimeout(this.timer); this.timer = null; }
        this.firstAt = 0;

        const projectIds = Array.from(this.pendingProjectIds);
        const assigneeIds = Array.from(this.pendingAssigneeIds);
        const workloadAll = this.pendingWorkloadAll;

        this.pendingProjectIds.clear();
        this.pendingAssigneeIds.clear();
        this.pendingWorkloadAll = false;

        if (!projectIds.length && !assigneeIds.length && !workloadAll) return;

        const jobs: Promise<any>[] = [this.bumpVersions(projectIds)];

        if (workloadAll) {
            jobs.push(RedisService.deleteCache("tasks:workload:*"));
        } else {
            for (const uid of assigneeIds) {
                jobs.push(RedisService.deleteCache(`tasks:workload:${uid}:*`));
            }
        }
        await Promise.allSettled(jobs);
    }

    /** Version `all` luôn bump (dashboard tổng hợp phụ thuộc mọi task); version project bump theo từng dự án. */
    private static async bumpVersions(projectIds: string[]): Promise<void> {
        if (!isRedisReady()) return;
        const jobs: Promise<any>[] = [redisClient.incr(VER_ALL)];
        for (const id of projectIds) {
            if (id && id !== "all") jobs.push(redisClient.incr(verProject(id)));
        }
        await Promise.allSettled(jobs);
    }

    /**
     * Trả "system.scope" cho cache key, 1 round-trip (MGET).
     * Mặc định 0 (KHÔNG phải 1) để lần INCR đầu tiên (→1) chắc chắn đổi key.
     */
    public static async getVersionTag(projectId?: string): Promise<string> {
        if (!isRedisReady()) return "0.0";
        const scopeKey = projectId && projectId !== "all" ? verProject(projectId) : VER_ALL;
        try {
            const [sys, scope] = await redisClient.mGet([VER_SYSTEM, scopeKey]);
            return `${sys ?? 0}.${scope ?? 0}`;
        } catch {
            return `x${Date.now()}`; // Redis lỗi: key duy nhất, không dùng dữ liệu cũ
        }
    }
}
