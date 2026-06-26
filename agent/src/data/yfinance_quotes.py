"""Small yfinance quote adapter for the market overview page."""

from __future__ import annotations

from concurrent.futures import ThreadPoolExecutor, TimeoutError, as_completed
from datetime import datetime
from typing import Any
from urllib.parse import quote as url_quote

import requests

NASDAQ_TIMEOUT_SECONDS = 1
NASDAQ_FALLBACK_BUDGET_SECONDS = 3
YAHOO_CHART_TIMEOUT_SECONDS = 4
YAHOO_CHART_BUDGET_SECONDS = 6
HTTP_HEADERS = {"User-Agent": "Mozilla/5.0", "Accept": "application/json"}

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
            headers=HTTP_HEADERS,
            timeout=NASDAQ_TIMEOUT_SECONDS,
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
    try:
        response = requests.get(
            f"https://api.nasdaq.com/api/quote/{nasdaq_symbol}/info",
            params={"assetclass": asset_class},
            headers=HTTP_HEADERS,
            timeout=NASDAQ_TIMEOUT_SECONDS,
        )
        data = response.json().get("data") or {}
    except Exception:
        return None
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
        import yfinance as yf

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


def _last_two(values: list[Any]) -> tuple[float, float]:
    numbers = [_to_float(value) for value in values if _to_float(value)]
    if not numbers:
        return 0.0, 0.0
    current = numbers[-1]
    previous = numbers[-2] if len(numbers) >= 2 else current
    return current, previous


def _chart_quote(symbol: str) -> dict[str, Any] | None:
    try:
        response = requests.get(
            f"https://query1.finance.yahoo.com/v8/finance/chart/{url_quote(symbol, safe='')}",
            params={"range": "5d", "interval": "1d"},
            headers=HTTP_HEADERS,
            timeout=YAHOO_CHART_TIMEOUT_SECONDS,
        )
        payload = response.json()
        result = (payload.get("chart") or {}).get("result") or []
        if not result:
            return None
        data = result[0]
        meta = data.get("meta") or {}
        quote_rows = ((data.get("indicators") or {}).get("quote") or [{}])[0]
        closes = quote_rows.get("close") or []
        close_price, previous = _last_two(closes)
        price = _to_float(meta.get("regularMarketPrice")) or close_price
        previous = previous or _to_float(meta.get("chartPreviousClose")) or price
        if not price:
            return None
        market_time = meta.get("regularMarketTime")
        timestamp = (
            datetime.fromtimestamp(market_time).isoformat(timespec="seconds")
            if market_time
            else datetime.now().isoformat(timespec="seconds")
        )
        return _quote_from_prices(
            symbol,
            price,
            previous,
            {
                "shortName": meta.get("shortName"),
                "longName": meta.get("longName"),
                "currency": meta.get("currency") or "USD",
                "marketCap": meta.get("marketCap"),
            },
        ) | {"market_time": timestamp}
    except Exception:
        return None


def _chart_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    result: dict[str, dict[str, Any]] = {}
    executor = ThreadPoolExecutor(max_workers=min(5, len(symbols)))
    future_to_symbol = {executor.submit(_chart_quote, symbol): symbol for symbol in symbols}
    try:
        for future in as_completed(future_to_symbol, timeout=YAHOO_CHART_BUDGET_SECONDS):
            symbol = future_to_symbol[future]
            try:
                quote = future.result()
            except Exception:
                quote = None
            if quote:
                result[symbol] = quote
    except TimeoutError:
        pass
    finally:
        for future in future_to_symbol:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
    return result


def _fallback_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    if not symbols:
        return {}
    result: dict[str, dict[str, Any]] = {}
    executor = ThreadPoolExecutor(max_workers=min(5, len(symbols)))
    future_to_symbol = {executor.submit(_nasdaq_quote, symbol): symbol for symbol in symbols}
    try:
        for future in as_completed(future_to_symbol, timeout=NASDAQ_FALLBACK_BUDGET_SECONDS):
            symbol = future_to_symbol[future]
            try:
                quote = future.result()
            except Exception:
                quote = None
            if quote:
                result[symbol] = quote
    except TimeoutError:
        pass
    finally:
        for future in future_to_symbol:
            future.cancel()
        executor.shutdown(wait=False, cancel_futures=True)
    return result


def yfinance_quotes(symbols: list[str]) -> dict[str, dict[str, Any]]:
    normalized = [_normalize_symbol(symbol) for symbol in symbols]
    result: dict[str, dict[str, Any]] = _chart_quotes(normalized)
    missing = [symbol for symbol in normalized if symbol not in result]
    if not missing:
        return result

    executor = ThreadPoolExecutor(max_workers=1)
    future = executor.submit(_download_quotes, missing)
    try:
        result.update(future.result(timeout=5))
    except TimeoutError:
        pass
    finally:
        executor.shutdown(wait=False, cancel_futures=True)
    missing = [symbol for symbol in normalized if symbol not in result]
    result.update(_fallback_quotes(missing))
    return result
