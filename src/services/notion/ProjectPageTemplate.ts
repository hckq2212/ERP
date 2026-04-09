import * as fs from "node:fs";
import * as path from "node:path";
import { NotionProvider } from "./NotionProvider";

type Block = any;

const DEFAULT_SUBPAGES = [
    "01. Overview",
    "02. Deliverables & Results",
    "03. Meeting Notes",
    "04. Acceptance / Handover",
    "99. Archive"
];

function getTemplateVersion(): string {
    return process.env.PROJECT_PAGE_TEMPLATE_VERSION || "v1";
}

function templateFileName(version: string): string {
    return `project_page_${version}.json`;
}

function loadTemplateBlocks(version: string): Block[] {
    const file = templateFileName(version);
    const candidates = [
        path.join(process.cwd(), "src", "notion_templates", file),
        path.join(process.cwd(), "build", "notion_templates", file)
    ];

    for (const p of candidates) {
        if (fs.existsSync(p)) {
            const raw = fs.readFileSync(p, "utf8");
            const parsed = JSON.parse(raw);
            if (!Array.isArray(parsed)) throw new Error(`Template file ${p} must be a JSON array of blocks`);
            return parsed;
        }
    }

    throw new Error(`Template file not found. Looked for: ${candidates.join(", ")}`);
}

function paragraph(content: string): Block {
    return {
        object: "block",
        type: "paragraph",
        paragraph: {
            rich_text: [{ type: "text", text: { content } }]
        }
    };
}

function safeIsoDate(d: any): string | null {
    if (!d) return null;
    const dt = new Date(d);
    if (Number.isNaN(dt.getTime())) return null;
    return dt.toISOString().slice(0, 10);
}

export async function isProjectTemplateApplied(pageId: string): Promise<boolean> {
    const page = await NotionProvider.run(() =>
        NotionProvider.notion.pages.retrieve({ page_id: pageId })
    );
    const props: any = (page as any)?.properties || {};
    const applied = props["Template Applied"]?.checkbox;
    return applied === true;
}

async function setTemplateApplied(pageId: string, version: string) {
    await NotionProvider.run(() =>
        NotionProvider.notion.pages.update({
            page_id: pageId,
            properties: {
                "Template Applied": { checkbox: true },
                "Template Version": {
                    rich_text: [{ type: "text", text: { content: version } }]
                }
            } as any
        })
    );
}

async function listChildPageTitles(parentPageId: string): Promise<Set<string>> {
    const titles = new Set<string>();
    let cursor: string | undefined = undefined;
    for (let i = 0; i < 50; i++) {
        const res = await NotionProvider.run(() =>
            NotionProvider.notion.blocks.children.list({
                block_id: parentPageId,
                start_cursor: cursor,
                page_size: 100
            })
        );
        const results: any[] = (res as any)?.results || [];
        for (const b of results) {
            if (b?.type === "child_page") {
                const t = b?.child_page?.title;
                if (t) titles.add(t);
            }
        }
        if (!(res as any)?.has_more) break;
        cursor = (res as any)?.next_cursor;
        if (!cursor) break;
    }
    return titles;
}

async function createChildPage(parentPageId: string, title: string) {
    await NotionProvider.run(() =>
        NotionProvider.notion.pages.create({
            parent: { page_id: parentPageId },
            properties: {
                title: {
                    title: [{ type: "text", text: { content: title } }]
                }
            } as any
        })
    );
}

export async function applyProjectTemplateOnce(opts: {
    pageId: string;
    projectSnapshot?: {
        id?: string;
        name?: string;
        status?: string;
        plannedStartDate?: any;
        plannedEndDate?: any;
        contractCode?: string;
        clientName?: string;
        teamLeadName?: string;
    };
}) {
    const version = getTemplateVersion();
    const already = await isProjectTemplateApplied(opts.pageId);
    if (already) return;

    const baseBlocks = loadTemplateBlocks(version);

    // Add a one-time snapshot paragraph near the top (keeps the JSON template stable).
    const snap = opts.projectSnapshot || {};
    const start = safeIsoDate(snap.plannedStartDate);
    const end = safeIsoDate(snap.plannedEndDate);
    const parts = [
        snap.status ? `Status=${snap.status}` : null,
        snap.contractCode ? `Contract=${snap.contractCode}` : null,
        snap.clientName ? `Client=${snap.clientName}` : null,
        snap.teamLeadName ? `TeamLead=${snap.teamLeadName}` : null,
        start || end ? `Planned=${start ?? "?"}..${end ?? "?"}` : null
    ].filter(Boolean);
    const snapshotLine = parts.length ? `ERP Snapshot: ${parts.join(" | ")}` : "ERP Snapshot: (unavailable)";
    const blocks: Block[] = [paragraph(snapshotLine), ...baseBlocks];

    // Append content blocks (chunk to satisfy Notion limits).
    for (let i = 0; i < blocks.length; i += 80) {
        const chunk = blocks.slice(i, i + 80);
        await NotionProvider.run(() =>
            NotionProvider.notion.blocks.children.append({
                block_id: opts.pageId,
                children: chunk
            } as any)
        );
    }

    // Create sub-pages (idempotent by title).
    const existingTitles = await listChildPageTitles(opts.pageId);
    for (const title of DEFAULT_SUBPAGES) {
        if (existingTitles.has(title)) continue;
        await createChildPage(opts.pageId, title);
    }

    await setTemplateApplied(opts.pageId, version);
}

