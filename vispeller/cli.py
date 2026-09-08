import argparse
import json
import os
import sys


def _resource_base() -> str:
    return getattr(sys, "_MEIPASS", os.path.dirname(os.path.abspath(__file__)))

os.environ.setdefault("NLTK_DATA", os.path.join(_resource_base(), "nltk_data"))

import nltk  # noqa: E402

nltk.download = lambda *a, **k: True

from vispeller.sdk import check  # noqa: E402


def main() -> None:
    parser = argparse.ArgumentParser(
        description="Vispeller - kiểm tra chính tả Tiếng Việt / Tiếng Anh trong spreadsheet"
    )
    parser.add_argument("link", help="URL Google Sheets (hoặc link .xlsx) cần kiểm tra")
    parser.add_argument("--lang", default="both", choices=["vi", "en", "both"])
    parser.add_argument("--whitelist", nargs="*", default=None, help="Danh sách từ bỏ qua thêm")
    parser.add_argument(
        "--no-default-whitelist",
        action="store_true",
        help="Không dùng whitelist mặc định đi kèm sẵn trong vispeller",
    )
    parser.add_argument("--proper-noun-threshold", type=int, default=3)
    parser.add_argument("-o", "--output", help="Ghi kết quả JSON ra file thay vì in ra màn hình")
    args = parser.parse_args()

    result = check(
        link=args.link,
        lang=args.lang,
        whitelist=args.whitelist,
        use_default_whitelist=not args.no_default_whitelist,
        proper_noun_threshold=args.proper_noun_threshold,
    )

    text = json.dumps(result, ensure_ascii=False, indent=2)
    if args.output:
        with open(args.output, "w", encoding="utf-8") as f:
            f.write(text)
        print(f"Đã ghi kết quả vào {args.output}")
    else:
        print(text)


if __name__ == "__main__":
    main()
