import { NotionProvider, NotionDatabaseId } from "./NotionProvider";

type CacheKey = string;

function key(db: string, erpId: string): CacheKey {
    return `${db}::${erpId}`;
}

export class NotionResolver {
    private cache = new Map<CacheKey, string>();

    async resolvePageIdByErpId(databaseId: NotionDatabaseId, erpId: string): Promise<string | null> {
        const db = NotionProvider.cleanNotionId(databaseId);
        if (!db || !erpId) return null;
        const k = key(db, erpId);
        const cached = this.cache.get(k);
        if (cached) return cached;

        const res = await NotionProvider.run(() =>
            (NotionProvider.notion as any).request({
                path: `databases/${db}/query`,
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

        const pageId = (res as any)?.results?.[0]?.id as string | undefined;
        if (!pageId) return null;
        this.cache.set(k, pageId);
        return pageId;
    }

    seed(databaseId: NotionDatabaseId, erpId: string, pageId: string) {
        const db = NotionProvider.cleanNotionId(databaseId);
        if (!db || !erpId || !pageId) return;
        this.cache.set(key(db, erpId), pageId);
    }
}

export const notionResolver = new NotionResolver();
