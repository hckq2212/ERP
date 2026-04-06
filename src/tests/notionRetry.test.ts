import test from "node:test";
import assert from "node:assert/strict";
import { withNotionRetry } from "../services/notion/NotionRetry";

test("withNotionRetry retries 429 then succeeds", async () => {
    let calls = 0;
    const result = await withNotionRetry(
        async () => {
            calls += 1;
            if (calls < 3) {
                const err: any = new Error("rate limited");
                err.status = 429;
                err.headers = { "retry-after": "0" };
                throw err;
            }
            return "ok";
        },
        { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 50 }
    );

    assert.equal(result, "ok");
    assert.equal(calls, 3);
});

test("withNotionRetry does not retry non-retryable errors", async () => {
    let calls = 0;
    await assert.rejects(
        () =>
            withNotionRetry(
                async () => {
                    calls += 1;
                    const err: any = new Error("bad request");
                    err.status = 400;
                    throw err;
                },
                { maxRetries: 5, baseDelayMs: 10, maxDelayMs: 50 }
            ),
        /bad request/
    );

    assert.equal(calls, 1);
});
