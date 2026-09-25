type Run = {
    text: string;
    bold: boolean;
    underline: boolean;
    strike: boolean;
    color: string;
};

type ListCtx = { type: "ul" | "ol"; counter: number };

const BASE_FONT = "Base";
const BOLD_FONT = "Base-Bold";
const TEXT_COLOR = "#1e293b";
const LINK_COLOR = "#2563eb";
const QUOTE_COLOR = "#64748b";
const MEDIA_COLOR = "#94a3b8";

function decodeEntities(str: string): string {
    return str
        .replace(/&nbsp;/gi, " ")
        .replace(/&amp;/gi, "&")
        .replace(/&lt;/gi, "<")
        .replace(/&gt;/gi, ">")
        .replace(/&quot;/gi, "\"")
        .replace(/&#39;/gi, "'");
}

export function renderRichTextToPdf(doc: any, html: string, x: number, width: number, fontSize = 10): void {
    doc.font(BASE_FONT).fontSize(fontSize).fillColor(TEXT_COLOR);

    if (!html || !decodeEntities(html.replace(/<[^>]+>/g, " ")).trim()) {
        doc.text("(Không có nội dung)", x, doc.y, { width });
        return;
    }

    const tokens = html.split(/(<[^>]+>)/g).filter((t) => t.length > 0);

    let bold = false;
    let underline = false;
    let strike = false;
    let inLink = false;
    let quoteDepth = 0;
    let listStack: ListCtx[] = [];
    let indent = 0;
    let runs: Run[] = [];
    let pendingLi = false;

    const currentColor = () => (inLink ? LINK_COLOR : quoteDepth > 0 ? QUOTE_COLOR : TEXT_COLOR);

    const flush = (gap = 4) => {
        if (runs.length === 0) {
            return;
        }
        const startX = x + indent;
        const usableWidth = Math.max(width - indent, 40);
        runs.forEach((run, idx) => {
            doc.font(run.bold ? BOLD_FONT : BASE_FONT).fillColor(run.color);
            const opts: any = {
                continued: idx < runs.length - 1,
                underline: run.underline,
                strike: run.strike,
                width: usableWidth
            };
            if (idx === 0) {
                doc.text(run.text, startX, doc.y, opts);
            } else {
                doc.text(run.text, opts);
            }
        });
        runs = [];
        if (gap > 0) doc.moveDown(gap / 10);
    };

    const pushText = (raw: string) => {
        const text = decodeEntities(raw).replace(/\s+/g, " ");
        if (!text) return;
        if (!text.trim() && runs.length === 0) return;
        if (pendingLi) {
            const ctx = listStack[listStack.length - 1];
            const bullet = ctx?.type === "ol" ? `${ctx.counter}. ` : "•  ";
            runs.push({ text: bullet, bold: false, underline: false, strike: false, color: currentColor() });
            pendingLi = false;
        }
        runs.push({ text, bold, underline, strike, color: currentColor() });
    };

    for (const token of tokens) {
        if (token.startsWith("<")) {
            const closing = /^<\//.test(token);
            const tagMatch = token.match(/^<\/?\s*([a-zA-Z0-9]+)/);
            const tag = tagMatch ? tagMatch[1].toUpperCase() : "";

            switch (tag) {
                case "B":
                case "STRONG":
                    bold = !closing;
                    break;
                case "I":
                case "EM":
                    // no italic font file available; underline is used as a subtle visual cue instead
                    break;
                case "U":
                    underline = !closing;
                    break;
                case "S":
                case "STRIKE":
                    strike = !closing;
                    break;
                case "A":
                    inLink = !closing;
                    break;
                case "BLOCKQUOTE":
                    if (!closing) {
                        flush();
                        quoteDepth += 1;
                        indent += 14;
                    } else {
                        flush();
                        quoteDepth = Math.max(0, quoteDepth - 1);
                        indent = Math.max(0, indent - 14);
                    }
                    break;
                case "UL":
                case "OL":
                    if (!closing) {
                        flush();
                        listStack.push({ type: tag === "OL" ? "ol" : "ul", counter: 0 });
                        indent += 14;
                    } else {
                        flush();
                        listStack.pop();
                        indent = Math.max(0, indent - 14);
                    }
                    break;
                case "LI":
                    if (!closing) {
                        flush(2);
                        const ctx = listStack[listStack.length - 1];
                        if (ctx) ctx.counter += 1;
                        pendingLi = true;
                    } else {
                        flush(3);
                    }
                    break;
                case "P":
                case "DIV":
                    if (closing) flush(5);
                    break;
                case "BR":
                    flush(3);
                    break;
                case "IMG":
                    flush(2);
                    doc.font(BASE_FONT).fillColor(MEDIA_COLOR).text("[Hình ảnh đính kèm]", x + indent, doc.y, { width: width - indent });
                    doc.moveDown(0.4);
                    break;
                case "VIDEO":
                    flush(2);
                    doc.font(BASE_FONT).fillColor(MEDIA_COLOR).text("[Video đính kèm]", x + indent, doc.y, { width: width - indent });
                    doc.moveDown(0.4);
                    break;
                default:
                    break;
            }
        } else {
            pushText(token);
        }
    }

    flush(0);
}
