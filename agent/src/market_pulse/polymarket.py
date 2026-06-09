from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx

from src.config.paths import get_data_dir
from src.market_pulse import taxonomy

logger = logging.getLogger(__name__)

GAMMA_MARKETS_URL = "https://gamma-api.polymarket.com/markets"
CLOB_HISTORY_URL = "https://clob.polymarket.com/prices-history"
_TTL_SECONDS = 300
_CACHE: dict[str, tuple[float, Any]] = {}


def _snapshot_path() -> Path:
    return get_data_dir() / "market_pulse_polymarket.json"


def _cache_get(key: str) -> Any | None:
    hit = _CACHE.get(key)
    if hit and time.time() - hit[0] < _TTL_SECONDS:
        return hit[1]
    return None


def _cache_set(key: str, value: Any) -> None:
    _CACHE[key] = (time.time(), value)


def _safe_float(value: Any) -> float | None:
    try:
        return float(value)
    except (TypeError, ValueError):
        return None


def _parse_json_field(raw: Any, default: Any) -> Any:
    if isinstance(raw, str):
        try:
            return json.loads(raw)
        except (TypeError, ValueError):
            return default
    return raw if raw is not None else default


def _load_snapshot() -> list[dict[str, Any]] | None:
    try:
        data = json.loads(_snapshot_path().read_text(encoding="utf-8"))
        return data if isinstance(data, list) else None
    except (FileNotFoundError, OSError, ValueError):
        return None


def _save_snapshot(markets: list[dict[str, Any]]) -> None:
    if not markets:
        return
    path = _snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(markets, ensure_ascii=False), encoding="utf-8")


def _shape(market: dict[str, Any]) -> dict[str, Any]:
    question = market.get("question") or ""
    outcomes = _parse_json_field(market.get("outcomes"), [])
    prices = _parse_json_field(market.get("outcomePrices"), [])
    token_ids = _parse_json_field(market.get("clobTokenIds"), [])
    yes = _safe_float(prices[0]) if prices else None
    return {
        "question": question,
        "question_zh": None,
        "topic": taxonomy.classify(question),
        "outcomes": outcomes,
        "prices": [_safe_float(p) for p in prices],
        "prob_yes": yes,
        "pick_label": None,
        "change_24h": _safe_float(market.get("oneDayPriceChange")),
        "change_7d": _safe_float(market.get("oneWeekPriceChange")),
        "volume_24h": _safe_float(market.get("volume24hr")),
        "liquidity": _safe_float(market.get("liquidity")),
        "end_date": market.get("endDateIso") or market.get("endDate"),
        "slug": market.get("slug"),
        "series_ticker": None,
        "token_id_yes": token_ids[0] if token_ids else None,
        "source": "polymarket",
    }


async def pull_raw_markets(pages: int = 3, force: bool = False) -> list[dict[str, Any]]:
    cache_key = f"raw:{pages}"
    cached = None if force else _cache_get(cache_key)
    if cached is not None:
        return cached

    raw: list[dict[str, Any]] = []
    seen: set[str] = set()
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (vibe-trading)"}
    async with httpx.AsyncClient(timeout=20.0, headers=headers) as client:
        for page in range(pages):
            params = {
                "active": "true",
                "closed": "false",
                "limit": "100",
                "offset": str(page * 100),
                "order": "volume24hr",
                "ascending": "false",
            }
            resp = await client.get(GAMMA_MARKETS_URL, params=params)
            resp.raise_for_status()
            batch = resp.json()
            if not isinstance(batch, list):
                batch = batch.get("data", []) if isinstance(batch, dict) else []
            if not batch:
                break
            for market in batch:
                mid = str(market.get("id") or market.get("conditionId") or market.get("slug"))
                if mid not in seen:
                    seen.add(mid)
                    raw.append(market)
    _cache_set(cache_key, raw)
    return raw


async def fetch_markets(force: bool = False) -> list[dict[str, Any]]:
    if not force:
        snapshot = _load_snapshot()
        if snapshot is not None:
            return snapshot
    raw = await pull_raw_markets(pages=3, force=force)
    shaped = [_shape(market) for market in raw]
    shaped = [m for m in shaped if m["prob_yes"] is not None]
    shaped.sort(key=lambda m: m.get("volume_24h") or 0.0, reverse=True)
    if shaped:
        _save_snapshot(shaped)
    elif (prev := _load_snapshot()) is not None:
        logger.warning("polymarket pull returned empty; serving previous snapshot")
        return prev
    return shaped


async def fetch_history(token_id: str, interval: str = "1m", fidelity: int = 720) -> list[dict[str, Any]]:
    cache_key = f"history:{token_id}:{interval}:{fidelity}"
    cached = _cache_get(cache_key)
    if cached is not None:
        return cached
    params = {"market": token_id, "interval": interval, "fidelity": str(fidelity)}
    async with httpx.AsyncClient(timeout=20.0) as client:
        resp = await client.get(CLOB_HISTORY_URL, params=params, headers={"Accept": "application/json"})
        resp.raise_for_status()
        data = resp.json()
    history = data.get("history", []) if isinstance(data, dict) else []
    points = [{"t": p.get("t"), "p": _safe_float(p.get("p"))} for p in history]
    _cache_set(cache_key, points)
    return points

