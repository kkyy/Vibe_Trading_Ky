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
let fixedGlobalScriptQueue = Promise.resolve();

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

  const gzPromise = runWithFixedGlobalScript(() => {
    const originalJsonpgz = window.jsonpgz;
    return new Promise<Partial<FundSnapshot>>((resolve, reject) => {
      window.jsonpgz = (json) => {
        window.jsonpgz = originalJsonpgz;
        if (!json || typeof json !== "object") {
          reject(new Error("估值接口没有返回数据"));
          return;
        }
        if (json.fundcode && String(json.fundcode) !== normalized) {
          reject(new Error("估值接口返回了错误的基金代码"));
          return;
        }
        const gszzl = Number.parseFloat(String(json.gszzl));
        resolve({
          code: String(json.fundcode || normalized),
          name: String(json.name || `基金 ${normalized}`),
          dwjz: String(json.dwjz || ""),
          gsz: json.gsz ? String(json.gsz) : null,
          gztime: json.gztime ? String(json.gztime) : null,
          jzrq: String(json.jzrq || ""),
          gszzl: Number.isFinite(gszzl) ? gszzl : null,
        });
      };
      loadScript(`https://fundgz.1234567.com.cn/js/${normalized}.js?rt=${Date.now()}`, 6000).catch((error) => {
        window.jsonpgz = originalJsonpgz;
        reject(error);
      });
    });
  });

  let base: Partial<FundSnapshot>;
  try {
    base = await gzPromise;
  } catch {
    return fetchFallback(normalized);
  }

  const [tencent, holdings, trend, intraday] = await Promise.all([
    fetchTencentFund(normalized).catch(() => null),
    fetchHoldings(normalized),
    fetchTrend(normalized),
    fetchIntraday(normalized),
  ]);

  if (tencent?.jzrq && (!base.jzrq || tencent.jzrq >= base.jzrq)) {
    base.dwjz = tencent.dwjz || base.dwjz;
    base.jzrq = tencent.jzrq;
    base.zzl = Number.isFinite(tencent.zzl) ? tencent.zzl : null;
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
    holdings,
    historyTrend: trend.historyTrend,
    yesterdayChange: trend.yesterdayChange,
    intraday,
  };
}
