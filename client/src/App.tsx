import { useCallback, useEffect, useRef, useState } from "react";
import { AllTracked } from "./routes/AllTracked.js";
import { FocusQueue } from "./routes/FocusQueue.js";
import { Workbench } from "./routes/Workbench.js";
import { ProposeChange } from "./routes/ProposeChange.js";
import { AppHeader } from "./components/AppHeader.js";
import { DEFAULT_PAGE, type PrimaryPage } from "./lib/navigation.js";
import {
  isLatestHealthRequest,
  resolveHealthBanner,
  type HealthBanner,
} from "./lib/health-request.js";
import { api, type FocusQueueRow } from "./lib/api.js";

type Route =
  | { page: "inbox" }
  | { page: "coverage" }
  | { page: "propose" }
  | { page: "review"; item: FocusQueueRow };

export function App() {
  const [route, setRoute] = useState<Route>({ page: DEFAULT_PAGE });
  const [healthBanner, setHealthBanner] = useState<HealthBanner>(null);
  const healthRequestSeq = useRef(0);

  const refreshHealth = useCallback(async () => {
    const requestId = ++healthRequestSeq.current;
    try {
      const result = await api.getHealth();
      if (!isLatestHealthRequest(requestId, healthRequestSeq.current)) {
        return;
      }
      setHealthBanner(
        resolveHealthBanner({
          kind: "ok",
          healthy: result.healthy,
          issues: result.issues,
        }),
      );
    } catch {
      if (!isLatestHealthRequest(requestId, healthRequestSeq.current)) {
        return;
      }
      setHealthBanner(resolveHealthBanner({ kind: "error" }));
    }
  }, []);

  useEffect(() => {
    void refreshHealth();
  }, [refreshHealth]);

  const handleNavigate = (page: PrimaryPage) => {
    setRoute({ page });
  };

  const handleOpenReview = (item: FocusQueueRow) => {
    setRoute({ page: "review", item });
  };

  const headerActive: PrimaryPage =
    route.page === "review" ? "inbox" : route.page;

  return (
    <div className="app-shell">
      <AppHeader active={headerActive} onNavigate={handleNavigate} />
      {healthBanner === "unavailable" && (
        <div className="health-banner" role="alert">
          Control Tower is unavailable.{" "}
          <button
            type="button"
            className="button button--quiet"
            onClick={() => void refreshHealth()}
          >
            Retry connection
          </button>
        </div>
      )}
      {route.page === "inbox" && (
        <FocusQueue onOpenReview={handleOpenReview} />
      )}
      {route.page === "coverage" && <AllTracked />}
      {route.page === "propose" && <ProposeChange />}
      {route.page === "review" && (
        <Workbench
          item={route.item}
          onBack={() => setRoute({ page: "inbox" })}
        />
      )}
    </div>
  );
}
