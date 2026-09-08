import re

PATTERN = re.compile(r"^[\"'“‘](.*)[\"'”’]$")

class QuotationDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
