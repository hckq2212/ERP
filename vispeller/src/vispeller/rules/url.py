import re

PATTERN = re.compile(r"https?://\S+")

class UrlDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
