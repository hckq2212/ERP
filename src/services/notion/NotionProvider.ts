import { Client } from "@notionhq/client";
import { NotionScheduler } from "./NotionScheduler";
import { withNotionRetry } from "./NotionRetry";

function cleanNotionId(id: string): string {
    if (!id) return "";
    let cleaned = id.trim();
    if (cleaned.includes("notion.so/")) {
        const parts = cleaned.split("/");
        const lastPart = parts[parts.length - 1];
        cleaned = lastPart.split("?")[0].split("-").pop() || lastPart.split("?")[0];
    }
    return cleaned;
}

const scheduler = new NotionScheduler({
    minDelayMs: Number(process.env.NOTION_MIN_DELAY_MS ?? process.env.NOTION_SYNC_MIN_DELAY_MS ?? 350) || 350
});

const notion = new Client({
    auth: process.env.NOTION_KEY,
    notionVersion: "2022-06-28"
});

const maxRetries = Number(process.env.NOTION_MAX_RETRIES ?? 6) || 6;

export const NotionProvider = {
    notion,
    scheduler,
    cleanNotionId,
    maxRetries,

    async run<T>(fn: () => Promise<T>): Promise<T> {
        return scheduler.run(() =>
            withNotionRetry(fn, {
                maxRetries,
                onRetry: (info) => {
                    console.warn(`[Notion] retry attempt=${info.attempt} delayMs=${info.delayMs} status=${info.status} msg=${info.message ?? ""}`);
                }
            })
        );
    },

    async onIdle(): Promise<void> {
        await scheduler.onIdle();
    }
};

export type NotionDatabaseId = string;

export function getEnvDatabaseId(envKey: string): NotionDatabaseId {
    return cleanNotionId(process.env[envKey] || "");
}
