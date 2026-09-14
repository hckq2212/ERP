import * as XLSX from "xlsx";

export function filterWorkbookSheets(buffer: Buffer, sheetNames: string[]): Buffer {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const keep = workbook.SheetNames.filter(name => sheetNames.includes(name));
    if (keep.length === 0) throw new Error("Không tìm thấy sheet nào khớp để lọc");

    const filtered = XLSX.utils.book_new();
    for (const name of keep) {
        XLSX.utils.book_append_sheet(filtered, workbook.Sheets[name], name);
    }

    const out = XLSX.write(filtered, { type: "buffer", bookType: "xlsx" });
    return Buffer.from(out);
}
