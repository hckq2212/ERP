import test from "node:test";
import assert from "node:assert/strict";
import { NotionScheduler } from "../services/notion/NotionScheduler";

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

test("NotionScheduler serializes tasks in order", async () => {
    const scheduler = new NotionScheduler({ minDelayMs: 1 });
    const events: string[] = [];

    const p1 = scheduler.run(async () => {
        events.push("start1");
        await sleep(25);
        events.push("end1");
        return 1;
    });

    const p2 = scheduler.run(async () => {
        events.push("start2");
        await sleep(1);
        events.push("end2");
        return 2;
    });

    const r = await Promise.all([p1, p2]);
    assert.deepEqual(r, [1, 2]);
    assert.deepEqual(events, ["start1", "end1", "start2", "end2"]);
});
