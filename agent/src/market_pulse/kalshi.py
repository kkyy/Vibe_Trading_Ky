from __future__ import annotations

import json
import logging
import os
import time
import asyncio
from pathlib import Path
from typing import Any

import httpx

from src.config.paths import get_data_dir
from src.market_pulse import taxonomy

logger = logging.getLogger(__name__)

EVENTS_URL = "https://api.elections.kalshi.com/trade-api/v2/events"
_TTL_SECONDS = 300
_MAX_PAGES = int(os.getenv("VIBE_TRADING_KALSHI_PULSE_PAGES", "8"))
_CACHE: dict[str, tuple[float, Any]] = {}


def _snapshot_path() -> Path:
    return get_data_dir() / "market_pulse_kalshi.json"


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


def _market_prob(market: dict[str, Any]) -> float | None:
    return _safe_float(market.get("yes_ask_dollars")) or _safe_float(market.get("last_price_dollars"))


async def pull_raw_events(force: bool = False) -> list[dict[str, Any]]:
    cached = None if force else _cache_get("events")
    if cached is not None:
        return cached

    events: list[dict[str, Any]] = []
    cursor = ""
    headers = {"Accept": "application/json", "User-Agent": "Mozilla/5.0 (vibe-trading)"}
    async with httpx.AsyncClient(timeout=24.0, headers=headers) as client:
        for page in range(_MAX_PAGES):
            params = {"limit": "200", "status": "open", "with_nested_markets": "true"}
            if cursor:
                params["cursor"] = cursor
            data = None
            for attempt in range(3):
                try:
                    resp = await client.get(EVENTS_URL, params=params)
                    resp.raise_for_status()
                    data = resp.json()
                    break
                except (httpx.HTTPError, ValueError) as exc:
                    logger.warning("kalshi page %d attempt %d failed: %s", page, attempt + 1, exc)
                    await asyncio.sleep(1.0 * (attempt + 1))
            if data is None:
                break
            batch = data.get("events", []) if isinstance(data, dict) else []
            if not batch:
                break
            events.extend(batch)
            cursor = data.get("cursor", "") if isinstance(data, dict) else ""
            if not cursor:
                break
    _cache_set("events", events)
    return events


def _shape_event(event: dict[str, Any]) -> dict[str, Any] | None:
    markets = event.get("markets") or []
    if not markets:
        return None

    if len(markets) > 1:
        priced = [m for m in markets if _market_prob(m) is not None]
        rep = min(priced or markets, key=lambda m: abs((_market_prob(m) or 0.0) - 0.5))
        pick_label = (rep.get("yes_sub_title") or "").strip() or None
    else:
        rep = markets[0]
        pick_label = None

    prob_yes = _market_prob(rep)
    if prob_yes is None:
        return None
    last = _safe_float(rep.get("last_price_dollars"))
    prev = _safe_float(rep.get("previous_price_dollars"))
    change_24h = (last - prev) if last not in (None, 0.0) and prev not in (None, 0.0) else None
    vol_24h = sum(_safe_float(m.get("volume_24h_fp")) or 0.0 for m in markets)
    liquidity = sum(_safe_float(m.get("liquidity_dollars")) or 0.0 for m in markets)
    title = (event.get("title") or "").strip()

    return {
        "question": title,
        "question_zh": None,
        "topic": taxonomy.classify(title, event.get("category")),
        "outcomes": [pick_label or "Yes", "No"],
        "prices": [prob_yes, 1 - prob_yes],
        "prob_yes": prob_yes,
        "pick_label": pick_label,
        "change_24h": change_24h,
        "change_7d": None,
        "volume_24h": vol_24h,
        "liquidity": liquidity,
        "end_date": rep.get("close_time") or event.get("close_time"),
        "slug": event.get("event_ticker"),
        "series_ticker": event.get("series_ticker"),
        "token_id_yes": None,
        "source": "kalshi",
        "kalshi_category": event.get("category"),
    }


async def fetch_markets(force: bool = False) -> list[dict[str, Any]]:
    if not force:
        snapshot = _load_snapshot()
        if snapshot is not None:
            return snapshot
    events = await pull_raw_events(force=force)
    shaped = [row for event in events if (row := _shape_event(event)) is not None]
    shaped = [m for m in shaped if (m.get("volume_24h") or 0.0) > 0.0]
    shaped.sort(key=lambda m: m.get("volume_24h") or 0.0, reverse=True)
    if shaped:
        _save_snapshot(shaped)
    elif (prev := _load_snapshot()) is not None:
        logger.warning("kalshi pull returned empty; serving previous snapshot")
        return prev
    return shaped
