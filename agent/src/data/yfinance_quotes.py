"""Small yfinance quote adapter for the market overview page."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError
from datetime import datetime
from typing import Any

import requests
import yfinance as yf

DISPLAY_NAMES = {
    "^IXIC": "NASDAQ Composite Index",
    "^GSPC": "S&P 500",
    "AAPL": "Apple Inc.",
    "MSFT": "Microsoft Corporation",
    "NVDA": "NVIDIA Corporation",
    "TSLA": "Tesla, Inc.",
    "AMZN": "Amazon.com, Inc.",
    "GOOGL": "Alphabet Inc.",
    "META": "Meta Platforms, Inc.",
}


def _to_float(value: Any) -> float:
    try:
        if value is None:
            return 0.0
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def _normalize_symbol(symbol: str) -> str:
    raw = (symbol or "").strip().upper()
    if not raw:
        raise ValueError("Symbol is required")
    if raw.endswith(".US"):
        return raw[:-3]
    return raw


def _parse_nasdaq_number(value: Any) -> float:
    text = str(value or "").replace("$", "").replace(",", "").replace("%", "").strip()
    return _to_float(text)


def _nasdaq_summary(symbol: str, asset_class: str) -> dict[str, Any]:
    try:
        response = requests.get(
            f"https://api.nasdaq.com/api/quote/{symbol}/summary",
            params={"assetclass": asset_class},
            headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
            timeout=10,
        )
        return response.json().get("data") or {}
    except Exception:
        return {}


def _nasdaq_symbol(symbol: str) -> tuple[str, str] | None:
    if symbol == "^IXIC":
        return "COMP", "index"
    if symbol.startswith("^"):
        return None
    return symbol, "stocks"


def _nasdaq_quote(symbol: str) -> dict[str, Any] | None:
    mapped = _nasdaq_symbol(symbol)
    if not mapped:
        return None
    nasdaq_symbol, asset_class = mapped
    response = requests.get(
        f"https://api.nasdaq.com/api/quote/{nasdaq_symbol}/info",
        params={"assetclass": asset_class},
        headers={"User-Agent": "Mozilla/5.0", "Accept": "application/json"},
        timeout=10,
    )
    data = response.json().get("data") or {}
    primary = data.get("primaryData") or {}
    summary = _nasdaq_summary(nasdaq_symbol, asset_class).get("summaryData") or {}
    price = _parse_nasdaq_number(primary.get("lastSalePrice"))
    change = _parse_nasdaq_number(primary.get("netChange"))
    pct = _parse_nasdaq_number(primary.get("percentageChange"))
    if not price:
        return None
    return {
        "symbol": symbol,
        "name": data.get("companyName") or symbol,
        "price": price,
        "previous_close": price - change if change else price,
        "change": change,
        "change_pct": pct,
        "currency": "USD",
        "pe_ttm": 0.0,
        "market_cap_yi": _parse_nasdaq_number((summary.get("MarketCap") or {}).get("value")) / 100000000,
        "market_time": primary.get("lastTradeTimestamp") or datetime.now().isoformat(timespec="seconds"),
    }


def _quote_from_prices(symbol: str, price: float, previous: float, info: dict[str, Any] | None = None) -> dict[str, Any]:
    info = info or {}
    change = price - previous if price and previous else 0.0
    change_pct = (change / previous * 100) if previous else 0.0
    return {
        "symbol": symbol,
        "name": info.get("shortName") or info.get("longName") or DISPLAY_NAMES.get(symbol, symbol),
        "price": price,
        "previous_close": previous,
        "change": change,
        "change_pct": change_pct,
        "currency": info.get("currency") or "USD",
        "pe_ttm": _to_float(info.get("trailingPE") or info.get("forwardPE")),
        "market_cap_yi": _to_float(info.get("marketCap")) / 100000000,
        "market_time": datetime.now().isoformat(timespec="seconds"),
    }


def _download_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    result: dict[str, dict[str, Any]] = {}
    try:
        frame = yf.download(symbols, period="5d", interval="1d", auto_adjust=False, progress=False, threads=False, timeout=4)
    except Exception:
        return result
    if frame.empty or "Close" not in frame:
        return result

    close_data = frame["Close"]
    if len(symbols) == 1:
        closes = close_data.dropna()
        if len(closes) >= 1:
            price = _to_float(closes.iloc[-1])
            previous = _to_float(closes.iloc[-2]) if len(closes) >= 2 else price
            result[symbols[0]] = _quote_from_prices(symbols[0], price, previous)
        return result

    for symbol in symbols:
        if symbol not in close_data:
            continue
        closes = close_data[symbol].dropna()
        if len(closes) < 1:
            continue
        price = _to_float(closes.iloc[-1])
        previous = _to_float(closes.iloc[-2]) if len(closes) >= 2 else price
        if price:
            result[symbol] = _quote_from_prices(symbol, price, previous)
    return result


def yfinance_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    normalized = [_normalize_symbol(symbol) for symbol in symbols]
    result: dict[str, dict[str, Any]] = {}
    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_download_quotes, normalized)
    try:
        result = future.result(timeout=5)
    except TimeoutError:
        result = {}
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    for symbol in normalized:
        if symbol in result:
            fallback = _nasdaq_quote(symbol)
            if fallback:
                result[symbol]["name"] = fallback.get("name") or result[symbol]["name"]
                result[symbol]["market_cap_yi"] = fallback.get("market_cap_yi", result[symbol].get("market_cap_yi", 0.0))
            continue
        fallback = _nasdaq_quote(symbol)
        if fallback:
            result[symbol] = fallback
    return result
