from dateutil import parser

class DateDetector:
    def detect(self, word: str) -> bool:
        try:
            parser.parse(word, fuzzy=False)
            return True
        except (ValueError, OverflowError):
            return False
