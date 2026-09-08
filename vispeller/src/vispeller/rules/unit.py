import re

class UnitDetector:
    PATTERN = re.compile(r"^\d+(?:[.,]\d+)?[a-zA-Z]{0,4}$")

    def detect(self, word: str) -> bool:
        return bool(self.PATTERN.fullmatch(word.strip()))