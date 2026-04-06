import * as dotenv from "dotenv";
import { NotionProvider } from "../notion/NotionProvider";
import { notionResolver } from "../notion/NotionResolver";

dotenv.config();

export abstract class BaseNotionService {
    protected databaseId: string;

    constructor(databaseId: string) {
        this.databaseId = NotionProvider.cleanNotionId(databaseId);
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
            return includeTime ? iso : iso.split("T")[0];
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
            return await NotionProvider.run(() =>
                (NotionProvider.notion as any).request({
                    path: `databases/${this.databaseId}/query`,
                    method: "POST",
                    body: {
                        filter: {
                            property: "Id",
                            title: {
                                equals: erpId
                            }
                        },
                        page_size: 1
                    }
                })
            );
        } catch (error) {
            console.error(`[BaseNotionService] Error querying database ${this.databaseId}:`, error);
            throw error;
        }
    }

    protected async resolveRelationPageId(targetDatabaseId: string, erpId: string): Promise<string | null> {
        return notionResolver.resolvePageIdByErpId(targetDatabaseId, erpId);
    }

    /**
     * Upsert a page in Notion
     */
    protected async upsertPage(erpId: string, properties: any, entityName: string) {
        try {
            const existingPage = await this.findPageByErpId(erpId);

            const pageId = (existingPage as any)?.results?.[0]?.id as string | undefined;

            if (pageId) {
                await NotionProvider.run(() =>
                    NotionProvider.notion.pages.update({
                        page_id: pageId,
                        properties: properties
                    })
                );
                console.log(`[${entityName}NotionService] Updated ${entityName} in Notion: ${erpId}`);
            } else {
                const created = await NotionProvider.run(() =>
                    NotionProvider.notion.pages.create({
                        parent: { database_id: this.databaseId },
                        properties: properties
                    })
                );
                const createdId = (created as any)?.id as string | undefined;
                if (createdId) {
                    notionResolver.seed(this.databaseId, erpId, createdId);
                }
                console.log(`[${entityName}NotionService] Created ${entityName} in Notion: ${erpId}`);
            }
        } catch (error) {
            console.error(`[${entityName}NotionService] Error upserting ${entityName} ${erpId}:`, error);
            throw error;
        }
    }
}
