"""
FastAPI wrapper around vispeller's SDK.

Run locally:
    uvicorn api:app --reload --port 8000

Endpoints:
    GET  /health                  -> liveness check
    POST /check-link              -> check a Google Sheets / .xlsx URL (JSON body)
    POST /check-file              -> check an uploaded .xlsx file (multipart/form-data)

Both /check-link and /check-file run the (blocking, CPU-heavy, uses
SIGALRM-based timeouts) vispeller pipeline inside a separate worker
process, so it never blocks the asyncio event loop and never hits the
"signal only works in main thread" error that would happen if it ran
in a plain thread pool.
"""

import asyncio
import os
import shutil
import sys
import tempfile
import uuid
from concurrent.futures import ProcessPoolExecutor
from contextlib import asynccontextmanager
from pathlib import Path
from typing import List, Optional


# --- Same NLTK bootstrap as cli.py: point NLTK at the bundled data ---------
# and make sure nothing tries to hit the network for tokenizer data.
def _resource_base() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))


os.environ.setdefault("NLTK_DATA", os.path.join(_resource_base(), "nltk_data_bundle"))

import nltk  # noqa: E402

nltk.download = lambda *a, **k: True

from fastapi import FastAPI, File, Form, HTTPException, UploadFile  # noqa: E402
from fastapi.responses import Response  # noqa: E402
from pydantic import BaseModel, Field  # noqa: E402

from vispeller.sdk import check as vispeller_check  # noqa: E402
from vispeller.report import build_pdf_report  # noqa: E402

ALLOWED_LANGS = {"vi", "en", "both"}
ALLOWED_EXTENSIONS = {".xlsx", ".xlsm"}

_executor: Optional[ProcessPoolExecutor] = None


@asynccontextmanager
async def lifespan(_: FastAPI):
    global _executor
    _executor = ProcessPoolExecutor(max_workers=2)
    try:
        yield
    finally:
        _executor.shutdown(wait=False, cancel_futures=True)


app = FastAPI(
    title="Vispeller API",
    description="Kiểm tra chính tả Tiếng Việt / Tiếng Anh trong spreadsheet (Google Sheets hoặc .xlsx)",
    version="0.1.0",
    lifespan=lifespan,
)


class CheckLinkRequest(BaseModel):
    link: str = Field(..., description="URL Google Sheets (chia sẻ công khai) hoặc link .xlsx trực tiếp")
    lang: str = Field("both", description="vi | en | both")
    whitelist: Optional[List[str]] = Field(None, description="Danh sách từ bỏ qua thêm")
    use_default_whitelist: bool = Field(True, description="Có dùng whitelist mặc định đi kèm sẵn hay không")
    proper_noun_threshold: int = Field(3, ge=1, description="Số lần lặp lại trước khi nghi ngờ là danh từ riêng")


class ReportMeta(BaseModel):
    title: Optional[str] = Field(None, description="Tiêu đề báo cáo")
    task_code: Optional[str] = Field(None, description="Mã công việc")
    task_name: Optional[str] = Field(None, description="Tên công việc")
    checked_at: Optional[str] = Field(None, description="Thời điểm kiểm tra, đã format sẵn")


class CheckLinkReportRequest(CheckLinkRequest):
    meta: Optional[ReportMeta] = Field(None, description="Thông tin hiển thị ở đầu báo cáo PDF")


def _run_check(
    link: str,
    lang: str,
    whitelist: Optional[List[str]],
    use_default_whitelist: bool,
    proper_noun_threshold: int,
) -> dict:
    """Executed inside the worker process (real main thread there)."""
    return vispeller_check(
        link=link,
        lang=lang,
        whitelist=whitelist,
        use_default_whitelist=use_default_whitelist,
        proper_noun_threshold=proper_noun_threshold,
    )


async def _dispatch_check(
    link: str,
    lang: str,
    whitelist: Optional[List[str]],
    use_default_whitelist: bool,
    proper_noun_threshold: int,
) -> dict:
    if lang not in ALLOWED_LANGS:
        raise HTTPException(status_code=422, detail=f"lang phải là một trong: {sorted(ALLOWED_LANGS)}")

    loop = asyncio.get_running_loop()
    try:
        return await loop.run_in_executor(
            _executor,
            _run_check,
            link,
            lang,
            whitelist,
            use_default_whitelist,
            proper_noun_threshold,
        )
    except Exception as exc:  # noqa: BLE001 - surface any pipeline error as 400
        raise HTTPException(status_code=400, detail=str(exc)) from exc


@app.get("/health")
async def health() -> dict:
    return {"status": "ok"}


@app.post("/check-link")
async def check_link(payload: CheckLinkRequest) -> dict:
    """Check spelling for a Google Sheets link or a direct .xlsx URL.

    Returns raw JSON — intended for internal/programmatic use only
    (e.g. by the /check-link/report endpoint below, or another service
    that will render its own presentation). End users should never be
    shown this payload directly; use /check-link/report for that.
    """
    return await _dispatch_check(
        link=payload.link,
        lang=payload.lang,
        whitelist=payload.whitelist,
        use_default_whitelist=payload.use_default_whitelist,
        proper_noun_threshold=payload.proper_noun_threshold,
    )


@app.post("/check-link/report")
async def check_link_report(payload: CheckLinkReportRequest) -> Response:
    """
    Run the spell-check pipeline and return a ready-to-download,
    professionally formatted PDF report (never raw JSON).
    """
    result = await _dispatch_check(
        link=payload.link,
        lang=payload.lang,
        whitelist=payload.whitelist,
        use_default_whitelist=payload.use_default_whitelist,
        proper_noun_threshold=payload.proper_noun_threshold,
    )

    meta = payload.meta.model_dump(exclude_none=True) if payload.meta else {}
    meta.setdefault("source", payload.link)
    meta.setdefault("lang", payload.lang)

    errors = result.get("errors") or {}
    pdf_bytes = build_pdf_report(errors, meta)

    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={
            "Content-Disposition": 'inline; filename="bao-cao-chinh-ta.pdf"',
            # Small bits of structured info the caller needs to decide what to
            # do next (block submission / auto-pass / etc.) without ever having
            # to parse the PDF or receive the raw errors JSON in the body.
            "X-Spellcheck-Status": "HAS_ERRORS" if errors else "CLEAN",
            "X-Spellcheck-Error-Count": str(len(errors)),
        },
    )


@app.post("/report")
async def report_from_errors(errors: dict, meta: Optional[ReportMeta] = None) -> Response:
    """
    Build a PDF report directly from an already-computed ``errors`` dict
    (avoids re-running the check pipeline when the caller already has it).
    """
    meta_dict = meta.model_dump(exclude_none=True) if meta else {}
    pdf_bytes = build_pdf_report(errors or {}, meta_dict)
    return Response(
        content=pdf_bytes,
        media_type="application/pdf",
        headers={"Content-Disposition": 'inline; filename="bao-cao-chinh-ta.pdf"'},
    )


@app.post("/check-file")
async def check_file(
    file: UploadFile = File(...),
    lang: str = Form("both"),
    whitelist: Optional[str] = Form(None, description="Các từ cách nhau bởi dấu phẩy"),
    use_default_whitelist: bool = Form(True),
    proper_noun_threshold: int = Form(3),
) -> dict:
    """Check spelling for an uploaded .xlsx file."""
    suffix = Path(file.filename or "").suffix.lower()
    if suffix not in ALLOWED_EXTENSIONS:
        raise HTTPException(status_code=400, detail=f"Chỉ hỗ trợ file {sorted(ALLOWED_EXTENSIONS)}")

    tmp_dir = Path(tempfile.mkdtemp(prefix="vispeller_"))
    tmp_path = tmp_dir / f"{uuid.uuid4().hex}{suffix}"

    try:
        with tmp_path.open("wb") as out:
            shutil.copyfileobj(file.file, out)
        await file.close()

        whitelist_words = [w.strip() for w in whitelist.split(",") if w.strip()] if whitelist else None

        return await _dispatch_check(
            link=tmp_path.resolve().as_uri(),  # file:///... -> read locally, no download
            lang=lang,
            whitelist=whitelist_words,
            use_default_whitelist=use_default_whitelist,
            proper_noun_threshold=proper_noun_threshold,
        )
    finally:
        shutil.rmtree(tmp_dir, ignore_errors=True)


if __name__ == "__main__":
    import uvicorn

    uvicorn.run("api:app", host="0.0.0.0", port=8000, reload=True)
