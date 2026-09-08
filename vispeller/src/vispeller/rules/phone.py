import phonenumbers

class PhoneDetector:
    def detect(self, word: str) -> bool:
        try:
            return phonenumbers.is_valid_number(phonenumbers.parse(word, "VN"))
        except phonenumbers.NumberParseException:
            return False
