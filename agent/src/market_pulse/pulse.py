from __future__ import annotations

import asyncio
import json
import logging
from datetime import datetime
from pathlib import Path
from typing import Any

from src.config.paths import get_data_dir
from src.market_pulse import kalshi, polymarket, taxonomy

logger = logging.getLogger(__name__)
_rebuilding = False


def _snapshot_path() -> Path:
    return get_data_dir() / "market_pulse_overview.json"


def _load_snapshot() -> dict[str, Any] | None:
    try:
        data = json.loads(_snapshot_path().read_text(encoding="utf-8"))
        return data if isinstance(data, dict) else None
    except (FileNotFoundError, OSError, ValueError):
        return None


def _save_snapshot(overview: dict[str, Any]) -> None:
    path = _snapshot_path()
    path.parent.mkdir(parents=True, exist_ok=True)
    path.write_text(json.dumps(overview, ensure_ascii=False), encoding="utf-8")


def _group(markets: list[dict[str, Any]]) -> list[dict[str, Any]]:
    buckets: dict[str, list[dict[str, Any]]] = {key: [] for key in taxonomy.MODULE_ORDER}
    for market in markets:
        buckets.setdefault(market.get("topic") or "other", []).append(market)

    modules: list[dict[str, Any]] = []
    for key in taxonomy.MODULE_ORDER:
        meta = taxonomy.MODULE_BY_KEY[key]
        group = sorted(buckets.get(key, []), key=lambda m: m.get("volume_24h") or 0.0, reverse=True)
        cap = int(meta.get("cap") or 0)
        if cap:
            group = group[:cap]
        if not group:
            continue
        source_counts: dict[str, int] = {}
        for market in group:
            source = market.get("source") or "unknown"
            source_counts[source] = source_counts.get(source, 0) + 1
        modules.append({
            "key": key,
            "label": meta["label"],
            "zh_label": meta["zh_label"],
            "core": bool(meta["core"]),
            "market_count": len(group),
            "volume_24h": sum(m.get("volume_24h") or 0.0 for m in group),
            "source_counts": source_counts,
            "markets": group,
        })
    return modules


async def _build() -> dict[str, Any]:
    results = await asyncio.gather(
        polymarket.fetch_markets(force=True),
        kalshi.fetch_markets(force=True),
        return_exceptions=True,
    )
    markets: list[dict[str, Any]] = []
    source_errors: dict[str, str] = {}
    for source, result in zip(("polymarket", "kalshi"), results, strict=True):
        if isinstance(result, Exception):
            source_errors[source] = str(result)
            logger.warning("market pulse source %s failed: %s", source, result)
        else:
            markets.extend(result)

    if not markets:
        previous = _load_snapshot()
        if previous is not None:
            return {**previous, "source_errors": source_errors}

    overview = {
        "as_of": datetime.now().isoformat(timespec="seconds"),
        "sources": ["polymarket", "kalshi"],
        "source_errors": source_errors,
        "module_order": taxonomy.MODULE_ORDER,
        "core_modules": taxonomy.CORE_MODULES,
        "modules": _group(markets),
    }
    if markets:
        _save_snapshot(overview)
    return overview


async def _background_rebuild() -> None:
    global _rebuilding
    try:
        await _build()
    finally:
        _rebuilding = False


async def fetch_overview(force: bool = False) -> dict[str, Any]:
    global _rebuilding
    snapshot = _load_snapshot()
    if snapshot is None:
        return await _build()
    if force and not _rebuilding:
        _rebuilding = True
        asyncio.create_task(_background_rebuild())
    if force or _rebuilding:
        return {**snapshot, "updating": True}
    return snapshot

