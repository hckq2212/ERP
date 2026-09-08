from .base import HunspellChecker, format_errors

class VietnameseChecker(HunspellChecker):
    dict_name = "vi"
    dic_url = "https://raw.githubusercontent.com/1ec5/hunspell-vi/main/dictionaries/vi-DauMoi.dic"
    aff_url = "https://raw.githubusercontent.com/1ec5/hunspell-vi/main/dictionaries/vi-DauMoi.aff"
    sanity_words = ["là", "và", "không"]

class VietnameseCheckerDauCu(HunspellChecker):
    dict_name = "vi-daucu"
    dic_url = "https://raw.githubusercontent.com/1ec5/hunspell-vi/main/dictionaries/vi-DauCu.dic"
    aff_url = "https://raw.githubusercontent.com/1ec5/hunspell-vi/main/dictionaries/vi-DauCu.aff"
    sanity_words = ["là", "và", "không"]