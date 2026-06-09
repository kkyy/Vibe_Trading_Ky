from __future__ import annotations

MODULES = [
    {"key": "monetary_policy", "label": "Monetary Policy", "zh_label": "货币政策", "core": True, "cap": 8},
    {"key": "macro_economy", "label": "Macro Economy", "zh_label": "宏观经济", "core": True, "cap": 8},
    {"key": "geopolitics", "label": "Geopolitics", "zh_label": "地缘政治", "core": True, "cap": 12},
    {"key": "politics_elections", "label": "Politics & Elections", "zh_label": "政治选举", "core": True, "cap": 8},
    {"key": "markets_assets", "label": "Markets & Assets", "zh_label": "股指大宗", "core": True, "cap": 8},
    {"key": "ai_technology", "label": "AI & Technology", "zh_label": "AI 科技", "core": True, "cap": 8},
    {"key": "crypto", "label": "Crypto", "zh_label": "加密资产", "core": False, "cap": 6},
    {"key": "sports", "label": "Sports", "zh_label": "体育", "core": False, "cap": 6},
    {"key": "entertainment", "label": "Entertainment", "zh_label": "娱乐", "core": False, "cap": 5},
    {"key": "other", "label": "Other", "zh_label": "其他", "core": False, "cap": 6},
]

MODULE_BY_KEY = {m["key"]: m for m in MODULES}
MODULE_ORDER = [m["key"] for m in MODULES]
CORE_MODULES = [m["key"] for m in MODULES if m["core"]]

_GEO = [
    "china", "taiwan", "tariff", "trade war", "xi jinping", "hormuz", "iran",
    "venezuela", "russia", "ukraine", "north korea", "israel", "gaza", "nato",
    "nuclear", "missile", "ceasefire", "invade", "war ", "military",
]
_MONETARY = [
    "fed ", "fed decision", "fed funds", "federal reserve", "interest rate",
    "rate cut", "rate hike", "fomc", "powell", "basis point",
]
_MACRO = [
    "recession", " gdp", "inflation", " cpi", "unemployment", "jobs report",
    "payroll", "nonfarm", "jobless", " ppi", " pce", "gas price",
]
_AI = [
    "nvidia", "openai", " agi", "semiconductor", "tsmc", " chip", "anthropic",
    "gpt", "chatgpt", "llm", "grok", "gemini", "claude", "deepmind",
    "artificial intelligence", "deepseek",
]
_MARKETS = [
    "s&p", "nasdaq", "dow ", " stock", "earnings", " ipo", "market cap",
    "crude oil", "wti", "brent", "oil price", "gold price", "gold above",
    "commodit", " spy ",
]
_ELECTION = [
    "election", "president", " senate", "congress", "nominee", "potus",
    "white house", "governor", " mayor", "parliament", "prime minister",
    "referendum", "trump", "midterm", "impeach",
]
_CRYPTO = [
    "bitcoin", " btc", "ethereum", "crypto", "microstrategy", " mstr",
    "solana", "dogecoin", "coinbase", "stablecoin", "ripple", " xrp",
]
_SPORTS = [
    "nba", "nfl", " mlb", "world series", "super bowl", "stanley cup",
    "tennis", " wta", "ufc", "boxing", "premier league", "champions league",
    " vs.", " vs ", "world cup", "fifa", "golf", "playoff", "champion",
]
_ENT = [
    "movie", "oscar", "grammy", "box office", "taylor swift", "spotify",
    "netflix", "celebrity", "album", " song ", "emmy",
]

_KALSHI_CATEGORY = {
    "Economics": "macro_economy",
    "Financials": "markets_assets",
    "Commodities": "markets_assets",
    "Companies": "markets_assets",
    "Elections": "politics_elections",
    "Politics": "politics_elections",
    "World": "geopolitics",
    "Science and Technology": "ai_technology",
    "Crypto": "crypto",
    "Sports": "sports",
    "Entertainment": "entertainment",
}


def _has(text: str, keywords: list[str]) -> bool:
    return any(keyword in text for keyword in keywords)


def classify(question: str | None, kalshi_category: str | None = None) -> str:
    text = f" {(question or '').lower()} "
    if "world cup" in text or "fifa" in text:
        return "sports"
    if _has(text, _GEO):
        return "geopolitics"
    if _has(text, _MONETARY):
        return "monetary_policy"
    if _has(text, _MACRO):
        return "macro_economy"
    if _has(text, _AI):
        return "ai_technology"
    if _has(text, _CRYPTO):
        return "crypto"
    if _has(text, _MARKETS):
        return "markets_assets"
    if _has(text, _ELECTION):
        return "politics_elections"
    if _has(text, _SPORTS):
        return "sports"
    if _has(text, _ENT):
        return "entertainment"
    if kalshi_category:
        return _KALSHI_CATEGORY.get(kalshi_category, "other")
    return "other"

