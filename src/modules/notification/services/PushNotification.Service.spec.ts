import { describe, it } from "node:test";
import assert from "node:assert/strict";
import { Expo } from "expo-server-sdk";

describe("PushNotificationService - Expo Push Tokens & Payloads", () => {
    it("validates valid Expo push token formats", () => {
        const validToken1 = "ExponentPushToken[xxxxxxxxxxxxxxxxxxxxxx]";
        const validToken2 = "ExpoPushToken[xxxxxxxxxxxxxxxxxxxxxx]";

        assert.strictEqual(Expo.isExpoPushToken(validToken1), true);
        assert.strictEqual(Expo.isExpoPushToken(validToken2), true);
    });

    it("rejects invalid token formats", () => {
        const invalid1 = "FCM-raw-token-12345";
        const invalid2 = "";
        const invalid3 = "invalid-token";

        assert.strictEqual(Expo.isExpoPushToken(invalid1), false);
        assert.strictEqual(Expo.isExpoPushToken(invalid2), false);
        assert.strictEqual(Expo.isExpoPushToken(invalid3), false);
    });

    it("chunks messages properly using expo-server-sdk chunking logic", () => {
        const expo = new Expo();
        const dummyMessages = Array.from({ length: 150 }, (_, i) => ({
            to: `ExponentPushToken[token_${i}]`,
            title: `Title ${i}`,
            body: `Content ${i}`,
            data: { id: `id_${i}` }
        }));

        const chunks = expo.chunkPushNotifications(dummyMessages);
        assert.ok(chunks.length > 0);
        // Ensure total count of messages across all chunks matches input
        const totalMessages = chunks.reduce((sum, chunk) => sum + chunk.length, 0);
        assert.strictEqual(totalMessages, 150);
    });
});
