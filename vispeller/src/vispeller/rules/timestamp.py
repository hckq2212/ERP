import re

PATTERN = re.compile(r"\[\s*[0-9]{1,2}:[0-9]{2}\s*[|-]\s*[0-9]{1,2}:[0-9]{2}\s*\]")

class TimestampDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
