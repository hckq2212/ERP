import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "../../account/entities/Account.entity";
import {
    DashboardScopeError,
    DashboardScopeType,
    resolveDashboardScope,
    selectDashboardWorkItems
} from "./Dashboard.Scope";

const baseInput = {
    viewerUserId: "viewer",
    viewerRole: UserRole.STAFF_A,
    managedProjectIds: [] as string[],
    managedMemberIds: [] as string[],
    personalProjectIds: ["personal-project"],
    targetPersonalProjectIds: [] as string[],
    systemProjectIds: ["project-a", "project-b"],
    systemMemberIds: ["viewer", "member-a", "member-b"]
};

test("staff receives personal scope and cannot select another member", () => {
    const scope = resolveDashboardScope(baseInput);
    assert.equal(scope.type, DashboardScopeType.PERSONAL);
    assert.deepEqual(scope.memberIds, ["viewer"]);
    assert.deepEqual(scope.projectIds, ["personal-project"]);

    assert.throws(
        () => resolveDashboardScope({ ...baseInput, requestedUserId: "member-a" }),
        DashboardScopeError
    );
});

test("actual team lead receives management scope", () => {
    const scope = resolveDashboardScope({
        ...baseInput,
        managedProjectIds: ["managed-project"],
        managedMemberIds: ["viewer", "member-a"]
    });

    assert.equal(scope.type, DashboardScopeType.MANAGEMENT);
    assert.deepEqual(scope.projectIds, ["managed-project"]);
    assert.equal(scope.canSelectMembers, true);
});

test("PM receives management scope even when no project is currently assigned", () => {
    const scope = resolveDashboardScope({ ...baseInput, viewerRole: UserRole.PM });
    assert.equal(scope.type, DashboardScopeType.MANAGEMENT);
    assert.deepEqual(scope.projectIds, []);
});

test("management can view a managed member but only inside managed projects", () => {
    const scope = resolveDashboardScope({
        ...baseInput,
        managedProjectIds: ["managed-a", "managed-b"],
        managedMemberIds: ["viewer", "member-a"],
        requestedUserId: "member-a",
        targetPersonalProjectIds: ["managed-b", "outside-project"]
    });

    assert.equal(scope.type, DashboardScopeType.PERSONAL);
    assert.equal(scope.targetUserId, "member-a");
    assert.deepEqual(scope.projectIds, ["managed-b"]);
});

test("ADMIN and BOD receive system scope", () => {
    for (const role of [UserRole.ADMIN, UserRole.BOD]) {
        const scope = resolveDashboardScope({ ...baseInput, viewerRole: role });
        assert.equal(scope.type, DashboardScopeType.SYSTEM);
        assert.deepEqual(scope.projectIds, ["project-a", "project-b"]);
        assert.equal(scope.canSelectMembers, true);
    }
});

test("system viewer switching member receives that member's personal project scope", () => {
    const scope = resolveDashboardScope({
        ...baseInput,
        viewerRole: UserRole.ADMIN,
        requestedUserId: "member-a",
        requestedProjectId: "project-b",
        targetPersonalProjectIds: ["project-b"]
    });

    assert.equal(scope.type, DashboardScopeType.PERSONAL);
    assert.equal(scope.targetUserId, "member-a");
    assert.deepEqual(scope.projectIds, ["project-b"]);
});

test("requested project must belong to the resolved scope", () => {
    assert.throws(
        () => resolveDashboardScope({ ...baseInput, requestedProjectId: "outside-project" }),
        DashboardScopeError
    );
});

test("management widgets use project-scoped work items instead of personal items", () => {
    const personalItems = [{ id: "personal-task" }];
    const projectItems = [{ id: "project-task-a" }, { id: "project-task-b" }];

    assert.deepEqual(
        selectDashboardWorkItems(DashboardScopeType.MANAGEMENT, personalItems, projectItems),
        projectItems
    );
    assert.deepEqual(
        selectDashboardWorkItems(DashboardScopeType.PERSONAL, personalItems, projectItems),
        personalItems
    );
});

test("account viewer can select managed members and has isAccountViewingMember flag set", () => {
    const scope = resolveDashboardScope({
        ...baseInput,
        isAccountViewer: true,
        managedProjectIds: ["managed-project"],
        managedMemberIds: ["viewer", "member-a"],
        requestedUserId: "member-a",
        targetPersonalProjectIds: ["managed-project", "outside-project"]
    });

    assert.equal(scope.type, DashboardScopeType.PERSONAL);
    assert.equal(scope.targetUserId, "member-a");
    assert.deepEqual(scope.projectIds, ["managed-project"]);
    assert.equal(scope.canSelectMembers, true);
    assert.equal(scope.isAccountViewingMember, true);
});

test("BD and ADMIN_SALE cannot select members or view another member dashboard", () => {
    const scopeBD = resolveDashboardScope({
        ...baseInput,
        viewerRole: UserRole.BD,
        isAccountViewer: true,
        managedProjectIds: ["managed-project"],
        managedMemberIds: ["viewer", "member-a"]
    });

    assert.equal(scopeBD.canSelectMembers, false);
    assert.equal(scopeBD.isAccountViewer, false);

    const scopeAdminSale = resolveDashboardScope({
        ...baseInput,
        viewerRole: UserRole.ADMIN_SALE,
        isAccountViewer: true,
        managedProjectIds: ["managed-project"],
        managedMemberIds: ["viewer", "member-a"]
    });

    assert.equal(scopeAdminSale.canSelectMembers, false);
    assert.equal(scopeAdminSale.isAccountViewer, false);
});

test("PM can request personal scope using mode=personal", () => {
    const scope = resolveDashboardScope({
        ...baseInput,
        viewerRole: UserRole.PM,
        mode: "personal"
    });

    assert.equal(scope.type, DashboardScopeType.PERSONAL);
    assert.equal(scope.targetUserId, "viewer");
    assert.deepEqual(scope.projectIds, ["personal-project"]);
    assert.equal(scope.canSelectMembers, true);
    assert.equal(scope.mode, "personal");
});
