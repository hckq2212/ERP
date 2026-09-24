import test from "node:test";
import assert from "node:assert/strict";
import { TaskBaseService } from "../services/Task.BaseService";
import { UserRole } from "../../account/entities/Account.entity";
import { MemberRole } from "../../project/entities/TeamMember.entity";
import { ProjectStatus } from "../../project/entities/Project.entity";

class TestTaskBaseService extends TaskBaseService {
    protected async resolveActorUserId(actor?: { id?: string; userId?: string }) {
        return actor?.userId || actor?.id;
    }

    authorize(task: any, actor: any) {
        return this.assertCanManageTaskAssignment(task, actor);
    }
}

const service = new TestTaskBaseService();
const leadA = { id: "lead-a" };
const leadB = { id: "lead-b" };
const pm = { id: "pm" };
const team = {
    teamLead: leadA,
    members: [
        { user: leadA, roles: [{ role: MemberRole.ACCOUNT }] },
        { user: leadB, roles: [{ role: MemberRole.ACCOUNT }] },
        { user: pm, roles: [{ role: MemberRole.PROJECT_MANAGER }] }
    ]
};

const task = (overrides: Record<string, unknown> = {}) => ({
    assignerId: null,
    assigneeId: null,
    vendor: null,
    project: { team },
    ...overrides
});

test("mọi Lead dự án trong team đều có thể giao task chưa được phân công", async () => {
    assert.equal(
        await service.authorize(task(), { userId: leadB.id, role: UserRole.STAFF_A }),
        leadB.id
    );
});

test("không được phân công task khi dự án chưa được chấp nhận", async () => {
    await assert.rejects(
        service.authorize(
            task({ project: { team, status: ProjectStatus.PENDING_CONFIRMATION } }),
            { userId: leadA.id, role: UserRole.STAFF_A }
        ),
        (error: any) => error.statusCode === 409
            && error.message === "Dự án chưa được chấp nhận, chưa thể phân công công việc"
    );
});

test("Lead đã giao task được phép thay đổi phân công của chính mình", async () => {
    assert.equal(
        await service.authorize(
            task({ assignerId: leadA.id, assigneeId: "staff-a" }),
            { userId: leadA.id, role: UserRole.STAFF_A }
        ),
        leadA.id
    );
});

test("Lead khác không được ghi đè task đã có người giao", async () => {
    await assert.rejects(
        service.authorize(
            task({ assignerId: leadA.id, assigneeId: "staff-a" }),
            { userId: leadB.id, role: UserRole.STAFF_A }
        ),
        (error: any) => error.statusCode === 409
    );
});

test("ADMIN là ngoại lệ và không bị khóa bởi assignerId", async () => {
    assert.equal(
        await service.authorize(
            task({ assignerId: leadA.id, assigneeId: "staff-a" }),
            { userId: "admin", role: UserRole.ADMIN }
        ),
        "admin"
    );
});

test("PM không được xem là Lead dự án hoặc ngoại lệ", async () => {
    await assert.rejects(
        service.authorize(task(), { userId: pm.id, role: UserRole.PM }),
        (error: any) => error.statusCode === 403
    );
});

test("BOD không được ghi đè phân công của Lead", async () => {
    await assert.rejects(
        service.authorize(
            task({ assignerId: leadA.id, assigneeId: "staff-a" }),
            { userId: "bod", role: UserRole.BOD }
        ),
        (error: any) => error.statusCode === 403
    );
});
