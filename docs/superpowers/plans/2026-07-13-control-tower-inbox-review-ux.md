# Control Tower Inbox + Review UX Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Replace the Phase 1 prototype navigation with an actionable, advisor-ranked Inbox, a draft-gated Review experience, and a focused Coverage audit surface without changing Control Tower policy or publication authority.

**Architecture:** Keep the existing `/api/queue` and draft endpoints. Add only the canonical repository key and deterministic queue-order tuple already present in backend policy inputs so the client can invoke analysis correctly and produce an advisor-default order with the same stable tie-break. Put all client display decisions (eligibility, state/CTA, reason summaries, filtering, and ordering) in pure `client/src/lib` helpers, then keep route components responsible for loading data, invoking API actions, and rendering shared presentational components backed by one token stylesheet.

**Tech Stack:** TypeScript, React 19, Vite, Vitest, Hono, SQLite projection layer, CSS custom properties.

---

## File structure

| Path | Responsibility |
| --- | --- |
| `src/api/contracts.ts` | Extend the queue-row contract with its canonical repository key and the existing deterministic sort tuple. |
| `src/api/projections/queue.ts` | Project the canonical repository key and policy queue tuple into every queue row without changing eligibility or priority decisions. |
| `client/src/lib/api.ts` | Mirror the extended queue contract for the React client. |
| `client/src/lib/queue-display.ts` | Pure functions for eligibility, advisor-first ordering, state/CTA mapping, and reason summaries. |
| `client/src/lib/review-fallback.ts` | Pure fallback action selection for stale or missing drafts. |
| `client/src/lib/navigation.ts` | Default page and the user-visible primary navigation contract. |
| `client/src/components/AppHeader.tsx` | Shell header and the Inbox / Coverage / Propose navigation. |
| `client/src/components/StatusChip.tsx` | Semantic state chip for Inbox rows. |
| `client/src/components/ReasonLine.tsx` | One safe, deduplicated eligibility or exclusion summary. |
| `client/src/components/AdvisorNote.tsx` | Advisor recommendation or the explicit “No advisor yet” empty value. |
| `client/src/components/PrimaryButton.tsx` | Shared primary and quiet button variants. |
| `client/src/components/EmptyState.tsx` | Reusable title, explanation, and action container. |
| `client/src/routes/FocusQueue.tsx` | Rework the existing route into the Inbox experience; retain its filename to avoid a broad import rename. |
| `client/src/routes/AllTracked.tsx` | Rework the existing route into the Coverage audit. |
| `client/src/routes/Workbench.tsx` | Rework the existing route into the Review experience and its recoverable missing-draft state. |
| `client/src/routes/ProposeChange.tsx` | Apply the shared shell classes without changing proposal behavior. |
| `client/src/App.tsx` | Route state, health banner, draft-gated Review handoff, and shared shell composition. |
| `client/src/index.css` | Design tokens and the complete responsive desktop visual system. |
| `tests/api/queue-projection.test.ts` | Assert the new projection metadata preserves existing backend ordering input. |
| `tests/client/queue-display.test.ts` | Unit-test state, CTA, sort, eligibility, filter, and reason-summary decisions. |
| `tests/client/review-fallback.test.ts` | Unit-test the stale/missing-draft recovery action. |
| `tests/client/navigation.test.ts` | Unit-test the default home and deliberately restricted top navigation. |

Do not modify policy evaluation, discovery, job transitions, Cursor harnesses, publication guards, or database migrations. Do not add a Defer action: it has no persistent attention-state operation in the current backend.

### Task 1: Expose canonical action identity and the authoritative deterministic tie-break

**Files:**
- Modify: `src/api/contracts.ts:33-51`
- Modify: `src/api/projections/queue.ts:9-136`
- Modify: `client/src/lib/api.ts:139-185`
- Modify: `tests/api/queue-projection.test.ts:10-102`

- [ ] **Step 1: Write the failing projection contract test**

Add the canonical `repositoryKey` and `queueOrder` expectations to the existing fixture test. The tuple must include the policy’s priority ordinal, explicit-review position, selected queue timestamp, repository key, and PR number; the test does not recalculate policy.

```ts
expect(row.repositoryKey).toBe("pba-webapp");
expect(row.queueOrder).toEqual({
  prioritySortOrdinal: 1,
  explicitRequestSort: 0,
  queueTimestamp: "2026-07-10T12:00:00.000Z",
  normalizedRepositoryIdentity: "pba-webapp",
  prNumber: 42,
});
```

- [ ] **Step 2: Run the focused test to verify it fails**

Run: `pnpm vitest run tests/api/queue-projection.test.ts`

Expected: FAIL because `TrackedQueueRow` and `projectTrackedItem()` do not yet provide `repositoryKey` or `queueOrder`.

- [ ] **Step 3: Add the shared contract field**

In `src/api/contracts.ts`, add this interface immediately before `TrackedQueueRow`, then add `repositoryKey: string;` immediately before the display-oriented `repository` field and `queueOrder: QueueOrder;` after `priorityReasons`.

```ts
export interface QueueOrder {
  prioritySortOrdinal: number;
  explicitRequestSort: 0 | 1;
  queueTimestamp: string;
  normalizedRepositoryIdentity: string;
  prNumber: number;
}
```

Mirror the same `QueueOrder`, `repositoryKey`, and `queueOrder` fields in `client/src/lib/api.ts`. Keep the types structurally identical; the file’s existing contract comment requires this. `repository` remains the owner/repository display string, while `repositoryKey` is the input accepted by `POST /api/jobs/analyze`.

- [ ] **Step 4: Project the existing queue tuple, without changing policy**

Import `toQueueTuple` from `../../policy/queue-order.js` in `src/api/projections/queue.ts`. In `projectTrackedItem`, compute the tuple directly from the already-evaluated `AllTrackedItem`; then assign it to the returned row.

```ts
const queueOrder = toQueueTuple({
  prNumber: item.prNumber,
  normalizedRepositoryIdentity: item.repositoryKey,
  prioritySortOrdinal: item.policy.prioritySortOrdinal,
  explicitRequest: item.reviewRequested,
  explicitRequestTimestamp: item.explicitRequestTimestamp ?? undefined,
  updatedAt: item.updatedAt,
  eligible: item.policy.eligible,
});

return {
  jobId: job?.id ?? null,
  repositoryKey: item.repositoryKey,
  repository: repo,
  prNumber: item.prNumber,
  title: item.title,
  author: item.author,
  headSha: item.headSha,
  eligibilityReasons: item.policy.eligibilityReasons as unknown as TrackedQueueRow["eligibilityReasons"],
  exclusionReasons: item.policy.exclusionReasons as unknown as TrackedQueueRow["exclusionReasons"],
  priority: item.policy.priorityStatus,
  priorityReasons: item.policy.priorityReasons as unknown as TrackedQueueRow["priorityReasons"],
  queueOrder,
  domains: item.policy.selectedDomains.map((d) => d.domain),
  attentionState: att?.state ?? "monitoring",
  jobState: job?.state ?? null,
  advisorResult: buildAdvisorResult(att),
  discoveredAt: att?.created_at ?? item.updatedAt ?? new Date().toISOString(),
  updatedAt: item.updatedAt ?? new Date().toISOString(),
};
```

`toQueueTuple()` owns date normalization and the existing unknown timestamp behavior. Do not reimplement it and do not sort in the endpoint.

- [ ] **Step 5: Run the focused test to verify it passes**

Run: `pnpm vitest run tests/api/queue-projection.test.ts`

Expected: PASS with the new `queueOrder` assertion and the pre-existing projection assertion.

- [ ] **Step 6: Commit the projection contract**

```bash
git add src/api/contracts.ts src/api/projections/queue.ts client/src/lib/api.ts tests/api/queue-projection.test.ts
git commit -m "feat(queue): expose deterministic display order"
```

### Task 2: Define and test all client display decisions as pure functions

**Files:**
- Create: `client/src/lib/queue-display.ts`
- Create: `client/src/lib/review-fallback.ts`
- Create: `tests/client/queue-display.test.ts`
- Create: `tests/client/review-fallback.test.ts`

- [ ] **Step 1: Write failing display-state, ordering, reason, filter, and fallback tests**

Create `tests/client/queue-display.test.ts`. Use rows with all required `TrackedQueueRow` fields; keep the fixture local to this test so it documents the UI boundary. Cover the following exact cases:

```ts
import { describe, expect, it } from "vitest";
import {
  deriveInboxPresentation,
  filterCoverageRows,
  isEligible,
  sortInboxRows,
  summarizeReasons,
} from "../../client/src/lib/queue-display.js";
import type { TrackedQueueRow } from "../../client/src/lib/api.js";

function row(overrides: Partial<TrackedQueueRow> = {}): TrackedQueueRow {
  return {
    jobId: null,
    repositoryKey: "repo",
    repository: "org/repo",
    prNumber: 42,
    title: "Improve review flow",
    author: "dev",
    headSha: "a".repeat(40),
    eligibilityReasons: [{ code: "eligible_path", matchedPath: "sdk/a.ts" }],
    exclusionReasons: [],
    priority: "p1",
    priorityReasons: [],
    queueOrder: {
      prioritySortOrdinal: 1,
      explicitRequestSort: 1,
      queueTimestamp: "2026-07-13T10:00:00.000Z",
      normalizedRepositoryIdentity: "repo",
      prNumber: 42,
    },
    domains: ["sdk"],
    attentionState: "ready_for_analysis",
    jobState: null,
    advisorResult: null,
    discoveredAt: "2026-07-13T09:00:00.000Z",
    updatedAt: "2026-07-13T10:00:00.000Z",
    ...overrides,
  };
}

it("maps eligible work without a job to Needs analysis and Analyze", () => {
  expect(deriveInboxPresentation(row())).toEqual({
    chip: "needs-analysis",
    primaryAction: "analyze",
  });
});

it("never offers Review while a job is running", () => {
  expect(deriveInboxPresentation(row({ jobId: "job-1", jobState: "running_agent" })))
    .toEqual({ chip: "analyzing", primaryAction: null });
});

it("offers Open Review only for a draft-ready job", () => {
  expect(deriveInboxPresentation(row({ jobId: "job-1", jobState: "draft_ready" })))
    .toEqual({ chip: "ready", primaryAction: "open-review" });
});

it("maps a failed job to Retry", () => {
  expect(deriveInboxPresentation(row({ jobId: "job-1", jobState: "failed" })))
    .toEqual({ chip: "failed", primaryAction: "retry" });
});

it("maps ineligible monitoring work to Waiting", () => {
  const item = row({ priority: "unranked", exclusionReasons: [{ code: "no_eligible_path_or_author_match" }] });
  expect(isEligible(item)).toBe(false);
  expect(deriveInboxPresentation(item)).toEqual({ chip: "waiting", primaryAction: null });
});

it("puts current advice first and uses the full deterministic tuple for ties", () => {
  const rows = sortInboxRows([
    row({ prNumber: 3, queueOrder: { ...row().queueOrder, prNumber: 3, normalizedRepositoryIdentity: "z" } }),
    row({ prNumber: 2, advisorResult: { relevance: "high", risk: "critical", explanation: "Review error handling.", recommendedAction: "review", confidence: "high", unknowns: [], stale: false }, queueOrder: { ...row().queueOrder, prNumber: 2, normalizedRepositoryIdentity: "b" } }),
    row({ prNumber: 1, advisorResult: { relevance: "high", risk: "critical", explanation: "Review API flow.", recommendedAction: "review", confidence: "high", unknowns: [], stale: false }, queueOrder: { ...row().queueOrder, prNumber: 1, normalizedRepositoryIdentity: "a" } }),
  ]);
  expect(rows.map((item) => item.prNumber)).toEqual([1, 2, 3]);
});

it("treats stale advice as deterministic, not current, advice", () => {
  const stale = row({ prNumber: 2, advisorResult: { relevance: "critical", risk: "critical", explanation: "Old result.", recommendedAction: "review", confidence: "high", unknowns: [], stale: true }, queueOrder: { ...row().queueOrder, prNumber: 2 } });
  const current = row({ prNumber: 1, queueOrder: { ...row().queueOrder, prNumber: 1 } });
  expect(sortInboxRows([stale, current]).map((item) => item.prNumber)).toEqual([1, 2]);
});

it("deduplicates repeated eligible paths into one Why line", () => {
  expect(summarizeReasons(row({ eligibilityReasons: [
    { code: "eligible_path", matchedPath: "sdk/a.ts" },
    { code: "eligible_path", matchedPath: "sdk/b.ts" },
  ] }))).toBe("eligible path · sdk/a.ts");
});

it("defaults Coverage to eligible rows and filters its search text", () => {
  const eligible = row({ prNumber: 7, title: "SDK support", author: "alex" });
  const ineligible = row({ prNumber: 8, priority: "unranked", exclusionReasons: [{ code: "inactive_repository" }] });
  expect(filterCoverageRows([eligible, ineligible], "eligible", "sdk")).toEqual([eligible]);
});
```

Create `tests/client/review-fallback.test.ts` with the recovery boundary:

```ts
import { describe, expect, it } from "vitest";
import { getReviewFallback } from "../../client/src/lib/review-fallback.js";

describe("getReviewFallback", () => {
  it("offers Retry and Back for a stale job with no draft", () => {
    expect(getReviewFallback({ jobId: "job-1", jobState: "draft_ready" })).toEqual({
      action: "retry",
      label: "Retry Analysis",
      message: "The draft is not available yet or is no longer current.",
    });
  });

  it("offers Analyze and Back when no job exists", () => {
    expect(getReviewFallback({ jobId: null, jobState: null })).toEqual({
      action: "analyze",
      label: "Analyze",
      message: "Analysis has not started for this pull request.",
    });
  });
});
```

- [ ] **Step 2: Run the focused tests to verify they fail**

Run: `pnpm vitest run tests/client/queue-display.test.ts tests/client/review-fallback.test.ts`

Expected: FAIL with module-not-found errors for `queue-display.js` and `review-fallback.js`.

- [ ] **Step 3: Implement the pure display helper**

Create `client/src/lib/queue-display.ts` with these exported types and functions. Do not import backend modules into the Vite client; the projected tuple is the client boundary.

```ts
import type {
  AdvisorResult,
  EligibilityReason,
  TrackedQueueRow,
} from "./api.js";

export type InboxChip = "needs-analysis" | "analyzing" | "ready" | "waiting" | "failed";
export type InboxAction = "analyze" | "open-review" | "retry" | null;
export type CoverageFilter = "eligible" | "ineligible" | "all";

const ACTIVE_JOB_STATES = new Set([
  "queued",
  "preparing_context",
  "preparing_source",
  "running_agent",
  "validating_output",
]);

const REVIEWABLE_JOB_STATES = new Set([
  "draft_ready",
  "awaiting_approval",
  "publishing",
]);

const ORDINAL: Record<string, number> = {
  critical: 0,
  high: 1,
  medium: 2,
  low: 3,
  unknown: 4,
};

export function isEligible(item: TrackedQueueRow): boolean {
  return item.priority !== "unranked" && item.exclusionReasons.length === 0;
}

export function deriveInboxPresentation(
  item: TrackedQueueRow,
): { chip: InboxChip; primaryAction: InboxAction } {
  if (item.jobState === "failed") return { chip: "failed", primaryAction: "retry" };
  if (item.jobState !== null && REVIEWABLE_JOB_STATES.has(item.jobState)) {
    return { chip: "ready", primaryAction: "open-review" };
  }
  if (item.jobState !== null && ACTIVE_JOB_STATES.has(item.jobState)) {
    return { chip: "analyzing", primaryAction: null };
  }
  if (isEligible(item)) return { chip: "needs-analysis", primaryAction: "analyze" };
  return { chip: "waiting", primaryAction: null };
}

function hasCurrentAdvice(result: AdvisorResult | null): result is AdvisorResult {
  return result !== null && !result.stale;
}

function compareQueueOrder(a: TrackedQueueRow, b: TrackedQueueRow): number {
  const left = a.queueOrder;
  const right = b.queueOrder;
  if (left.prioritySortOrdinal !== right.prioritySortOrdinal) {
    return left.prioritySortOrdinal - right.prioritySortOrdinal;
  }
  if (left.explicitRequestSort !== right.explicitRequestSort) {
    return left.explicitRequestSort - right.explicitRequestSort;
  }
  if (left.queueTimestamp !== right.queueTimestamp) {
    return left.queueTimestamp < right.queueTimestamp ? -1 : 1;
  }
  if (left.normalizedRepositoryIdentity !== right.normalizedRepositoryIdentity) {
    return left.normalizedRepositoryIdentity < right.normalizedRepositoryIdentity ? -1 : 1;
  }
  return left.prNumber - right.prNumber;
}

export function sortInboxRows(items: TrackedQueueRow[]): TrackedQueueRow[] {
  const advised = items.filter((item) => hasCurrentAdvice(item.advisorResult));
  const other = items.filter((item) => !hasCurrentAdvice(item.advisorResult));
  advised.sort((a, b) => {
    const relevance = (ORDINAL[a.advisorResult!.relevance] ?? 4) - (ORDINAL[b.advisorResult!.relevance] ?? 4);
    if (relevance !== 0) return relevance;
    const risk = (ORDINAL[a.advisorResult!.risk] ?? 4) - (ORDINAL[b.advisorResult!.risk] ?? 4);
    return risk !== 0 ? risk : compareQueueOrder(a, b);
  });
  other.sort(compareQueueOrder);
  return [...advised, ...other];
}

export function summarizeReasons(item: TrackedQueueRow): string {
  const reasons = item.eligibilityReasons.length > 0
    ? item.eligibilityReasons
    : item.exclusionReasons;
  const first = reasons[0] as EligibilityReason | undefined;
  if (!first) return "No eligibility reason recorded";
  if (first.code === "explicit_review_request") return "explicit review request";
  if (first.code === "eligible_author") return "eligible author";
  if (first.code === "eligible_path") {
    const path = typeof first.matchedPath === "string" ? first.matchedPath : "matched path";
    return `eligible path · ${path}`;
  }
  return first.code.replace(/_/g, " ");
}

export function filterCoverageRows(
  items: TrackedQueueRow[],
  filter: CoverageFilter,
  query: string,
): TrackedQueueRow[] {
  const needle = query.trim().toLowerCase();
  return items.filter((item) => {
    const matchesFilter = filter === "all" || (filter === "eligible" ? isEligible(item) : !isEligible(item));
    const haystack = `${item.repository}#${item.prNumber} ${item.title} ${item.author}`.toLowerCase();
    return matchesFilter && (needle === "" || haystack.includes(needle));
  });
}
```

The `eligible_path` result intentionally takes only the first matched path. That turns a repeated per-file stack into one stable, explainable line without creating a new policy summary.

- [ ] **Step 4: Implement the recovery decision helper**

Create `client/src/lib/review-fallback.ts`:

```ts
export type ReviewFallbackAction = "analyze" | "retry";

export function getReviewFallback(input: {
  jobId: string | null;
  jobState: string | null;
}): { action: ReviewFallbackAction; label: string; message: string } {
  if (input.jobId !== null) {
    return {
      action: "retry",
      label: "Retry Analysis",
      message: "The draft is not available yet or is no longer current.",
    };
  }
  return {
    action: "analyze",
    label: "Analyze",
    message: "Analysis has not started for this pull request.",
  };
}
```

- [ ] **Step 5: Run the focused tests to verify they pass**

Run: `pnpm vitest run tests/client/queue-display.test.ts tests/client/review-fallback.test.ts`

Expected: PASS. The tests exercise the six display decisions before any React markup is introduced.

- [ ] **Step 6: Commit the display rules**

```bash
git add client/src/lib/queue-display.ts client/src/lib/review-fallback.ts tests/client/queue-display.test.ts tests/client/review-fallback.test.ts
git commit -m "feat(client): add inbox display rules"
```

### Task 3: Add a shared, token-based visual foundation

**Files:**
- Create: `client/src/components/AppHeader.tsx`
- Create: `client/src/components/StatusChip.tsx`
- Create: `client/src/components/ReasonLine.tsx`
- Create: `client/src/components/AdvisorNote.tsx`
- Create: `client/src/components/PrimaryButton.tsx`
- Create: `client/src/components/EmptyState.tsx`
- Create: `client/src/lib/navigation.ts`
- Create: `tests/client/navigation.test.ts`
- Modify: `client/src/index.css:1-20`

- [ ] **Step 1: Write the failing primary-navigation contract test**

Create `tests/client/navigation.test.ts`:

```ts
import { describe, expect, it } from "vitest";
import { DEFAULT_PAGE, PRIMARY_NAV } from "../../client/src/lib/navigation.js";

describe("primary navigation", () => {
  it("uses Inbox as the default and does not expose Review in the top navigation", () => {
    expect(DEFAULT_PAGE).toBe("inbox");
    expect(PRIMARY_NAV.map((item) => item.id)).toEqual(["inbox", "coverage", "propose"]);
    expect(PRIMARY_NAV.map((item) => item.id)).not.toContain("review");
  });
});
```

Run: `pnpm vitest run tests/client/navigation.test.ts`

Expected: FAIL with a module-not-found error for `navigation.js`.

- [ ] **Step 2: Create the shared components with stable interfaces**

Create the presentational components below. Each must render untrusted text through `SafeText`; none performs fetching or owns business state.

```tsx
// client/src/components/StatusChip.tsx
import type { InboxChip } from "../lib/queue-display.js";

const LABELS: Record<InboxChip, string> = {
  "needs-analysis": "Needs analysis",
  analyzing: "Analyzing",
  ready: "Ready",
  waiting: "Waiting",
  failed: "Failed",
};

export function StatusChip({ status }: { status: InboxChip }) {
  return <span className={`status-chip status-chip--${status}`}>{LABELS[status]}</span>;
}
```

```tsx
// client/src/components/ReasonLine.tsx
import { SafeText } from "./SafeText.js";

export function ReasonLine({ text }: { text: string }) {
  return <p className="reason-line"><SafeText text={text} /></p>;
}
```

```tsx
// client/src/components/AdvisorNote.tsx
import type { AdvisorResult } from "../lib/api.js";
import { SafeText } from "./SafeText.js";

export function AdvisorNote({ result }: { result: AdvisorResult | null }) {
  if (result === null) return <p className="advisor-note advisor-note--empty">No advisor yet</p>;
  const prefix = result.stale ? "Stale advice — " : "";
  const detail = result.explanation.trim() || result.recommendedAction.replace(/_/g, " ");
  return <p className="advisor-note"><SafeText text={`${prefix}${detail}`} /></p>;
}
```

```tsx
// client/src/components/PrimaryButton.tsx
import type { ButtonHTMLAttributes } from "react";

export function PrimaryButton({
  quiet = false,
  className = "",
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { quiet?: boolean }) {
  return <button {...props} className={`button ${quiet ? "button--quiet" : "button--primary"} ${className}`} />;
}
```

```tsx
// client/src/components/EmptyState.tsx
import type { ReactNode } from "react";

export function EmptyState({
  title,
  body,
  action,
}: { title: string; body: string; action?: ReactNode }) {
  return (
    <section className="empty-state">
      <h2>{title}</h2>
      <p>{body}</p>
      {action}
    </section>
  );
}
```

Create `client/src/lib/navigation.ts`:

```ts
export const PRIMARY_NAV = [
  { id: "inbox", label: "Inbox" },
  { id: "coverage", label: "Coverage" },
  { id: "propose", label: "Propose" },
] as const;

export type PrimaryPage = (typeof PRIMARY_NAV)[number]["id"];
export const DEFAULT_PAGE: PrimaryPage = "inbox";
```

`AppHeader` imports `PRIMARY_NAV`, receives `active: PrimaryPage` and `onNavigate: (page: PrimaryPage) => void`, and maps those three items to buttons. It must not render Review as navigation.

- [ ] **Step 3: Replace the global stylesheet with the actual design system**

Rewrite `client/src/index.css` as one class-based stylesheet. Define the following token values, then use them for every new component and route class:

```css
:root {
  --canvas: #f5f2ec;
  --surface: #fffdf9;
  --surface-muted: #eee9df;
  --ink: #24302c;
  --ink-muted: #65706a;
  --line: #d8d2c7;
  --accent: #1d6155;
  --accent-hover: #164c42;
  --danger: #a64536;
  --warning: #9b691f;
  --radius: 10px;
  --shadow: 0 12px 35px rgb(36 48 44 / 8%);
}
```

Include class rules for `.app-shell`, `.app-header`, `.primary-nav`, `.page-heading`, `.inbox-list`, `.inbox-row`, `.status-chip`, `.advisor-note`, `.reason-line`, `.button`, `.coverage-controls`, `.coverage-table`, `.review-header`, `.review-tabs`, `.empty-state`, `.health-banner`, and `.proposal-page`. Use a single `@media (max-width: 760px)` rule to stack header and row metadata; mobile-first redesign is out of scope, but the desktop UI must not overflow narrow windows. Do not add gradients, glows, `rounded-full`, Tailwind utility dependencies, or inline style objects.

- [ ] **Step 4: Run the navigation test and client build to verify the foundation compiles**

Run:

```bash
pnpm vitest run tests/client/navigation.test.ts
cd client && pnpm build
```

Expected: both commands PASS. This validates the user-visible navigation contract, TypeScript imports, and CSS resolution before routes are migrated.

- [ ] **Step 5: Commit the visual foundation**

```bash
git add client/src/components/AppHeader.tsx client/src/components/StatusChip.tsx client/src/components/ReasonLine.tsx client/src/components/AdvisorNote.tsx client/src/components/PrimaryButton.tsx client/src/components/EmptyState.tsx client/src/lib/navigation.ts tests/client/navigation.test.ts client/src/index.css
git commit -m "feat(client): add control tower visual foundation"
```

### Task 4: Make Inbox the default actionable home

**Files:**
- Modify: `client/src/routes/FocusQueue.tsx:1-185`
- Modify: `client/src/App.tsx:1-81`

- [ ] **Step 1: Write the failing Inbox behavior assertions**

Extend `tests/client/queue-display.test.ts` with the no-draft handoff contract used by the route:

```ts
it("does not classify a queued job as review-ready", () => {
  expect(deriveInboxPresentation(row({ jobId: "job-1", jobState: "queued" })))
    .toEqual({ chip: "analyzing", primaryAction: null });
});
```

Run: `pnpm vitest run tests/client/queue-display.test.ts`

Expected: PASS only after Task 2; this confirms the route can use the helper without inventing a second state mapping.

- [ ] **Step 2: Replace the Focus Queue route markup with Inbox**

Keep the exported component name `FocusQueue` for this slice. Change its props to:

```ts
export function FocusQueue({
  onOpenReview,
}: {
  onOpenReview: (item: FocusQueueRow) => void;
}) { /* implementation */ }
```

Flatten `data.focusQueue.now`, `next`, and `monitor`, apply `sortInboxRows()`, and render one `.inbox-list` by default. Keep a `groupByLane` checkbox as a secondary control; when selected, render the same sorted rows within Now, Next, and Monitor sections. The title and subtitle must be:

```tsx
<h2>Inbox</h2>
<p>{`${items.filter((item) => deriveInboxPresentation(item).primaryAction !== null).length} items need attention · ordered by advisor relevance & risk`}</p>
```

For each row:

```tsx
const presentation = deriveInboxPresentation(item);
<article className="inbox-row" key={`${item.repository}-${item.prNumber}`}>
  <StatusChip status={presentation.chip} />
  <div className="inbox-row__content">
    <h3>
      <code>{`${item.repository.split("/").at(-1)}#${item.prNumber}`}</code>
      <SafeText text={item.title} />
    </h3>
    <p className="row-meta">
      <SafeText text={item.author} />
      {item.priority !== "unranked" && ` · ${item.priority.toUpperCase()}`}
      {item.eligibilityReasons.some((reason) => reason.code === "explicit_review_request") && " · Explicit request"}
    </p>
    <AdvisorNote result={item.advisorResult} />
    <ReasonLine text={summarizeReasons(item)} />
  </div>
</article>
```

Use a local `actioningKey` and `errorByKey` map. `Analyze` calls `api.requestAnalyze({ repositoryKey: item.repositoryKey, prNumber: item.prNumber })`, `Retry` calls `api.requestRetry(item.jobId!)`, then refetches the queue. Show the API error under that row and preserve the row. On `Open Review`, first call `api.getDraft(item.jobId!)`; only invoke `onOpenReview(item)` when it resolves. If it rejects, keep the user on Inbox and show `Draft is not available yet. Retry analysis or refresh the Inbox.` This is the runtime gate that prevents a stale `draft_ready` queue row from navigating to Review.

- [ ] **Step 3: Update App route state, shared header, and health feedback**

Replace `focus`, `all-tracked`, `propose-change`, and `workbench` with these routes:

```ts
type Route =
  | { page: "inbox" }
  | { page: "coverage" }
  | { page: "propose" }
  | { page: "review"; item: FocusQueueRow };
```

Initialize `{ page: "inbox" }`. Render `AppHeader` outside the route switch and pass `active={route.page === "review" ? "inbox" : route.page}`. The Review route remains absent from `PRIMARY_NAV`.

Load `api.getHealth()` in an effect. If it rejects or returns `{ healthy: false }`, render this above the active route:

```tsx
<div className="health-banner" role="alert">
  Control Tower is unavailable. <button onClick={refreshHealth}>Retry connection</button>
</div>
```

`refreshHealth` reruns the exact request and clears the banner only after a healthy result. Do not hide page content when health is unknown.

- [ ] **Step 4: Run focused and build verification**

Run:

```bash
pnpm vitest run tests/client/queue-display.test.ts
cd client && pnpm build
```

Expected: both commands PASS.

- [ ] **Step 5: Commit the Inbox and shell routing**

```bash
git add client/src/App.tsx client/src/routes/FocusQueue.tsx tests/client/queue-display.test.ts
git commit -m "feat(client): make inbox the review home"
```

### Task 5: Turn All Tracked into the Coverage audit surface

**Files:**
- Modify: `client/src/routes/AllTracked.tsx:1-138`

- [ ] **Step 1: Add a failing Coverage filtering case**

Add the title, author, and `repo#PR` search cases to `tests/client/queue-display.test.ts`:

```ts
it("finds Coverage rows by PR identifier and author", () => {
  const item = row({ prNumber: 99, author: "sam" });
  expect(filterCoverageRows([item], "eligible", "#99")).toEqual([item]);
  expect(filterCoverageRows([item], "eligible", "sam")).toEqual([item]);
});
```

Run: `pnpm vitest run tests/client/queue-display.test.ts`

Expected: PASS after the helper’s joined search haystack includes repository, PR number, title, and author.

- [ ] **Step 2: Replace the table behavior and markup**

Keep the `AllTracked` export name. Add local state:

```ts
const [filter, setFilter] = useState<CoverageFilter>("eligible");
const [query, setQuery] = useState("");
const visibleItems = filterCoverageRows(items, filter, query);
```

Render the user-facing title as `Coverage`, then buttons for `Eligible`, `Ineligible`, and `All`, followed by a search input with `aria-label="Search coverage"` and placeholder `Search PR, title, or author`.

Replace the nine-column table header with exactly `PR`, `Title`, `Author`, `Priority`, `Why`, and `Action`. In the Why cell render:

```tsx
<ReasonLine text={summarizeReasons(item)} />
```

Keep Analyze as the only action. On successful `requestAnalyze`, refetch queue data so the row reflects its queued or running job; on failure, retain the row and show its error in the Action cell. Do not render Advisor, Updated, or an unbounded stack of reason rows.

- [ ] **Step 3: Run the client-focused tests and build**

Run:

```bash
pnpm vitest run tests/client/queue-display.test.ts
cd client && pnpm build
```

Expected: PASS.

- [ ] **Step 4: Commit the Coverage surface**

```bash
git add client/src/routes/AllTracked.tsx tests/client/queue-display.test.ts
git commit -m "feat(client): redesign coverage audit"
```

### Task 6: Make Review contextual and recoverable

**Files:**
- Modify: `client/src/routes/Workbench.tsx:1-355`
- Modify: `tests/client/review-fallback.test.ts`

- [ ] **Step 1: Add the failed-job recovery test**

Add this test to `tests/client/review-fallback.test.ts`:

```ts
it("uses Retry even when the unavailable draft came from a failed job", () => {
  expect(getReviewFallback({ jobId: "job-1", jobState: "failed" }).action).toBe("retry");
});
```

Run: `pnpm vitest run tests/client/review-fallback.test.ts`

Expected: PASS. The fallback action is based on the presence of a prior job, not a fragile state-name allowlist.

- [ ] **Step 2: Change Workbench inputs to receive Inbox context**

Replace `WorkbenchProps` with:

```ts
interface WorkbenchProps {
  item: FocusQueueRow;
  onBack: () => void;
}
```

Use `item.jobId!` only after the route has passed an Inbox `Open Review` handoff. Set the review header before the tabs:

```tsx
<header className="review-header">
  <PrimaryButton quiet onClick={onBack}>← Inbox</PrimaryButton>
  <p><code>{`${item.repository.split("/").at(-1)}#${item.prNumber}`}</code></p>
  <h2><SafeText text={item.title} /></h2>
  <p className="row-meta"><SafeText text={item.author} /> · {item.priority.toUpperCase()}</p>
  <AdvisorNote result={item.advisorResult} />
</header>
```

Retain the Understand, Verify, and Act tab data and all existing per-operation approval/publish logic. Replace every inline style object in this route with the classes defined in Task 3. Preserve `SafeText`, `SafeMarkdown`, `CoverageWarning`, visible publication results, and the “No batch approval” copy.

- [ ] **Step 3: Replace the orphan draft message with a recoverable EmptyState**

Replace:

```tsx
if (!draft) return <p>No draft available for this job.</p>;
```

with a context-preserving fallback. Reuse `getReviewFallback({ jobId: item.jobId, jobState: item.jobState })`; call `api.requestRetry(item.jobId!)` for `retry`, otherwise `api.requestAnalyze({ repositoryKey: item.repositoryKey, prNumber: item.prNumber })`. While the action is pending, disable its button. Always render Back to Inbox.

```tsx
if (!draft) {
  const fallback = getReviewFallback({ jobId: item.jobId, jobState: item.jobState });
  return (
    <section className="review-page">
      <header className="review-header">
        <PrimaryButton quiet onClick={onBack}>← Inbox</PrimaryButton>
        <h2><SafeText text={item.title} /></h2>
      </header>
      <EmptyState
        title="Review is not available"
        body={fallback.message}
        action={
          <div className="button-group">
            <PrimaryButton onClick={handleFallback} disabled={recovering}>
              {recovering ? "Starting…" : fallback.label}
            </PrimaryButton>
            <PrimaryButton quiet onClick={onBack}>Back to Inbox</PrimaryButton>
          </div>
        }
      />
    </section>
  );
}
```

Record a recovery error below the action if it fails. Never replace the contextual fallback with a generic null or blank page.

- [ ] **Step 4: Run Review unit and build verification**

Run:

```bash
pnpm vitest run tests/client/review-fallback.test.ts
cd client && pnpm build
```

Expected: PASS.

- [ ] **Step 5: Commit the Review recovery flow**

```bash
git add client/src/routes/Workbench.tsx tests/client/review-fallback.test.ts
git commit -m "feat(client): make review recovery actionable"
```

### Task 7: Bring Propose into the shared shell and verify the complete slice

**Files:**
- Modify: `client/src/routes/ProposeChange.tsx:1-185`
- Modify: `Architecture.md` (only the user-facing surface names)

- [ ] **Step 1: Rewrite ProposeChange’s nonfunctional utility classes**

The project has no Tailwind dependency, so replace all Tailwind-style `className` strings in `ProposeChange.tsx` with the token classes from `index.css`: `.proposal-page`, `.proposal-section`, `.proposal-list`, `.proposal-card`, `.button`, `.button--primary`, `.button--quiet`, `.error-message`, and `.success-message`. Preserve every fetch, mutation, validation, preview, and adoption branch exactly as it is; this task is presentation-only.

- [ ] **Step 2: Update the architecture naming**

In `Architecture.md`, rename only user-facing occurrences:

```text
Focus Queue -> Inbox
All Tracked -> Coverage
Workbench -> Review
```

Do not rename internal API endpoint names, exported component filenames, historical phases, or database concepts.

- [ ] **Step 3: Run automated verification**

Run:

```bash
pnpm test
pnpm typecheck
cd client && pnpm build
```

Expected: all commands PASS. The root test suite verifies projection and display helpers; the client build verifies all React routes and styles.

- [ ] **Step 4: Run the operator acceptance pass**

Start the local daemon in one terminal:

```bash
pnpm ct start
```

Then verify in the served UI:

1. Inbox is the initial route; its primary nav contains Inbox, Coverage, and Propose only.
2. Inbox defaults to a single advisor-ranked list, shows `No advisor yet` rather than `—`, and grouping is optional.
3. Analyze changes the row to pending/running feedback; Ready uses Open Review only after the draft probe succeeds.
4. A missing/stale draft remains recoverable in Review with contextual chrome, Back to Inbox, and Analyze or Retry.
5. Coverage defaults to Eligible, filters by all three toggle values and search text, shows one Why line, and has six columns.
6. Review retains Understand / Verify / Act; per-operation Approve & Publish remains individual and publication errors stay visible.
7. Disconnect or stop the daemon, reload once, and confirm the shell shows a retryable connection banner instead of blanking the page.

- [ ] **Step 5: Commit and inspect the final diff**

```bash
git add client/src/routes/ProposeChange.tsx client/src/index.css Architecture.md
git commit -m "feat(client): complete control tower inbox redesign"
git status --short
git diff HEAD~7..HEAD --check
```

Expected: `git diff --check` produces no whitespace errors. `git status --short` contains no unintended generated files such as `client/dist/`.

## Plan self-review

**Spec coverage**

- Inbox home, advisor-default ordering, optional lanes, state chips, one CTA, recommendations, and deduped reasons: Tasks 2 and 4.
- Hard Review entry gate and stale/draft-empty recovery: Tasks 4 and 6.
- Coverage filtering, search, reduced columns, and refetch feedback: Task 5.
- Shared components, visual constraints, and Propose consistency: Tasks 3 and 7.
- Health/banner error behavior, advisor-unavailable behavior, publish visibility, and preserved authority semantics: Tasks 3, 4, 6, and 7.
- Client-focused acceptance checks, backend projection contract, build, typecheck, and operator validation: Tasks 1, 2, and 7.

**Scope safeguards**

- The sole backend change exposes the canonical repository key and queue ordering tuple already present in policy input; it neither alters eligibility nor invokes agents.
- The client rechecks `/api/drafts/:jobId` before navigating to Review, so a stale queue projection cannot create the existing dead end.
- Defer and new advisor persistence are explicitly omitted because they require missing backend state or scheduled advisor work and are outside this UI slice.

**Type consistency**

- `QueueOrder` is defined with the same shape on server and client.
- `InboxChip`, `InboxAction`, `CoverageFilter`, and `ReviewFallbackAction` are defined once in client helpers and consumed by route components.
- All new API action calls use existing `requestAnalyze`, `requestRetry`, `getDraft`, and action-token handling.
