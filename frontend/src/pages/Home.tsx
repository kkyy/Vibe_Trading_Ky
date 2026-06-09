import { Link } from "react-router-dom";
import { ArrowRight, Bot, BarChart3, Zap, UserCircle2 } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";

export function Home() {
  const { isZh } = useLanguage();
  const FEATURES = [
    {
      icon: Bot,
      title: isZh ? "AI 智能体" : "AI Agent",
      desc: isZh ? "用自然语言生成策略，并通过 ReAct 推理调用工具" : "Natural language strategy generation with ReAct reasoning",
    },
    {
      icon: BarChart3,
      title: isZh ? "内置回测" : "Built-in Backtest",
      desc: isZh ? "覆盖 A 股、美股、港股和加密资产的 7 类数据源" : "7 data sources across A-shares, US/HK & Crypto",
    },
    {
      icon: Zap,
      title: isZh ? "实时流式执行" : "Real-time Streaming",
      desc: isZh ? "实时查看智能体思考、调用工具和迭代过程" : "Watch the agent think, call tools, and iterate",
    },
    {
      icon: UserCircle2,
      title: isZh ? "策略复盘" : "Strategy Replay",
      desc: isZh
        ? "交易日志分析 + Shadow Account，提取你的交易规则、回测并归因盈亏差异"
        : "Trade journal analyzer + Shadow Account: extract your rules, backtest them, attribute PnL delta",
    },
  ];

  return (
    <div className="flex flex-col items-center justify-center min-h-screen p-8">
      <div className="max-w-2xl text-center space-y-6">
        <h1 className="text-4xl font-bold tracking-tight">
          {isZh ? "AI 驱动的量化策略研究" : "AI-Powered Quant Strategy Research"}
        </h1>
        <p className="text-lg text-muted-foreground">
          {isZh
            ? "用自然语言描述交易策略。智能体会生成代码、运行回测并实时优化。"
            : "Describe a trading strategy in natural language. The agent generates code, runs backtests, and optimizes in real time."}
        </p>
        <Link
          to="/agent"
          className="inline-flex items-center gap-2 px-6 py-3 rounded-lg bg-primary text-primary-foreground font-medium hover:opacity-90 transition"
        >
          {isZh ? "开始研究" : "Start Research"} <ArrowRight className="h-4 w-4" />
        </Link>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-6 mt-16 max-w-5xl w-full">
        {FEATURES.map(({ icon: Icon, title, desc }) => (
          <div key={title} className="border rounded-lg p-6 space-y-3">
            <Icon className="h-8 w-8 text-primary" />
            <h3 className="font-semibold">{title}</h3>
            <p className="text-sm text-muted-foreground">{desc}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
