from typing import Iterable

from .pipeline import check_spreadsheet, group_errors


def check(
    link: str,
    lang: str = "both",
    whitelist: Iterable[str] | None = None,
    use_default_whitelist: bool = True,
    proper_noun_threshold: int = 3,
) -> dict:
    """
    Check spelling errors in a spreadsheet.

    This is the single public use case exposed by the SDK.

    Args:
        link:
            URL or path to the spreadsheet.

        lang:
            Language to check:
            - "vi"
            - "en"
            - "both"

        whitelist:
            Additional words that should not be checked.

        use_default_whitelist:
            Whether to use the built-in whitelist.

        proper_noun_threshold:
            Number of repetitions before an unknown word
            is suspected to be a proper noun.

    Returns:
        {
            "errors": {
                "word": {
                    "suggestions": [...],
                    "positions": [...],
                    "suspected_proper_noun": bool
                }
            }
        }
    """

    events = check_spreadsheet(
        link=link,
        lang=lang,
        whitelist=whitelist,
        use_default_whitelist=use_default_whitelist,
        proper_noun_threshold=proper_noun_threshold,
    )

    return {
        "errors": group_errors(events)
    }