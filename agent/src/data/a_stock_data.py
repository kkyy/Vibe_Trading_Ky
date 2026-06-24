"""A-share data adapters inspired by simonlin1212/a-stock-data.

This module keeps the public-data calls small and explicit so the Web UI and
agent runtime can use A-share quotes, reports, news, basics, and announcements
without replacing the existing tushare/akshare/mootdx loaders.
"""

from __future__ import annotations

import json
import random
import re
import time
import urllib.request
import uuid
from datetime import datetime
from typing import Any

import requests

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36"
REPORT_API = "https://reportapi.eastmoney.com/report/list"
DATACENTER_URL = "https://datacenter-web.eastmoney.com/api/data/v1/get"

EM_SESSION = requests.Session()
EM_SESSION.headers.update({"User-Agent": UA})
EM_MIN_INTERVAL = 1.0
_em_last_call = [0.0]
_cninfo_orgid_map: dict[str, str] = {}


def normalize_code(code: str) -> str:
    match = re.search(r"\d{6}", code or "")
    if not match:
        raise ValueError("A-share code must contain 6 digits")
    return match.group(0)


def get_prefix(code: str) -> str:
    code = normalize_code(code)
    if code.startswith(("6", "9")):
        return "sh"
    if code.startswith(("8", "4")):
        return "bj"
    return "sz"


def _quote_symbol(code: str) -> tuple[str, str]:
    raw = (code or "").strip().lower()
    market_match = re.match(r"^(sh|sz|bj)\D*(\d{6})$", raw) or re.match(r"^(\d{6})\D*(sh|sz|bj)$", raw)
    if market_match:
        first, second = market_match.groups()
        market, normalized = (first, second) if first in {"sh", "sz", "bj"} else (second, first)
        return f"{market}{normalized}", normalized
    normalized = normalize_code(raw)
    return f"{get_prefix(normalized)}{normalized}", normalized


def _to_float(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return 0.0


def em_get(url: str, params: dict[str, Any] | None = None, headers: dict[str, str] | None = None, timeout: int = 15):
    """Eastmoney request helper with serial throttling, per a-stock-data guidance."""
    wait = EM_MIN_INTERVAL - (time.time() - _em_last_call[0])
    if wait > 0:
        time.sleep(wait + random.uniform(0.1, 0.5))
    try:
        return EM_SESSION.get(url, params=params, headers=headers, timeout=timeout)
    finally:
        _em_last_call[0] = time.time()


def tencent_quote(codes: list[str]) -> dict[str, dict[str, Any]]:
    symbols = [_quote_symbol(code) for code in codes]
    prefixed = [symbol for symbol, _code in symbols]
    url = "https://qt.gtimg.cn/q=" + ",".join(prefixed)
    req = urllib.request.Request(url, headers={"User-Agent": UA})
    with urllib.request.urlopen(req, timeout=10) as resp:
        data = resp.read().decode("gbk", errors="replace")

    result: dict[str, dict[str, Any]] = {}
    for line in data.strip().split(";"):
        if not line.strip() or "=" not in line or '"' not in line:
            continue
        key = line.split("=")[0].split("_")[-1]
        values = line.split('"')[1].split("~")
        if len(values) < 53:
            continue
        code = key[2:]
        result_key = code if code not in result else key.upper()
        result[result_key] = {
            "code": code,
            "market": key[:2],
            "name": values[1],
            "price": _to_float(values[3]),
            "last_close": _to_float(values[4]),
            "open": _to_float(values[5]),
            "change_amt": _to_float(values[31]),
            "change_pct": _to_float(values[32]),
            "high": _to_float(values[33]),
            "low": _to_float(values[34]),
            "amount_wan": _to_float(values[37]),
            "turnover_pct": _to_float(values[38]),
            "pe_ttm": _to_float(values[39]),
            "amplitude_pct": _to_float(values[43]),
            "mcap_yi": _to_float(values[44]),
            "float_mcap_yi": _to_float(values[45]),
            "pb": _to_float(values[46]),
            "limit_up": _to_float(values[47]),
            "limit_down": _to_float(values[48]),
            "vol_ratio": _to_float(values[49]),
            "pe_static": _to_float(values[52]),
        }
    return result


def eastmoney_reports(code: str, max_pages: int = 2) -> list[dict[str, Any]]:
    code = normalize_code(code)
    records: list[dict[str, Any]] = []
    for page in range(1, max_pages + 1):
        params = {
            "industryCode": "*",
            "pageSize": "50",
            "industry": "*",
            "rating": "*",
            "ratingChange": "*",
            "beginTime": "2000-01-01",
            "endTime": "2030-01-01",
            "pageNo": str(page),
            "fields": "",
            "qType": "0",
            "orgCode": "",
            "code": code,
            "rcode": "",
            "p": str(page),
            "pageNum": str(page),
            "pageNumber": str(page),
        }
        response = em_get(REPORT_API, params=params, headers={"Referer": "https://data.eastmoney.com/"}, timeout=30)
        data = response.json()
        rows = data.get("data") or []
        if not rows:
            break
        records.extend(rows)
        if page >= (data.get("TotalPage", 1) or 1):
            break
    return records


def _eastmoney_stock_news_keyword(keyword: str, page_size: int = 20) -> list[dict[str, Any]]:
    callback = "jQuery_news"
    params = {
        "cb": callback,
        "param": json.dumps(
            {
                "uid": "",
                "keyword": keyword,
                "type": ["cmsArticleWebOld"],
                "client": "web",
                "clientType": "web",
                "clientVersion": "curr",
                "param": {
                    "cmsArticleWebOld": {
                        "searchScope": "default",
                        "sort": "default",
                        "pageIndex": 1,
                        "pageSize": page_size,
                        "preTag": "",
                        "postTag": "",
                    }
                },
            },
            separators=(",", ":"),
        ),
    }
    response = em_get(
        "https://search-api-web.eastmoney.com/search/jsonp",
        params=params,
        headers={"User-Agent": UA, "Referer": "https://so.eastmoney.com/"},
        timeout=15,
    )
    text = response.text
    json_text = text[text.index("(") + 1 : text.rindex(")")]
    data = json.loads(json_text)
    rows = []
    for article in data.get("result", {}).get("cmsArticleWebOld", []) or []:
        rows.append(
            {
                "title": re.sub(r"<[^>]+>", "", article.get("title", "")),
                "content": re.sub(r"<[^>]+>", "", article.get("content", ""))[:240],
                "time": article.get("date", ""),
                "source": article.get("mediaName", ""),
                "url": article.get("url", ""),
            }
        )
    return rows


def eastmoney_stock_news(code: str, page_size: int = 20) -> list[dict[str, Any]]:
    code = normalize_code(code)
    rows = _eastmoney_stock_news_keyword(code, page_size=page_size)
    if rows:
        return rows
    name = eastmoney_stock_info(code).get("name")
    rows = _eastmoney_stock_news_keyword(str(name), page_size=page_size) if name else []
    return rows if rows else eastmoney_global_news(page_size=page_size)


def eastmoney_global_news(page_size: int = 50) -> list[dict[str, Any]]:
    params = {
        "client": "web",
        "biz": "web_724",
        "fastColumn": "102",
        "sortEnd": "",
        "pageSize": str(page_size),
        "req_trace": str(uuid.uuid4()),
    }
    response = em_get(
        "https://np-weblist.eastmoney.com/comm/web/getFastNewsList",
        params=params,
        headers={"User-Agent": UA, "Referer": "https://kuaixun.eastmoney.com/"},
        timeout=10,
    )
    data = response.json()
    rows = []
    for item in data.get("data", {}).get("fastNewsList", []) or []:
        rows.append(
            {
                "title": item.get("title", ""),
                "summary": item.get("summary", "")[:240],
                "time": item.get("showTime", ""),
                "source": "东方财富7x24",
                "url": item.get("url", ""),
            }
        )
    return rows


def eastmoney_stock_info(code: str) -> dict[str, Any]:
    code = normalize_code(code)
    market_code = 1 if code.startswith("6") else 0
    params = {
        "fltt": "2",
        "invt": "2",
        "fields": "f57,f58,f84,f85,f127,f116,f117,f189,f43",
        "secid": f"{market_code}.{code}",
    }
    response = em_get("https://push2.eastmoney.com/api/qt/stock/get", params=params, headers={"User-Agent": UA}, timeout=10)
    data = response.json().get("data", {}) or {}
    return {
        "code": data.get("f57", code),
        "name": data.get("f58", ""),
        "industry": data.get("f127", ""),
        "total_shares": data.get("f84", 0),
        "float_shares": data.get("f85", 0),
        "mcap": data.get("f116", 0),
        "float_mcap": data.get("f117", 0),
        "list_date": str(data.get("f189", "")),
        "price": data.get("f43", 0),
    }


def _cninfo_ts_to_date(value: Any) -> str:
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000).strftime("%Y-%m-%d")
    return str(value)[:10] if value else ""


def _cninfo_orgid(code: str) -> str:
    code = normalize_code(code)
    global _cninfo_orgid_map
    if not _cninfo_orgid_map:
        try:
            response = requests.get("http://www.cninfo.com.cn/new/data/szse_stock.json", headers={"User-Agent": UA}, timeout=15)
            _cninfo_orgid_map = {
                stock["code"]: stock["orgId"]
                for stock in response.json().get("stockList", [])
                if stock.get("code") and stock.get("orgId")
            }
        except Exception:
            _cninfo_orgid_map = {}
    org_id = _cninfo_orgid_map.get(code)
    if org_id:
        return org_id
    if code.startswith("6"):
        return f"gssh0{code}"
    if code.startswith(("8", "4")):
        return f"gsbj0{code}"
    return f"gssz0{code}"


def cninfo_announcements(code: str, page_size: int = 20) -> list[dict[str, Any]]:
    code = normalize_code(code)
    org_id = _cninfo_orgid(code)
    payload = {
        "stock": f"{code},{org_id}",
        "tabName": "fulltext",
        "pageSize": str(page_size),
        "pageNum": "1",
        "column": "",
        "category": "",
        "plate": "",
        "seDate": "",
        "searchkey": "",
        "secid": "",
        "sortName": "",
        "sortType": "",
        "isHLtitle": "true",
    }
    headers = {
        "User-Agent": UA,
        "Content-Type": "application/x-www-form-urlencoded",
        "Referer": "https://www.cninfo.com.cn/new/disclosure",
        "Origin": "https://www.cninfo.com.cn",
    }
    response = requests.post("https://www.cninfo.com.cn/new/hisAnnouncement/query", data=payload, headers=headers, timeout=15)
    try:
        data = response.json()
    except ValueError:
        return []
    rows = []
    for item in data.get("announcements", []) or []:
        rows.append(
            {
                "title": item.get("announcementTitle", ""),
                "type": item.get("announcementTypeName", ""),
                "date": _cninfo_ts_to_date(item.get("announcementTime")),
                "url": f"https://www.cninfo.com.cn/new/disclosure/detail?annoId={item.get('announcementId', '')}",
            }
        )
    return rows


def stock_bundle(code: str) -> dict[str, Any]:
    code = normalize_code(code)
    quote = tencent_quote([code]).get(code, {})
    return {
        "code": code,
        "quote": quote,
        "basic": eastmoney_stock_info(code),
        "reports": eastmoney_reports(code, max_pages=1)[:10],
        "news": eastmoney_stock_news(code, page_size=10),
        "announcements": cninfo_announcements(code, page_size=10),
    }
