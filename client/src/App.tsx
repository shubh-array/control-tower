// client/src/App.tsx
import { useState } from "react";
import { AllTracked } from "./routes/AllTracked.js";
import { FocusQueue } from "./routes/FocusQueue.js";
import { Workbench } from "./routes/Workbench.js";
import { ProposeChange } from "./routes/ProposeChange.js";
import type { FocusQueueRow } from "./lib/api.js";

type Route =
  | { page: "focus" }
  | { page: "all-tracked" }
  | { page: "propose-change" }
  | { page: "workbench"; jobId: string };

export function App() {
  const [route, setRoute] = useState<Route>({ page: "focus" });

  const handleSelectItem = (item: FocusQueueRow) => {
    if (item.jobId) {
      setRoute({ page: "workbench", jobId: item.jobId });
    }
  };

  return (
    <div style={{ fontFamily: "system-ui, sans-serif", maxWidth: "1200px", margin: "0 auto", padding: "16px" }}>
      <header style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "24px", borderBottom: "1px solid #e5e7eb", paddingBottom: "12px" }}>
        <h1 style={{ fontSize: "1.25rem", fontWeight: 700 }}>Control Tower</h1>
        <nav style={{ display: "flex", gap: "12px" }}>
          <button
            onClick={() => setRoute({ page: "focus" })}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: route.page === "focus" ? 700 : 400,
              textDecoration: route.page === "focus" ? "underline" : "none",
            }}
          >
            Focus Queue
          </button>
          <button
            onClick={() => setRoute({ page: "all-tracked" })}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: route.page === "all-tracked" ? 700 : 400,
              textDecoration: route.page === "all-tracked" ? "underline" : "none",
            }}
          >
            All Tracked
          </button>
          <button
            onClick={() => setRoute({ page: "propose-change" })}
            style={{
              border: "none",
              background: "none",
              cursor: "pointer",
              fontWeight: route.page === "propose-change" ? 700 : 400,
              textDecoration: route.page === "propose-change" ? "underline" : "none",
            }}
          >
            Propose Change
          </button>
        </nav>
      </header>

      {route.page === "focus" && (
        <FocusQueue onSelectItem={handleSelectItem} />
      )}
      {route.page === "all-tracked" && <AllTracked />}
      {route.page === "propose-change" && <ProposeChange />}
      {route.page === "workbench" && (
        <Workbench
          jobId={route.jobId}
          onBack={() => setRoute({ page: "focus" })}
        />
      )}
    </div>
  );
}
