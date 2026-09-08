"""
Professional PDF report generator for Vispeller spell-check results.

Turns the raw ``{"errors": {...}}`` dict produced by :func:`vispeller.sdk.check`
into a nicely formatted, print-ready PDF report — no raw JSON is ever
surfaced to end users.

Usage:
    from vispeller.report import build_pdf_report

    pdf_bytes = build_pdf_report(
        errors=result["errors"],
        meta={
            "title": "Báo cáo kiểm tra chính tả",
            "source": "https://docs.google.com/spreadsheets/d/...",
            "lang": "both",
            "checked_at": "2026-09-08 15:32",
            "task_code": "TASK-0042",
        },
    )
"""

from __future__ import annotations

import os
from datetime import datetime
from io import BytesIO
from typing import Any, Dict, Optional

from reportlab.lib import colors
from reportlab.lib.enums import TA_CENTER, TA_LEFT
from reportlab.lib.pagesizes import A4
from reportlab.lib.styles import ParagraphStyle, getSampleStyleSheet
from reportlab.lib.units import mm
from reportlab.pdfbase import pdfmetrics
from reportlab.pdfbase.ttfonts import TTFont
from reportlab.platypus import (
    KeepTogether,
    ListFlowable,
    ListItem,
    Paragraph,
    SimpleDocTemplate,
    Spacer,
    Table,
    TableStyle,
)

# --------------------------------------------------------------------------
# Fonts — DejaVu Sans covers Vietnamese diacritics; ReportLab's built-in
# Helvetica does not, so we register bundled TTFs (see assets/fonts/).
# --------------------------------------------------------------------------
_FONT_DIR = os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "assets", "fonts")
_FONT_DIR = os.path.normpath(_FONT_DIR)
_REGULAR_FONT = "DejaVuSans"
_BOLD_FONT = "DejaVuSans-Bold"

_fonts_registered = False


def _register_fonts() -> None:
    global _fonts_registered
    if _fonts_registered:
        return
    pdfmetrics.registerFont(TTFont(_REGULAR_FONT, os.path.join(_FONT_DIR, "DejaVuSans.ttf")))
    pdfmetrics.registerFont(TTFont(_BOLD_FONT, os.path.join(_FONT_DIR, "DejaVuSans-Bold.ttf")))
    _fonts_registered = True


BRAND_COLOR = colors.HexColor("#4F46E5")
DANGER_COLOR = colors.HexColor("#DC2626")
SUCCESS_COLOR = colors.HexColor("#16A34A")
MUTED_COLOR = colors.HexColor("#6B7280")
LIGHT_BG = colors.HexColor("#F3F4F6")


def _styles() -> Dict[str, ParagraphStyle]:
    base = getSampleStyleSheet()
    return {
        "title": ParagraphStyle(
            "ReportTitle", parent=base["Title"], fontName=_BOLD_FONT,
            fontSize=20, leading=24, textColor=colors.HexColor("#111827"),
            alignment=TA_LEFT, spaceAfter=2,
        ),
        "subtitle": ParagraphStyle(
            "ReportSubtitle", parent=base["Normal"], fontName=_REGULAR_FONT,
            fontSize=10, leading=14, textColor=MUTED_COLOR,
        ),
        "h2": ParagraphStyle(
            "H2", parent=base["Heading2"], fontName=_BOLD_FONT,
            fontSize=13, leading=16, textColor=colors.HexColor("#111827"),
            spaceBefore=14, spaceAfter=8,
        ),
        "body": ParagraphStyle(
            "Body", parent=base["Normal"], fontName=_REGULAR_FONT,
            fontSize=9.5, leading=13,
        ),
        "cell": ParagraphStyle(
            "Cell", parent=base["Normal"], fontName=_REGULAR_FONT,
            fontSize=9, leading=12,
        ),
        "cellBold": ParagraphStyle(
            "CellBold", parent=base["Normal"], fontName=_BOLD_FONT,
            fontSize=9, leading=12,
        ),
        "statBig": ParagraphStyle(
            "StatBig", parent=base["Normal"], fontName=_BOLD_FONT,
            fontSize=22, leading=26, alignment=TA_CENTER,
        ),
        "statSmall": ParagraphStyle(
            "StatSmall", parent=base["Normal"], fontName=_BOLD_FONT,
            fontSize=13, leading=16, alignment=TA_CENTER,
        ),
        "statLabel": ParagraphStyle(
            "StatLabel", parent=base["Normal"], fontName=_REGULAR_FONT,
            fontSize=8.5, leading=11, alignment=TA_CENTER, textColor=MUTED_COLOR,
        ),
        "footer": ParagraphStyle(
            "Footer", parent=base["Normal"], fontName=_REGULAR_FONT,
            fontSize=7.5, leading=10, textColor=MUTED_COLOR,
        ),
    }


def _format_positions(positions: list) -> str:
    parts = []
    for p in positions[:8]:
        sheet = p.get("sheet", "")
        row = p.get("row", "")
        col = p.get("column", "")
        parts.append(f"{sheet}!R{row}C{col}" if sheet else f"R{row}C{col}")
    extra = len(positions) - 8
    text = ", ".join(parts)
    if extra > 0:
        text += f" (+{extra} vị trí khác)"
    return text or "—"


def _stat_card(value: str, label: str, styles: Dict[str, ParagraphStyle], color_hex: str, small: bool = False) -> Table:
    style = styles["statSmall"] if small else styles["statBig"]
    t = Table(
        [[Paragraph(f'<font color="{color_hex}">{value}</font>', style)],
         [Paragraph(label, styles["statLabel"])]],
        colWidths=[55 * mm],
    )
    t.setStyle(TableStyle([
        ("BACKGROUND", (0, 0), (-1, -1), LIGHT_BG),
        ("TOPPADDING", (0, 0), (-1, 0), 10),
        ("BOTTOMPADDING", (0, 1), (-1, 1), 10),
        ("BOX", (0, 0), (-1, -1), 0.5, colors.HexColor("#E5E7EB")),
    ]))
    return t


def build_pdf_report(errors: Dict[str, Dict[str, Any]], meta: Optional[Dict[str, Any]] = None) -> bytes:
    """
    Render a professional PDF spell-check report.

    Args:
        errors: the ``errors`` dict as returned by ``vispeller.sdk.check()``.
        meta: optional context to print in the header — any of
            ``title``, ``source`` (link that was checked), ``lang``,
            ``checked_at``, ``task_code``, ``task_name``.

    Returns:
        Raw PDF bytes.
    """
    _register_fonts()
    meta = meta or {}
    styles = _styles()
    errors = errors or {}
    error_count = len(errors)
    is_clean = error_count == 0

    buf = BytesIO()
    doc = SimpleDocTemplate(
        buf, pagesize=A4,
        leftMargin=18 * mm, rightMargin=18 * mm,
        topMargin=16 * mm, bottomMargin=16 * mm,
        title=meta.get("title", "Báo cáo kiểm tra chính tả"),
    )

    story = []

    # --- Header -----------------------------------------------------
    story.append(Paragraph(meta.get("title", "BÁO CÁO KIỂM TRA CHÍNH TẢ"), styles["title"]))
    story.append(Paragraph("Được tạo tự động bởi Vispeller", styles["subtitle"]))
    story.append(Spacer(1, 10))

    info_rows = []
    if meta.get("task_code") or meta.get("task_name"):
        label = " / ".join(filter(None, [meta.get("task_code"), meta.get("task_name")]))
        info_rows.append(["Công việc:", label])
    if meta.get("source"):
        info_rows.append(["Nguồn kiểm tra:", meta["source"]])
    info_rows.append(["Ngôn ngữ:", {"vi": "Tiếng Việt", "en": "Tiếng Anh", "both": "Tiếng Việt & Tiếng Anh"}.get(meta.get("lang", "both"), meta.get("lang", "both"))])
    info_rows.append(["Thời điểm kiểm tra:", meta.get("checked_at") or datetime.now().strftime("%d/%m/%Y %H:%M")])

    info_table = Table(
        [[Paragraph(f"<font face='{_BOLD_FONT}'>{k}</font>", styles["cell"]), Paragraph(str(v), styles["cell"])] for k, v in info_rows],
        colWidths=[38 * mm, 128 * mm],
    )
    info_table.setStyle(TableStyle([
        ("VALIGN", (0, 0), (-1, -1), "TOP"),
        ("BOTTOMPADDING", (0, 0), (-1, -1), 3),
    ]))
    story.append(info_table)
    story.append(Spacer(1, 14))

    # --- Summary cards ------------------------------------------------
    status_text = "SẠCH — KHÔNG CÓ LỖI" if is_clean else "PHÁT HIỆN LỖI"
    status_hex = "#16A34A" if is_clean else "#DC2626"
    proper_noun_count = sum(1 for e in errors.values() if e.get("suspected_proper_noun"))

    cards = Table([[
        _stat_card(str(error_count), "TỔNG SỐ TỪ NGHI SAI", styles, status_hex),
        _stat_card(str(proper_noun_count), "NGHI NGỜ DANH TỪ RIÊNG", styles, "#4F46E5"),
        _stat_card(status_text, "TRẠNG THÁI", styles, status_hex, small=True),
    ]], colWidths=[57 * mm, 57 * mm, 57 * mm])
    cards.setStyle(TableStyle([("LEFTPADDING", (0, 0), (-1, -1), 3), ("RIGHTPADDING", (0, 0), (-1, -1), 3)]))
    story.append(cards)
    story.append(Spacer(1, 16))

    # --- Details --------------------------------------------------------
    if is_clean:
        story.append(Paragraph("Kết quả chi tiết", styles["h2"]))
        story.append(Paragraph(
            "Không phát hiện lỗi chính tả nào trong nội dung được kiểm tra. Nội dung đạt yêu cầu để nộp.",
            styles["body"],
        ))
    else:
        story.append(Paragraph(f"Danh sách lỗi chi tiết ({error_count})", styles["h2"]))

        table_data = [[
            Paragraph("STT", styles["cellBold"]),
            Paragraph("Từ nghi sai", styles["cellBold"]),
            Paragraph("Vị trí", styles["cellBold"]),
            Paragraph("Gợi ý sửa", styles["cellBold"]),
            Paragraph("Ghi chú", styles["cellBold"]),
        ]]

        for idx, (word, info) in enumerate(errors.items(), start=1):
            suggestions = info.get("suggestions") or []
            suggestion_text = ", ".join(suggestions[:5]) if suggestions else "—"
            note = "Có thể là danh từ riêng" if info.get("suspected_proper_noun") else ""
            table_data.append([
                Paragraph(str(idx), styles["cell"]),
                Paragraph(f"<font face='{_BOLD_FONT}' color='#DC2626'>{word}</font>", styles["cell"]),
                Paragraph(_format_positions(info.get("positions") or []), styles["cell"]),
                Paragraph(suggestion_text, styles["cell"]),
                Paragraph(note, styles["cell"]),
            ])

        col_widths = [13 * mm, 27 * mm, 40 * mm, 43 * mm, 47 * mm]
        err_table = Table(table_data, colWidths=col_widths, repeatRows=1)
        err_table.setStyle(TableStyle([
            ("BACKGROUND", (0, 0), (-1, 0), BRAND_COLOR),
            ("TEXTCOLOR", (0, 0), (-1, 0), colors.white),
            ("FONTNAME", (0, 0), (-1, 0), _BOLD_FONT),
            ("VALIGN", (0, 0), (-1, -1), "TOP"),
            ("GRID", (0, 0), (-1, -1), 0.4, colors.HexColor("#E5E7EB")),
            ("ROWBACKGROUNDS", (0, 1), (-1, -1), [colors.white, LIGHT_BG]),
            ("TOPPADDING", (0, 0), (-1, -1), 5),
            ("BOTTOMPADDING", (0, 0), (-1, -1), 5),
            ("LEFTPADDING", (0, 0), (-1, -1), 6),
            ("RIGHTPADDING", (0, 0), (-1, -1), 6),
        ]))
        story.append(err_table)

        story.append(Spacer(1, 12))
        story.append(Paragraph("Ghi chú", styles["h2"]))
        story.append(ListFlowable([
            ListItem(Paragraph("Các từ được đánh dấu \u201cnghi ngờ danh từ riêng\u201d có thể là tên người, địa danh hoặc thuật ngữ hợp lệ — vui lòng đối chiếu ngữ cảnh trước khi sửa.", styles["body"])),
            ListItem(Paragraph("Nếu từ nghi sai là đúng (thuật ngữ chuyên ngành, tên riêng...), có thể xác nhận bỏ qua cảnh báo khi nộp kết quả.", styles["body"])),
        ], bulletType="bullet", start="•"))

    story.append(Spacer(1, 20))
    story.append(Paragraph(
        f"Báo cáo được tạo tự động bởi Vispeller lúc {datetime.now().strftime('%d/%m/%Y %H:%M:%S')}. "
        f"Đây là công cụ hỗ trợ, kết quả cuối cùng cần được người kiểm duyệt xác nhận.",
        styles["footer"],
    ))

    doc.build(story)
    return buf.getvalue()
