import "dotenv/config";
import { ulid } from "ulid";
import { NotionProvider } from "../src/services/notion/NotionProvider";
import { applyProjectTemplateOnce } from "../src/services/notion/ProjectPageTemplate";

async function listChildPageTitles(parentPageId: string): Promise<string[]> {
    const titles: string[] = [];
    let cursor: string | undefined = undefined;
    for (let i = 0; i < 50; i++) {
        const res: any = await NotionProvider.run(() =>
            NotionProvider.notion.blocks.children.list({
                block_id: parentPageId,
                start_cursor: cursor,
                page_size: 100
            })
        );
        for (const b of res?.results || []) {
            if (b?.type === "child_page" && b?.child_page?.title) {
                titles.push(b.child_page.title);
            }
        }
        if (!res?.has_more) break;
        cursor = res?.next_cursor;
        if (!cursor) break;
    }
    return titles;
}

async function main() {
    const db = NotionProvider.cleanNotionId(process.env.NOTION_DATABASE_ID_PROJECTS || "");
    if (!process.env.NOTION_KEY) throw new Error("Missing NOTION_KEY");
    if (!db) throw new Error("Missing NOTION_DATABASE_ID_PROJECTS");

    const erpId = `SMOKE_${ulid()}`;

    const created = await NotionProvider.run(() =>
        NotionProvider.notion.pages.create({
            parent: { database_id: db },
            properties: {
                Id: { title: [{ type: "text", text: { content: erpId } }] },
                Name: { rich_text: [{ type: "text", text: { content: "SMOKE - Project Page Template" } }] },
                Status: { select: { name: "PENDING_CONFIRMATION" } }
            } as any
        })
    );

    const pageId = (created as any).id as string;
    const url = (created as any).url as string;

    await applyProjectTemplateOnce({
        pageId,
        projectSnapshot: {
            id: erpId,
            name: "SMOKE - Project Page Template",
            status: "PENDING_CONFIRMATION"
        }
    });

    const page = await NotionProvider.run(() => NotionProvider.notion.pages.retrieve({ page_id: pageId }));
    const applied = (page as any)?.properties?.["Template Applied"]?.checkbox === true;
    const version = ((page as any)?.properties?.["Template Version"]?.rich_text?.[0]?.plain_text as string | undefined) || "";
    const subpages = await listChildPageTitles(pageId);

    console.log(JSON.stringify({ erpId, pageId, url, applied, version, subpages }, null, 2));
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
