import mimetypes

class FilenameDetector:
    def detect(self, word: str) -> bool:
        return mimetypes.guess_type(word)[0] is not None
