import nltk

nltk.download("punkt_tab", quiet=True)

class EnTokenizer:
    def tokenize(self, text: str) -> list[str]:
        return [tok.lower() for tok in nltk.word_tokenize(text)]