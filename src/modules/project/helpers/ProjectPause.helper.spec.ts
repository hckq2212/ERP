import assert from "node:assert/strict";
import test from "node:test";
import { TaskStatus } from "../../../shared/entities/Enums";
import {
    PAUSE_DURATION_DAYS,
    REMINDER_WINDOW_DAYS,
    HOLD_EXEMPT_TASK_STATUSES,
    DEBT_STATUSES_TO_LOCK,
    addDays,
    calcAutoAcceptAt,
    calcReminderStartAt,
    classifyTasksForClose,
    buildRewardWhitelist,
    shouldHoldTask
} from "./ProjectPause.helper";

const task = (id: string, status: TaskStatus) => ({ id, status });

// ─────────────────────────────────────────────────────────────────────────
// LUẬT CHỐT TASK — TEST QUAN TRỌNG NHẤT CỦA TÍNH NĂNG
// ─────────────────────────────────────────────────────────────────────────

test("🔴 closeProject: 2 COMPLETED + 1 INTERNAL_COMPLETED + 1 DOING + 1 ACCEPTED", () => {
    const tasks = [
        task("t1", TaskStatus.COMPLETED),
        task("t2", TaskStatus.COMPLETED),
        task("t3", TaskStatus.INTERNAL_COMPLETED),
        task("t4", TaskStatus.DOING),          // khi pause đã thành ON_HOLD
        task("t5", TaskStatus.ACCEPTED)
    ];
    // Mô phỏng trạng thái SAU khi pause: DOING → ON_HOLD
    const afterPause = tasks.map(t =>
        t.status === TaskStatus.DOING ? task(t.id, TaskStatus.ON_HOLD) : t
    );

    const { toAccept, toCancel, toKeep } = classifyTasksForClose(afterPause);

    assert.deepEqual(toAccept.map(t => t.id), ["t1", "t2"], "Chỉ COMPLETED mới được nghiệm thu");
    assert.deepEqual(toCancel.map(t => t.id), ["t4"], "Chỉ task ON_HOLD mới bị hủy");
    assert.deepEqual(toKeep.map(t => t.id), ["t3", "t5"], "INTERNAL_COMPLETED + ACCEPTED giữ nguyên");
});

test("🔴 Vinicoin whitelist CHỈ gồm task gốc COMPLETED", () => {
    const tasks = [
        task("t1", TaskStatus.COMPLETED),
        task("t2", TaskStatus.COMPLETED),
        task("t3", TaskStatus.INTERNAL_COMPLETED),
        task("t4", TaskStatus.ON_HOLD),
        task("t5", TaskStatus.ACCEPTED)
    ];
    const { toAccept } = classifyTasksForClose(tasks);
    const whitelist = buildRewardWhitelist(toAccept);

    assert.equal(whitelist.size, 2);
    assert.ok(whitelist.has("t1"));
    assert.ok(whitelist.has("t2"));
    // INTERNAL_COMPLETED KHÔNG được thưởng (chốt #42)
    assert.ok(!whitelist.has("t3"), "INTERNAL_COMPLETED không được nhận Vinicoin");
    assert.ok(!whitelist.has("t4"), "Task dở dang không được nhận Vinicoin");
    // ACCEPTED đã trả thưởng từ trước → không thưởng lại
    assert.ok(!whitelist.has("t5"), "ACCEPTED không được tính lại Vinicoin");
});

test("INTERNAL_COMPLETED KHÔNG bị đổi trạng thái và KHÔNG được thưởng", () => {
    const { toAccept, toCancel, toKeep } = classifyTasksForClose([
        task("a", TaskStatus.INTERNAL_COMPLETED)
    ]);
    assert.equal(toAccept.length, 0, "Không được đưa vào nhóm ACCEPTED");
    assert.equal(toCancel.length, 0, "Không được hủy");
    assert.equal(toKeep.length, 1, "Phải giữ nguyên");
    assert.equal(buildRewardWhitelist(toAccept).size, 0, "Không được thưởng");
});

test("task dở dang ở MỌI status (không phải 3 cuối) đều thành ON_HOLD rồi CANCELLED", () => {
    const inProgressStatuses = [
        TaskStatus.PENDING, TaskStatus.DOING, TaskStatus.AWAITING_ACCEPTANCE,
        TaskStatus.AWAITING_REVIEW, TaskStatus.REJECTED, TaskStatus.REJECTED_BILLABLE,
        TaskStatus.REJECTED_SUPPORT, TaskStatus.OVERDUE, TaskStatus.AWAITING_PRICING,
        TaskStatus.AWAITING_SUPPORT, TaskStatus.REWORKING, TaskStatus.SUPPORT_PENDING,
        TaskStatus.SUPPORT_AWAITING_RETURN
    ];
    for (const status of inProgressStatuses) {
        assert.equal(shouldHoldTask(status), true, `${status} phải bị đưa về ON_HOLD`);
    }
});

test("3 trạng thái cuối được MIỄN TRỪ khi pause", () => {
    for (const status of HOLD_EXEMPT_TASK_STATUSES) {
        assert.equal(shouldHoldTask(status), false, `${status} phải được giữ nguyên`);
        assert.equal(
            classifyTasksForClose([task("x", status)]).toCancel.length, 0,
            `${status} không bao giờ bị hủy`
        );
    }
    assert.equal(HOLD_EXEMPT_TASK_STATUSES.length, 3);
});

test("dự án không có task nào → không lỗi, mọi nhóm rỗng", () => {
    const { toAccept, toCancel, toKeep } = classifyTasksForClose([]);
    assert.equal(toAccept.length + toCancel.length + toKeep.length, 0);
    assert.equal(buildRewardWhitelist(toAccept).size, 0);
});

// ─────────────────────────────────────────────────────────────────────────
// ĐỒNG HỒ 37 NGÀY
// ─────────────────────────────────────────────────────────────────────────

test("D+37 = D0 + 37 ngày, GIỮ NGUYÊN giờ:phút", () => {
    const d0 = new Date("2026-09-21T14:30:00.000Z");
    const d37 = calcAutoAcceptAt(d0);

    assert.equal(d37.getUTCHours(), 14, "Giờ phải giữ nguyên");
    assert.equal(d37.getUTCMinutes(), 30, "Phút phải giữ nguyên");
    assert.equal(PAUSE_DURATION_DAYS, 37);

    const diffDays = Math.round((d37.getTime() - d0.getTime()) / 86400000);
    assert.equal(diffDays, 37);
});

test("biên tháng: pause 23:59 ngày 30/11 → D+37 là 06/01 (không lệch ngày)", () => {
    const d0 = new Date(2026, 10, 30, 23, 59, 0); // 30/11/2026 23:59 giờ local
    const d37 = calcAutoAcceptAt(d0);

    assert.equal(d37.getFullYear(), 2027, "Phải sang năm 2027");
    assert.equal(d37.getMonth(), 0, "Phải là tháng 1");
    assert.equal(d37.getDate(), 6, "Phải là ngày 06/01");
    assert.equal(d37.getHours(), 23);
    assert.equal(d37.getMinutes(), 59);
});

test("biên năm nhuận: 2028 là năm nhuận nên 37 ngày vẫn đúng", () => {
    const d0 = new Date(2028, 1, 20, 8, 0, 0); // 20/02/2028
    const d37 = calcAutoAcceptAt(d0);
    // 20/02 + 37 ngày: 2028 nhuận → tháng 2 có 29 ngày
    // 20/02 + 9 = 29/02, còn 28 ngày → 28/03
    assert.equal(d37.getMonth(), 2, "Phải là tháng 3");
    assert.equal(d37.getDate(), 28, "Phải là 28/03");
});

test("addDays không mutate ngày gốc (tránh bug dùng chung reference)", () => {
    const original = new Date(2026, 0, 15, 10, 0, 0);
    const snapshot = original.getTime();
    addDays(original, 37);
    assert.equal(original.getTime(), snapshot, "Ngày gốc không được đổi");
});

test("cửa sổ nhắc nhở = D+37 − 7 ngày = D+30", () => {
    const d0 = new Date(2026, 8, 21, 9, 0, 0);
    const autoAcceptAt = calcAutoAcceptAt(d0);
    const reminderStart = calcReminderStartAt(autoAcceptAt);

    assert.equal(REMINDER_WINDOW_DAYS, 7);
    const diffDays = Math.round((autoAcceptAt.getTime() - reminderStart.getTime()) / 86400000);
    assert.equal(diffDays, 7);
    // D+30 so với D0
    const fromD0 = Math.round((reminderStart.getTime() - d0.getTime()) / 86400000);
    assert.equal(fromD0, 30);
});

// ─────────────────────────────────────────────────────────────────────────
// DEBT
// ─────────────────────────────────────────────────────────────────────────

test("chỉ 3 trạng thái debt chưa thu mới bị khóa, PAID giữ nguyên", () => {
    assert.deepEqual(
        [...DEBT_STATUSES_TO_LOCK].sort(),
        ["OVERDUE", "PARTIAL", "UNPAID"].sort()
    );
    assert.ok(!DEBT_STATUSES_TO_LOCK.includes("PAID" as any), "Debt PAID không được khóa");
    assert.ok(!DEBT_STATUSES_TO_LOCK.includes("LOCKED" as any), "Debt đã khóa không cần khóa lại");
});
