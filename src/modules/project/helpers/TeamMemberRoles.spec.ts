import assert from "node:assert/strict";
import test from "node:test";
import { getMemberRoles, MemberRole, memberHasRole, TeamMembers } from "../entities/TeamMember.entity";

test("một membership có thể chứa nhiều role", () => {
    const member = {
        roles: [
            { role: MemberRole.EDITOR },
            { role: MemberRole.GRAPHIC_DESIGNER },
            { role: MemberRole.CONTENT_CREATOR }
        ]
    } as TeamMembers;

    assert.deepEqual(getMemberRoles(member), [
        MemberRole.EDITOR,
        MemberRole.GRAPHIC_DESIGNER,
        MemberRole.CONTENT_CREATOR
    ]);
    assert.equal(memberHasRole(member, MemberRole.GRAPHIC_DESIGNER), true);
    assert.equal(memberHasRole(member, MemberRole.PROJECT_MANAGER), false);
});

test("helper vẫn đọc được roles đã serialize thành chuỗi", () => {
    const serializedMember = {
        roles: [MemberRole.EDITOR, MemberRole.SCRIPTER]
    } as unknown as TeamMembers;

    assert.deepEqual(getMemberRoles(serializedMember), [MemberRole.EDITOR, MemberRole.SCRIPTER]);
});
