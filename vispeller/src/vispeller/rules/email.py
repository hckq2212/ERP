import re

PATTERN = re.compile(r"[a-zA-Z0-9_%+-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,}")

class EmailDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
