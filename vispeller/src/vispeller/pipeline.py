import json
import re
from nltk.tokenize import WordPunctTokenizer
from tqdm import tqdm
from .io.reader import SpreadsheetReader
from .rules.rule_checker import RuleChecker
from .rules.default_whitelist import DEFAULT_WHITELIST
from .spell_checker.en import EnglishChecker
from .spell_checker.vi import VietnameseChecker, VietnameseCheckerDauCu

TOKENIZER = WordPunctTokenizer()
URL_RE = re.compile(r"https?://\S+|www\.\S+", re.IGNORECASE)
DOMAIN_RE = re.compile(r"\b[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.(?:com|net|org|vn|edu|gov|info|biz|io|co|me|tv|shop)(?:\.\w+)?\b", re.IGNORECASE)

CHECKERS = {
    "vi": VietnameseChecker,
    "en": EnglishChecker,
}

DEFAULT_PROPER_NOUN_THRESHOLD = 3

def tokenize(text):
    text = URL_RE.sub(" ", text)
    text = DOMAIN_RE.sub(" ", text)
    tokens = TOKENIZER.tokenize(text)
    return [token for token in tokens if any(c.isalpha() for c in token)]

def check_spreadsheet(link, lang="both", whitelist=None, use_default_whitelist=True, proper_noun_threshold=DEFAULT_PROPER_NOUN_THRESHOLD):
    if lang == "both":
        checkers = [CHECKERS["vi"](), VietnameseCheckerDauCu(), CHECKERS["en"]()]
    elif lang == "vi":
        checkers = [CHECKERS["vi"](), VietnameseCheckerDauCu()]
    else:
        checker_cls = CHECKERS.get(lang)
        if checker_cls is None:
            raise ValueError(f"Unsupported language: {lang}")
        checkers = [checker_cls()]

    whitelist = {w.lower() for w in whitelist} if whitelist else set()
    if use_default_whitelist:
        whitelist |= DEFAULT_WHITELIST

    reader = SpreadsheetReader(link)
    rule_checker = RuleChecker()
    verdict_cache = {}
    repeat_counts = {}
    warned_words = set()

    for sheet_index, sheet_name in enumerate(reader.sheet_names()):
        cells = json.loads(reader.fetch(sheet_index))[sheet_name]
        tasks = []

        for cell in cells:
            words = tokenize(cell["text"])
            words = rule_checker.filter(words)
            words = [word for word in words if word.lower() not in whitelist]
            tasks.extend((cell, word) for word in words)

        bar = tqdm(tasks, desc=f"Checking '{sheet_name}'", unit="word", leave=False)

        for cell, word in bar:
            bar.set_postfix_str(word[:20], refresh=True)
            cached = verdict_cache.get(word)

            if cached is None:
                is_word_correct = any(checker.is_correct(word) for checker in checkers)

                if is_word_correct:
                    suggestions = None
                else:
                    suggestions = []
                    for checker in checkers:
                        suggestions.extend(checker.suggest(word))

                cached = (is_word_correct, suggestions)
                verdict_cache[word] = cached

            is_word_correct, suggestions = cached
            error = None
            suspected_proper_noun = False

            if not is_word_correct:
                repeat_counts[word] = repeat_counts.get(word, 0) + 1

                if repeat_counts[word] >= proper_noun_threshold:
                    suspected_proper_noun = True

                    if word not in warned_words:
                        warned_words.add(word)
                        tqdm.write(f"⚠️ '{word}' repeats {proper_noun_threshold}+ times in '{sheet_name}'. It may be a proper noun. Please consider adding it to the whitelist.")

                error = {"word": word, "suggestions": suggestions}

            yield {
                "sheet": sheet_name,
                "row": cell["row"],
                "column": cell["column"],
                "word": word,
                "error": error,
                "suspected_proper_noun": suspected_proper_noun,
            }

def group_errors(events):
    errors = {}

    for event in events:
        if not event["error"]:
            continue

        entry = errors.setdefault(event["word"], {"suggestions": event["error"]["suggestions"], "positions": [], "suspected_proper_noun": event.get("suspected_proper_noun", False)})

        entry["positions"].append({"sheet": event["sheet"], "row": event["row"], "column": event["column"]})

        if event.get("suspected_proper_noun", False):
            entry["suspected_proper_noun"] = True

    return errors