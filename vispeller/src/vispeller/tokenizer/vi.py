from underthesea import word_tokenize

class ViTokenizer:
    def tokenize(self, text: str) -> list[str]:
        return word_tokenize(text)