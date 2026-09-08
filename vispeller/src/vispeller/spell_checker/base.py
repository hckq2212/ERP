import signal
import urllib.request
from pathlib import Path

from spylls.hunspell import Dictionary

class HunspellChecker:
    dict_name = "base"
    dic_url = ""
    aff_url = ""
    sanity_words = []

    def __init__(self, dict_dir=None):
        if dict_dir is None:
            dict_dir = Path(__file__).parent / "dictionaries"
        self.dict_dir = Path(dict_dir)
        self.dictionary = None

    def load(self):
        if self.dictionary is not None:
            return self.dictionary
        self._ensure_dict_files()
        base_path = self.dict_dir / self.dict_name
        self.dictionary = Dictionary.from_files(str(base_path))
        if self.sanity_words and not all(self.dictionary.lookup(w) for w in self.sanity_words):
            self._ensure_dict_files(force=True)
            self.dictionary = Dictionary.from_files(str(base_path))
            if self.sanity_words and not all(self.dictionary.lookup(w) for w in self.sanity_words):
                raise RuntimeError(f"'{self.dict_name}' dictionary looks corrupted after re-download")
        return self.dictionary

    def _ensure_dict_files(self, force=False):
        self.dict_dir.mkdir(parents=True, exist_ok=True)
        dic_path = self.dict_dir / f"{self.dict_name}.dic"
        aff_path = self.dict_dir / f"{self.dict_name}.aff"
        if not force and dic_path.exists() and aff_path.exists():
            return
        for url, path in ((self.dic_url, dic_path), (self.aff_url, aff_path)):
            with urllib.request.urlopen(url, timeout=15) as response:
                data = response.read()
            if not data or data.lstrip()[:1] in (b"<", b"{"):
                raise RuntimeError(f"failed to download valid dictionary file from {url}")
            path.write_bytes(data)

    def is_correct(self, word):
        self.load()
        return bool(self.dictionary.lookup(word))

    def suggest(self, word, limit=5, timeout=3):
        self.load()
        if not hasattr(signal, "SIGALRM"):
            return list(self.dictionary.suggest(word))[:limit]

        def _raise(signum, frame):
            raise TimeoutError

        previous = signal.signal(signal.SIGALRM, _raise)
        signal.alarm(timeout)
        try:
            return list(self.dictionary.suggest(word))[:limit]
        except TimeoutError:
            return []
        finally:
            signal.alarm(0)
            signal.signal(signal.SIGALRM, previous)

    def check(self, words):
        errors = []
        for word in words:
            if not self.is_correct(word):
                errors.append({"word": word, "suggestions": self.suggest(word)})
        return errors

def format_errors(errors):
    if not errors:
        return "No spelling errors found."
    lines = [f"Found {len(errors)} possible spelling error(s):"]
    for i, err in enumerate(errors, start=1):
        suggestion_text = ", ".join(err["suggestions"]) if err["suggestions"] else "(no suggestions)"
        lines.append(f"{i}. '{err['word']}' -> {suggestion_text}")
    return "\n".join(lines)