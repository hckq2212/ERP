from .url import UrlDetector
from .number import NumberDetector
from .percent import PercentDetector
from .date import DateDetector
from .date_range_short import DateRangeShortDetector
from .abbreviation_detector import AbbreviationDetector
from .code import CodeDetector
from .currency import CurrencyDetector
from .timestamp import TimestampDetector
from .filename import FilenameDetector
from .hash_id import HashIdDetector
from .email import EmailDetector
from .phone import PhoneDetector
from .hashtag import HashtagDetector
from .emoji import EmojiDetector
from .symbol_only import SymbolOnlyDetector
from .quotation import QuotationDetector
from .acronym import AcronymDetector
from .unit import UnitDetector

class RuleChecker:
    def __init__(self):
        self.detectors = [
            UrlDetector(),
            NumberDetector(),
            PercentDetector(),
            DateDetector(),
            DateRangeShortDetector(),
            AbbreviationDetector(),
            CodeDetector(),
            CurrencyDetector(),
            TimestampDetector(),
            FilenameDetector(),
            HashIdDetector(),
            EmailDetector(),
            PhoneDetector(),
            HashtagDetector(),
            EmojiDetector(),
            SymbolOnlyDetector(),
            QuotationDetector(),
            AcronymDetector(),
            UnitDetector(),
        ]

    def matches(self, word: str) -> bool:
        return any(detector.detect(word) for detector in self.detectors)

    def filter(self, words):
        return [word for word in words if not self.matches(word)]
