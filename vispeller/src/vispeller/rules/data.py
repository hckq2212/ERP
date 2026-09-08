import calendar

import nltk

nltk.download("punkt_tab", quiet=True)

ABBREVIATIONS = set(nltk.data.load("tokenizers/punkt/english.pickle")._params.abbrev_types)
ABBREVIATIONS.update(d.lower() for d in calendar.day_abbr)
ABBREVIATIONS.update(m.lower() for m in calendar.month_abbr if m)
ABBREVIATIONS.update({"t2", "t3", "t4", "t5", "t6", "t7", "cn"})
