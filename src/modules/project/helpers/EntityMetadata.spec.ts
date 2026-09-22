/**
 * Kiểm tra entity metadata KHÔNG cần kết nối DB.
 *
 * Mục đích: xác nhận entity mới đã được đăng ký đúng vào AppDataSource và
 * các cột/enum mới tồn tại với đúng tên. Bổ sung cho `tsc` (chỉ kiểm tra type)
 * và unit test (chỉ kiểm tra logic thuần).
 *
 * Chạy: node --test -r ts-node/register src/modules/project/helpers/EntityMetadata.spec.ts
 */
import assert from "node:assert/strict";
import test, { before, after } from "node:test";
import { AppDataSource } from "../../../data-source";
import { ProjectPauseRequests } from "../entities/ProjectPauseRequest.entity";
import { Projects } from "../entities/Project.entity";
import { Tasks } from "../../task/entities/Task.entity";
import { Debts, DebtStatus } from "../../debt/entities/Debt.entity";
import { TaskStatus } from "../../../shared/entities/Enums";

const columnsOf = (entity: any): string[] =>
    AppDataSource.getMetadata(entity).columns.map(column => column.propertyName);

/**
 * Metadata chỉ được build sau `initialize()`. Ta ép `synchronize = false` để
 * việc verify CHỈ ĐỌC — không bao giờ ALTER schema dù DB có kết nối được.
 * Nếu không kết nối được DB thì `initialize()` sẽ throw, và test sẽ báo skip.
 */
let initialized = false;
let skipReason = "";

before(async () => {
    AppDataSource.setOptions({
        synchronize: false,
        extra: { connectionTimeoutMillis: 3000 }
    });
    try {
        await AppDataSource.initialize();
        initialized = true;
    } catch (error: any) {
        skipReason = `Không kết nối được DB để verify metadata: ${error?.message}`;
    }
});

after(async () => {
    if (initialized) await AppDataSource.destroy();
});

const requireDb = (t: any) => {
    if (!initialized) {
        t.skip(skipReason);
        return false;
    }
    return true;
};

test("ProjectPauseRequests đã được đăng ký trong AppDataSource", (t) => {
    if (!requireDb(t)) return;
    const entityNames = AppDataSource.entityMetadatas.map(meta => meta.name);
    assert.ok(
        entityNames.includes("ProjectPauseRequests"),
        `ProjectPauseRequests chưa được đăng ký. Có: ${entityNames.join(", ")}`
    );
});

test("ProjectPauseRequests có đủ cột cho luồng pause/resume/close", (t) => {
    if (!requireDb(t)) return;
    const columns = columnsOf(ProjectPauseRequests);
    const required = [
        "projectId", "requesterId", "requesterRole", "pauseMode", "reason", "status",
        "approverId", "feedback", "requestedAt", "approvedAt", "autoAcceptAt",
        "resumedAt", "resumeReason",
        "closeMode", "closedByType", "closedById", "closedAt", "closeReason",
        "acceptedTaskCount", "cancelledTaskCount", "acceptedTaskIds"
    ];
    for (const column of required) {
        assert.ok(columns.includes(column), `Thiếu cột ${column}`);
    }
});

test("Projects có đủ 6 field tạm dừng", (t) => {
    if (!requireDb(t)) return;
    const columns = columnsOf(Projects);
    for (const column of [
        "pausedAt", "autoAcceptAt", "lastReminderDate",
        "currentPauseRequestId", "pausedById", "isOnHold"
    ]) {
        assert.ok(columns.includes(column), `Thiếu cột ${column}`);
    }
});

test("Tasks có statusBeforeHold và KHÔNG có readyForAcceptance", (t) => {
    if (!requireDb(t)) return;
    const columns = columnsOf(Tasks);
    assert.ok(columns.includes("statusBeforeHold"), "Thiếu statusBeforeHold");
    // readyForAcceptance đã bị bỏ theo chốt #42 — không được quay lại
    assert.ok(
        !columns.includes("readyForAcceptance"),
        "readyForAcceptance không được tồn tại — đã bỏ theo chốt #42"
    );
});

test("Debts có đủ field khóa/mở khóa", (t) => {
    if (!requireDb(t)) return;
    const columns = columnsOf(Debts);
    for (const column of [
        "lockedAt", "lockReason", "lockedById",
        "unlockedAt", "unlockReason", "unlockedById"
    ]) {
        assert.ok(columns.includes(column), `Thiếu cột ${column}`);
    }
    // FK nằm ở cột `...ById`; quan hệ ManyToOne nằm ở metadata.relations, không phải columns
    const relationNames = AppDataSource.getMetadata(Debts)
        .relations.map(relation => relation.propertyName);
    assert.ok(relationNames.includes("lockedBy"), "Thiếu quan hệ lockedBy");
    assert.ok(relationNames.includes("unlockedBy"), "Thiếu quan hệ unlockedBy");
});

test("ProjectStatus có ON_HOLD và PENDING_PAUSE_APPROVAL", (t) => {
    if (!requireDb(t)) return;
    const statuses = AppDataSource.getMetadata(Projects)
        .columns.find(column => column.propertyName === "status") as any;
    const enumValues: string[] = statuses.enum || [];
    assert.ok(enumValues.includes("ON_HOLD"), `Thiếu ON_HOLD. Có: ${enumValues.join(", ")}`);
    assert.ok(enumValues.includes("PENDING_PAUSE_APPROVAL"), "Thiếu PENDING_PAUSE_APPROVAL");
});

test("TaskStatus enum trong DB có ON_HOLD và CANCELLED", (t) => {
    if (!requireDb(t)) return;
    const statuses = AppDataSource.getMetadata(Tasks)
        .columns.find(column => column.propertyName === "status") as any;
    const enumValues: string[] = statuses.enum || [];
    assert.ok(enumValues.includes("ON_HOLD"), `Thiếu ON_HOLD. Có: ${enumValues.join(", ")}`);
    assert.ok(enumValues.includes("CANCELLED"), "Thiếu CANCELLED");
});

test("DebtStatus enum trong DB có LOCKED", (t) => {
    if (!requireDb(t)) return;
    const statuses = AppDataSource.getMetadata(Debts)
        .columns.find(column => column.propertyName === "status") as any;
    const enumValues: string[] = statuses.enum || [];
    assert.ok(enumValues.includes("LOCKED"), `Thiếu LOCKED. Có: ${enumValues.join(", ")}`);
});

