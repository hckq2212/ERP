from price_parser import Price

class CurrencyDetector:
    def detect(self, word: str) -> bool:
        price = Price.fromstring(word)
        return price.amount is not None and price.currency is not None
