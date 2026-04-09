import * as fs from "node:fs";
import * as path from "node:path";
import { NotionProvider } from "../src/services/notion/NotionProvider";

type Block = any;

const TEMPLATE_VERSION = process.env.PROJECT_PAGE_TEMPLATE_VERSION || "v1";

function isSupportedBlockType(type: string): boolean {
    return [
        "paragraph",
        "heading_1",
        "heading_2",
        "heading_3",
        "bulleted_list_item",
        "numbered_list_item",
        "to_do",
        "quote",
        "divider",
        "callout",
        "toggle"
    ].includes(type);
}

function normalizeBlock(b: any): Block | null {
    const type = b?.type;
    if (!type || !isSupportedBlockType(type)) return null;
    const out: any = {
        object: "block",
        type
    };
    out[type] = b[type];
    return out;
}

async function listChildren(blockId: string, cursor?: string): Promise<any> {
    return NotionProvider.run(() =>
        NotionProvider.notion.blocks.children.list({
            block_id: blockId,
            start_cursor: cursor,
            page_size: 100
        })
    );
}

async function exportTree(blockId: string, depth: number, maxDepth: number): Promise<Block[]> {
    if (depth > maxDepth) return [];
    const blocks: Block[] = [];
    let cursor: string | undefined = undefined;

    for (let page = 0; page < 50; page++) {
        const res: any = await listChildren(blockId, cursor);
        for (const raw of res?.results || []) {
            const norm = normalizeBlock(raw);
            if (!norm) continue;
            if (raw?.has_children) {
                const children = await exportTree(raw.id, depth + 1, maxDepth);
                if (children.length) norm.children = children;
            }
            blocks.push(norm);
        }
        if (!res?.has_more) break;
        cursor = res?.next_cursor;
        if (!cursor) break;
    }
    return blocks;
}

async function main() {
    const templatePageId = process.env.NOTION_PROJECT_TEMPLATE_PAGE_ID;
    if (!templatePageId) {
        console.error("Missing NOTION_PROJECT_TEMPLATE_PAGE_ID");
        process.exit(1);
    }

    const blocks = await exportTree(NotionProvider.cleanNotionId(templatePageId), 0, 6);

    const outDir = path.join(process.cwd(), "src", "notion_templates");
    fs.mkdirSync(outDir, { recursive: true });
    const outPath = path.join(outDir, `project_page_${TEMPLATE_VERSION}.json`);
    fs.writeFileSync(outPath, JSON.stringify(blocks, null, 2), "utf8");
    console.log(`Exported ${blocks.length} blocks to ${outPath}`);
}

main().catch((err) => {
    console.error(err);
    process.exit(1);
});
