import { TaskStatus } from "../../../shared/entities/Enums";
import { DebtStatus } from "../../debt/entities/Debt.entity";

/** Số ngày tạm dừng trước khi hệ thống tự động đóng dự án. */
export const PAUSE_DURATION_DAYS = 37;

/** Số ngày cuối trước D+37 mà hệ thống gửi thông báo nhắc nhở hằng ngày. */
export const REMINDER_WINDOW_DAYS = 7;

/** Lý do ghi vào lịch sử khi cron force đóng dự án ở D+37. */
export const FORCE_CLOSE_REASON = "Tự động đóng sau 37 ngày tạm dừng";

/**
 * 3 trạng thái CUỐI được MIỄN TRỪ khi tạm dừng — GIỮ NGUYÊN status.
 *
 * Lý do: chúng không còn là "việc đang làm". Chỉ task DỞ DANG mới bị đưa về `ON_HOLD`.
 */
export const HOLD_EXEMPT_TASK_STATUSES: TaskStatus[] = [
    TaskStatus.COMPLETED,
    TaskStatus.INTERNAL_COMPLETED,
    TaskStatus.ACCEPTED
];

/** Trạng thái debt sẽ bị khóa khi đóng dự án (debt PAID giữ nguyên). */
export const DEBT_STATUSES_TO_LOCK: DebtStatus[] = [
    DebtStatus.UNPAID,
    DebtStatus.PARTIAL,
    DebtStatus.OVERDUE
];

/** Cộng NGÀY TRỌN VẸN, giữ nguyên giờ:phút — tránh lệch khi qua tháng/nhuận. */
export const addDays = (from: Date, days: number): Date => {
    const result = new Date(from);
    result.setDate(result.getDate() + days);
    return result;
};

/** Mốc D+37 tính từ D0. */
export const calcAutoAcceptAt = (pausedAt: Date): Date =>
    addDays(pausedAt, PAUSE_DURATION_DAYS);

/** Mốc bắt đầu gửi thông báo nhắc nhở (D+30 = D+37 − 7). */
export const calcReminderStartAt = (autoAcceptAt: Date): Date =>
    addDays(autoAcceptAt, -REMINDER_WINDOW_DAYS);

type TaskLike = { id: string; status: TaskStatus };

/**
 * Phân loại task khi ĐÓNG DỰ ÁN.
 *
 * ⚠️ ĐÂY LÀ CHỐT CHẶN QUAN TRỌNG NHẤT CỦA TÍNH NĂNG — chỉ có 2 nhóm bị đụng:
 *
 * | Trạng thái khi đóng        | → Sau khi đóng | +Vinicoin |
 * |----------------------------|----------------|-----------|
 * | `COMPLETED`                | `ACCEPTED`     | ✅ CÓ     |
 * | `INTERNAL_COMPLETED`       | GIỮ NGUYÊN     | ❌ KHÔNG  |
 * | `ACCEPTED`                 | GIỮ NGUYÊN     | — đã trả  |
 * | `ON_HOLD` (dở dang)        | `CANCELLED`    | ❌ KHÔNG  |
 *
 * `INTERNAL_COMPLETED` là mới xong NỘI BỘ, khách CHƯA nghiệm thu → không thưởng
 * và không đổi trạng thái (chốt #42).
 */
export const classifyTasksForClose = <T extends TaskLike>(tasks: T[]) => {
    const toAccept = tasks.filter(task => task.status === TaskStatus.COMPLETED);
    const toCancel = tasks.filter(task => task.status === TaskStatus.ON_HOLD);
    const toKeep = tasks.filter(task => (
        task.status === TaskStatus.INTERNAL_COMPLETED
        || task.status === TaskStatus.ACCEPTED
    ));
    return { toAccept, toCancel, toKeep };
};

/**
 * Danh sách task ĐƯỢC THƯỞNG Vinicoin khi đóng dự án.
 *
 * ⚠️ CHỈ nhóm `toAccept` (task gốc là `COMPLETED`).
 * Nếu truyền `undefined` vào `triggerRewards` thì hàm đó KHÔNG giới hạn →
 * sẽ thưởng oan cho `INTERNAL_COMPLETED` và task dở dang. Đây là bug âm thầm:
 * không ném lỗi, chỉ sai tiền.
 */
export const buildRewardWhitelist = (toAccept: TaskLike[]): Set<string> =>
    new Set(toAccept.map(task => task.id));

/** Phân loại task khi TẠM DỪNG — nhóm nào bị đưa về `ON_HOLD`. */
export const shouldHoldTask = (status: TaskStatus): boolean =>
    !HOLD_EXEMPT_TASK_STATUSES.includes(status);

/**
 * Gán cờ khóa lên danh sách debt (hàm thuần, không chạm DB).
 *
 * Tách khỏi `closeProject()` để cron dùng lại được mà không tạo phụ thuộc vòng
 * giữa `Cron.Helper` và `ProjectPause.Service`.
 */
export const applyDebtLock = <T extends {
    status: DebtStatus;
    lockedAt?: Date | null;
    lockReason?: string | null;
    lockedBy?: unknown;
    lockedById?: string | null;
}>(
    debts: T[],
    reason: string,
    lockedBy?: { id: string } | null,
    now: Date = new Date()
): T[] => {
    for (const debt of debts) {
        debt.status = DebtStatus.LOCKED;
        debt.lockedAt = now;
        debt.lockReason = reason;
        debt.lockedBy = lockedBy || null;
        debt.lockedById = lockedBy?.id || null;
    }
    return debts;
};
