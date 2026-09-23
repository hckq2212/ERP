import assert from "node:assert/strict";
import test from "node:test";
import { Projects, ProjectStatus } from "../entities/Project.entity";
import {
    assertProjectNotOnHold,
    assertTaskProjectNotOnHold
} from "./ProjectHold.helper";

/** Repository giả: chỉ cần `find` vì helper không gọi method nào khác. */
const fakeRepo = (rows: Partial<Projects>[]) =>
    ({ find: async () => rows }) as any;

test("dự án ON_HOLD → chặn với 409", async () => {
    const repo = fakeRepo([{ id: "p1", name: "Dự án Alpha", status: ProjectStatus.ON_HOLD }]);

    await assert.rejects(
        () => assertProjectNotOnHold(repo, ["p1"]),
        (error: any) => {
            assert.equal(error.statusCode, 409);
            assert.match(error.message, /tạm dừng/);
            assert.match(error.message, /Dự án Alpha/);
            return true;
        }
    );
});

test("dự án IN_PROGRESS → cho phép", async () => {
    const repo = fakeRepo([]);
    await assert.doesNotReject(() => assertProjectNotOnHold(repo, ["p1"]));
});

test("PENDING_PAUSE_APPROVAL → KHÔNG chặn (dự án vẫn chạy bình thường)", async () => {
    // Theo luồng: giai đoạn chờ duyệt tạm dừng, dự án VẪN CHẠY BÌNH THƯỜNG.
    // Task chưa đổi gì, đồng hồ 37 ngày chưa chạy → mọi thao tác vẫn phải được phép.
    // Repo giả trả về [] vì `where` đã lọc status = ON_HOLD nên không match.
    const repo = fakeRepo([]);
    await assert.doesNotReject(() => assertProjectNotOnHold(repo, ["p1"]));
});

test("assertTaskProjectNotOnHold: PENDING_PAUSE_APPROVAL → không chặn", () => {
    assert.doesNotThrow(() => assertTaskProjectNotOnHold({
        project: { id: "p1", name: "Dự án Alpha", status: ProjectStatus.PENDING_PAUSE_APPROVAL }
    }));
});

test("dự án COMPLETED → cho phép (không phải ON_HOLD)", async () => {
    const repo = fakeRepo([]);
    await assert.doesNotReject(() => assertProjectNotOnHold(repo, ["p1"]));
});

test("helper CHỈ lọc theo status ON_HOLD (không lọc nhầm status khác)", async () => {
    let receivedWhere: any = null;
    const repo = {
        find: async (options: any) => {
            receivedWhere = options.where;
            return [];
        }
    } as any;

    await assertProjectNotOnHold(repo, ["p1"]);

    // Phải lọc đúng status = ON_HOLD, và KHÔNG dùng In(...) nhiều status
    assert.deepEqual(receivedWhere.status, ProjectStatus.ON_HOLD);
});

test("danh sách rỗng hoặc chỉ có null → bỏ qua, không truy vấn", async () => {
    const repo = {
        find: async () => {
            throw new Error("không được truy vấn khi không có project id");
        }
    } as any;

    await assert.doesNotReject(() => assertProjectNotOnHold(repo, []));
    await assert.doesNotReject(() => assertProjectNotOnHold(repo, [null, undefined]));
});

test("bulk: 1 project ON_HOLD trong nhiều project → chặn toàn bộ", async () => {
    const repo = fakeRepo([{ id: "p2", name: "Dự án Beta", status: ProjectStatus.ON_HOLD }]);

    await assert.rejects(
        () => assertProjectNotOnHold(repo, ["p1", "p2", "p3"]),
        (error: any) => {
            assert.equal(error.statusCode, 409);
            assert.match(error.message, /Dự án Beta/);
            return true;
        }
    );
});

test("project id trùng lặp → chỉ truy vấn 1 lần", async () => {
    let receivedIds: string[] = [];
    const repo = {
        find: async (options: any) => {
            receivedIds = options.where.id._value;
            return [];
        }
    } as any;

    await assertProjectNotOnHold(repo, ["p1", "p1", "p1"]);
    assert.deepEqual(receivedIds, ["p1"]);
});

test("assertTaskProjectNotOnHold: task thuộc dự án ON_HOLD → chặn", () => {
    assert.throws(
        () => assertTaskProjectNotOnHold({
            project: { id: "p1", name: "Dự án Alpha", status: ProjectStatus.ON_HOLD }
        }),
        (error: any) => {
            assert.equal(error.statusCode, 409);
            assert.match(error.message, /Dự án Alpha/);
            return true;
        }
    );
});

test("assertTaskProjectNotOnHold: task dự án thường hoặc task nội bộ (không project) → cho phép", () => {
    assert.doesNotThrow(() => assertTaskProjectNotOnHold({
        project: { id: "p1", name: "Dự án Alpha", status: ProjectStatus.IN_PROGRESS }
    }));
    // Task nội bộ: project = null → không bao giờ bị chặn
    assert.doesNotThrow(() => assertTaskProjectNotOnHold({ project: null }));
    assert.doesNotThrow(() => assertTaskProjectNotOnHold(null));
    assert.doesNotThrow(() => assertTaskProjectNotOnHold(undefined));
});
