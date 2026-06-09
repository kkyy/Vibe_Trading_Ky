import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Activity,
  AlertCircle,
  BarChart3,
  ExternalLink,
  Loader2,
  RefreshCw,
  TrendingDown,
  TrendingUp,
} from "lucide-react";
import { ProbabilityTrend, type ProbabilityTrendPoint } from "@/components/charts/ProbabilityTrend";
import { useLanguage } from "@/hooks/useLanguage";

type SourceName = "polymarket" | "kalshi";

interface PulseMarket {
  source: SourceName;
  topic: string;
  question: string;
  question_zh?: string | null;
  prob_yes: number | null;
  prices?: Array<number | null>;
  change_24h: number | null;
  change_7d?: number | null;
  volume: number | null;
  volume_24h: number | null;
  liquidity: number | null;
  end_date?: string | null;
  slug?: string | null;
  series_ticker?: string | null;
  token_id_yes?: string | null;
  pick_label?: string | null;
}

interface PulseGroup {
  key: string;
  label: string;
  zh_label: string;
  market_count: number;
  volume_24h: number;
  source_counts: Record<string, number>;
  markets: PulseMarket[];
}

interface PulseOverview {
  as_of: string;
  updating: boolean;
  modules: PulseGroup[];
  source_errors?: Record<string, string>;
}

async function requestJson<T>(url: string): Promise<T> {
  const response = await fetch(url, { headers: { Accept: "application/json" } });
  if (!response.ok) throw new Error(await response.text());
  return response.json() as Promise<T>;
}

function pct(value: number | null | undefined, fallback = "N/A") {
  if (value === null || value === undefined || Number.isNaN(value)) return fallback;
  return `${Math.round(value * 100)}%`;
}

function money(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "N/A";
  if (value >= 1_000_000) return `$${(value / 1_000_000).toFixed(1)}M`;
  if (value >= 1_000) return `$${(value / 1_000).toFixed(0)}K`;
  return `$${value.toFixed(0)}`;
}

function formatDate(value?: string | null) {
  if (!value) return "";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "";
  return date.toLocaleDateString();
}

function changeText(value: number | null | undefined) {
  if (value === null || value === undefined || Number.isNaN(value)) return "24h N/A";
  const sign = value > 0 ? "+" : "";
  return `${sign}${Math.round(value * 100)} pts`;
}

function marketTitle(market: PulseMarket, isZh: boolean) {
  return isZh && market.question_zh ? market.question_zh : market.question;
}

function sourceLabel(source: SourceName) {
  return source === "polymarket" ? "Polymarket" : "Kalshi";
}

function marketKey(market: PulseMarket) {
  return `${market.source}:${market.slug || market.series_ticker || market.token_id_yes || market.question}`;
}

function marketUrl(market: PulseMarket) {
  if (market.source === "polymarket" && market.slug) return `https://polymarket.com/event/${market.slug}`;
  if (market.source === "kalshi" && market.series_ticker) return `https://kalshi.com/markets/${market.series_ticker}`;
  return null;
}

function avgProbability(group: PulseGroup) {
  const values = group.markets
    .map((market) => market.prob_yes)
    .filter((value): value is number => typeof value === "number" && !Number.isNaN(value));
  if (!values.length) return null;
  return values.reduce((sum, value) => sum + value, 0) / values.length;
}

export function EventProbability() {
  const { isZh } = useLanguage();
  const [overview, setOverview] = useState<PulseOverview | null>(null);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [trend, setTrend] = useState<ProbabilityTrendPoint[]>([]);
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [trendLoading, setTrendLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const allMarkets = useMemo(
    () => overview?.modules.flatMap((group) => group.markets) ?? [],
    [overview],
  );
  const selected = allMarkets.find((market) => marketKey(market) === selectedId) ?? allMarkets[0] ?? null;

  const loadOverview = useCallback(async (refresh = false) => {
    setError(null);
    if (refresh) setRefreshing(true);
    try {
      const data = await requestJson<PulseOverview>(`/pulse/overview${refresh ? "?refresh=true" : ""}`);
      setOverview(data);
      if (!selectedId && data.modules[0]?.markets[0]) setSelectedId(marketKey(data.modules[0].markets[0]));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoading(false);
      if (!refresh) setRefreshing(false);
    }
  }, [selectedId]);

  useEffect(() => {
    void loadOverview(false);
  }, [loadOverview]);

  useEffect(() => {
    if (!overview?.updating) {
      setRefreshing(false);
      return;
    }
    const timer = window.setTimeout(() => void loadOverview(false), 15000);
    return () => window.clearTimeout(timer);
  }, [loadOverview, overview?.updating]);

  useEffect(() => {
    if (!selected?.token_id_yes || selected.source !== "polymarket") {
      setTrend([]);
      return;
    }
    setTrendLoading(true);
    requestJson<{ history: ProbabilityTrendPoint[] }>(
      `/polymarket/history?token_id=${encodeURIComponent(selected.token_id_yes)}&interval=1h`,
    )
      .then((data) => setTrend(data.history ?? []))
      .catch(() => setTrend([]))
      .finally(() => setTrendLoading(false));
  }, [selected?.source, selected?.token_id_yes]);

  return (
    <div className="mx-auto max-w-7xl p-4 md:p-8">
      <div className="mb-6 flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="flex items-center gap-3">
            <Activity className="h-6 w-6 text-primary" aria-hidden="true" />
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              {isZh ? "事件概率" : "Event Probability"}
            </h1>
          </div>
          <p className="mt-2 max-w-3xl text-sm text-muted-foreground">
            {isZh
              ? "全球宏观预期概率面板，汇总 Polymarket 和 Kalshi 的公开预测市场数据。"
              : "Global macro expectation panel from public Polymarket and Kalshi prediction markets."}
          </p>
        </div>
        <button
          type="button"
          onClick={() => void loadOverview(true)}
          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-border bg-card px-3 text-sm font-medium hover:bg-accent disabled:opacity-60"
          disabled={refreshing}
        >
          {refreshing ? <Loader2 className="h-4 w-4 animate-spin" /> : <RefreshCw className="h-4 w-4" />}
          {isZh ? "刷新" : "Refresh"}
        </button>
      </div>

      {error && (
        <div className="mb-5 flex items-start gap-2 rounded-md border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">
          <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
          <span>{error}</span>
        </div>
      )}

      {loading ? (
        <div className="flex h-[45vh] items-center justify-center text-muted-foreground">
          <Loader2 className="mr-2 h-5 w-5 animate-spin" />
          {isZh ? "正在加载概率数据..." : "Loading probability data..."}
        </div>
      ) : (
        <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_360px]">
          <main className="space-y-5">
            <div className="grid gap-3 md:grid-cols-3">
              {(overview?.modules ?? []).slice(0, 3).map((group) => (
                <section key={group.key} className="rounded-md border border-border bg-card p-4">
                  <div className="text-xs uppercase tracking-wide text-muted-foreground">
                    {isZh ? group.zh_label : group.label}
                  </div>
                  <div className="mt-2 flex items-end justify-between">
                    <div className="text-3xl font-semibold">{pct(avgProbability(group))}</div>
                    <div className="text-sm text-muted-foreground">
                      {group.market_count} {isZh ? "个市场" : "markets"}
                    </div>
                  </div>
                </section>
              ))}
            </div>

            {(overview?.modules ?? []).map((group) => (
              <section key={group.key}>
                <div className="mb-3 flex items-center justify-between">
                  <h2 className="text-lg font-semibold">{isZh ? group.zh_label : group.label}</h2>
                  <span className="text-sm text-muted-foreground">{pct(avgProbability(group))}</span>
                </div>
                <div className="grid gap-3 md:grid-cols-2">
                  {group.markets.map((market) => (
                    <button
                      key={marketKey(market)}
                      type="button"
                      onClick={() => setSelectedId(marketKey(market))}
                      className={`rounded-md border bg-card p-4 text-left transition hover:border-primary/60 ${
                        selected && marketKey(selected) === marketKey(market) ? "border-primary" : "border-border"
                      }`}
                    >
                      <div className="mb-3 flex items-start justify-between gap-3">
                        <div className="min-w-0">
                          <div className="mb-2 flex flex-wrap gap-2">
                            <span className="rounded bg-secondary px-2 py-0.5 text-xs text-secondary-foreground">
                              {sourceLabel(market.source)}
                            </span>
                            {market.pick_label && (
                              <span className="rounded bg-muted px-2 py-0.5 text-xs text-muted-foreground">
                                {market.pick_label}
                              </span>
                            )}
                          </div>
                          <div className="line-clamp-2 text-sm font-medium leading-5">
                            {marketTitle(market, isZh)}
                          </div>
                        </div>
                        <div className="shrink-0 text-right text-2xl font-semibold">
                          {pct(market.prob_yes)}
                        </div>
                      </div>
                      <div className="mb-3 h-2 overflow-hidden rounded bg-muted">
                        <div
                          className="h-full rounded bg-primary"
                          style={{ width: `${Math.max(0, Math.min(100, (market.prob_yes ?? 0) * 100))}%` }}
                        />
                      </div>
                      <div className="flex items-center justify-between text-xs text-muted-foreground">
                        <span>{isZh ? "成交量" : "Volume"} {money(market.volume_24h ?? market.volume)}</span>
                        <span className={market.change_24h && market.change_24h > 0 ? "text-emerald-600" : market.change_24h && market.change_24h < 0 ? "text-rose-600" : ""}>
                          {changeText(market.change_24h)}
                        </span>
                      </div>
                    </button>
                  ))}
                </div>
              </section>
            ))}
          </main>

          <aside className="rounded-md border border-border bg-card p-4 xl:sticky xl:top-20 xl:self-start">
            {selected ? (
              <>
                <div className="mb-4 flex items-start justify-between gap-3">
                  <div>
                    <div className="text-xs uppercase tracking-wide text-muted-foreground">
                      {sourceLabel(selected.source)}
                    </div>
                    <h2 className="mt-1 text-lg font-semibold leading-6">{marketTitle(selected, isZh)}</h2>
                  </div>
                  {marketUrl(selected) && (
                    <a
                      href={marketUrl(selected) ?? undefined}
                      target="_blank"
                      rel="noreferrer"
                      className="rounded-md border border-border p-2 hover:bg-accent"
                      aria-label={isZh ? "打开市场" : "Open market"}
                    >
                      <ExternalLink className="h-4 w-4" />
                    </a>
                  )}
                </div>
                <div className="grid grid-cols-2 gap-3">
                  <Metric label={isZh ? "当前概率" : "Probability"} value={pct(selected.prob_yes)} />
                  <Metric label="24h" value={changeText(selected.change_24h)} positive={selected.change_24h} />
                  <Metric label={isZh ? "流动性" : "Liquidity"} value={money(selected.liquidity)} />
                  <Metric label={isZh ? "截止" : "End"} value={formatDate(selected.end_date) || "N/A"} />
                </div>
                <div className="mt-5">
                  <div className="mb-2 flex items-center gap-2 text-sm font-medium">
                    <BarChart3 className="h-4 w-4 text-primary" />
                    {isZh ? "概率走势" : "Probability Trend"}
                  </div>
                  {trendLoading ? (
                    <div className="flex h-[220px] items-center justify-center text-sm text-muted-foreground">
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      {isZh ? "加载中..." : "Loading..."}
                    </div>
                  ) : trend.length > 1 ? (
                    <ProbabilityTrend data={trend} />
                  ) : (
                    <div className="flex h-[220px] items-center justify-center rounded-md border border-dashed border-border text-sm text-muted-foreground">
                      {isZh ? "暂无可用历史曲线" : "No history curve available"}
                    </div>
                  )}
                </div>
              </>
            ) : (
              <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">
                {isZh ? "暂无市场数据" : "No market data"}
              </div>
            )}
          </aside>
        </div>
      )}
    </div>
  );
}

function Metric({ label, value, positive }: { label: string; value: string; positive?: number | null }) {
  const positiveClass = positive && positive > 0 ? "text-emerald-600" : positive && positive < 0 ? "text-rose-600" : "";
  return (
    <div className="rounded-md border border-border bg-background p-3">
      <div className="flex items-center gap-1 text-xs text-muted-foreground">
        {positive && positive > 0 ? <TrendingUp className="h-3.5 w-3.5" /> : positive && positive < 0 ? <TrendingDown className="h-3.5 w-3.5" /> : null}
        {label}
      </div>
      <div className={`mt-1 text-lg font-semibold ${positiveClass}`}>{value}</div>
    </div>
  );
}
