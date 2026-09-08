from .base import HunspellChecker, format_errors

DIC_URL = "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_US.dic"
AFF_URL = "https://raw.githubusercontent.com/LibreOffice/dictionaries/master/en/en_US.aff"

class EnglishChecker(HunspellChecker):
    dict_name = "en"
    dic_url = DIC_URL
    aff_url = AFF_URL
    sanity_words = ["the", "true", "content"]