export interface PdfTableColumn {
    header: string;
    width: number;
}

const PADDING = 5;
const HEADER_HEIGHT = 22;
const TEXT_COLOR = "#1e293b";
const BORDER_COLOR = "#e2e8f0";
const ZEBRA_COLOR = "#f8fafc";

function measureRowHeight(doc: any, cells: string[], columns: PdfTableColumn[]) {
    let max = 0;
    columns.forEach((col, i) => {
        const h = doc.font("Base").fontSize(9).heightOfString(cells[i] || "", { width: col.width - PADDING * 2 });
        if (h > max) max = h;
    });
    return Math.max(max + PADDING * 2, 18);
}

function drawHeader(doc: any, x: number, y: number, columns: PdfTableColumn[], headerColor: string) {
    let cx = x;
    columns.forEach((col) => {
        doc.rect(cx, y, col.width, HEADER_HEIGHT).fill(headerColor);
        doc.fillColor("#ffffff").font("Base-Bold").fontSize(9).text(col.header, cx + PADDING, y + 7, { width: col.width - PADDING * 2 });
        cx += col.width;
    });
    doc.fillColor(TEXT_COLOR);
    return y + HEADER_HEIGHT;
}

export function drawTable(
    doc: any,
    opts: { x: number; y: number; columns: PdfTableColumn[]; rows: string[][]; headerColor: string }
) {
    const { x, columns, rows, headerColor } = opts;
    const totalWidth = columns.reduce((sum, c) => sum + c.width, 0);
    const bottomLimit = doc.page.height - doc.page.margins.bottom;

    let y = opts.y;
    y = drawHeader(doc, x, y, columns, headerColor);

    rows.forEach((cells, idx) => {
        const rowHeight = measureRowHeight(doc, cells, columns);
        if (y + rowHeight > bottomLimit) {
            doc.addPage();
            y = doc.page.margins.top;
            y = drawHeader(doc, x, y, columns, headerColor);
        }

        if (idx % 2 === 1) {
            doc.rect(x, y, totalWidth, rowHeight).fill(ZEBRA_COLOR);
        }

        let cx = x;
        columns.forEach((col, i) => {
            doc.rect(cx, y, col.width, rowHeight).strokeColor(BORDER_COLOR).lineWidth(0.5).stroke();
            doc.fillColor(TEXT_COLOR).font("Base").fontSize(9).text(cells[i] || "", cx + PADDING, y + PADDING, { width: col.width - PADDING * 2 });
            cx += col.width;
        });

        y += rowHeight;
    });

    return y;
}
