// client/src/routes/FocusQueue.tsx
import { useEffect, useState } from "react";
import { api, type FocusQueueRow } from "../lib/api.js";
import { SafeText } from "../components/SafeText.js";
import { AdvisorBadge } from "../components/AdvisorBadge.js";

type ViewOrder = "deterministic" | "advisor";

function QueueLane({
  title,
  items,
  onSelect,
}: {
  title: string;
  items: FocusQueueRow[];
  onSelect: (item: FocusQueueRow) => void;
}) {
  if (items.length === 0) {
    return (
      <section style={{ marginBottom: "24px" }}>
        <h3 style={{ fontSize: "1rem", color: "#6b7280" }}>{title}</h3>
        <p style={{ color: "#9ca3af", fontStyle: "italic" }}>No items</p>
      </section>
    );
  }

  return (
    <section style={{ marginBottom: "24px" }}>
      <h3 style={{ fontSize: "1rem", marginBottom: "8px" }}>
        {title} ({items.length})
      </h3>
      {items.map((item) => (
        <div
          key={`${item.repository}-${item.prNumber}`}
          onClick={() => onSelect(item)}
          style={{
            padding: "12px",
            marginBottom: "8px",
            border: "1px solid #e5e7eb",
            borderRadius: "8px",
            cursor: "pointer",
          }}
        >
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <div>
              <span style={{ fontFamily: "monospace", fontSize: "0.875rem", fontWeight: 600 }}>
                <SafeText text={`${item.repository.split("/")[1]}#${item.prNumber}`} />
              </span>
              <span style={{ marginLeft: "8px" }}>
                <SafeText text={item.title} />
              </span>
            </div>
            <AdvisorBadge result={item.advisorResult} />
          </div>
          <div style={{ fontSize: "0.75rem", color: "#6b7280", marginTop: "4px" }}>
            <SafeText text={item.author} /> ·{" "}
            {item.priority !== "unranked" ? item.priority.toUpperCase() : ""} ·{" "}
            {item.domains.join(", ")} ·{" "}
            <SafeText text={item.attentionState.replace(/_/g, " ")} />
          </div>
        </div>
      ))}
    </section>
  );
}

export function FocusQueue({
  onSelectItem,
}: {
  onSelectItem: (item: FocusQueueRow) => void;
}) {
  const [queue, setQueue] = useState<{
    now: FocusQueueRow[];
    next: FocusQueueRow[];
    monitor: FocusQueueRow[];
  }>({ now: [], next: [], monitor: [] });
  const [loading, setLoading] = useState(true);
  const [viewOrder, setViewOrder] = useState<ViewOrder>("deterministic");

  useEffect(() => {
    api
      .getQueue()
      .then((data) => {
        setQueue(data.focusQueue);
        setLoading(false);
      })
      .catch(() => setLoading(false));
  }, []);

  if (loading) return <p>Loading queue…</p>;

  return (
    <div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "16px" }}>
        <h2>Focus Queue</h2>
        <label style={{ fontSize: "0.875rem" }}>
          <input
            type="checkbox"
            checked={viewOrder === "advisor"}
            onChange={(e) =>
              setViewOrder(e.target.checked ? "advisor" : "deterministic")
            }
            style={{ marginRight: "4px" }}
          />
          Advisor order
        </label>
      </div>
      <QueueLane
        title="Now"
        items={queue.now}
        onSelect={onSelectItem}
      />
      <QueueLane
        title="Next"
        items={queue.next}
        onSelect={onSelectItem}
      />
      <QueueLane
        title="Monitor"
        items={queue.monitor}
        onSelect={onSelectItem}
      />
    </div>
  );
}
