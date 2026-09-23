import assert from "node:assert/strict";
import test from "node:test";
import { UserRole } from "../../account/entities/Account.entity";
import { Contracts } from "../../contract/entities/Contract.entity";
import {
    assertBdOwnsContract,
    assertBdOwnsProjectContract,
    isContractOwnedByActor
} from "./ProjectOwnership.helper";

const BD_ACTOR = { userId: "bd-user-1", role: UserRole.BD };
const OTHER_BD = { userId: "bd-user-2", role: UserRole.BD };

test("BD tạo hợp đồng → được phép", () => {
    assert.doesNotThrow(() => assertBdOwnsContract(BD_ACTOR, {
        contractCode: "HD-001",
        createdById: "bd-user-1"
    }));
});

test("BD tạo khách hàng (không tạo hợp đồng) → được phép", () => {
    assert.doesNotThrow(() => assertBdOwnsContract(BD_ACTOR, {
        contractCode: "HD-002",
        createdById: "someone-else",
        customer: { createdBy: { id: "bd-user-1" } }
    }));
});

test("BD tạo cơ hội (hợp đồng do người khác tạo) → được phép", () => {
    assert.doesNotThrow(() => assertBdOwnsContract(BD_ACTOR, {
        contractCode: "HD-002-OPP",
        createdById: "admin-user",
        opportunity: { createdBy: { id: "bd-user-1" } }
    }));
});

test("BD không tạo hợp đồng, không tạo cơ hội, không tạo khách hàng → chặn với 403", () => {
    assert.throws(
        () => assertBdOwnsContract(BD_ACTOR, {
            contractCode: "HD-NONE",
            createdById: "someone-else",
            opportunity: { createdBy: { id: "someone-else" } },
            customer: { createdBy: { id: "someone-else" } }
        }),
        (error: any) => {
            assert.equal(error.statusCode, 403);
            return true;
        }
    );
});

test("BD khác phụ trách → chặn với 403", () => {
    assert.throws(
        () => assertBdOwnsContract(BD_ACTOR, {
            contractCode: "HD-003",
            createdById: "bd-user-2",
            customer: { createdBy: { id: "someone-else" } }
        }),
        (error: any) => {
            assert.equal(error.statusCode, 403);
            assert.match(error.message, /HD-003/);
            // Thông báo phải nói về ĐÓNG dự án (nghiệp vụ hiện tại), không phải tạm dừng
            assert.match(error.message, /đóng dự án/);
            assert.doesNotMatch(error.message, /tạm dừng/);
            return true;
        }
    );
});

test("hợp đồng không có createdBy/customer → chặn (fail-closed)", () => {
    assert.throws(
        () => assertBdOwnsContract(BD_ACTOR, { contractCode: "HD-004" }),
        (error: any) => {
            assert.equal(error.statusCode, 403);
            return true;
        }
    );
    assert.throws(() => assertBdOwnsContract(BD_ACTOR, null));
    assert.throws(() => assertBdOwnsContract(BD_ACTOR, undefined));
});

test("actor không có userId → chặn", () => {
    assert.throws(
        () => assertBdOwnsContract({ role: UserRole.BD }, { createdById: "bd-user-1" }),
        (error: any) => {
            assert.equal(error.statusCode, 403);
            return true;
        }
    );
    assert.throws(() => assertBdOwnsContract(undefined, { createdById: "bd-user-1" }));
});

test("dùng `id` (account id) thay cho `userId` vẫn khớp", () => {
    assert.doesNotThrow(() => assertBdOwnsContract(
        { id: "bd-user-1", role: UserRole.BD },
        { createdById: "bd-user-1" }
    ));
});

test("isContractOwnedByActor trả boolean đúng cho từng trường hợp", () => {
    const contract = { createdById: "bd-user-1" };
    assert.equal(isContractOwnedByActor(BD_ACTOR, contract), true);
    assert.equal(isContractOwnedByActor(OTHER_BD, contract), false);
    assert.equal(isContractOwnedByActor(BD_ACTOR, null), false);
    // Không có userId → không bao giờ sở hữu
    assert.equal(isContractOwnedByActor({ role: UserRole.BD }, contract), false);
});

test("assertBdOwnsProjectContract: nạp hợp đồng theo projectId rồi kiểm tra", async () => {
    const contractRepository = {
        findOne: async () => ({
            contractCode: "HD-005",
            createdById: "bd-user-1"
        } as Partial<Contracts>)
    } as any;

    await assert.doesNotReject(() =>
        assertBdOwnsProjectContract(contractRepository, BD_ACTOR, "p1")
    );
    await assert.rejects(
        () => assertBdOwnsProjectContract(contractRepository, OTHER_BD, "p1"),
        (error: any) => {
            assert.equal(error.statusCode, 403);
            return true;
        }
    );
});

test("assertBdOwnsProjectContract: dự án không có hợp đồng → 404", async () => {
    const contractRepository = { findOne: async () => null } as any;

    await assert.rejects(
        () => assertBdOwnsProjectContract(contractRepository, BD_ACTOR, "p-no-contract"),
        (error: any) => {
            assert.equal(error.statusCode, 404);
            return true;
        }
    );
});
