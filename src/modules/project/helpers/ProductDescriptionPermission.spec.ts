import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "../../account/entities/Account.entity";
import { MemberRole } from "../entities/TeamMember.entity";
import { ProjectProductDescriptionService } from "../services/ProjectProductDescription.Service";

// Không cần DB: chỉ gọi các hàm kiểm tra quyền (private) trên instance tạo bằng Object.create.
const service = Object.create(ProjectProductDescriptionService.prototype) as any;

const member = (userId: string, ...roles: MemberRole[]) => ({
    user: { id: userId },
    roles: roles.map((role) => ({ role }))
});

const project = (overrides: any = {}) =>
    ({
        team: {
            teamLead: { id: "lead1" },
            members: [
                member("pm1", MemberRole.PROJECT_MANAGER),
                member("acc1", MemberRole.ACCOUNT),
                member("editor1", MemberRole.EDITOR)
            ],
            ...overrides
        }
    }) as any;

const actor = (userId: string, role: UserRole) => ({ id: `account-${userId}`, userId, role });

const canEdit = (userId: string, role: UserRole) => () =>
    service.assertCanEditProductDescription(project(), actor(userId, role));
const canReview = (userId: string, role: UserRole) => () =>
    service.assertAssignedPm(project(), actor(userId, role));

test("BD KHÔNG còn được nhập thông tin chuẩn sản phẩm", () => {
    assert.throws(canEdit("bd1", UserRole.BD), (error: any) => error.statusCode === 403);
});

test("Account (thành viên team role ACCOUNT = Lead dự án) được nhập thông tin chuẩn", () => {
    assert.doesNotThrow(canEdit("acc1", UserRole.STAFF_A));
});

test("Team lead của dự án vẫn được nhập thông tin chuẩn", () => {
    assert.doesNotThrow(canEdit("lead1", UserRole.STAFF_A));
});

test("PM phụ trách được nhập; PM không phụ trách dự án thì không", () => {
    assert.doesNotThrow(canEdit("pm1", UserRole.PM));
    assert.throws(canEdit("pm-other", UserRole.PM), (error: any) => error.statusCode === 403);
});

test("thành viên thường (không phải Account/PM) không được nhập", () => {
    assert.throws(canEdit("editor1", UserRole.STAFF_B), (error: any) => error.statusCode === 403);
});

test("Account KHÔNG được duyệt/từ chối — chỉ PM phụ trách", () => {
    assert.throws(canReview("acc1", UserRole.STAFF_A), (error: any) => error.statusCode === 403);
    assert.throws(canReview("lead1", UserRole.STAFF_A), (error: any) => error.statusCode === 403);
    assert.throws(canReview("bd1", UserRole.BD), (error: any) => error.statusCode === 403);
    assert.doesNotThrow(canReview("pm1", UserRole.PM));
});
