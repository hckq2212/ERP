import unicodedata

class EmojiDetector:
    def detect(self, word: str) -> bool:
        return any(unicodedata.category(c) in ("So", "Sk") for c in word)
