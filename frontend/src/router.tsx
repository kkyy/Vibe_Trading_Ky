import { Suspense, lazy, type ComponentType } from "react";
import { createBrowserRouter } from "react-router-dom";
import { Layout } from "@/components/layout/Layout";
import { useLanguage } from "@/hooks/useLanguage";

const Home = lazy(() => import("@/pages/Home").then((m) => ({ default: m.Home })));
const Agent = lazy(() => import("@/pages/Agent").then((m) => ({ default: m.Agent })));
const RunDetail = lazy(() =>
  import("@/pages/RunDetail").then((m) => ({ default: m.RunDetail })),
);
const Compare = lazy(() =>
  import("@/pages/Compare").then((m) => ({ default: m.Compare })),
);
const Settings = lazy(() =>
  import("@/pages/Settings").then((m) => ({ default: m.Settings })),
);
const Correlation = lazy(() =>
  import("@/pages/Correlation").then((m) => ({ default: m.Correlation })),
);
const AlphaZoo = lazy(() =>
  import("@/pages/AlphaZoo").then((m) => ({ default: m.AlphaZoo })),
);
const ModulePlaceholder = lazy(() =>
  import("@/pages/ModulePlaceholder").then((m) => ({ default: m.ModulePlaceholder })),
);
const EventProbability = lazy(() =>
  import("@/pages/EventProbability").then((m) => ({ default: m.EventProbability })),
);

function PageLoader() {
  const { isZh } = useLanguage();
  return (
    <div className="flex h-[60vh] items-center justify-center text-muted-foreground">
      {isZh ? "加载中..." : "Loading..."}
    </div>
  );
}

function wrap(Component: ComponentType) {
  return (
    <Suspense fallback={<PageLoader />}>
      <Component />
    </Suspense>
  );
}

export const router = createBrowserRouter([
  {
    element: <Layout />,
    children: [
      { path: "/", element: wrap(Home) },
      { path: "/news", element: wrap(() => <ModulePlaceholder kind="news" />) },
      { path: "/event-probability", element: wrap(EventProbability) },
      { path: "/holdings", element: wrap(() => <ModulePlaceholder kind="holdings" />) },
      { path: "/agent", element: wrap(Agent) },
      { path: "/settings", element: wrap(Settings) },
      { path: "/runs/:runId", element: wrap(RunDetail) },
      { path: "/compare", element: wrap(Compare) },
      { path: "/correlation", element: wrap(Correlation) },
      { path: "/alpha-zoo", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/bench", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/compare", element: wrap(AlphaZoo) },
      { path: "/alpha-zoo/:alphaId", element: wrap(AlphaZoo) },
    ],
  },
]);
