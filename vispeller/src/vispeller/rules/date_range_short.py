import re

PATTERN = re.compile(r"^[0-9]+(\.[0-9]+)?\s*-\s*[0-9]+(\.[0-9]+)?$")

class DateRangeShortDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
