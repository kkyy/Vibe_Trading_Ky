import { FormEvent, useEffect, useMemo, useState } from "react";
import { Loader2, Plus, RefreshCw, Trash2, X } from "lucide-react";
import { api, type AStockQuote, type YFinanceQuote } from "@/lib/api";
import { cn } from "@/lib/utils";

type MarketSide = "cn" | "us";

type BoardQuote = {
  id: string;
  label: string;
  code: string;
  price: number;
  change: number;
  changePct: number;
  peTtm?: number;
  marketCapYi?: number;
  currency?: string;
};

type WatchItem = {
  code: string;
  label?: string;
};

const CN_WATCH_KEY = "vibe-home-cn-watchlist";
const US_WATCH_KEY = "vibe-home-us-watchlist";

const CN_INDEXES: WatchItem[] = [
  { code: "SH000001", label: "上证指数" },
  { code: "SH000300", label: "沪深300" },
  { code: "SZ399006", label: "创业板指" },
  { code: "SH000688", label: "科创50" },
];

const US_INDEXES: WatchItem[] = [
  { code: "^IXIC", label: "纳斯达克" },
  { code: "^GSPC", label: "标普500" },
];

const DEFAULT_CN_WATCH: WatchItem[] = [
  { code: "600519", label: "贵州茅台" },
  { code: "300750", label: "宁德时代" },
  { code: "000001", label: "平安银行" },
];

const DEFAULT_US_WATCH: WatchItem[] = [
  { code: "AAPL", label: "Apple" },
  { code: "NVDA", label: "NVIDIA" },
  { code: "MSFT", label: "Microsoft" },
];

const CN_NAME_ALIASES: Record<string, string> = {
  上证: "SH000001",
  上证指数: "SH000001",
  沪深300: "SH000300",
  创业板: "SZ399006",
  创业板指: "SZ399006",
  科创板: "SH000688",
  科创50: "SH000688",
  贵州茅台: "600519",
  茅台: "600519",
  宁德时代: "300750",
  平安银行: "000001",
  比亚迪: "002594",
  招商银行: "600036",
};

const US_NAME_ALIASES: Record<string, string> = {
  apple: "AAPL",
  苹果: "AAPL",
  microsoft: "MSFT",
  微软: "MSFT",
  nvidia: "NVDA",
  英伟达: "NVDA",
  tesla: "TSLA",
  特斯拉: "TSLA",
  amazon: "AMZN",
  亚马逊: "AMZN",
  google: "GOOGL",
  alphabet: "GOOGL",
  meta: "META",
  facebook: "META",
  nasdaq: "^IXIC",
  纳斯达克: "^IXIC",
  "s&p": "^GSPC",
  sp500: "^GSPC",
  标普: "^GSPC",
  标普500: "^GSPC",
};

function loadWatchlist(key: string, fallback: WatchItem[]) {
  try {
    const saved = window.localStorage.getItem(key);
    if (!saved) return fallback;
    const parsed = JSON.parse(saved);
    if (!Array.isArray(parsed)) return fallback;
    return parsed.filter((item) => item?.code).map((item) => ({ code: String(item.code), label: item.label ? String(item.label) : undefined }));
  } catch {
    return fallback;
  }
}

function saveWatchlist(key: string, items: WatchItem[]) {
  window.localStorage.setItem(key, JSON.stringify(items));
}

function normalizeCnInput(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  const alias = CN_NAME_ALIASES[raw];
  if (alias) return alias;
  const upper = raw.toUpperCase();
  const suffixMatch = upper.match(/^(\d{6})\.(SH|SZ|BJ)$/);
  if (suffixMatch) return `${suffixMatch[2]}${suffixMatch[1]}`;
  const prefixMatch = upper.match(/^(SH|SZ|BJ)(\d{6})$/);
  if (prefixMatch) return `${prefixMatch[1]}${prefixMatch[2]}`;
  const digitMatch = raw.match(/\d{6}/);
  return digitMatch?.[0] ?? raw;
}

function normalizeUsInput(input: string) {
  const raw = input.trim();
  if (!raw) return "";
  const alias = US_NAME_ALIASES[raw.toLowerCase()] || US_NAME_ALIASES[raw];
  return (alias || raw).toUpperCase().replace(/\.US$/, "");
}

function quoteTone(value: number) {
  if (value > 0) return "text-danger";
  if (value < 0) return "text-success";
  return "text-muted-foreground";
}

function formatNumber(value: number, digits = 2) {
  if (!Number.isFinite(value) || value === 0) return "--";
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function formatChange(value: number, pct: number) {
  if (!Number.isFinite(pct)) return "--";
  const sign = value > 0 ? "+" : "";
  return `${sign}${formatNumber(value)} (${sign}${pct.toFixed(2)}%)`;
}

function formatCompactMetric(value?: number, digits = 2) {
  if (!value || !Number.isFinite(value)) return "--";
  return value.toLocaleString(undefined, { minimumFractionDigits: digits, maximumFractionDigits: digits });
}

function fromAQuote(quote: AStockQuote, label?: string): BoardQuote {
  return {
    id: `${quote.market}${quote.code}`.toUpperCase(),
    label: label || quote.name || quote.code,
    code: `${quote.market.toUpperCase()}${quote.code}`,
    price: quote.price,
    change: quote.change_amt,
    changePct: quote.change_pct,
    peTtm: quote.pe_ttm,
    marketCapYi: quote.mcap_yi,
  };
}

function fromYQuote(quote: YFinanceQuote, label?: string): BoardQuote {
  return {
    id: quote.symbol,
    label: label || quote.name || quote.symbol,
    code: quote.symbol,
    price: quote.price,
    change: quote.change,
    changePct: quote.change_pct,
    peTtm: quote.pe_ttm,
    marketCapYi: quote.market_cap_yi,
    currency: quote.currency,
  };
}

export function Home() {
  const [cnWatch, setCnWatch] = useState<WatchItem[]>(() => loadWatchlist(CN_WATCH_KEY, DEFAULT_CN_WATCH));
  const [usWatch, setUsWatch] = useState<WatchItem[]>(() => loadWatchlist(US_WATCH_KEY, DEFAULT_US_WATCH));
  const [cnQuotes, setCnQuotes] = useState<Record<string, BoardQuote>>({});
  const [usQuotes, setUsQuotes] = useState<Record<string, BoardQuote>>({});
  const [indexQuotes, setIndexQuotes] = useState<Record<string, BoardQuote>>({});
  const [adding, setAdding] = useState<MarketSide | null>(null);
  const [draft, setDraft] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [updatedAt, setUpdatedAt] = useState("");

  const cnAll = useMemo(() => [...CN_INDEXES, ...cnWatch], [cnWatch]);
  const usAll = useMemo(() => [...US_INDEXES, ...usWatch], [usWatch]);

  async function refresh() {
    setLoading(true);
    setError("");
    let hadError = false;
    try {
      const cnData = await api.getAStockQuote(cnAll.map((item) => item.code));
      const nextIndexes: Record<string, BoardQuote> = {};
      const nextCn: Record<string, BoardQuote> = {};
      const cnLabels = new Map(cnAll.map((item) => [normalizeCnInput(item.code).toUpperCase(), item.label]));
      Object.values(cnData.quotes).forEach((quote) => {
        const fullCode = `${quote.market}${quote.code}`.toUpperCase();
        const label = cnLabels.get(fullCode) || cnLabels.get(quote.code);
        const boardQuote = fromAQuote(quote, label);
        const isIndex = CN_INDEXES.some((item) => normalizeCnInput(item.code).toUpperCase() === fullCode);
        if (isIndex) nextIndexes[boardQuote.id] = boardQuote;
        else {
          nextCn[fullCode] = boardQuote;
          nextCn[quote.code] = boardQuote;
        }
      });
      setIndexQuotes(nextIndexes);
      setCnQuotes(nextCn);
      setUpdatedAt(new Date().toLocaleTimeString());
    } catch (err) {
      hadError = true;
      setError(err instanceof Error ? err.message : "A股行情刷新失败");
    }

    api.getYFinanceQuote(usAll.map((item) => item.code)).then((usData) => {
      const nextUsIndexes: Record<string, BoardQuote> = {};
      const nextUs: Record<string, BoardQuote> = {};
      const usLabels = new Map(usAll.map((item) => [normalizeUsInput(item.code), item.label]));
      Object.values(usData.quotes).forEach((quote) => {
        const boardQuote = fromYQuote(quote, usLabels.get(quote.symbol));
        const isIndex = US_INDEXES.some((item) => normalizeUsInput(item.code) === quote.symbol);
        if (isIndex) nextUsIndexes[boardQuote.id] = boardQuote;
        else nextUs[quote.symbol] = boardQuote;
      });
      setIndexQuotes((current) => ({ ...current, ...nextUsIndexes }));
      setUsQuotes(nextUs);
      setUpdatedAt(new Date().toLocaleTimeString());
      setError((current) => (current === "美股行情刷新失败" ? "" : current));
    }).catch((err) => {
      hadError = true;
      setError(err instanceof Error ? err.message : "美股行情刷新失败");
    });

    if (!hadError) {
      setError("");
    }
    setLoading(false);
  }

  useEffect(() => saveWatchlist(CN_WATCH_KEY, cnWatch), [cnWatch]);
  useEffect(() => saveWatchlist(US_WATCH_KEY, usWatch), [usWatch]);
  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cnWatch, usWatch]);

  function addWatch(side: MarketSide, input: string) {
    const normalized = side === "cn" ? normalizeCnInput(input) : normalizeUsInput(input);
    if (!normalized) return;
    const setter = side === "cn" ? setCnWatch : setUsWatch;
    setter((items) => {
      if (items.some((item) => item.code.toUpperCase() === normalized.toUpperCase())) return items;
      return [{ code: normalized, label: input.trim() }, ...items];
    });
    setDraft("");
    setAdding(null);
  }

  function removeWatch(side: MarketSide, code: string) {
    if (side === "cn") setCnWatch((items) => items.filter((item) => item.code !== code));
    else setUsWatch((items) => items.filter((item) => item.code !== code));
  }

  return (
    <div className="min-h-screen bg-background p-4 pb-24 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-7xl space-y-5">
        <header className="flex flex-wrap items-end justify-between gap-3">
          <div>
            <p className="text-sm text-muted-foreground">Home · 市场总览</p>
            <h1 className="mt-1 text-2xl font-semibold tracking-tight">行情看板</h1>
          </div>
          <div className="text-right text-xs text-muted-foreground">
            <p>数据源：A股 a-stock-data，美股 yfinance</p>
            <p>{updatedAt ? `最后更新 ${updatedAt}` : "等待刷新"}</p>
          </div>
        </header>

        {error && <div className="rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div>}

        <section className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-6">
          {[...CN_INDEXES, ...US_INDEXES].map((item) => {
            const quote = indexQuotes[normalizeCnInput(item.code).toUpperCase()] || indexQuotes[normalizeUsInput(item.code)] || Object.values(indexQuotes).find((q) => q.label === item.label);
            return <QuoteCard key={item.code} fallback={item} quote={quote} compact />;
          })}
        </section>

        <section className="grid grid-cols-1 gap-4 lg:grid-cols-2">
          <WatchColumn
            title="A股自选"
            subtitle="a-stock-data 实时行情"
            side="cn"
            items={cnWatch}
            quotes={cnQuotes}
            onAdd={() => setAdding("cn")}
            onRemove={(code) => removeWatch("cn", code)}
          />
          <WatchColumn
            title="美股自选"
            subtitle="yfinance 行情"
            side="us"
            items={usWatch}
            quotes={usQuotes}
            onAdd={() => setAdding("us")}
            onRemove={(code) => removeWatch("us", code)}
          />
        </section>
      </div>

      <button
        onClick={refresh}
        disabled={loading}
        className="fixed bottom-6 right-6 inline-flex h-12 items-center gap-2 rounded-full bg-primary px-5 text-sm font-medium text-primary-foreground shadow-lg transition hover:opacity-90 disabled:opacity-70"
      >
        {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
        刷新
      </button>

      {adding && (
        <div className="fixed inset-0 z-40 flex items-center justify-center bg-background/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={(event: FormEvent) => {
              event.preventDefault();
              addWatch(adding, draft);
            }}
            className="w-full max-w-sm rounded-lg border bg-card p-4 shadow-xl"
          >
            <div className="flex items-center justify-between gap-3">
              <div>
                <h2 className="font-semibold">添加{adding === "cn" ? "A股" : "美股"}自选</h2>
                <p className="mt-1 text-xs text-muted-foreground">输入代码或常见名称</p>
              </div>
              <button type="button" onClick={() => setAdding(null)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground">
                <X className="h-4 w-4" />
              </button>
            </div>
            <input
              autoFocus
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder={adding === "cn" ? "600519 或 贵州茅台" : "AAPL 或 Apple"}
              className="mt-4 w-full rounded-md border bg-background px-3 py-2 text-sm outline-none focus:border-primary"
            />
            <button type="submit" className="mt-4 w-full rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:opacity-90">
              添加
            </button>
          </form>
        </div>
      )}
    </div>
  );
}

function QuoteCard({ fallback, quote, compact = false }: { fallback: WatchItem; quote?: BoardQuote; compact?: boolean }) {
  const label = quote?.label || fallback.label || fallback.code;
  const code = quote?.code || fallback.code;
  const change = quote?.change ?? 0;
  const changePct = quote?.changePct ?? 0;
  return (
    <article className={cn("rounded-lg border bg-card shadow-sm", compact ? "p-3" : "p-4")}>
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <h2 className={cn("truncate font-semibold", compact ? "text-sm" : "text-base")}>{label}</h2>
          <p className="mt-1 truncate text-xs text-muted-foreground">{code}</p>
        </div>
        {quote?.currency && <span className="rounded border px-1.5 py-0.5 text-[10px] text-muted-foreground">{quote.currency}</span>}
      </div>
      <div className={cn("mt-4 tabular-nums", compact && "mt-3")}>
        <p className={cn("font-semibold", compact ? "text-xl" : "text-2xl")}>{quote ? formatNumber(quote.price) : "--"}</p>
        <p className={cn("mt-1 text-sm font-medium", quoteTone(changePct))}>{quote ? formatChange(change, changePct) : "加载中"}</p>
      </div>
    </article>
  );
}

function WatchColumn({
  title,
  subtitle,
  side,
  items,
  quotes,
  onAdd,
  onRemove,
}: {
  title: string;
  subtitle: string;
  side: MarketSide;
  items: WatchItem[];
  quotes: Record<string, BoardQuote>;
  onAdd: () => void;
  onRemove: (code: string) => void;
}) {
  return (
    <section className="rounded-lg border bg-card p-4 shadow-sm">
      <div className="mb-4 flex items-center justify-between gap-3">
        <div>
          <h2 className="text-lg font-semibold">{title}</h2>
          <p className="mt-1 text-xs text-muted-foreground">{subtitle}</p>
        </div>
        <button onClick={onAdd} className="inline-flex items-center gap-1 rounded-md border px-3 py-2 text-sm font-medium hover:bg-muted">
          <Plus className="h-4 w-4" />
          添加
        </button>
      </div>
      <div className="space-y-2">
        {items.map((item) => {
          const key = side === "cn" ? normalizeCnInput(item.code).toUpperCase() : normalizeUsInput(item.code);
          const quote = quotes[key] || quotes[item.code.toUpperCase()];
          return (
            <div key={item.code} className="grid grid-cols-[minmax(0,1.35fr)_minmax(118px,auto)_72px_84px_auto] items-center gap-3 rounded-md border bg-background/40 px-3 py-2 max-sm:grid-cols-[minmax(0,1fr)_auto]">
              <div className="min-w-0">
                <p className="truncate text-sm font-medium">{quote?.label || item.label || item.code}</p>
                <p className="mt-0.5 text-xs text-muted-foreground">{quote?.code || item.code}</p>
              </div>
              <div className="text-right tabular-nums">
                <p className="text-sm font-semibold">{quote ? formatNumber(quote.price) : "--"}</p>
                <p className={cn("text-xs font-medium", quoteTone(quote?.changePct ?? 0))}>{quote ? formatChange(quote.change, quote.changePct) : "加载中"}</p>
              </div>
              <div className="text-right tabular-nums max-sm:col-start-1 max-sm:text-left">
                <p className="text-[10px] text-muted-foreground">PE</p>
                <p className="text-xs font-medium">{quote ? formatCompactMetric(quote.peTtm) : "--"}</p>
              </div>
              <div className="text-right tabular-nums max-sm:text-left">
                <p className="text-[10px] text-muted-foreground">市值(亿)</p>
                <p className="text-xs font-medium">{quote ? formatCompactMetric(quote.marketCapYi) : "--"}</p>
              </div>
              <button onClick={() => onRemove(item.code)} className="rounded-md p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger" title="删除">
                <Trash2 className="h-4 w-4" />
              </button>
            </div>
          );
        })}
      </div>
    </section>
  );
}
