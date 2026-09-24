import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "../../account/entities/Account.entity";
import { MemberRole } from "../entities/TeamMember.entity";
import { canConfirmProject } from "./ProjectConfirmation.helper";

const member = (userId: string, ...roles: MemberRole[]) => ({
    user: { id: userId },
    roles: roles.map(role => ({ role }))
});

const project = {
    team: {
        teamLead: { id: "account-1" },
        members: [
            member("pm-1", MemberRole.PROJECT_MANAGER),
            member("account-1", MemberRole.ACCOUNT, MemberRole.EDITOR),
            member("account-2", MemberRole.ACCOUNT, MemberRole.EDITOR),
            member("editor-1", MemberRole.EDITOR)
        ]
    }
} as any;

test("mọi thành viên ACCOUNT của dự án đều được chấp nhận", () => {
    assert.equal(canConfirmProject(project, "account-1", UserRole.STAFF_A), true);
    assert.equal(canConfirmProject(project, "account-2", UserRole.STAFF_A), true);
});

test("thành viên thường và người ngoài dự án không được chấp nhận", () => {
    assert.equal(canConfirmProject(project, "editor-1", UserRole.STAFF_A), false);
    assert.equal(canConfirmProject(project, "other-user", UserRole.STAFF_A), false);
});

test("ADMIN vẫn được chấp nhận dự án", () => {
    assert.equal(canConfirmProject(project, "admin-user", UserRole.ADMIN), true);
});
