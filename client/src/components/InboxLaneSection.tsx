import { useState, type ReactNode } from "react";

interface InboxLaneSectionProps {
  title: string;
  description: string;
  count: number;
  children: ReactNode;
}

/** Collapsible lane group (Now/Next/Monitor) with a count badge and on-demand expand/collapse. */
export function InboxLaneSection({
  title,
  description,
  count,
  children,
}: InboxLaneSectionProps) {
  const [expanded, setExpanded] = useState(count > 0);
  const panelId = `inbox-lane-${title.toLowerCase()}`;

  return (
    <section className="inbox-lane">
      <button
        type="button"
        className="inbox-lane__header"
        aria-expanded={expanded}
        aria-controls={panelId}
        onClick={() => setExpanded((prev) => !prev)}
      >
        <span className="inbox-lane__heading">
          <span className="inbox-lane__title">{title}</span>
          <span className="inbox-lane__count">{count}</span>
          <span className="inbox-lane__subtitle">{description}</span>
        </span>
        <svg
          className={
            expanded
              ? "inbox-lane__chevron"
              : "inbox-lane__chevron inbox-lane__chevron--collapsed"
          }
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          aria-hidden="true"
        >
          <path
            d="M4 6l4 4 4-4"
            stroke="currentColor"
            strokeWidth="1.75"
            strokeLinecap="round"
            strokeLinejoin="round"
          />
        </svg>
      </button>
      <div id={panelId} className="inbox-lane__body" hidden={!expanded}>
        {children}
      </div>
    </section>
  );
}
