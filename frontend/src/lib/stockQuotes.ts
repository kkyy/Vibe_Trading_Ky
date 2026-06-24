export type StockMarket = "HK" | "US";

export interface StockQuote {
  id: string;
  market: StockMarket;
  symbol: string;
  quoteCode: string;
  name: string;
  price: number;
  previousClose: number;
  change: number | null;
  changePercent: number | null;
  currency: string;
  time: string;
}

declare global {
  interface Window {
    [key: string]: unknown;
  }
}

function loadScript(url: string, timeoutMs = 8000) {
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

function numberAt(parts: string[], index: number) {
  const value = Number.parseFloat(parts[index] || "");
  return Number.isFinite(value) ? value : 0;
}

function normalizeStockSymbol(symbol: string, market: StockMarket) {
  const raw = symbol.trim().replace(/^hk/i, "").replace(/^us/i, "");
  if (market === "HK") return raw.replace(/\D/g, "").padStart(5, "0").slice(-5);
  return raw.replace(/[^A-Za-z.]/g, "").toUpperCase();
}

export function stockId(market: StockMarket, symbol: string) {
  return `${market}:${normalizeStockSymbol(symbol, market)}`;
}

export function quoteCodeForStock(market: StockMarket, symbol: string) {
  const normalized = normalizeStockSymbol(symbol, market);
  return market === "HK" ? `hk${normalized}` : `us${normalized}`;
}

export async function fetchStockQuote(market: StockMarket, symbol: string): Promise<StockQuote> {
  const normalized = normalizeStockSymbol(symbol, market);
  if (!normalized) throw new Error("请输入股票代码");
  const quoteCode = quoteCodeForStock(market, normalized);
  await loadScript(`https://qt.gtimg.cn/q=${quoteCode}&_=${Date.now()}`);
  const raw = window[`v_${quoteCode}`];
  if (typeof raw !== "string" || !raw) throw new Error("未能获取股票行情");
  const parts = raw.split("~");
  const price = numberAt(parts, 3);
  const previousClose = numberAt(parts, 4);
  const change = numberAt(parts, 31);
  const changePercent = numberAt(parts, 32);
  const currency = parts.find((part) => part === "HKD" || part === "USD") || (market === "HK" ? "HKD" : "USD");
  return {
    id: stockId(market, normalized),
    market,
    symbol: normalized,
    quoteCode,
    name: parts[1] || normalized,
    price,
    previousClose,
    change: Number.isFinite(change) ? change : null,
    changePercent: Number.isFinite(changePercent) ? changePercent : null,
    currency,
    time: parts.find((part) => /\d{4}[-/]\d{2}[-/]\d{2}/.test(part)) || "",
  };
}
