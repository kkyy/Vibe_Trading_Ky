from __future__ import annotations

from fastapi import HTTPException, Query


def register_pulse_routes(app) -> None:
    @app.get("/pulse/overview")
    async def get_pulse_overview(refresh: bool = Query(False)):
        from src.market_pulse.pulse import fetch_overview

        try:
            return await fetch_overview(force=refresh)
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Market pulse fetch failed: {exc}") from exc

    @app.get("/polymarket/history")
    async def get_polymarket_history(
        token_id: str = Query(...),
        interval: str = Query("1m"),
    ):
        from src.market_pulse.polymarket import fetch_history

        try:
            return {"history": await fetch_history(token_id=token_id, interval=interval)}
        except Exception as exc:  # noqa: BLE001
            raise HTTPException(status_code=502, detail=f"Polymarket history fetch failed: {exc}") from exc
