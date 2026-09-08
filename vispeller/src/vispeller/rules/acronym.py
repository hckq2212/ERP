class AcronymDetector:
    def detect(self, word: str) -> bool:
        return 2 <= len(word) <= 6 and word.isupper()
