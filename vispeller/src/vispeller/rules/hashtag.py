import re

PATTERN = re.compile(r"#\w+")

class HashtagDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
