import re

PATTERN = re.compile(r"^[.\-*_,;:—]{1,3}$")

class SymbolOnlyDetector:
    def detect(self, word: str) -> bool:
        return bool(PATTERN.search(word))
