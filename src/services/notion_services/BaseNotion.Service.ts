import { Client } from "@notionhq/client";
import * as dotenv from "dotenv";

dotenv.config();

export abstract class BaseNotionService {
    protected notion: Client;
    protected databaseId: string;

    constructor(databaseId: string) {
        this.notion = new Client({
            auth: process.env.NOTION_KEY,
            notionVersion: "2022-06-28"
        });
        this.databaseId = this.cleanNotionId(databaseId);
    }

    /**
     * Extracts and cleans the Notion ID from potential full URLs or whitespace
     */
    protected cleanNotionId(id: string): string {
        if (!id) return "";
        let cleaned = id.trim();
        if (cleaned.includes("notion.so/")) {
            const parts = cleaned.split("/");
            const lastPart = parts[parts.length - 1];
            cleaned = lastPart.split("?")[0].split("-").pop() || lastPart.split("?")[0];
        }
        return cleaned;
    }

    /**
     * Formats a date for Notion API (YYYY-MM-DD or ISO string)
     */
    protected formatDate(date: any, includeTime: boolean = false): string | null {
        if (!date) return null;
        try {
            const d = new Date(date);
            if (isNaN(d.getTime())) return null;
            const iso = d.toISOString();
            return includeTime ? iso : iso.split('T')[0];
        } catch (error) {
            return null;
        }
    }

    /**
     * Generic query to find a page by its ERP ID (mapped as 'Id' title property)
     */
    protected async findPageByErpId(erpId: string) {
        if (!this.databaseId) return null;
        try {
            return await (this.notion as any).request({
                path: `databases/${this.databaseId}/query`,
                method: "POST",
                body: {
                    filter: {
                        property: "Id",
                        title: {
                            equals: erpId
                        }
                    }
                }
            });
        } catch (error) {
            console.error(`[BaseNotionService] Error querying database ${this.databaseId}:`, error);
            throw error;
        }
    }

    /**
     * Upsert a page in Notion
     */
    protected async upsertPage(erpId: string, properties: any, entityName: string) {
        try {
            const existingPage = await this.findPageByErpId(erpId);

            if (existingPage && existingPage.results.length > 0) {
                await this.notion.pages.update({
                    page_id: existingPage.results[0].id,
                    properties: properties
                });
                console.log(`[${entityName}NotionService] Updated ${entityName} in Notion: ${erpId}`);
            } else {
                await this.notion.pages.create({
                    parent: { database_id: this.databaseId },
                    properties: properties
                });
                console.log(`[${entityName}NotionService] Created ${entityName} in Notion: ${erpId}`);
            }
        } catch (error) {
            console.error(`[${entityName}NotionService] Error upserting ${entityName} ${erpId}:`, error);
            throw error;
        }
    }
}
