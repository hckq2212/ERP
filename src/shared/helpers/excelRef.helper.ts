const RAW_LOCATION_RE = /^(?:(.+)!)?R(\d+)C(\d+)$/;
const EXCEL_REF_RE = /^(?:(.+)!)?([A-Za-z]+)(\d+)$/;

export function colNumberToLetters(col: number): string {
    let n = col;
    let letters = "";
    while (n > 0) {
        const rem = (n - 1) % 26;
        letters = String.fromCharCode(65 + rem) + letters;
        n = Math.floor((n - 1) / 26);
    }
    return letters;
}

export function lettersToColNumber(letters: string): number {
    let n = 0;
    for (const ch of letters.toUpperCase()) {
        n = n * 26 + (ch.charCodeAt(0) - 64);
    }
    return n;
}

export function rawLocationToExcelRef(raw: string): string {
    const match = RAW_LOCATION_RE.exec(raw || "");
    if (!match) return raw;
    const [, sheet, row, col] = match;
    const ref = `${colNumberToLetters(Number(col))}${row}`;
    return sheet ? `${sheet}!${ref}` : ref;
}

export function excelRefToRowCol(ref: string): { sheet: string | null; row: number; col: number } | null {
    const match = EXCEL_REF_RE.exec(ref || "");
    if (!match) return null;
    const [, sheet, letters, row] = match;
    return { sheet: sheet || null, row: Number(row), col: lettersToColNumber(letters) };
}
