import ExcelJS from "exceljs";
import { excelRefToRowCol } from "./excelRef.helper";

const SPELL_FILL = "FFFFF59D";
const QC_BORDER_COLOR = "FFFF0000";
const QC_BORDER: Partial<ExcelJS.Border> = { style: "thick", color: { argb: QC_BORDER_COLOR } };

function resolveSheet(workbook: ExcelJS.Workbook, sheetNames: string[], hint: string | null) {
    if (hint) {
        const bySheetName = workbook.getWorksheet(hint);
        if (bySheetName) return bySheetName;
    }
    if (sheetNames.length === 1) {
        const byRecordSheet = workbook.getWorksheet(sheetNames[0]);
        if (byRecordSheet) return byRecordSheet;
    }
    if (workbook.worksheets.length === 1) return workbook.worksheets[0];
    return null;
}

function fillCell(cell: ExcelJS.Cell, color: string) {
    cell.fill = { type: "pattern", pattern: "solid", fgColor: { argb: color } };
}

export async function buildHighlightedWorkbook(
    buffer: Buffer,
    sheetNames: string[],
    spellItems: { location: string; token: string }[],
    qcItems: (Record<string, any> & { sheet_name?: string })[]
): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as any);

    for (const item of qcItems) {
        const sheet = resolveSheet(workbook, sheetNames, item.sheet_name || null);
        if (!sheet) continue;
        const rowRange: number[] = Array.isArray(item.row_range) ? item.row_range : [item.row_range, item.row_range];
        const start = Number(rowRange[0]);
        const end = Number(rowRange[1] ?? rowRange[0]);
        const maxCol = Math.max(sheet.columnCount, 1);

        for (let r = start; r <= end; r++) {
            const row = sheet.getRow(r);
            for (let c = 1; c <= maxCol; c++) {
                const cell = row.getCell(c);
                const border: Partial<ExcelJS.Borders> = { ...(cell.border || {}) };
                if (r === start) border.top = QC_BORDER;
                if (r === end) border.bottom = QC_BORDER;
                if (c === 1) border.left = QC_BORDER;
                if (c === maxCol) border.right = QC_BORDER;
                cell.border = border;
            }
            row.commit();
        }
    }

    for (const item of spellItems) {
        const parsed = excelRefToRowCol(item.location);
        if (!parsed) continue;
        const sheet = resolveSheet(workbook, sheetNames, parsed.sheet);
        if (!sheet) continue;
        const cell = sheet.getRow(parsed.row).getCell(parsed.col);
        fillCell(cell, SPELL_FILL);
    }

    const out = await workbook.xlsx.writeBuffer();
    return Buffer.from(out);
}
