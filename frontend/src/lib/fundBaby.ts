type FundSuggestItem = {
  CODE: string;
  NAME?: string;
  SHORTNAME?: string;
  CATEGORY?: string | number;
  CATEGORYDESC?: string;
};

export interface FundSearchResult {
  code: string;
  name: string;
}

export interface FundHolding {
  code: string;
  name: string;
  weight: string;
  change: number | null;
}

export interface FundTrendPoint {
  x: number;
  y: number;
  equityReturn?: number;
}

export interface IntradayPoint {
  time: string;
  value: number;
  growth: number;
}

export interface FundSnapshot {
  code: string;
  name: string;
  dwjz: string;
  gsz: string | null;
  gztime: string | null;
  jzrq: string;
  gszzl: number | null;
  zzl?: number | null;
  yesterdayChange?: number | null;
  noValuation?: boolean;
  valuationSource?: string | null;
  dataSource?: number;
  holdings: FundHolding[];
  historyTrend: FundTrendPoint[];
  intraday: IntradayPoint[];
}

declare global {
  interface Window {
    apidata?: { content?: string };
    jsonpgz?: (data: Record<string, string>) => void;
    Data_netWorthTrend?: Array<{ x: number; y: number; equityReturn?: number }>;
    [key: string]: unknown;
  }
}

const SCRIPT_TIMEOUT_MS = 8000;
const VALUATION_SOURCE_CACHE_KEY = "vibe-fund-baby-valuation-source-cache";
const FUND_VALUATION_LAST_FIELDS = "FCODE,SHORTNAME,GSZZL,GZTIME,GSZ,NAV,PDATE";
const FUND_VALUATION_LAST_BATCH_SIZE = 50;
const FUND_VALUATION_LAST_STALE_MS = 10_000;
const FUND_VALUATION_LAST_TIMEOUT_MS = 8_000;
let fixedGlobalScriptQueue = Promise.resolve();
const fundValuationLastCache = new Map<string, { value: ValuationSnapshot; expiresAt: number }>();
const fundValuationLastInflight = new Map<
  string,
  {
    promise: Promise<ValuationSnapshot>;
    resolve: (value: ValuationSnapshot) => void;
    reject: (error: unknown) => void;
  }
>();
const fundValuationLastQueue = new Set<string>();
let fundValuationLastTimeout: number | null = null;

type ValuationSourceId = 1 | 2 | 3;

type ValuationSnapshot = Partial<FundSnapshot> & {
  code: string;
  gsz: string | null;
  gszzl: number | null;
  gztime: string | null;
  valuationSource: string;
  dataSource: ValuationSourceId;
  fundValuationTimeseries?: IntradayPoint[];
};

type ValuationSourceCacheItem = {
  source: ValuationSourceId;
  selectedAt: string;
  auditedDate?: string;
  reason: string;
};

type SinaEstimatePoint = {
  growthrate?: string | number;
  growthrate2?: string | number;
  pre_nav?: string | number;
  pre_nav2?: string | number;
  min_time?: string;
  pre_date?: string;
};

type SinaEstimateResponse = {
  result?: {
    data?: {
      networth?: SinaEstimatePoint[];
    };
  };
};

type FundValuationLastItem = {
  FCODE?: string | number;
  SHORTNAME?: string;
  GSZZL?: string | number | null;
  GZTIME?: string | null;
  GSZ?: string | number | null;
  NAV?: string | number | null;
  PDATE?: string | null;
};

type FundValuationLastResponse = {
  success?: boolean;
  data?: FundValuationLastItem[];
};

type BackendValuationItem = Partial<ValuationSnapshot> & {
  dataSource?: number;
  fundValuationTimeseries?: IntradayPoint[];
};

type BackendValuationResponse = {
  valuations?: BackendValuationItem[];
};

function runWithFixedGlobalScript<T>(task: () => Promise<T>) {
  const run = fixedGlobalScriptQueue.then(task, task);
  fixedGlobalScriptQueue = run.catch(() => undefined).then(() => undefined);
  return run;
}

function loadScript(url: string, timeoutMs = SCRIPT_TIMEOUT_MS) {
  return new Promise<void>((resolve, reject) => {
    const script = document.createElement("script");
    let done = false;
    const cleanup = () => {
      if (script.parentNode) script.parentNode.removeChild(script);
    };
    const finish = (error?: Error) => {
      if (done) return;
      done = true;
      window.setTimeout(cleanup, 0);
      if (error) reject(error);
      else resolve();
    };
    const timer = window.setTimeout(() => finish(new Error("request timeout")), timeoutMs);
    script.src = url;
    script.async = true;
    script.onload = () => {
      window.clearTimeout(timer);
      finish();
    };
    script.onerror = () => {
      window.clearTimeout(timer);
      finish(new Error("script load failed"));
    };
    document.body.appendChild(script);
  });
}

function cleanText(value: string) {
  return value.replace(/<[^>]+>/g, "").replace(/&nbsp;/g, " ").trim();
}

function toFiniteNumber(value: unknown) {
  const number = typeof value === "number" ? value : Number.parseFloat(String(value ?? ""));
  return Number.isFinite(number) ? number : null;
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, "0")}-${String(now.getDate()).padStart(2, "0")}`;
}

function extractDate(value: string | null | undefined) {
  const text = String(value || "");
  const dashed = text.match(/\d{4}[-/]\d{2}[-/]\d{2}/);
  if (dashed) return dashed[0].replace(/\//g, "-");
  const compact = text.match(/\d{8}/);
  if (compact) return `${compact[0].slice(0, 4)}-${compact[0].slice(4, 6)}-${compact[0].slice(6, 8)}`;
  return "";
}

function valuationSourceLabel(source: ValuationSourceId) {
  if (source === 2) return "sina_ds2";
  if (source === 3) return "sina_ds3";
  return "fundgz";
}

function readValuationSourceCache(): Record<string, ValuationSourceCacheItem> {
  try {
    const value = JSON.parse(localStorage.getItem(VALUATION_SOURCE_CACHE_KEY) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function writeValuationSourceCache(code: string, item: ValuationSourceCacheItem) {
  try {
    const cache = readValuationSourceCache();
    cache[code] = item;
    localStorage.setItem(VALUATION_SOURCE_CACHE_KEY, JSON.stringify(cache));
  } catch {
    // localStorage can be unavailable in private or restricted contexts.
  }
}

function stockQuoteCode(code: string) {
  if (/^\d{6}$/.test(code)) {
    if (code.startsWith("6") || code.startsWith("9")) return `s_sh${code}`;
    if (code.startsWith("4") || code.startsWith("8")) return `s_bj${code}`;
    return `s_sz${code}`;
  }
  if (/^\d{5}$/.test(code)) return `s_hk${code}`;
  return null;
}

async function fetchTencentFund(code: string) {
  await loadScript(`https://qt.gtimg.cn/q=jj${code}&_=${Date.now()}`);
  const raw = window[`v_jj${code}`];
  if (typeof raw !== "string") return null;
  const parts = raw.split("~");
  return {
    dwjz: parts[5] || "",
    zzl: Number.parseFloat(parts[7]),
    jzrq: parts[8] ? parts[8].slice(0, 10) : "",
  };
}

function normalizeFundValuationLastItem(item: FundValuationLastItem): ValuationSnapshot | null {
  const code = item.FCODE != null ? String(item.FCODE).trim() : "";
  if (!code) return null;
  const gsz = toFiniteNumber(item.GSZ);
  const gszzl = toFiniteNumber(item.GSZZL);
  const nav = toFiniteNumber(item.NAV);
  return {
    code,
    name: item.SHORTNAME ? String(item.SHORTNAME) : undefined,
    dwjz: nav === null ? "" : String(nav),
    gsz: gsz === null ? null : String(gsz),
    gztime: item.GZTIME ? String(item.GZTIME).replace(/:(\d{2}):\d{2}$/, ":$1") : null,
    jzrq: item.PDATE ? String(item.PDATE) : "",
    gszzl,
    valuationSource: "fundgz",
    dataSource: 1,
  };
}

async function processFundValuationLastQueue() {
  const codes = Array.from(fundValuationLastQueue);
  fundValuationLastQueue.clear();
  fundValuationLastTimeout = null;
  if (!codes.length) return;

  const chunks: string[][] = [];
  for (let index = 0; index < codes.length; index += FUND_VALUATION_LAST_BATCH_SIZE) {
    chunks.push(codes.slice(index, index + FUND_VALUATION_LAST_BATCH_SIZE));
  }

  await Promise.all(
    chunks.map(async (chunk) => {
      const controller = new AbortController();
      const timer = window.setTimeout(() => controller.abort(), FUND_VALUATION_LAST_TIMEOUT_MS);
      try {
        const url = `https://fundcomapi.tiantianfunds.com/mm/newCore/FundValuationLast?FCODES=${encodeURIComponent(
          chunk.join(","),
        )}&FIELDS=${encodeURIComponent(FUND_VALUATION_LAST_FIELDS)}`;
        const response = await fetch(url, { signal: controller.signal });
        window.clearTimeout(timer);
        if (!response.ok) throw new Error(`FundValuationLast HTTP ${response.status}`);
        const result = (await response.json()) as FundValuationLastResponse;
        if (!result?.success) throw new Error("FundValuationLast returned failure");

        const found = new Map<string, ValuationSnapshot>();
        (Array.isArray(result.data) ? result.data : []).forEach((item) => {
          const snapshot = normalizeFundValuationLastItem(item);
          if (!snapshot) return;
          found.set(snapshot.code, snapshot);
          fundValuationLastCache.set(snapshot.code, {
            value: snapshot,
            expiresAt: Date.now() + FUND_VALUATION_LAST_STALE_MS,
          });
        });

        chunk.forEach((code) => {
          const entry = fundValuationLastInflight.get(code);
          if (!entry) return;
          const snapshot = found.get(code);
          if (snapshot) entry.resolve(snapshot);
          else entry.reject(new Error(`FundValuationLast no data for ${code}`));
          fundValuationLastInflight.delete(code);
        });
      } catch (error) {
        window.clearTimeout(timer);
        chunk.forEach((code) => {
          const entry = fundValuationLastInflight.get(code);
          if (!entry) return;
          entry.reject(error);
          fundValuationLastInflight.delete(code);
        });
      }
    }),
  );
}

function fetchFundgzValuation(code: string): Promise<ValuationSnapshot> {
  const cached = fundValuationLastCache.get(code);
  if (cached && cached.expiresAt > Date.now()) return Promise.resolve(cached.value);

  const existing = fundValuationLastInflight.get(code);
  if (existing) return existing.promise;

  let resolveFn!: (value: ValuationSnapshot) => void;
  let rejectFn!: (error: unknown) => void;
  const promise = new Promise<ValuationSnapshot>((resolve, reject) => {
    resolveFn = resolve;
    rejectFn = reject;
  });
  fundValuationLastInflight.set(code, { promise, resolve: resolveFn, reject: rejectFn });
  fundValuationLastQueue.add(code);
  if (fundValuationLastTimeout === null) {
    fundValuationLastTimeout = window.setTimeout(() => {
      void processFundValuationLastQueue();
    }, 0);
  }
  return promise;
}

async function fetchSinaEstimateNetworth(code: string): Promise<SinaEstimateResponse | null> {
  const callbackName = `jsonp_sina_${Date.now()}_${Math.floor(Math.random() * 10000)}`;
  const url = `https://stock.finance.sina.com.cn/fundInfo/api/openapi.php/FdFundService.getEstimateNetworthPic?symbol=${code}&callback=${callbackName}`;
  return new Promise((resolve, reject) => {
    let settled = false;
    const finish = (value: SinaEstimateResponse | null, error?: Error) => {
      if (settled) return;
      settled = true;
      try {
        delete window[callbackName];
      } catch {
        // ignore
      }
      if (timer) window.clearTimeout(timer);
      if (script.parentNode) script.parentNode.removeChild(script);
      if (error) reject(error);
      else resolve(value);
    };

    const script = document.createElement("script");
    const timer = window.setTimeout(() => finish(null), 8000);
    window[callbackName] = (response: SinaEstimateResponse) => finish(response);
    script.src = url;
    script.async = true;
    script.onerror = () => finish(null, new Error("sina script load failed"));
    document.body.appendChild(script);
  });
}

async function fetchSinaValuation(code: string, source: 2 | 3): Promise<ValuationSnapshot> {
  const response = await fetchSinaEstimateNetworth(code);
  const networth = response?.result?.data?.networth;
  if (!Array.isArray(networth) || networth.length === 0) throw new Error("新浪估值没有返回数据");

  const lastPoint = networth[networth.length - 1];
  const navKey = source === 2 ? "pre_nav" : "pre_nav2";
  const growthKey = source === 2 ? "growthrate" : "growthrate2";
  const gsz = toFiniteNumber(lastPoint[navKey]);
  const growthRate = toFiniteNumber(lastPoint[growthKey]);
  const gszzl = growthRate === null ? null : growthRate * 100;
  if (gsz === null && gszzl === null) throw new Error("新浪估值为空");

  const intraday: IntradayPoint[] = [];
  const seen = new Set<string>();
  networth.forEach((point) => {
    const value = toFiniteNumber(point[navKey]);
    const time = point.min_time || "";
    const date = point.pre_date || "";
    if (value === null || !time || !date) return;
    const key = `${date} ${time}`;
    if (seen.has(key)) return;
    seen.add(key);
    intraday.push({
      time: time.slice(0, 5),
      value,
      growth: gszzl ?? 0,
    });
  });

  return {
    code,
    gsz: gsz === null ? null : String(gsz),
    gztime: lastPoint.min_time ? `${lastPoint.pre_date || ""} ${lastPoint.min_time}`.trim() : null,
    gszzl,
    valuationSource: valuationSourceLabel(source),
    dataSource: source,
    fundValuationTimeseries: intraday,
  };
}

async function fetchValuationBySource(code: string, source: ValuationSourceId): Promise<ValuationSnapshot> {
  if (source === 2 || source === 3) return fetchSinaValuation(code, source);
  return fetchFundgzValuation(code);
}

function normalizeBackendValuation(code: string, item: BackendValuationItem): ValuationSnapshot {
  const source = item.dataSource === 2 || item.dataSource === 3 ? item.dataSource : 1;
  const gszzl = toFiniteNumber(item.gszzl);
  const gsz = toFiniteNumber(item.gsz);
  const dwjz = toFiniteNumber(item.dwjz);
  return {
    ...item,
    code: String(item.code || code),
    name: item.name ? String(item.name) : undefined,
    dwjz: dwjz === null ? String(item.dwjz || "") : String(dwjz),
    gsz: gsz === null ? null : String(gsz),
    gztime: item.gztime ? String(item.gztime) : null,
    jzrq: item.jzrq ? String(item.jzrq) : "",
    gszzl,
    valuationSource: item.valuationSource ? String(item.valuationSource) : valuationSourceLabel(source),
    dataSource: source,
    fundValuationTimeseries: Array.isArray(item.fundValuationTimeseries) ? item.fundValuationTimeseries : undefined,
  } satisfies ValuationSnapshot;
}

async function fetchBackendValuationSources(code: string) {
  try {
    const response = await fetch(`/fund-valuation/${encodeURIComponent(code)}`);
    if (!response.ok) return [];
    const payload = (await response.json()) as BackendValuationResponse;
    return (Array.isArray(payload.valuations) ? payload.valuations : [])
      .map((item) => normalizeBackendValuation(code, item))
      .filter((item): item is ValuationSnapshot =>
        Boolean(item && (item.gsz || item.gszzl !== null || item.dwjz || item.jzrq)),
      );
  } catch {
    return [];
  }
}

async function fetchAllValuationSources(code: string) {
  const backendValuations = await fetchBackendValuationSources(code);
  if (backendValuations.some((item) => item.gsz || item.gszzl !== null)) {
    return backendValuations;
  }

  const sources: ValuationSourceId[] = [1, 2, 3];
  const results = await Promise.allSettled(sources.map((source) => fetchValuationBySource(code, source)));
  return results
    .map((result) => (result.status === "fulfilled" ? result.value : null))
    .filter(
      (item): item is ValuationSnapshot =>
        Boolean(item && (item.gsz || item.gszzl !== null || item.dwjz || item.jzrq)),
    );
}

function chooseBestValuationSource(
  code: string,
  valuations: ValuationSnapshot[],
  actual: Awaited<ReturnType<typeof fetchTencentFund>>,
) {
  if (!valuations.length) return null;

  const actualChange = actual?.zzl;
  const actualDate = actual?.jzrq || "";
  const auditable = valuations.filter(
    (item) =>
      item.gszzl !== null &&
      Number.isFinite(item.gszzl) &&
      Number.isFinite(actualChange) &&
      actualDate &&
      extractDate(item.gztime || item.jzrq || actualDate) === actualDate,
  );

  if (auditable.length > 0 && Number.isFinite(actualChange)) {
    const referenceChange = actualChange as number;
    const selected = [...auditable].sort(
      (left, right) =>
        Math.abs((left.gszzl ?? 0) - referenceChange) - Math.abs((right.gszzl ?? 0) - referenceChange),
    )[0];
    writeValuationSourceCache(code, {
      source: selected.dataSource,
      selectedAt: todayKey(),
      auditedDate: actualDate,
      reason: "actual-nav-diff",
    });
    return selected;
  }

  const cached = readValuationSourceCache()[code];
  if (cached?.source) {
    const selected = valuations.find((item) => item.dataSource === cached.source);
    if (selected) {
      writeValuationSourceCache(code, { ...cached, selectedAt: todayKey(), reason: "cached-best" });
      return selected;
    }
  }

  const selected = [...valuations].sort((left, right) => {
    const leftScore = (left.gsz ? 2 : 0) + (left.gszzl !== null ? 1 : 0);
    const rightScore = (right.gsz ? 2 : 0) + (right.gszzl !== null ? 1 : 0);
    if (leftScore !== rightScore) return rightScore - leftScore;
    const leftDate = extractDate(left.gztime || left.jzrq || "");
    const rightDate = extractDate(right.gztime || right.jzrq || "");
    if (leftDate !== rightDate) return rightDate.localeCompare(leftDate);
    return left.dataSource - right.dataSource;
  })[0];
  writeValuationSourceCache(code, {
    source: selected.dataSource,
    selectedAt: todayKey(),
    reason: "fresh-valid-source",
  });
  return selected;
}

async function fetchHoldings(code: string): Promise<FundHolding[]> {
  return runWithFixedGlobalScript(async () => {
    window.apidata = undefined;
    await loadScript(
      `https://fundf10.eastmoney.com/FundArchivesDatas.aspx?type=jjcc&code=${code}&topline=10&year=&month=&_=${Date.now()}`,
    );
    const apiData = window.apidata as { content?: string } | undefined;
    const html = apiData?.content || "";
    const rows: string[] = (html.match(/<tr[\s\S]*?<\/tr>/gi) || []).slice(1);
    const holdings = rows
      .map((row): FundHolding => {
        const cells: string[] = (row.match(/<td[\s\S]*?<\/td>/gi) || []).map(cleanText);
        const stockCode = cells.find((cell) => /^\d{5,6}$/.test(cell)) || "";
        const weight = cells.find((cell) => /\d+(?:\.\d+)?\s*%/.test(cell)) || "";
        const name = cells.find((cell) => cell && cell !== stockCode && cell !== weight && !/^\d+$/.test(cell)) || "";
        return { code: stockCode, name, weight, change: null };
      })
      .filter((item) => Boolean(item.code || item.name || item.weight))
      .slice(0, 10);

    const quoteCodes = holdings.map((item) => stockQuoteCode(item.code)).filter(Boolean).join(",");
    if (!quoteCodes) return holdings;
    await loadScript(`https://qt.gtimg.cn/q=${quoteCodes}&_=${Date.now()}`, 5000).catch(() => undefined);
    holdings.forEach((item) => {
      const quoteCode = stockQuoteCode(item.code);
      const raw = quoteCode ? window[`v_${quoteCode}`] : null;
      if (typeof raw === "string") {
        const change = Number.parseFloat(raw.split("~")[5]);
        item.change = Number.isFinite(change) ? change : null;
      }
    });
    return holdings;
  }).catch(() => []);
}

async function fetchTrend(code: string) {
  return runWithFixedGlobalScript(async () => {
    window.Data_netWorthTrend = undefined;
    await loadScript(`https://fund.eastmoney.com/pingzhongdata/${code}.js?v=${Date.now()}`);
    const trend: FundTrendPoint[] = Array.isArray(window.Data_netWorthTrend) ? window.Data_netWorthTrend : [];
    const sliced = trend.slice(-90).map((item) => ({
      x: item.x,
      y: item.y,
      equityReturn: item.equityReturn,
    }));
    const previous = sliced[sliced.length - 2];
    return {
      historyTrend: sliced,
      yesterdayChange: typeof previous?.equityReturn === "number" ? previous.equityReturn : null,
    };
  }).catch(() => ({ historyTrend: [], yesterdayChange: null }));
}

async function fetchIntraday(code: string): Promise<IntradayPoint[]> {
  try {
    const response = await fetch(
      `https://web.ifzq.gtimg.cn/fund/newfund/fundSsgz/getSsgz?app=web&symbol=jj${code}&_=${Date.now()}`,
    );
    if (!response.ok) return [];
    const result = await response.json();
    const list = result?.data?.data;
    const yesterdayDwjz = Number.parseFloat(result?.data?.yesterdayDwjz);
    if (!Array.isArray(list) || !yesterdayDwjz) return [];
    return list.map((item: [string, number]) => {
      const time = String(item[0]);
      const value = Number(item[1]);
      return {
        time: `${time.slice(0, 2)}:${time.slice(2)}`,
        value,
        growth: Number((((value - yesterdayDwjz) / yesterdayDwjz) * 100).toFixed(2)),
      };
    });
  } catch {
    return [];
  }
}

async function fetchFallback(code: string): Promise<FundSnapshot> {
  const tencent = await fetchTencentFund(code);
  if (!tencent?.dwjz) throw new Error("未能获取基金数据");
  return {
    code,
    name: `基金 ${code}`,
    dwjz: tencent.dwjz,
    gsz: null,
    gztime: null,
    jzrq: tencent.jzrq,
    gszzl: null,
    zzl: Number.isFinite(tencent.zzl) ? tencent.zzl : null,
    noValuation: true,
    holdings: [],
    historyTrend: [],
    intraday: [],
  };
}

export async function searchFunds(keyword: string): Promise<FundSearchResult[]> {
  const value = keyword.trim();
  if (!value) return [];
  const callbackName = `SuggestData_${Date.now()}`;
  const url = `https://fundsuggest.eastmoney.com/FundSearch/api/FundSearchAPI.ashx?m=1&key=${encodeURIComponent(value)}&callback=${callbackName}&_=${Date.now()}`;
  return new Promise((resolve) => {
    let settled = false;
    const finish = (items: FundSearchResult[]) => {
      if (settled) return;
      settled = true;
      delete window[callbackName];
      resolve(items);
    };
    window[callbackName] = (data: { Datas?: FundSuggestItem[] }) => {
      const results = (data?.Datas || [])
        .filter((item) => item.CATEGORY === 700 || item.CATEGORY === "700" || item.CATEGORYDESC === "基金")
        .slice(0, 8)
        .map((item) => ({ code: item.CODE, name: item.NAME || item.SHORTNAME || item.CODE }));
      finish(results);
    };
    loadScript(url, 5000).catch(() => finish([]));
    window.setTimeout(() => finish([]), 5500);
  });
}

export async function fetchFundSnapshot(code: string): Promise<FundSnapshot> {
  const normalized = code.trim();
  if (!/^\d{6}$/.test(normalized)) throw new Error("请输入 6 位基金代码");

  const [valuations, tencent, holdings, trend, tencentIntraday] = await Promise.all([
    fetchAllValuationSources(normalized),
    fetchTencentFund(normalized).catch(() => null),
    fetchHoldings(normalized),
    fetchTrend(normalized),
    fetchIntraday(normalized),
  ]);

  let base: Partial<FundSnapshot> & { fundValuationTimeseries?: IntradayPoint[] } =
    chooseBestValuationSource(normalized, valuations, tencent) || {};

  if (!base.gsz && !base.gszzl && !tencent?.dwjz) {
    return fetchFallback(normalized);
  }

  if (tencent?.jzrq && (!base.jzrq || tencent.jzrq >= base.jzrq)) {
    base.dwjz = tencent.dwjz || base.dwjz;
    base.jzrq = tencent.jzrq;
    base.zzl = Number.isFinite(tencent.zzl) ? tencent.zzl : null;
  }

  if (!base.gsz && base.gszzl !== null && base.gszzl !== undefined && base.dwjz) {
    const nav = toFiniteNumber(base.dwjz);
    const change = toFiniteNumber(base.gszzl);
    if (nav !== null && change !== null) {
      base.gsz = String(Number((nav * (1 + change / 100)).toFixed(4)));
    }
  }

  return {
    code: normalized,
    name: base.name || `基金 ${normalized}`,
    dwjz: base.dwjz || "",
    gsz: base.gsz || null,
    gztime: base.gztime || null,
    jzrq: base.jzrq || "",
    gszzl: base.gszzl ?? null,
    zzl: base.zzl ?? null,
    valuationSource: base.valuationSource || null,
    dataSource: base.dataSource,
    holdings,
    historyTrend: trend.historyTrend,
    yesterdayChange: trend.yesterdayChange,
    intraday: base.fundValuationTimeseries?.length ? base.fundValuationTimeseries : tencentIntraday,
  };
}
