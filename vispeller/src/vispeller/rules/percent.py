import re

PATTERN = re.compile(r"^[0-9]+(\.[0-9]+)?%$")

class PercentDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
