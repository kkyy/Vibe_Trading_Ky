#!/usr/bin/env python3
"""macOS menu bar helper for the holdings monitor daily P&L snapshot."""

from __future__ import annotations

import json
import os
import platform
import subprocess
import sys
import urllib.error
import urllib.request
from datetime import datetime
from zoneinfo import ZoneInfo

API_URL = os.environ.get("VIBE_HOLDINGS_SNAPSHOT_URL", "http://127.0.0.1:8899/holdings/snapshot")
FRONTEND_URL = os.environ.get("VIBE_FRONTEND_URL", "http://127.0.0.1:5899/fund-baby")
CHINA_TZ = ZoneInfo("Asia/Shanghai")


def require_macos() -> None:
    if platform.system() != "Darwin":
        raise SystemExit("This menu bar helper only runs on macOS.")


def load_rumps():
    try:
        import rumps  # type: ignore
    except ImportError as exc:
        raise SystemExit(
            "Missing dependency: rumps. Install it with:\n"
            "  python -m pip install -r tools/requirements-menubar.txt\n"
            "Use the same Python environment that runs the backend."
        ) from exc
    return rumps


def is_a_share_session(now: datetime | None = None) -> bool:
    current = now.astimezone(CHINA_TZ) if now else datetime.now(CHINA_TZ)
    if current.weekday() >= 5:
        return False
    minutes = current.hour * 60 + current.minute
    return (9 * 60 + 30 <= minutes <= 11 * 60 + 30) or (13 * 60 <= minutes <= 15 * 60)


def format_cny(value: float) -> str:
    abs_value = abs(value)
    if abs_value >= 10_000:
        prefix = "-" if value < 0 else ""
        wan_text = f"{abs_value / 10_000:.2f}".rstrip("0").rstrip(".")
        return f"{prefix}¥{wan_text}万"
    if value > 0:
        return f"¥{value:,.1f}"
    if value < 0:
        return f"-¥{abs_value:,.1f}"
    return "¥0.0"


def format_percent(value: float) -> str:
    if value > 0:
        return f"{value:.2f}%"
    if value < 0:
        return f"-{abs(value):.2f}%"
    return "0.00%"


def daily_profit_percent(snapshot: dict, today_profit: float) -> float:
    total_asset = float(snapshot.get("total_asset") or 0)
    base_asset = total_asset - today_profit
    if abs(base_asset) < 1e-9:
        total_cost = float(snapshot.get("total_cost") or 0)
        base_asset = total_cost
    if abs(base_asset) < 1e-9:
        return 0.0
    return (today_profit / base_asset) * 100


def fetch_snapshot() -> dict:
    headers = {"Accept": "application/json"}
    api_key = os.environ.get("API_AUTH_KEY") or os.environ.get("VIBE_API_AUTH_KEY")
    if api_key:
        headers["Authorization"] = f"Bearer {api_key}"
    request = urllib.request.Request(API_URL, headers=headers)
    with urllib.request.urlopen(request, timeout=4) as response:
        return json.loads(response.read().decode("utf-8"))


def main() -> None:
    require_macos()
    rumps = load_rumps()
    from AppKit import NSColor, NSFont, NSForegroundColorAttributeName, NSFontAttributeName  # type: ignore
    from Foundation import NSMakeRange, NSMutableAttributedString  # type: ignore

    class HoldingsMenuApp(rumps.App):
        def __init__(self) -> None:
            super().__init__("--", quit_button=None)
            self.last_snapshot: dict | None = None
            self.amount_item = rumps.MenuItem("收益金额：--")
            self.percent_item = rumps.MenuItem("盈亏比例：--")
            self.status = rumps.MenuItem("等待持仓快照")
            self.session = rumps.MenuItem("A股时段：未开盘")
            self.menu = [
                self.amount_item,
                self.percent_item,
                None,
                self.status,
                self.session,
                None,
                rumps.MenuItem("刷新", callback=self.refresh_now),
                rumps.MenuItem("打开持仓监测", callback=self.open_holdings_monitor),
                None,
                rumps.MenuItem("退出", callback=rumps.quit_application),
            ]
            self.refresh(force=True)
            self.timer = rumps.Timer(self.refresh, 10)
            self.timer.start()

        def title_color(self, value: float):
            if value > 0:
                return NSColor.systemGreenColor()
            if value < 0:
                return NSColor.systemGreenColor()
            return NSColor.labelColor()

        def set_status_title(self, title: str, percent_start: int | None = None, value: float = 0) -> None:
            self.title = title
            if percent_start is None:
                return
            try:
                status_item = self._nsapp.nsstatusitem
                attributed = NSMutableAttributedString.alloc().initWithString_(title)
                full_range = NSMakeRange(0, len(title))
                percent_range = NSMakeRange(percent_start, len(title) - percent_start)
                attributed.addAttribute_value_range_(NSFontAttributeName, NSFont.menuBarFontOfSize_(0), full_range)
                attributed.addAttribute_value_range_(NSForegroundColorAttributeName, NSColor.labelColor(), full_range)
                attributed.addAttribute_value_range_(NSForegroundColorAttributeName, self.title_color(value), percent_range)
                status_item.setAttributedTitle_(attributed)
            except Exception:
                self.title = title

        def refresh_now(self, _sender=None) -> None:
            self.refresh(force=True)

        def refresh(self, _timer=None, force: bool = False) -> None:
            trading = is_a_share_session()
            self.session.title = "A股时段：交易中" if trading else "A股时段：未开盘"
            if not force and not trading and self.last_snapshot is not None:
                return

            try:
                snapshot = fetch_snapshot()
            except (OSError, urllib.error.URLError, json.JSONDecodeError) as exc:
                self.set_status_title("--")
                self.status.title = f"读取失败：{exc}"
                return

            self.last_snapshot = snapshot
            today_profit = float(snapshot.get("today_profit") or 0)
            today_percent = daily_profit_percent(snapshot, today_profit)
            updated_at = str(snapshot.get("updated_at") or "")
            amount_text = format_cny(today_profit)
            percent_text = format_percent(today_percent)
            title = f"{amount_text}/{percent_text}"
            self.set_status_title(title, title.index("/") + 1, today_profit)
            self.amount_item.title = f"收益金额：{amount_text}"
            self.percent_item.title = f"盈亏比例：{percent_text}"
            self.status.title = f"更新：{updated_at[:19].replace('T', ' ') or '暂无'}"

        def open_holdings_monitor(self, _sender=None) -> None:
            subprocess.Popen(["open", FRONTEND_URL])

    HoldingsMenuApp().run()


if __name__ == "__main__":
    sys.exit(main())
