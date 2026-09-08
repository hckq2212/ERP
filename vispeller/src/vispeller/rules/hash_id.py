import re

# md5/sha-style hashes: long runs of hex chars only. Real Vietnamese/English
# words this long made up of only a-f letters practically don't exist, so a
# length floor of 10 keeps this safe from false positives.
HEX_HASH_RE = re.compile(r"^[0-9a-fA-F]{10,}$")

# Opaque IDs / filename stems such as "VID_20260508064413376", "IMG1234567",
# "20260508064413376" - an optional short letter prefix, optional underscore,
# followed by a long run of digits. This is what's left over once the
# tokenizer splits a real filename like "VID_20260508064413376.mp4" into
# ["VID_20260508064413376", "mp4"] and FilenameDetector no longer has the
# extension attached to recognize it by.
ID_RE = re.compile(r"^[A-Za-z]{0,6}_?[0-9]{6,}$")

class HashIdDetector:
    def detect(self, word: str) -> bool:
        return bool(HEX_HASH_RE.match(word)) or bool(ID_RE.match(word))
