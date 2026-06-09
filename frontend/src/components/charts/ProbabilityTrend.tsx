import { useEffect, useRef } from "react";
import { echarts } from "@/lib/echarts";
import { getChartTheme } from "@/lib/chart-theme";

export interface ProbabilityTrendPoint {
  t: number;
  p: number;
}

interface ProbabilityTrendProps {
  data: ProbabilityTrendPoint[];
  height?: number;
}

export function ProbabilityTrend({ data, height = 220 }: ProbabilityTrendProps) {
  const ref = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!ref.current) return;
    const chart = echarts.init(ref.current);
    const theme = getChartTheme();

    chart.setOption({
      animation: false,
      grid: { left: 44, right: 14, top: 18, bottom: 34 },
      tooltip: {
        trigger: "axis",
        valueFormatter: (value: unknown) =>
          typeof value === "number" ? `${value.toFixed(1)}%` : String(value),
      },
      xAxis: {
        type: "time",
        axisLine: { lineStyle: { color: theme.axisColor } },
        axisLabel: { color: theme.textColor },
      },
      yAxis: {
        type: "value",
        min: 0,
        max: 100,
        axisLine: { show: false },
        splitLine: { lineStyle: { color: theme.gridColor } },
        axisLabel: { color: theme.textColor, formatter: "{value}%" },
      },
      series: [
        {
          name: "Yes probability",
          type: "line",
          smooth: true,
          symbol: "none",
          lineStyle: { width: 2, color: theme.infoColor },
          areaStyle: { color: theme.infoColor + "22" },
          data: data.map((point) => [point.t, point.p * 100]),
        },
      ],
    });

    const resize = () => chart.resize();
    window.addEventListener("resize", resize);
    return () => {
      window.removeEventListener("resize", resize);
      chart.dispose();
    };
  }, [data]);

  return <div ref={ref} style={{ height }} className="w-full" />;
}
