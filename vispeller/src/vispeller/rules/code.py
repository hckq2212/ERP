import re

PATTERN = re.compile(r"^[A-Za-z]{1,4}[0-9]{1,4}$")

class CodeDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
