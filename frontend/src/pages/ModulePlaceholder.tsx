import { Activity, BriefcaseBusiness, Newspaper } from "lucide-react";
import { useLanguage } from "@/hooks/useLanguage";

type ModuleKind = "news" | "event-probability" | "holdings";

const MODULES = {
  news: {
    icon: Newspaper,
    title: "新闻",
    enTitle: "News",
  },
  "event-probability": {
    icon: Activity,
    title: "事件概率",
    enTitle: "Event Probability",
  },
  holdings: {
    icon: BriefcaseBusiness,
    title: "持仓监测",
    enTitle: "Holdings Monitor",
  },
} satisfies Record<ModuleKind, { icon: typeof Newspaper; title: string; enTitle: string }>;

export function ModulePlaceholder({ kind }: { kind: ModuleKind }) {
  const { isZh } = useLanguage();
  const module = MODULES[kind];
  const Icon = module.icon;

  return (
    <div className="p-4 md:p-8 max-w-6xl mx-auto">
      <div className="flex items-center gap-3">
        <Icon className="h-6 w-6 text-primary" aria-hidden="true" />
        <h1 className="text-2xl md:text-3xl font-bold tracking-tight">
          {isZh ? module.title : module.enTitle}
        </h1>
      </div>
    </div>
  );
}
