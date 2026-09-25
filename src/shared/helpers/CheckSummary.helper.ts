// Tóm tắt ngắn gọn (1 dòng, chỉ tổng số) để dùng cho thông báo/popup.
// Chi tiết đầy đủ theo từng sheet/kịch bản đã có sẵn trong trang task (ConfirmedCheckErrors),
// nên không cần lặp lại toàn bộ danh sách ở đây.
export function buildCheckSummary(spellErrors: any[], qcMismatches: Record<string, any>[]): string | null {
    const confirmedSpell = (spellErrors || []).filter(e => e.confirmed !== false);
    const confirmedQc = (qcMismatches || []).filter(m => m.status !== "unresolved" && m.confirmed !== false);
    if (confirmedSpell.length === 0 && confirmedQc.length === 0) return null;

    const parts: string[] = [];
    if (confirmedSpell.length > 0) parts.push(`${confirmedSpell.length} lỗi chính tả`);
    if (confirmedQc.length > 0) parts.push(`${confirmedQc.length} điểm QC chưa khớp`);
    return parts.join(", ");
}
