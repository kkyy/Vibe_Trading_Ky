import { useEffect, useMemo, useRef, useState } from "react";
import { AlertCircle, ArrowDownWideNarrow, ChevronDown, Download, Grid2X2, Heart, List, Loader2, Plus, RefreshCw, Search, Settings, SlidersHorizontal, Trash2, Upload } from "lucide-react";
import { echarts } from "@/lib/echarts";
import { getChartTheme } from "@/lib/chart-theme";
import {
  fetchFundSnapshot,
  searchFunds,
  type FundSearchResult,
  type FundSnapshot,
} from "@/lib/fundBaby";
import { fetchStockQuote, stockId, type StockMarket, type StockQuote } from "@/lib/stockQuotes";
import { cn } from "@/lib/utils";
import { useLanguage } from "@/hooks/useLanguage";

const STORAGE_KEY = "vibe-fund-baby-codes";
const FAVORITE_KEY = "vibe-fund-baby-favorites";
const POSITION_KEY = "vibe-fund-baby-positions";
const ADD_PANEL_KEY = "vibe-fund-baby-add-panel";
const STOCK_CODES_KEY = "vibe-holdings-stock-codes";
const STOCK_POSITION_KEY = "vibe-holdings-stock-positions";

type ViewMode = "grid" | "list";
type SortMode = "default" | "change" | "holdingProfit";
type DensityMode = "comfortable" | "compact";
type FilterMode = "all" | "favorites" | "held";
type AssetView = "overview" | "funds" | "stocks";

type ImportValueObject = { code?: unknown; CODE?: unknown; fundcode?: unknown; fundCode?: unknown };

type ImportPayload = {
  codes?: unknown;
  fundCodes?: unknown;
  funds?: unknown;
  myFunds?: unknown;
  favorites?: unknown;
  favoriteCodes?: unknown;
  watchlist?: unknown;
  positions?: unknown;
  holdings?: unknown;
  fundPositions?: unknown;
  fundHoldings?: unknown;
  amounts?: unknown;
  shares?: unknown;
  amountMap?: unknown;
  sharesMap?: unknown;
};

type FundPosition = {
  shares: string;
  cost: string;
};

type StoredFundPosition = Partial<FundPosition> & {
  share?: unknown;
  units?: unknown;
  amount?: unknown;
  asset?: unknown;
  assets?: unknown;
  costAmount?: unknown;
  fundShares?: unknown;
  holdingAmount?: unknown;
  holdingShare?: unknown;
  holdingShares?: unknown;
  money?: unknown;
  principal?: unknown;
  unitCost?: unknown;
};

type ImportedFundSnapshot = Partial<FundSnapshot> & {
  fundcode?: unknown;
  fundCode?: unknown;
  gszzl?: unknown;
  zzl?: unknown;
  yesterdayChange?: unknown;
};

function readCodes(key: string) {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "[]");
    return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readRecord<T>(key: string): Record<string, T> {
  try {
    const value = JSON.parse(localStorage.getItem(key) || "{}");
    return value && typeof value === "object" && !Array.isArray(value) ? value : {};
  } catch {
    return {};
  }
}

function readPositions() {
  const stored = readRecord<StoredFundPosition>(POSITION_KEY);
  return Object.fromEntries(
    Object.entries(stored).map(([code, position]) => [
      code,
      normalizePosition(position),
    ]),
  );
}

function normalizePosition(position: StoredFundPosition): FundPosition {
  const hasInternalShares = position.shares !== undefined || position.holdingShares !== undefined;
  const shares = position.shares ?? position.holdingShares ?? position.share ?? position.holdingShare ?? position.units ?? position.fundShares ?? "";
  const amount = position.amount ?? position.holdingAmount ?? position.costAmount ?? position.principal ?? position.money ?? position.asset ?? position.assets;
  const internalCost = hasInternalShares ? position.cost : undefined;
  const unitCost = position.unitCost ?? (!hasInternalShares && amount === undefined ? position.cost : undefined);
  return {
    shares: String(shares ?? ""),
    cost: internalCost !== undefined
      ? String(internalCost ?? "")
      : amount !== undefined
        ? String(amount ?? "")
        : inferAmountFromShareAndUnitCost(String(shares ?? ""), String(unitCost ?? "")),
  };
}

function normalizeCode(value: unknown) {
  let raw = value;
  if (typeof value === "object" && value !== null) {
    const item = value as ImportValueObject;
    raw = item.code ?? item.CODE ?? item.fundcode ?? item.fundCode;
  }
  const match = String(raw ?? "").match(/\d{6}/);
  return match?.[0] ?? null;
}

function extractCodes(value: unknown): string[] {
  if (!value) return [];
  if (Array.isArray(value)) {
    return [...new Set(value.map(normalizeCode).filter((item): item is string => Boolean(item)))];
  }
  if (typeof value === "object") {
    return extractCodes(Object.values(value));
  }
  return [];
}

function parseImportedFunds(payload: unknown) {
  if (Array.isArray(payload)) {
    return {
      codes: extractCodes(payload),
      favorites: [],
      positions: {} as Record<string, FundPosition>,
      snapshots: parseImportedSnapshots(payload),
    };
  }
  if (!payload || typeof payload !== "object") {
    return { codes: [], favorites: [], positions: {} as Record<string, FundPosition>, snapshots: {} as Record<string, FundSnapshot> };
  }
  const data = payload as ImportPayload;
  const codes = extractCodes(data.codes ?? data.fundCodes ?? data.funds ?? data.myFunds ?? data.watchlist);
  const favorites = extractCodes(data.favorites ?? data.favoriteCodes);
  const positions = {
    ...parseImportedPositions(data.positions ?? data.holdings ?? data.fundPositions ?? data.fundHoldings),
    ...parseImportedPositionMaps(data.amounts ?? data.amountMap, data.shares ?? data.sharesMap),
  };
  const snapshots = parseImportedSnapshots(data.funds ?? data.myFunds ?? data.watchlist);
  return {
    codes: [...new Set([...codes, ...favorites, ...Object.keys(positions), ...Object.keys(snapshots)])],
    favorites,
    positions,
    snapshots,
  };
}

function parseImportedSnapshots(value: unknown) {
  const snapshots: Record<string, FundSnapshot> = {};
  if (!value) return snapshots;
  const items = Array.isArray(value) ? value : typeof value === "object" ? Object.values(value) : [];
  items.forEach((item) => {
    if (!item || typeof item !== "object") return;
    const record = item as ImportedFundSnapshot;
    const code = normalizeCode(record.code ?? record.fundcode ?? record.fundCode ?? item);
    if (!code) return;
    snapshots[code] = {
      code,
      name: String(record.name || `基金 ${code}`),
      dwjz: String(record.dwjz || ""),
      gsz: record.gsz === null || record.gsz === undefined || record.gsz === "" ? null : String(record.gsz),
      gztime: record.gztime === null || record.gztime === undefined || record.gztime === "" ? null : String(record.gztime),
      jzrq: String(record.jzrq || ""),
      gszzl: toFiniteNumber(record.gszzl),
      zzl: toFiniteNumber(record.zzl),
      yesterdayChange: toFiniteNumber(record.yesterdayChange),
      noValuation: Boolean(record.noValuation),
      holdings: Array.isArray(record.holdings) ? record.holdings : [],
      historyTrend: Array.isArray(record.historyTrend) ? record.historyTrend : [],
      intraday: Array.isArray(record.intraday) ? record.intraday : [],
    };
  });
  return snapshots;
}

function toFiniteNumber(value: unknown) {
  if (value === null || value === undefined || value === "") return null;
  const parsed = typeof value === "number" ? value : Number.parseFloat(String(value));
  return Number.isFinite(parsed) ? parsed : null;
}

function parseImportedPositions(value: unknown) {
  const positions: Record<string, FundPosition> = {};
  if (!value || typeof value !== "object") return positions;
  if (Array.isArray(value)) {
    value.forEach((item) => {
      if (!item || typeof item !== "object") return;
      const code = normalizeCode(item);
      if (!code) return;
      positions[code] = normalizePosition(item as StoredFundPosition);
    });
    return positions;
  }
  Object.entries(value).forEach(([key, raw]) => {
    const code = normalizeCode(key);
    if (!code || !raw || typeof raw !== "object") return;
    positions[code] = normalizePosition(raw as StoredFundPosition);
  });
  return positions;
}

function inferAmountFromShareAndUnitCost(share: string, unitCost: string) {
  const shareNumber = toNumber(share);
  const costNumber = toNumber(unitCost);
  if (!shareNumber || !costNumber) return "";
  return (shareNumber * costNumber).toFixed(2);
}

function parseImportedPositionMaps(amounts: unknown, shares: unknown) {
  const positions: Record<string, FundPosition> = {};
  if (amounts && typeof amounts === "object" && !Array.isArray(amounts)) {
    Object.entries(amounts).forEach(([key, value]) => {
      const code = normalizeCode(key);
      if (!code) return;
      positions[code] = { ...(positions[code] || { shares: "", cost: "" }), cost: String(value ?? "") };
    });
  }
  if (shares && typeof shares === "object" && !Array.isArray(shares)) {
    Object.entries(shares).forEach(([key, value]) => {
      const code = normalizeCode(key);
      if (!code) return;
      positions[code] = { ...(positions[code] || { shares: "", cost: "" }), shares: String(value ?? "") };
    });
  }
  return positions;
}

function toNumber(value: string | undefined) {
  if (!value) return 0;
  const parsed = Number.parseFloat(value.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : 0;
}

function fundNav(fund: FundSnapshot) {
  return Number.parseFloat(fund.gsz || fund.dwjz || "0") || 0;
}

function fundBaseNav(fund: FundSnapshot) {
  return Number.parseFloat(fund.dwjz || "0") || fundNav(fund);
}

function getPositionMetrics(fund: FundSnapshot | undefined, position: FundPosition | undefined) {
  const shares = toNumber(position?.shares);
  const cost = toNumber(position?.cost);
  const nav = fund ? fundNav(fund) : 0;
  const baseNav = fund ? fundBaseNav(fund) : 0;
  const asset = shares > 0 && nav > 0 ? shares * nav : cost;
  const todayProfit = shares > 0 && fund ? shares * (nav - baseNav) : 0;
  const holdingProfit = cost > 0 && shares > 0 ? asset - cost : 0;
  const holdingReturn = cost > 0 ? (holdingProfit / cost) * 100 : 0;
  return { shares, cost, asset, todayProfit, holdingProfit, holdingReturn };
}

function getStockMetrics(stock: StockQuote | undefined, position: FundPosition | undefined) {
  const shares = toNumber(position?.shares);
  const cost = toNumber(position?.cost);
  const price = stock?.price || 0;
  const previousClose = stock?.previousClose || price;
  const asset = shares > 0 && price > 0 ? shares * price : cost;
  const todayProfit = shares > 0 && stock ? shares * (price - previousClose) : 0;
  const holdingProfit = cost > 0 && shares > 0 ? asset - cost : 0;
  const holdingReturn = cost > 0 ? (holdingProfit / cost) * 100 : 0;
  return { shares, cost, asset, todayProfit, holdingProfit, holdingReturn };
}

function formatMoney(value: number) {
  if (!Number.isFinite(value)) return "¥0.00";
  return `¥${value.toLocaleString("zh-CN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatPercent(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "--";
  return `${value >= 0 ? "+" : ""}${value.toFixed(2)}%`;
}

function changeTone(value: number | null | undefined) {
  if (typeof value !== "number" || !Number.isFinite(value)) return "text-muted-foreground";
  if (value > 0) return "text-danger";
  if (value < 0) return "text-success";
  return "text-muted-foreground";
}

const metricValueClass = "mt-1 break-all font-semibold leading-snug tabular-nums";
const compactMetricValueClass = "text-[12px] sm:text-[13px]";
const comfortableMetricValueClass = "text-[15px] sm:text-base";
const compactMetricGridClass = "grid grid-cols-[repeat(auto-fit,minmax(104px,1fr))] gap-1.5";
const comfortableMetricGridClass = "grid grid-cols-[repeat(auto-fit,minmax(126px,1fr))] gap-3";
const compactMetricBoxClass = "min-w-0 rounded bg-muted/35 px-2 py-1.5";
const comfortableMetricBoxClass = "min-w-0 rounded-md bg-muted/35 p-3";

function PortfolioSummary({
  totalAsset,
  todayProfit,
  holdingProfit,
  holdingReturn,
  hasPositions,
}: {
  totalAsset: number;
  todayProfit: number;
  holdingProfit: number;
  holdingReturn: number;
  hasPositions: boolean;
}) {
  const { isZh } = useLanguage();
  return (
    <section className="mt-5 rounded-lg border bg-card p-4 shadow-sm">
      <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
        <div>
          <div className="text-sm text-muted-foreground">{isZh ? "当日资产" : "Daily assets"}</div>
          <div className="mt-1 text-3xl font-semibold tabular-nums">{formatMoney(totalAsset)}</div>
          {!hasPositions && (
            <p className="mt-1 text-xs text-muted-foreground">
              {isZh ? "在基金卡片中录入持仓份额和持仓金额后自动计算。" : "Enter holding shares and amount on fund cards to calculate portfolio metrics."}
            </p>
          )}
        </div>
        <div className="grid grid-cols-2 gap-4 md:min-w-[360px]">
          <div className="rounded-md bg-muted/35 p-3 text-right">
            <div className="text-xs text-muted-foreground">{isZh ? "当日收益" : "Today P/L"}</div>
            <div className={cn("mt-1 text-xl font-semibold tabular-nums", changeTone(todayProfit))}>
              {formatMoney(todayProfit)}
            </div>
          </div>
          <div className="rounded-md bg-muted/35 p-3 text-right">
            <div className="text-xs text-muted-foreground">{isZh ? "持有收益" : "Holding P/L"}</div>
            <div className={cn("mt-1 text-xl font-semibold tabular-nums", changeTone(holdingProfit))}>
              {formatMoney(holdingProfit)}
            </div>
            <div className={cn("text-xs tabular-nums", changeTone(holdingReturn))}>{formatPercent(holdingReturn)}</div>
          </div>
        </div>
      </div>
    </section>
  );
}

function FundTrendChart({ fund }: { fund: FundSnapshot }) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const theme = getChartTheme();
    const history = fund.historyTrend.map((point) => [point.x, point.y]);
    const intraday = fund.intraday.map((point) => [point.time, point.growth]);

    chart.setOption({
      animation: false,
      grid: [
        { left: 42, right: 14, top: 18, height: fund.intraday.length ? 116 : 190 },
        ...(fund.intraday.length ? [{ left: 42, right: 14, top: 170, height: 94 }] : []),
      ],
      tooltip: { trigger: "axis" },
      xAxis: [
        {
          type: "time",
          axisLine: { lineStyle: { color: theme.axisColor } },
          axisLabel: { color: theme.textColor },
        },
        ...(fund.intraday.length
          ? [{
              type: "category",
              gridIndex: 1,
              axisLine: { lineStyle: { color: theme.axisColor } },
              axisLabel: { color: theme.textColor },
            }]
          : []),
      ],
      yAxis: [
        {
          type: "value",
          scale: true,
          axisLine: { show: false },
          axisLabel: { color: theme.textColor },
          splitLine: { lineStyle: { color: theme.gridColor } },
        },
        ...(fund.intraday.length
          ? [{
              type: "value",
              gridIndex: 1,
              axisLabel: { color: theme.textColor, formatter: "{value}%" },
              splitLine: { lineStyle: { color: theme.gridColor } },
            }]
          : []),
      ],
      series: [
        {
          name: "Net value",
          type: "line",
          smooth: true,
          symbol: "none",
          data: history,
          lineStyle: { width: 2, color: theme.infoColor },
          areaStyle: { color: theme.infoColor + "18" },
        },
        ...(fund.intraday.length
          ? [{
              name: "Intraday estimate",
              type: "line",
              xAxisIndex: 1,
              yAxisIndex: 1,
              smooth: true,
              symbol: "none",
              data: intraday,
              lineStyle: { width: 2, color: theme.downColor },
            }]
          : []),
      ],
    });

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [fund]);

  return <div ref={ref} className="h-[290px] w-full" />;
}

function PositionEditorDialog({
  code,
  position,
  currentNav,
  onChange,
  onClose,
}: {
  code: string;
  position: FundPosition;
  currentNav: number;
  onChange: (position: FundPosition) => void;
  onClose: () => void;
}) {
  const { isZh } = useLanguage();
  const [mode, setMode] = useState<"amount" | "share">(() => (toNumber(position.shares) > 0 ? "share" : "amount"));
  const initialAsset = toNumber(position.shares) > 0 && currentNav > 0 ? toNumber(position.shares) * currentNav : toNumber(position.cost);
  const initialProfit = toNumber(position.shares) > 0 && toNumber(position.cost) > 0 && currentNav > 0
    ? initialAsset - toNumber(position.cost)
    : 0;
  const [amount, setAmount] = useState(initialAsset ? initialAsset.toFixed(2) : "");
  const [profit, setProfit] = useState(initialProfit ? initialProfit.toFixed(2) : "");
  const [share, setShare] = useState(position.shares);
  const [unitCost, setUnitCost] = useState(() => {
    const shares = toNumber(position.shares);
    const cost = toNumber(position.cost);
    return shares > 0 && cost > 0 ? (cost / shares).toFixed(4) : "";
  });

  const save = () => {
    if (mode === "amount") {
      const amountNumber = toNumber(amount);
      const profitNumber = toNumber(profit);
      const nextShares = currentNav > 0 && amountNumber > 0 ? amountNumber / currentNav : toNumber(position.shares);
      const principal = Math.max(0, amountNumber - profitNumber);
      onChange({
        shares: nextShares ? nextShares.toFixed(2) : "",
        cost: principal ? principal.toFixed(2) : amount,
      });
    } else {
      const shareNumber = toNumber(share);
      const unitCostNumber = toNumber(unitCost);
      onChange({
        shares: share,
        cost: shareNumber && unitCostNumber ? (shareNumber * unitCostNumber).toFixed(2) : "",
      });
    }
    onClose();
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/45 px-4">
      <div className="w-full max-w-sm rounded-lg border bg-card p-4 shadow-xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h3 className="text-base font-semibold">{isZh ? "持仓设置" : "Position settings"}</h3>
            <p className="mt-1 text-xs text-muted-foreground">{code}</p>
          </div>
          <button onClick={onClose} className="rounded-md px-2 py-1 text-sm text-muted-foreground hover:bg-muted hover:text-foreground">
            {isZh ? "关闭" : "Close"}
          </button>
        </div>
        <div className="mt-4 grid grid-cols-2 rounded-md border bg-muted/30 p-1 text-sm">
          <button
            onClick={() => setMode("amount")}
            className={cn("rounded px-3 py-2", mode === "amount" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {isZh ? "按金额" : "By amount"}
          </button>
          <button
            onClick={() => setMode("share")}
            className={cn("rounded px-3 py-2", mode === "share" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
          >
            {isZh ? "按份额" : "By shares"}
          </button>
        </div>
        <div className="mt-4 space-y-3">
          {mode === "amount" ? (
            <>
              <label className="block">
                <span className="text-xs text-muted-foreground">{isZh ? "持有金额" : "Holding amount"}</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  placeholder={isZh ? "请输入持有总金额" : "Enter total holding amount"}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{isZh ? "持有收益" : "Holding profit"}</span>
                <input
                  inputMode="decimal"
                  value={profit}
                  onChange={(event) => setProfit(event.target.value)}
                  placeholder={isZh ? "请输入持有总收益，可为负" : "Enter total profit, can be negative"}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus:border-primary"
                />
              </label>
            </>
          ) : (
            <>
              <label className="block">
                <span className="text-xs text-muted-foreground">{isZh ? "持有份额" : "Holding shares"}</span>
                <input
                  autoFocus
                  inputMode="decimal"
                  value={share}
                  onChange={(event) => setShare(event.target.value)}
                  placeholder={isZh ? "请输入持有份额" : "Enter holding shares"}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus:border-primary"
                />
              </label>
              <label className="block">
                <span className="text-xs text-muted-foreground">{isZh ? "持仓成本价" : "Cost price"}</span>
                <input
                  inputMode="decimal"
                  value={unitCost}
                  onChange={(event) => setUnitCost(event.target.value)}
                  placeholder={isZh ? "请输入持仓成本价" : "Enter cost price"}
                  className="mt-1 h-10 w-full rounded-md border bg-background px-3 text-sm tabular-nums outline-none focus:border-primary"
                />
              </label>
            </>
          )}
        </div>
        <button
          onClick={save}
          className="mt-4 h-10 w-full rounded-md bg-primary text-sm font-medium text-primary-foreground hover:bg-primary/90"
        >
          {isZh ? "保存" : "Save"}
        </button>
      </div>
    </div>
  );
}

function FundCard({
  fund,
  favorite,
  position,
  collapsed,
  viewMode,
  density,
  onRefresh,
  onRemove,
  onFavorite,
  onToggleCollapsed,
  onPositionChange,
  loading,
}: {
  fund: FundSnapshot;
  favorite: boolean;
  position: FundPosition;
  collapsed: boolean;
  viewMode: ViewMode;
  density: DensityMode;
  onRefresh: () => void;
  onRemove: () => void;
  onFavorite: () => void;
  onToggleCollapsed: () => void;
  onPositionChange: (position: FundPosition) => void;
  loading: boolean;
}) {
  const { isZh } = useLanguage();
  const [editingPosition, setEditingPosition] = useState(false);
  const { asset: displayAsset, todayProfit, holdingProfit, holdingReturn } = getPositionMetrics(fund, position);
  const compact = density === "compact" || viewMode === "list";
  const metricBoxClass = compact ? compactMetricBoxClass : comfortableMetricBoxClass;
  const metricGridClass = compact ? compactMetricGridClass : comfortableMetricGridClass;
  const metricTextClass = cn(metricValueClass, compact ? compactMetricValueClass : comfortableMetricValueClass);
  return (
    <article className={cn("rounded-lg border bg-card shadow-sm", compact ? "p-2" : "p-4")}>
      {editingPosition && (
        <PositionEditorDialog
          code={fund.code}
          position={position}
          currentNav={fundNav(fund)}
          onChange={onPositionChange}
          onClose={() => setEditingPosition(false)}
        />
      )}
      <div className={cn("flex flex-wrap items-start justify-between", compact ? "gap-2" : "gap-3")}>
        <div className="min-w-0">
          <div className={cn("flex items-center", compact ? "gap-1.5" : "gap-2")}>
            <h2 className={cn("truncate font-semibold", compact ? "text-sm" : "text-base")}>{fund.name}</h2>
            <span className={cn("rounded border text-muted-foreground", compact ? "px-1 py-0 text-[10px]" : "px-1.5 py-0.5 text-[11px]")}>{fund.code}</span>
          </div>
          <p className={cn("text-muted-foreground", compact ? "mt-0.5 text-[10px]" : "mt-1 text-xs")}>
            {isZh ? "净值日期" : "NAV date"} {fund.jzrq || "--"}
            {fund.gztime ? ` · ${isZh ? "估值时间" : "Estimate"} ${fund.gztime}` : ""}
          </p>
        </div>
        <div className={cn("flex items-center", compact ? "gap-0.5" : "gap-1")}>
          <button onClick={onFavorite} className={cn("rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", compact ? "p-1" : "p-2")} title={isZh ? "自选" : "Favorite"}>
            <Heart className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", favorite && "fill-danger text-danger")} />
          </button>
          <button onClick={onToggleCollapsed} className={cn("rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", compact ? "p-1" : "p-2")} title={collapsed ? (isZh ? "展开" : "Expand") : (isZh ? "折叠" : "Collapse")}>
            <ChevronDown className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "transition-transform", collapsed && "-rotate-90")} />
          </button>
          <button onClick={onRefresh} className={cn("rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", compact ? "p-1" : "p-2")} title={isZh ? "刷新" : "Refresh"}>
            {loading ? <Loader2 className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "animate-spin")} /> : <RefreshCw className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />}
          </button>
          <button onClick={onRemove} className={cn("rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger", compact ? "p-1" : "p-2")} title={isZh ? "删除" : "Remove"}>
            <Trash2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        </div>
      </div>

      <div className={cn(metricGridClass, compact ? "mt-2" : "mt-4")}>
        <div className={metricBoxClass}>
          <div className={cn("flex items-center gap-1 text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
            <span>{isZh ? "持仓份额" : "Holding shares"}</span>
            <button
              onClick={() => setEditingPosition(true)}
              className={cn("rounded hover:bg-muted hover:text-foreground", compact ? "p-0" : "p-0.5")}
              title={isZh ? "设置持仓" : "Set position"}
            >
              <Settings className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            </button>
          </div>
          <p className={metricTextClass}>{position.shares || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "当日资产" : "Daily assets"}</p>
          <p className={metricTextClass}>{formatMoney(displayAsset)}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "估值涨跌幅" : "Est. change"}</p>
          <p className={cn(metricTextClass, changeTone(fund.gszzl))}>{formatPercent(fund.gszzl)}</p>
          <p className={cn("text-muted-foreground tabular-nums", compact ? "text-[10px]" : "text-xs")}>{fund.gsz || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "当日盈亏" : "Today P/L"}</p>
          <p className={cn(metricTextClass, changeTone(todayProfit))}>{formatMoney(todayProfit)}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "持有收益" : "Holding P/L"}</p>
          <p className={cn(metricTextClass, changeTone(holdingProfit))}>{formatMoney(holdingProfit)}</p>
          <p className={cn(compact ? "text-[10px]" : "text-xs", "tabular-nums", changeTone(holdingReturn))}>{formatPercent(holdingReturn)}</p>
        </div>
      </div>

      {collapsed ? null : (
        <>

      <div className={cn(metricGridClass, compact ? "mt-2" : "mt-4")}>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "单位净值" : "NAV"}</p>
          <p className={metricTextClass}>{fund.dwjz || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "实时估值" : "Estimate"}</p>
          <p className={metricTextClass}>{fund.gsz || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "估算涨跌" : "Est. change"}</p>
          <p className={cn(metricTextClass, changeTone(fund.gszzl))}>{formatPercent(fund.gszzl)}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "昨日涨跌" : "Last change"}</p>
          <p className={cn(metricTextClass, changeTone(fund.zzl ?? fund.yesterdayChange))}>
            {formatPercent(fund.zzl ?? fund.yesterdayChange)}
          </p>
        </div>
      </div>

      {(fund.historyTrend.length > 0 || fund.intraday.length > 0) && (
        <div className={cn("rounded-md border bg-background/40", compact ? "mt-2 p-1" : "mt-4 p-2")}>
          <FundTrendChart fund={fund} />
        </div>
      )}

      <div className={compact ? "mt-2" : "mt-4"}>
        <div className={cn("flex items-center justify-between", compact ? "mb-1" : "mb-2")}>
          <h3 className={cn("font-medium", compact ? "text-xs" : "text-sm")}>{isZh ? "前十大重仓" : "Top holdings"}</h3>
          {fund.noValuation && <span className="text-xs text-warning">{isZh ? "当前基金不支持实时估值" : "Realtime estimate unavailable"}</span>}
        </div>
        {fund.holdings.length ? (
          <div className="overflow-hidden rounded-md border">
            <table className={cn("w-full", compact ? "text-xs" : "text-sm")}>
              <thead className="bg-muted/60 text-xs text-muted-foreground">
                <tr>
                  <th className={cn("text-left font-medium", compact ? "px-2 py-1" : "px-3 py-2")}>{isZh ? "股票" : "Stock"}</th>
                  <th className={cn("text-right font-medium", compact ? "px-2 py-1" : "px-3 py-2")}>{isZh ? "占比" : "Weight"}</th>
                  <th className={cn("text-right font-medium", compact ? "px-2 py-1" : "px-3 py-2")}>{isZh ? "今日涨跌" : "Today"}</th>
                </tr>
              </thead>
              <tbody>
                {fund.holdings.map((holding, index) => (
                  <tr key={`${holding.code}-${index}`} className="border-t">
                    <td className={compact ? "px-2 py-1" : "px-3 py-2"}>
                      <div className="font-medium">{holding.name || "--"}</div>
                      <div className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{holding.code || "--"}</div>
                    </td>
                    <td className={cn("text-right tabular-nums", compact ? "px-2 py-1" : "px-3 py-2")}>{holding.weight || "--"}</td>
                    <td className={cn("text-right tabular-nums", compact ? "px-2 py-1" : "px-3 py-2", changeTone(holding.change))}>{formatPercent(holding.change)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="rounded-md border border-dashed px-3 py-6 text-center text-sm text-muted-foreground">
            {isZh ? "暂无重仓数据" : "No holding data"}
          </div>
        )}
      </div>
        </>
      )}
    </article>
  );
}

function LoadingFundCard({
  code,
  position,
  density,
  onPositionChange,
  onRemove,
}: {
  code: string;
  position: FundPosition;
  density: DensityMode;
  onPositionChange: (position: FundPosition) => void;
  onRemove: () => void;
}) {
  const { isZh } = useLanguage();
  const [editingPosition, setEditingPosition] = useState(false);
  const displayAsset = toNumber(position.cost);
  const compact = density === "compact";
  const metricBoxClass = compact ? compactMetricBoxClass : comfortableMetricBoxClass;
  const metricGridClass = compact ? compactMetricGridClass : comfortableMetricGridClass;
  const metricTextClass = cn(metricValueClass, compact ? compactMetricValueClass : comfortableMetricValueClass);
  return (
    <div className={cn("rounded-lg border bg-card shadow-sm", compact ? "p-2" : "p-4")}>
      {editingPosition && (
        <PositionEditorDialog
          code={code}
          position={position}
          currentNav={0}
          onChange={onPositionChange}
          onClose={() => setEditingPosition(false)}
        />
      )}
      <div className={cn("flex items-center justify-between", compact ? "gap-2" : "gap-3")}>
        <div>
          <div className={cn("flex items-center font-semibold", compact ? "gap-1.5 text-xs" : "gap-2 text-sm")}>
            <Loader2 className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "animate-spin text-muted-foreground")} />
            {isZh ? `正在加载 ${code}` : `Loading ${code}`}
          </div>
          <p className={cn("text-muted-foreground", compact ? "mt-0.5 text-[10px]" : "mt-1 text-xs")}>
            {isZh ? "点击持仓金额旁的齿轮录入持仓。" : "Use the gear beside holding amount to enter the position."}
          </p>
        </div>
        <button
          onClick={onRemove}
          className={cn("rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger", compact ? "p-1" : "p-2")}
          title={isZh ? "删除" : "Remove"}
        >
          <Trash2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
        </button>
      </div>
      <div className={cn(metricGridClass, compact ? "mt-2" : "mt-4")}>
        <div className={metricBoxClass}>
          <div className={cn("flex items-center gap-1 text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>
            <span>{isZh ? "持仓份额" : "Holding shares"}</span>
            <button
              onClick={() => setEditingPosition(true)}
              className={cn("rounded hover:bg-muted hover:text-foreground", compact ? "p-0" : "p-0.5")}
              title={isZh ? "设置持仓" : "Set position"}
            >
              <Settings className={compact ? "h-3 w-3" : "h-3.5 w-3.5"} />
            </button>
          </div>
          <p className={metricTextClass}>{position.shares || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "持仓金额" : "Holding amount"}</p>
          <p className={metricTextClass}>{formatMoney(displayAsset)}</p>
        </div>
      </div>
    </div>
  );
}

function StockCard({
  stock,
  position,
  density,
  loading,
  onRefresh,
  onRemove,
  onPositionChange,
}: {
  stock: StockQuote;
  position: FundPosition;
  density: DensityMode;
  loading: boolean;
  onRefresh: () => void;
  onRemove: () => void;
  onPositionChange: (position: FundPosition) => void;
}) {
  const { isZh } = useLanguage();
  const [editingPosition, setEditingPosition] = useState(false);
  const compact = density === "compact";
  const metricBoxClass = compact ? compactMetricBoxClass : comfortableMetricBoxClass;
  const metricGridClass = compact ? compactMetricGridClass : comfortableMetricGridClass;
  const metricTextClass = cn(metricValueClass, compact ? compactMetricValueClass : comfortableMetricValueClass);
  const { asset, todayProfit, holdingProfit, holdingReturn } = getStockMetrics(stock, position);
  return (
    <article className={cn("rounded-lg border bg-card shadow-sm", compact ? "p-2" : "p-4")}>
      {editingPosition && (
        <PositionEditorDialog
          code={`${stock.market} ${stock.symbol}`}
          position={position}
          currentNav={stock.price}
          onChange={onPositionChange}
          onClose={() => setEditingPosition(false)}
        />
      )}
      <div className={cn("flex flex-wrap items-start justify-between", compact ? "gap-2" : "gap-3")}>
        <div className="min-w-0">
          <div className={cn("flex items-center", compact ? "gap-1.5" : "gap-2")}>
            <h2 className={cn("truncate font-semibold", compact ? "text-sm" : "text-base")}>{stock.name}</h2>
            <span className={cn("rounded border text-muted-foreground", compact ? "px-1 py-0 text-[10px]" : "px-1.5 py-0.5 text-[11px]")}>
              {stock.market} {stock.symbol}
            </span>
          </div>
          <p className={cn("text-muted-foreground", compact ? "mt-0.5 text-[10px]" : "mt-1 text-xs")}>
            {isZh ? "行情时间" : "Quote time"} {stock.time || "--"} · {stock.currency}
          </p>
        </div>
        <div className={cn("flex items-center", compact ? "gap-0.5" : "gap-1")}>
          <button onClick={() => setEditingPosition(true)} className={cn("rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", compact ? "p-1" : "p-2")} title={isZh ? "设置持仓" : "Set position"}>
            <Settings className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
          <button onClick={onRefresh} className={cn("rounded-md text-muted-foreground hover:bg-muted hover:text-foreground", compact ? "p-1" : "p-2")} title={isZh ? "刷新" : "Refresh"}>
            {loading ? <Loader2 className={cn(compact ? "h-3.5 w-3.5" : "h-4 w-4", "animate-spin")} /> : <RefreshCw className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />}
          </button>
          <button onClick={onRemove} className={cn("rounded-md text-muted-foreground hover:bg-danger/10 hover:text-danger", compact ? "p-1" : "p-2")} title={isZh ? "删除" : "Remove"}>
            <Trash2 className={compact ? "h-3.5 w-3.5" : "h-4 w-4"} />
          </button>
        </div>
      </div>
      <div className={cn(metricGridClass, compact ? "mt-2" : "mt-4")}>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "持仓份额" : "Holding shares"}</p>
          <p className={metricTextClass}>{position.shares || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "当日资产" : "Daily assets"}</p>
          <p className={metricTextClass}>{formatMoney(asset)}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "涨跌幅" : "Change"}</p>
          <p className={cn(metricTextClass, changeTone(stock.changePercent))}>{formatPercent(stock.changePercent)}</p>
          <p className={cn("text-muted-foreground tabular-nums", compact ? "text-[10px]" : "text-xs")}>{stock.price || "--"}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "当日盈亏" : "Today P/L"}</p>
          <p className={cn(metricTextClass, changeTone(todayProfit))}>{formatMoney(todayProfit)}</p>
        </div>
        <div className={metricBoxClass}>
          <p className={cn("text-muted-foreground", compact ? "text-[10px]" : "text-xs")}>{isZh ? "持有收益" : "Holding P/L"}</p>
          <p className={cn(metricTextClass, changeTone(holdingProfit))}>{formatMoney(holdingProfit)}</p>
          <p className={cn(compact ? "text-[10px]" : "text-xs", "tabular-nums", changeTone(holdingReturn))}>{formatPercent(holdingReturn)}</p>
        </div>
      </div>
    </article>
  );
}

export function FundBaby() {
  const { isZh } = useLanguage();
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const [codes, setCodes] = useState(() => readCodes(STORAGE_KEY));
  const [favorites, setFavorites] = useState(() => new Set(readCodes(FAVORITE_KEY)));
  const [positions, setPositions] = useState<Record<string, FundPosition>>(() => readPositions());
  const [stockCodes, setStockCodes] = useState(() => readCodes(STOCK_CODES_KEY));
  const [stockPositions, setStockPositions] = useState<Record<string, FundPosition>>(() => readRecord<FundPosition>(STOCK_POSITION_KEY));
  const [collapsedCards, setCollapsedCards] = useState(() => new Set(readCodes(STORAGE_KEY)));
  const [addPanelOpen, setAddPanelOpen] = useState(() => localStorage.getItem(ADD_PANEL_KEY) !== "closed");
  const [snapshots, setSnapshots] = useState<Record<string, FundSnapshot>>({});
  const [stockSnapshots, setStockSnapshots] = useState<Record<string, StockQuote>>({});
  const [loadingCodes, setLoadingCodes] = useState<Set<string>>(new Set());
  const [loadingStocks, setLoadingStocks] = useState<Set<string>>(new Set());
  const [query, setQuery] = useState("");
  const [stockQuery, setStockQuery] = useState("");
  const [stockMarket, setStockMarket] = useState<StockMarket>("HK");
  const [suggestions, setSuggestions] = useState<FundSearchResult[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [assetView, setAssetView] = useState<AssetView>("overview");
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [viewMode, setViewMode] = useState<ViewMode>("grid");
  const [density, setDensity] = useState<DensityMode>("compact");
  const [sortMode, setSortMode] = useState<SortMode>("default");

  useEffect(() => {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(codes));
  }, [codes]);

  useEffect(() => {
    localStorage.setItem(FAVORITE_KEY, JSON.stringify([...favorites]));
  }, [favorites]);

  useEffect(() => {
    localStorage.setItem(POSITION_KEY, JSON.stringify(positions));
  }, [positions]);

  useEffect(() => {
    localStorage.setItem(STOCK_CODES_KEY, JSON.stringify(stockCodes));
  }, [stockCodes]);

  useEffect(() => {
    localStorage.setItem(STOCK_POSITION_KEY, JSON.stringify(stockPositions));
  }, [stockPositions]);

  useEffect(() => {
    localStorage.setItem(ADD_PANEL_KEY, addPanelOpen ? "open" : "closed");
  }, [addPanelOpen]);

  const refreshFund = async (code: string) => {
    setLoadingCodes((prev) => new Set(prev).add(code));
    setError(null);
    try {
      const snapshot = await fetchFundSnapshot(code);
      setSnapshots((prev) => ({ ...prev, [code]: snapshot }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingCodes((prev) => {
        const next = new Set(prev);
        next.delete(code);
        return next;
      });
    }
  };

  const refreshStock = async (id: string) => {
    const [market, symbol] = id.split(":") as [StockMarket, string];
    if (!market || !symbol) return;
    setLoadingStocks((prev) => new Set(prev).add(id));
    setError(null);
    try {
      const quote = await fetchStockQuote(market, symbol);
      setStockSnapshots((prev) => ({ ...prev, [quote.id]: quote }));
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setLoadingStocks((prev) => {
        const next = new Set(prev);
        next.delete(id);
        return next;
      });
    }
  };

  useEffect(() => {
    codes.forEach((code) => {
      if (!snapshots[code] && !loadingCodes.has(code)) void refreshFund(code);
    });
  }, [codes]);

  useEffect(() => {
    stockCodes.forEach((id) => {
      if (!stockSnapshots[id] && !loadingStocks.has(id)) void refreshStock(id);
    });
  }, [stockCodes]);

  useEffect(() => {
    const handle = window.setTimeout(() => {
      void searchFunds(query).then(setSuggestions);
    }, 250);
    return () => window.clearTimeout(handle);
  }, [query]);

  const addFund = (value = query) => {
    const match = value.match(/\d{6}/);
    if (!match) {
      setError(isZh ? "请输入 6 位基金代码" : "Enter a 6-digit fund code");
      return;
    }
    const code = match[0];
    setCodes((prev) => (prev.includes(code) ? prev : [code, ...prev]));
    setCollapsedCards((prev) => new Set(prev).add(code));
    setQuery("");
    setSuggestions([]);
    void refreshFund(code);
  };

  const addStock = () => {
    const symbol = stockQuery.trim();
    if (!symbol) {
      setError(isZh ? "请输入股票代码" : "Enter a stock symbol");
      return;
    }
    const id = stockId(stockMarket, symbol);
    setStockCodes((prev) => (prev.includes(id) ? prev : [id, ...prev]));
    setStockQuery("");
    void refreshStock(id);
  };

  const exportFunds = () => {
    const exportPositions = Object.fromEntries(
      Object.entries(positions).map(([code, position]) => [
        code,
        {
          shares: position.shares,
          amount: position.cost,
          holdingShares: position.shares,
          holdingAmount: position.cost,
        },
      ]),
    );
    const payload = {
      source: "Vibe-Trading Fund Baby",
      version: 1,
      exportedAt: new Date().toISOString(),
      codes,
      favorites: [...favorites].filter((code) => codes.includes(code)),
      positions: exportPositions,
    };
    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const date = new Date().toISOString().slice(0, 10);
    const link = document.createElement("a");
    link.href = url;
    link.download = `fund-baby-${date}.json`;
    link.click();
    URL.revokeObjectURL(url);
    setNotice(isZh ? "已导出基金列表" : "Fund list exported");
  };

  const importFunds = async (file: File | null) => {
    if (!file) return;
    setError(null);
    setNotice(null);
    try {
      const payload = JSON.parse(await file.text());
      const imported = parseImportedFunds(payload);
      if (!imported.codes.length) {
        setError(isZh ? "未在文件中识别到基金代码" : "No fund codes found in the file");
        return;
      }
      setCodes((prev) => [...new Set([...prev, ...imported.codes])]);
      setFavorites((prev) => new Set([...prev, ...imported.favorites]));
      setPositions((prev) => ({ ...prev, ...imported.positions }));
      setSnapshots((prev) => ({ ...prev, ...imported.snapshots }));
      setCollapsedCards((prev) => new Set([...prev, ...imported.codes]));
      imported.codes.forEach((code) => void refreshFund(code));
      const positionCount = Object.keys(imported.positions).length;
      const yifangdaShare = imported.positions["002910"]?.shares;
      setNotice(
        isZh
          ? `已导入 ${imported.codes.length} 只基金${positionCount ? `，${positionCount} 条持仓` : ""}${yifangdaShare ? `，002910 份额 ${yifangdaShare}` : ""}${imported.favorites.length ? `，其中 ${imported.favorites.length} 只自选` : ""}`
          : `Imported ${imported.codes.length} funds${positionCount ? `, ${positionCount} positions` : ""}${yifangdaShare ? `, 002910 shares ${yifangdaShare}` : ""}${imported.favorites.length ? `, ${imported.favorites.length} favorites` : ""}`,
      );
    } catch {
      setError(isZh ? "导入失败，请选择有效的 JSON 文件" : "Import failed. Choose a valid JSON file.");
    } finally {
      if (fileInputRef.current) fileInputRef.current.value = "";
    }
  };

  const heldCount = useMemo(
    () => codes.filter((code) => toNumber(positions[code]?.shares) > 0).length,
    [codes, positions],
  );

  const visibleCodes = useMemo(
    () => codes.filter((code) => {
      if (filterMode === "favorites") return favorites.has(code);
      if (filterMode === "held") return toNumber(positions[code]?.shares) > 0;
      return true;
    }),
    [codes, favorites, filterMode, positions],
  );

  const sortedVisibleCodes = useMemo(() => {
    if (sortMode === "default") return visibleCodes;
    return [...visibleCodes].sort((left, right) => {
      if (sortMode === "change") {
        return (snapshots[right]?.gszzl ?? Number.NEGATIVE_INFINITY) - (snapshots[left]?.gszzl ?? Number.NEGATIVE_INFINITY);
      }
      const rightProfit = getPositionMetrics(snapshots[right], positions[right]).holdingProfit;
      const leftProfit = getPositionMetrics(snapshots[left], positions[left]).holdingProfit;
      return rightProfit - leftProfit;
    });
  }, [positions, snapshots, sortMode, visibleCodes]);

  const fundPortfolio = useMemo(() => {
    return codes.reduce(
      (acc, code) => {
        const fund = snapshots[code];
        const position = positions[code];
        if (!fund || !position) return acc;
        const shares = toNumber(position.shares);
        const cost = toNumber(position.cost);
        if (!shares && !cost) return acc;
        const asset = shares > 0 ? shares * fundNav(fund) : cost;
        acc.totalAsset += asset;
        if (shares > 0) {
          acc.todayProfit += shares * (fundNav(fund) - fundBaseNav(fund));
        }
        if (cost > 0 && shares > 0) {
          acc.totalCost += cost;
          acc.holdingProfit += asset - cost;
        } else if (cost > 0) {
          acc.totalCost += cost;
        }
        acc.hasPositions = true;
        return acc;
      },
      { totalAsset: 0, todayProfit: 0, holdingProfit: 0, totalCost: 0, hasPositions: false },
    );
  }, [codes, positions, snapshots]);

  const stockPortfolio = useMemo(() => {
    return stockCodes.reduce(
      (acc, id) => {
        const stock = stockSnapshots[id];
        const position = stockPositions[id];
        if (!position) return acc;
        const metrics = getStockMetrics(stock, position);
        if (!metrics.shares && !metrics.cost) return acc;
        acc.totalAsset += metrics.asset;
        acc.todayProfit += metrics.todayProfit;
        if (metrics.cost > 0) {
          acc.totalCost += metrics.cost;
          acc.holdingProfit += metrics.holdingProfit;
        }
        acc.hasPositions = true;
        return acc;
      },
      { totalAsset: 0, todayProfit: 0, holdingProfit: 0, totalCost: 0, hasPositions: false },
    );
  }, [stockCodes, stockPositions, stockSnapshots]);

  const portfolio = {
    totalAsset: fundPortfolio.totalAsset + stockPortfolio.totalAsset,
    todayProfit: fundPortfolio.todayProfit + stockPortfolio.todayProfit,
    holdingProfit: fundPortfolio.holdingProfit + stockPortfolio.holdingProfit,
    totalCost: fundPortfolio.totalCost + stockPortfolio.totalCost,
    hasPositions: fundPortfolio.hasPositions || stockPortfolio.hasPositions,
  };
  const visiblePortfolio = assetView === "stocks" ? stockPortfolio : assetView === "funds" ? fundPortfolio : portfolio;
  const holdingReturn = visiblePortfolio.totalCost > 0 ? (visiblePortfolio.holdingProfit / visiblePortfolio.totalCost) * 100 : 0;

  return (
    <main className="min-h-screen overflow-auto bg-background">
      <div className="mx-auto max-w-7xl px-4 py-5 sm:px-6">
        <div className="border-b pb-4">
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{isZh ? "持仓监测" : "Holdings Monitor"}</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">
              {isZh
                ? "实时监测基金持仓资产、收益、净值趋势和重仓股。数据来自公开财经接口，仅供研究参考。"
                : "Monitor fund positions, assets, returns, NAV trends, and top holdings from public market data sources."}
            </p>
          </div>
          <div className="mt-4 flex flex-wrap gap-2">
            {(["overview", "funds", "stocks"] as AssetView[]).map((view) => (
              <button
                key={view}
                onClick={() => setAssetView(view)}
                className={cn("rounded-md border px-4 py-2 text-sm font-medium", assetView === view ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {view === "overview" ? (isZh ? "总览" : "Overview") : view === "funds" ? (isZh ? `基金 (${codes.length})` : `Funds (${codes.length})`) : (isZh ? `股票 (${stockCodes.length})` : `Stocks (${stockCodes.length})`)}
              </button>
            ))}
          </div>
        </div>

        <section className="mt-4 rounded-lg border bg-card p-4 shadow-sm">
          <button
            onClick={() => setAddPanelOpen((value) => !value)}
            className="flex w-full items-center justify-between gap-3 text-left"
          >
            <span className="flex items-center gap-2 text-sm font-semibold">
              <Plus className="h-4 w-4" />
              {isZh ? "添加基金" : "Add fund"}
              <span className="font-normal text-muted-foreground">
                {assetView === "stocks"
                  ? (isZh ? "添加港股或美股持仓" : "Add HK or US stock positions")
                  : (isZh ? "搜索并选择基金（支持名称或代码）" : "Search by name or code")}
              </span>
            </span>
            <ChevronDown className={cn("h-4 w-4 text-muted-foreground transition-transform", !addPanelOpen && "-rotate-90")} />
          </button>
          {addPanelOpen && (
            <div className="mt-4 flex flex-col gap-3 md:flex-row md:items-start">
          <input
            ref={fileInputRef}
            type="file"
            accept="application/json,.json"
            className="hidden"
            onChange={(event) => void importFunds(event.target.files?.[0] ?? null)}
          />
          {assetView === "stocks" ? (
            <>
              <select
                value={stockMarket}
                onChange={(event) => setStockMarket(event.target.value as StockMarket)}
                className="h-10 rounded-md border bg-card px-3 text-sm outline-none transition focus:border-primary"
              >
                <option value="HK">{isZh ? "港股" : "HK"}</option>
                <option value="US">{isZh ? "美股" : "US"}</option>
              </select>
              <input
                value={stockQuery}
                onChange={(event) => setStockQuery(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === "Enter") addStock();
                }}
                placeholder={isZh ? "输入股票代码，例如 00700 或 AAPL" : "Enter symbol, e.g. 00700 or AAPL"}
                className="h-10 flex-1 rounded-md border bg-card px-3 text-sm outline-none transition focus:border-primary"
              />
              <button
                onClick={addStock}
                className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
              >
                <Plus className="h-4 w-4" />
                {isZh ? "添加股票" : "Add stock"}
              </button>
            </>
          ) : (
          <>
          <div className="relative flex-1">
            <Search className="pointer-events-none absolute left-3 top-3 h-4 w-4 text-muted-foreground" />
            <input
              value={query}
              onChange={(event) => setQuery(event.target.value)}
              onKeyDown={(event) => {
                if (event.key === "Enter") addFund();
              }}
              placeholder={isZh ? "输入基金代码或名称，例如 110022" : "Search by fund code or name, e.g. 110022"}
              className="h-10 w-full rounded-md border bg-card pl-9 pr-3 text-sm outline-none transition focus:border-primary"
            />
            {suggestions.length > 0 && (
              <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-md border bg-card shadow-lg">
                {suggestions.map((item) => (
                  <button
                    key={item.code}
                    onClick={() => addFund(item.code)}
                    className="flex w-full items-center justify-between gap-3 px-3 py-2 text-left text-sm hover:bg-muted"
                  >
                    <span className="min-w-0 truncate">{item.name}</span>
                    <span className="shrink-0 text-xs text-muted-foreground">{item.code}</span>
                  </button>
                ))}
              </div>
            )}
          </div>
          <button
            onClick={() => addFund()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:bg-primary/90"
          >
            <Plus className="h-4 w-4" />
            {isZh ? "添加基金" : "Add fund"}
          </button>
          </>
          )}
          <button
            onClick={() => {
              if (assetView === "stocks") stockCodes.forEach((id) => void refreshStock(id));
              else visibleCodes.forEach((code) => void refreshFund(code));
            }}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <RefreshCw className="h-4 w-4" />
            {isZh ? "刷新" : "Refresh"}
          </button>
          <button
            onClick={() => fileInputRef.current?.click()}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Upload className="h-4 w-4" />
            {isZh ? "导入" : "Import"}
          </button>
          <button
            onClick={exportFunds}
            className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-4 text-sm text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <Download className="h-4 w-4" />
            {isZh ? "导出" : "Export"}
          </button>
            </div>
          )}
        </section>

        {error && (
          <div className="mt-4 flex items-center gap-2 rounded-md border border-danger/30 bg-danger/10 px-3 py-2 text-sm text-danger">
            <AlertCircle className="h-4 w-4" />
            {error}
          </div>
        )}
        {notice && (
          <div className="mt-4 rounded-md border border-success/30 bg-success/10 px-3 py-2 text-sm text-success">
            {notice}
          </div>
        )}

        <PortfolioSummary
          totalAsset={visiblePortfolio.totalAsset}
          todayProfit={visiblePortfolio.todayProfit}
          holdingProfit={visiblePortfolio.holdingProfit}
          holdingReturn={holdingReturn}
          hasPositions={visiblePortfolio.hasPositions}
        />

        {assetView !== "stocks" && (
        <section className="mt-5 flex flex-wrap items-center justify-between gap-3">
          <div className="flex gap-2">
            <button
              onClick={() => setFilterMode("all")}
              className={cn("rounded-md px-4 py-2 text-sm font-medium", filterMode === "all" ? "bg-primary text-primary-foreground" : "border text-muted-foreground hover:bg-muted")}
            >
              {isZh ? `全部 (${codes.length})` : `All (${codes.length})`}
            </button>
            <button
              onClick={() => setFilterMode("favorites")}
              className={cn("rounded-md px-4 py-2 text-sm font-medium", filterMode === "favorites" ? "bg-primary text-primary-foreground" : "border text-muted-foreground hover:bg-muted")}
            >
              {isZh ? `自选 (${favorites.size})` : `Favorites (${favorites.size})`}
            </button>
            <button
              onClick={() => setFilterMode("held")}
              className={cn("rounded-md px-4 py-2 text-sm font-medium", filterMode === "held" ? "bg-primary text-primary-foreground" : "border text-muted-foreground hover:bg-muted")}
            >
              {isZh ? `持有 (${heldCount})` : `Held (${heldCount})`}
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <button
              onClick={() => setAddPanelOpen((value) => !value)}
              className="inline-flex h-9 w-9 items-center justify-center rounded-md border text-muted-foreground hover:bg-muted hover:text-foreground"
              title={isZh ? "添加基金" : "Add fund"}
            >
              <Plus className="h-4 w-4" />
            </button>
            <div className="flex rounded-md border bg-muted/30 p-1">
              <button
                onClick={() => setViewMode("grid")}
                className={cn("inline-flex h-8 w-8 items-center justify-center rounded", viewMode === "grid" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                title={isZh ? "方格显示" : "Grid view"}
              >
                <Grid2X2 className="h-4 w-4" />
              </button>
              <button
                onClick={() => setViewMode("list")}
                className={cn("inline-flex h-8 w-8 items-center justify-center rounded", viewMode === "list" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground")}
                title={isZh ? "条形显示" : "List view"}
              >
                <List className="h-4 w-4" />
              </button>
            </div>
            <button
              onClick={() => setDensity((value) => (value === "compact" ? "comfortable" : "compact"))}
              className={cn("inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm", density === "compact" ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              title={isZh ? "切换界面密度" : "Toggle density"}
            >
              <SlidersHorizontal className="h-4 w-4" />
              {density === "compact" ? (isZh ? "紧凑" : "Compact") : (isZh ? "舒适" : "Roomy")}
            </button>
            <div className="hidden h-6 w-px bg-border md:block" />
            <span className="inline-flex items-center gap-1 text-sm text-muted-foreground">
              <ArrowDownWideNarrow className="h-4 w-4" />
              {isZh ? "排序" : "Sort"}
            </span>
            {(["default", "change", "holdingProfit"] as SortMode[]).map((mode) => (
              <button
                key={mode}
                onClick={() => setSortMode(mode)}
                className={cn("rounded-md border px-3 py-1.5 text-sm", sortMode === mode ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:bg-muted hover:text-foreground")}
              >
                {mode === "default" ? (isZh ? "默认" : "Default") : mode === "change" ? (isZh ? "涨跌幅" : "Change") : (isZh ? "持有收益" : "Holding P/L")}
              </button>
            ))}
          </div>
        </section>
        )}

        {assetView !== "stocks" && (
        <section className={cn("mt-4 grid", density === "compact" ? "gap-2" : "gap-4", viewMode === "grid" ? "2xl:grid-cols-2" : "grid-cols-1")}>
          {sortedVisibleCodes.map((code) => {
            const fund = snapshots[code];
            if (!fund) {
              const position = positions[code] || { shares: "", cost: "" };
              return (
                <LoadingFundCard
                  key={code}
                  code={code}
                  position={position}
                  density={density}
                  onPositionChange={(nextPosition) => setPositions((prev) => ({ ...prev, [code]: nextPosition }))}
                  onRemove={() => {
                    setCodes((prev) => prev.filter((item) => item !== code));
                    setPositions((prev) => {
                      const next = { ...prev };
                      delete next[code];
                      return next;
                    });
                  }}
                />
              );
            }
            return (
              <FundCard
                key={code}
                fund={fund}
                favorite={favorites.has(code)}
                position={positions[code] || { shares: "", cost: "" }}
                collapsed={collapsedCards.has(code)}
                viewMode={viewMode}
                density={density}
                loading={loadingCodes.has(code)}
                onRefresh={() => void refreshFund(code)}
                onRemove={() => {
                  setCodes((prev) => prev.filter((item) => item !== code));
                  setFavorites((prev) => {
                    const next = new Set(prev);
                    next.delete(code);
                    return next;
                  });
                  setPositions((prev) => {
                    const next = { ...prev };
                    delete next[code];
                    return next;
                  });
                  setCollapsedCards((prev) => {
                    const next = new Set(prev);
                    next.delete(code);
                    return next;
                  });
                }}
                onFavorite={() =>
                  setFavorites((prev) => {
                    const next = new Set(prev);
                    if (next.has(code)) next.delete(code);
                    else next.add(code);
                    return next;
                  })
                }
                onToggleCollapsed={() =>
                  setCollapsedCards((prev) => {
                    const next = new Set(prev);
                    if (next.has(code)) next.delete(code);
                    else next.add(code);
                    return next;
                  })
                }
                onPositionChange={(position) => setPositions((prev) => ({ ...prev, [code]: position }))}
              />
            );
          })}
        </section>
        )}

        {assetView !== "funds" && (
        <section className={cn("mt-4 grid", density === "compact" ? "gap-2" : "gap-4", viewMode === "grid" ? "2xl:grid-cols-2" : "grid-cols-1")}>
          {stockCodes.map((id) => {
            const stock = stockSnapshots[id];
            const position = stockPositions[id] || { shares: "", cost: "" };
            if (!stock) {
              return (
                <div key={id} className={cn("rounded-lg border bg-card shadow-sm", density === "compact" ? "p-2" : "p-4")}>
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex items-center gap-2 text-sm font-semibold">
                      <Loader2 className="h-4 w-4 animate-spin text-muted-foreground" />
                      {isZh ? `正在加载 ${id}` : `Loading ${id}`}
                    </div>
                    <button
                      onClick={() => setStockCodes((prev) => prev.filter((item) => item !== id))}
                      className="rounded-md p-2 text-muted-foreground hover:bg-danger/10 hover:text-danger"
                    >
                      <Trash2 className="h-4 w-4" />
                    </button>
                  </div>
                </div>
              );
            }
            return (
              <StockCard
                key={id}
                stock={stock}
                position={position}
                density={density}
                loading={loadingStocks.has(id)}
                onRefresh={() => void refreshStock(id)}
                onRemove={() => {
                  setStockCodes((prev) => prev.filter((item) => item !== id));
                  setStockPositions((prev) => {
                    const next = { ...prev };
                    delete next[id];
                    return next;
                  });
                }}
                onPositionChange={(nextPosition) => setStockPositions((prev) => ({ ...prev, [id]: nextPosition }))}
              />
            );
          })}
        </section>
        )}

        {assetView !== "stocks" && sortedVisibleCodes.length === 0 && (
          <div className="mt-12 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">{isZh ? "还没有基金" : "No funds yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isZh ? "添加一个 6 位基金代码即可开始跟踪。" : "Add a 6-digit fund code to start tracking."}
            </p>
          </div>
        )}
        {assetView !== "funds" && stockCodes.length === 0 && (
          <div className="mt-12 rounded-lg border border-dashed p-10 text-center">
            <p className="text-sm font-medium">{isZh ? "还没有股票" : "No stocks yet"}</p>
            <p className="mt-1 text-sm text-muted-foreground">
              {isZh ? "切换到股票页，添加港股或美股代码即可开始监测。" : "Switch to Stocks and add HK or US symbols to start monitoring."}
            </p>
          </div>
        )}
      </div>
    </main>
  );
}
