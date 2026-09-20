export function buildCheckSummary(spellErrors: any[], qcMismatches: Record<string, any>[]): string | null {
    const confirmedSpell = (spellErrors || []).filter(e => e.confirmed !== false);
    const confirmedQc = (qcMismatches || []).filter(m => m.status !== "unresolved" && m.confirmed !== false);
    if (confirmedSpell.length === 0 && confirmedQc.length === 0) return null;

    const sheetOrder: string[] = [];
    const sheets = new Map<string, { scenarioOrder: string[]; scenarios: Map<string, { spell: number; qc: number }> }>();

    const ensure = (sheet: string, scenario: string) => {
        if (!sheets.has(sheet)) {
            sheets.set(sheet, { scenarioOrder: [], scenarios: new Map() });
            sheetOrder.push(sheet);
        }
        const entry = sheets.get(sheet)!;
        if (!entry.scenarios.has(scenario)) {
            entry.scenarios.set(scenario, { spell: 0, qc: 0 });
            entry.scenarioOrder.push(scenario);
        }
        return entry.scenarios.get(scenario)!;
    };

    for (const e of confirmedSpell) {
        ensure(e.sheetName || "Không rõ sheet", e.scenarioLabel || "Chung").spell += 1;
    }
    for (const m of confirmedQc) {
        ensure(m.sheet_name || m.sheet || "Không rõ sheet", m.scenario || "Chung").qc += 1;
    }

    const lines: string[] = [];
    for (const sheet of sheetOrder) {
        const entry = sheets.get(sheet)!;
        const multi = entry.scenarioOrder.length > 1;
        if (multi) lines.push(`${sheet}:`);
        for (const scenario of entry.scenarioOrder) {
            const stat = entry.scenarios.get(scenario)!;
            const label = multi
                ? `  • ${scenario === "Chung" ? "Toàn sheet" : scenario}`
                : `${sheet}${scenario === "Chung" ? "" : ` - ${scenario}`}`;
            lines.push(`${label}: ${stat.spell} lỗi chính tả, ${stat.qc} điểm QC chưa khớp`);
        }
    }

    return lines.join("\n");
}
