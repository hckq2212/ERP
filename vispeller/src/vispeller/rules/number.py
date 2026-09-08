import re

PATTERN = re.compile(r"^[0-9]+(\.[0-9]+)?$")

class NumberDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
