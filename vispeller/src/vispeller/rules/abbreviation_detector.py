from .data import ABBREVIATIONS

class AbbreviationDetector:
    def detect(self, word: str) -> bool:
        return word.lower().strip(".") in ABBREVIATIONS
