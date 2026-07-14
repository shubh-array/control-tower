# Review-Core Simplification Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Reduce Control Tower to the current eligible-PR review workflow: persist and expose only reviewable PRs, remove all-PR Coverage and governed learning/proposal features, and preserve a clean documented seam for a future Delivery Intelligence workflow.

**Architecture:** The review database becomes an eligible-review cache. Discovery still evaluates every PR needed to determine eligibility, but durable writes happen only after a PR is eligible. `prs` becomes the only review-item projection and stores the policy snapshot needed by the Inbox; jobs/runs remain the analysis lifecycle. Product Coverage, `attention_items`, advisor placeholders, learning/proposals, and their APIs/UI are removed. Per-run source/diff coverage remains untouched.

**Tech Stack:** TypeScript, Node.js, SQLite (`better-sqlite3`), Hono, React/Vite, TanStack Query, Vitest.

**Destructive-change policy:** Existing local Control Tower state is intentionally incompatible. Replace the canonical initial schema and require `pnpm ct reset --yes` before starting the new daemon. Do not add compatibility migrations or preserve `attention_items`, proposal, signal, or old Coverage data.

**Runtime safety policy:** A stale database must fail closed, not silently run against removed tables. After migrations, startup detects legacy review-core artifacts (`attention_items`, `advisor_runs`, or `learning_signals`) and throws an error instructing the operator to run `pnpm ct reset --yes`.

---

## Confirmed product decisions

- The Inbox is the only current PR-list surface. Delete `/coverage`, `allTracked`, and the product Coverage terminology.
- Durable discovery data exists only for `PolicyDecision.eligible === true`.
- Manual Analyze is allowed only for a persisted eligible Inbox PR. It must be an honest manual request, not a fabricated GitHub review request.
- Proposal UI, proposal storage, learning signals, attention/advisor code, and the `pr-attention` harness are out of the current product and must be removed.
- Keep per-run `CoverageObject`, `CoverageInfo`, and the Workbench coverage warning. They describe evidence limitations for a review run and are unrelated to the deleted Coverage page.
- Do not add Linear, portfolio, advisor, or delivery tables. Document the Phase 2 Delivery Intelligence boundary instead.

## Target database ownership

| Data | Owner / retention |
|---|---|
| `repositories`, eligible `prs`, `pr_checks`, `pr_comments` | Live eligible-review cache; delete when GitHub confirms a PR is no longer eligible/open. |
| `jobs`, `runs`, `audit_events`, sealed run artifacts | Current review lifecycle and publication evidence. |
| Policy snapshot on `prs` | Current Inbox ordering/display; refreshed on each eligible poll. |
| Ineligible PR metadata, all-PR coverage, advisor facts, Linear facts | Not persisted in Phase 1. |

The persisted `prs` record must include only fields used by the current review flow:

```sql
CREATE TABLE prs (
  id                  INTEGER PRIMARY KEY AUTOINCREMENT,
  repository_id       TEXT NOT NULL REFERENCES repositories(id),
  pr_number           INTEGER NOT NULL,
  head_sha            TEXT NOT NULL,
  base_sha            TEXT NOT NULL,
  title               TEXT NOT NULL,
  url                 TEXT NOT NULL,
  author_login        TEXT NOT NULL,
  explicit_request    INTEGER NOT NULL DEFAULT 0,
  explicit_request_at TEXT,
  github_updated      TEXT NOT NULL,
  fetched_at          TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  policy_json         TEXT NOT NULL,
  policy_hash         TEXT NOT NULL,
  UNIQUE (repository_id, pr_number)
);
```

`pr_files`, `pr_reviews`, `review_requests`, `attention_items`, `advisor_runs`, and `learning_signals` are intentionally absent. File paths are transient policy inputs; review/request records have no current review-pipeline reader; checks and issue comments remain because the pipeline builds provenance from them.

## Task 1: Replace the schema with the review-core schema

**Files:**
- Modify: `src/store/migrations/001_initial.sql`
- Delete: `src/store/migrations/002_projection_columns.sql`
- Modify: `src/store/migrate.ts`
- Modify: `src/config/types.ts`
- Modify: `src/config/schemas.ts`
- Modify: `config/organization.json`
- Modify: `tests/store/migrate.test.ts`
- Modify: `tests/config/load.test.ts`
- Modify: `tests/config/schemas.test.ts`
- Modify: `src/source/cleanup.ts`
- Test: `tests/store/migrate.test.ts`
- Test: `tests/config/load.test.ts`
- Test: `tests/config/schemas.test.ts`

- [ ] **Step 1: Write the new migration assertions first.**

Replace the current table assertions with an exact review-core table set and explicit absence checks:

```ts
expect(names).toEqual(expect.arrayContaining([
  "repositories", "prs", "pr_checks", "pr_comments",
  "discovery_checkpoints", "jobs", "runs", "audit_events",
]));
expect(names).not.toEqual(expect.arrayContaining([
  "attention_items", "advisor_runs", "pr_files", "pr_reviews",
  "review_requests", "learning_signals",
]));

const prColumns = db.prepare("PRAGMA table_info(prs)").all()
  as Array<{ name: string }>;
expect(prColumns.map((column) => column.name)).toEqual(expect.arrayContaining([
  "policy_json", "policy_hash", "explicit_request", "github_updated",
]));
```

Add a stale-schema guard test:

```ts
it("rejects a legacy database and instructs the operator to reset", () => {
  db.exec("CREATE TABLE attention_items (id TEXT PRIMARY KEY)");
  expect(() => runMigrations(db)).toThrow(
    "Legacy Control Tower data detected; run `pnpm ct reset --yes`",
  );
});
```

- [ ] **Step 2: Run the migration test to establish the old-schema failure.**

Run:

```bash
pnpm vitest run tests/store/migrate.test.ts
```

Expected: FAIL because the current schema still creates the removed tables, lacks policy columns on `prs`, and accepts a legacy database.

- [ ] **Step 3: Replace the canonical initial migration.**

Rewrite `001_initial.sql` so it creates only:

```sql
schema_migrations
repositories
prs
pr_checks
pr_comments
discovery_checkpoints
jobs
runs
audit_events
```

Keep existing `jobs`, `runs`, and `audit_events` constraints. Move `policy_json` and `policy_hash` from `attention_items` onto `prs`. Retain child foreign keys with `ON DELETE CASCADE` for checks/comments. Remove columns that were only used by the all-tracked projection (`body`, `labels_json`, draft/refs/size fields, `state`, advisor fields, attention state, and review-request data).

- [ ] **Step 4: Remove unimplemented retention configuration.**

Replace:

```ts
reviewDefaults: {
  jobTimeoutSeconds: number;
  retentionDays: number;
  maxStorageBytes: number;
}
```

with no `reviewDefaults` field in `OrganizationConfig` or `organizationSchema`; remove the corresponding JSON block and test fixtures. Delete `CleanupConfig` and `cleanupAbandonedPairs` from `src/source/cleanup.ts`, retaining only `removeRunSourcePair`, the function used by the pipeline.

- [ ] **Step 5: Run schema/config regression tests.**

Run:

```bash
pnpm vitest run tests/store/migrate.test.ts tests/config/load.test.ts tests/config/schemas.test.ts
```

Expected: PASS.

- [ ] **Step 6: Fail fast on pre-reset databases.**

Add `assertReviewCoreSchema(db)` in `src/store/migrate.ts`, called after pending migrations run:

```ts
const LEGACY_TABLES = ["attention_items", "advisor_runs", "learning_signals"];

export function assertReviewCoreSchema(db: Database.Database): void {
  const legacy = db.prepare(
    `SELECT name FROM sqlite_master
     WHERE type = 'table' AND name IN (${LEGACY_TABLES.map(() => "?").join(",")})`,
  ).all(...LEGACY_TABLES) as Array<{ name: string }>;

  if (legacy.length > 0) {
    throw new Error(
      "Legacy Control Tower data detected; run `pnpm ct reset --yes` before starting this version.",
    );
  }
}
```

Call it from `runMigrations` even when `pending.length === 0`; this is the required hard gate for a database that reports migration version 1 or 2 but predates the review-core schema.

## Task 2: Make discovery eligibility-gated and remove the attention projection

**Files:**
- Modify: `src/discovery/poll.ts`
- Modify: `src/discovery/poll-resilience.ts`
- Modify: `src/normalize/upsert.ts`
- Modify: `src/daemon/bootstrap.ts`
- Modify: `src/github/types.ts`
- Modify: `src/normalize/from-gh.ts`
- Modify: `tests/discovery/poll.test.ts`
- Modify: `tests/discovery/poll-resilience.test.ts`
- Create: `tests/discovery/eligible-persistence.test.ts`
- Modify: `tests/normalize/upsert.test.ts`
- Modify: `tests/orchestrator/draft-loader.test.ts`

- [ ] **Step 1: Add failing discovery tests for the persistence boundary.**

Add cases proving this exact order:

```ts
it("does not persist or enqueue an ineligible discovered PR", async () => {
  // list one active-repository PR; evaluatePolicy returns { eligible: false, ... }
  await poller.poll();
  expect(upsertPr).not.toHaveBeenCalled();
  expect(enqueueEligible).not.toHaveBeenCalled();
});

it("persists once and evaluates/enqueues once for an eligible PR", async () => {
  // enriched PR evaluates eligible
  await poller.poll();
  expect(upsertPr).toHaveBeenCalledTimes(1);
  expect(enqueueEligible).toHaveBeenCalledTimes(1);
});
```

Add an SQLite-backed integration assertion instead of relying only on mocks:

```ts
it("persists policy only for an eligible PR and cascades an eligibility transition", async () => {
  await poller.poll(); // first decision eligible
  expect(db.prepare("SELECT policy_json, policy_hash FROM prs").all()).toHaveLength(1);
  expect(db.prepare("SELECT COUNT(*) AS count FROM pr_checks").get())
    .toMatchObject({ count: 1 });

  policy = tightenedPolicy;
  await poller.poll(); // same PR now ineligible
  expect(db.prepare("SELECT * FROM prs").all()).toEqual([]);
  expect(db.prepare("SELECT * FROM pr_checks").all()).toEqual([]);
  expect(db.prepare("SELECT * FROM pr_comments").all()).toEqual([]);
});
```

- [ ] **Step 2: Run the focused discovery tests.**

Run:

```bash
pnpm vitest run tests/discovery/poll.test.ts tests/discovery/poll-resilience.test.ts tests/discovery/eligible-persistence.test.ts
```

Expected: FAIL because `DiscoveryPoller` currently upserts before policy and the resilient wrapper evaluates policy a second time.

- [ ] **Step 3: Make one policy decision before persistence.**

Refactor `DiscoveryPoller.poll()` to keep the existing enrich-then-normalize path (file paths are necessary for path eligibility), then use this sequence:

```ts
const discovered = this.deps.normalizePr(raw, entry.repositoryId, entry.explicitRequest);
const decision = this.deps.evaluatePolicy(discovered);

if (!decision.eligible) {
  await this.deps.retireReviewPr(
    discovered.repositoryId,
    discovered.prNumber,
  );
  continue;
}

const prId = this.deps.upsertEligiblePr(discovered, decision);
this.deps.enqueueEligible(prId, discovered, decision);
```

Remove `persistDecision`, `evaluateAndEnqueue`, and the duplicate evaluation wrapper. The resilience layer must pass through a single `upsertEligiblePr` callback and never enqueue an ineligible decision.

- [ ] **Step 4: Simplify the normalized persistence model.**

In `upsert.ts`:

```ts
export function upsertEligiblePr(
  db: Database.Database,
  pr: DiscoveredPr,
  decision: PolicyDecision,
): number {
  // Upsert the reduced prs record, then replace checks/comments.
}

export function deleteReviewPr(
  db: Database.Database,
  repositoryId: string,
  prNumber: number,
): void {
  db.prepare(
    "DELETE FROM prs WHERE repository_id = ? AND pr_number = ?",
  ).run(repositoryId, prNumber);
}
```

Serialize `policy_json` with the existing canonical serializer and compute `policy_hash` with the existing canonical hash helper. Delete `upsertPrFiles`, `upsertPrReviews`, `upsertReviewRequests`, `upsertAttentionItem`, and `createPersistDecision`; remove mappings/type members that exist solely for those deleted writes.

- [ ] **Step 5: Wire bootstrap to persist only eligible records.**

Remove `createPersistDecision` and `upsertDiscoveredPr` imports and wiring. The bootstrap callback must resolve repository/source mode once, create the same `PolicyDecision` used for persistence and enqueue, then call `enqueueFromPolicyDecision` exactly once.

- [ ] **Step 6: Verify discovery gating.**

Run:

```bash
pnpm vitest run tests/discovery/poll.test.ts tests/discovery/poll-resilience.test.ts tests/discovery/eligible-persistence.test.ts
```

Expected: PASS.

## Task 3: Reconcile review-cache rows without falsely inferring closure

**Files:**
- Create: `src/discovery/reconcile-review-cache.ts`
- Modify: `src/discovery/poll.ts`
- Modify: `src/discovery/poll-resilience.ts`
- Modify: `src/daemon/bootstrap.ts`
- Modify: `tests/discovery/poll.test.ts`
- Create: `tests/discovery/reconcile-review-cache.test.ts`

- [ ] **Step 1: Write reconciliation tests.**

Cover three states:

```ts
it("keeps a persisted PR when a direct GitHub lookup confirms it remains open and eligible", async () => {});
it("deletes a persisted PR and supersedes active jobs when GitHub confirms it is closed or merged", async () => {});
it("deletes a persisted PR and supersedes active jobs when GitHub confirms it is open but no longer eligible", async () => {});
```

The tests must also assert that a failed verification does not delete any row.

- [ ] **Step 2: Run reconciliation tests to establish the missing behavior.**

Run:

```bash
pnpm vitest run tests/discovery/reconcile-review-cache.test.ts
```

Expected: FAIL because no reconciliation exists.

- [ ] **Step 3: Add positive-confirmation reconciliation.**

At the end of a successful poll, compare persisted review-cache identity keys with the current eligible keys. For a persisted key missing from that set:

1. Call `enrichPr(ownerRepo, prNumber)`.
2. On transport/API failure, retain the row.
3. If GitHub returns `CLOSED` or `MERGED`, supersede non-terminal jobs for that PR and delete it.
4. If GitHub returns `OPEN`, normalize it, re-evaluate policy, and either upsert it if still eligible or supersede/delete it if no longer eligible.

Do not write a `closed` state or infer a terminal GitHub state solely because an item was absent from `gh pr list --state open`.

- [ ] **Step 4: Add bootstrap callbacks for persisted review-cache identities and job supersession.**

Expose narrowly scoped adapters from bootstrap:

```ts
listPersistedReviewPrs(): Array<{ repositoryId: string; github: string; prNumber: number }>;
supersedeActiveJobsForPr(repositoryKey: string, prNumber: number): void;
```

Use the existing versioned `supersede` query pattern. Keep terminal job/run records for audit; only remove the live PR cache row and its cascaded checks/comments.

Every transition away from eligible review data must use the same ordered operation:

```ts
supersedeActiveJobsForPr(repositoryKey, prNumber);
deleteReviewPr(repositoryId, prNumber);
```

Do not let the direct ineligible path in Task 2 delete a row independently. `retireReviewPr` is the only removal callback, and it supersedes active/draft/publish-capable jobs before deleting the cache row. This prevents a publishable draft from being detached from policy/lifecycle truth.

- [ ] **Step 5: Run discovery reconciliation tests.**

Run:

```bash
pnpm vitest run tests/discovery/poll.test.ts tests/discovery/poll-resilience.test.ts tests/discovery/reconcile-review-cache.test.ts
```

Expected: PASS.

## Task 4: Collapse the read model to `prs` and make manual Analyze honest

**Files:**
- Modify: `src/orchestrator/work-graph.ts`
- Modify: `src/policy/evaluate.ts`
- Modify: `src/orchestrator/facade.ts`
- Modify: `src/api/contracts.ts`
- Modify: `src/api/routes/jobs.ts`
- Modify: `src/api/projections/queue.ts`
- Modify: `src/orchestrator/enqueue.ts`
- Modify: `src/daemon/bootstrap.ts`
- Modify: `src/daemon/runtime.ts`
- Modify: `tests/orchestrator/work-graph.test.ts`
- Modify: `tests/orchestrator/facade.test.ts`
- Modify: `tests/api/queue-projection.test.ts`
- Modify: `tests/orchestrator/enqueue.test.ts`
- Create: `tests/daemon/manual-analyze.test.ts`
- Modify: `tests/api/jobs.test.ts` or create `tests/api/jobs-analyze.test.ts`

- [ ] **Step 1: Write failing read-model and manual-enqueue tests.**

Add assertions that:

```ts
expect(workGraph.getFocusQueue()).toEqual({
  now: expect.arrayContaining([eligibleP0]),
  next: expect.any(Array),
  monitor: expect.any(Array),
});
expect(workGraph).not.toHaveProperty("getAllTracked");

expect(() => facade.requestAnalyze({
  repositoryKey: "repo-a",
  prNumber: 7,
})).toThrow("PR is not eligible for review");
```

For a persisted author-only/on-demand PR, assert manual Analyze creates a job using the stored real head SHA and returns `reason: "manual_request"`; do not accept the all-zero SHA or a fabricated `explicitRequest`.

At the HTTP boundary, assert:

```ts
it("rejects Analyze for a missing or ineligible PR without creating a job", async () => {
  const response = await app.request("/api/jobs/analyze", {
    method: "POST",
    body: JSON.stringify({
      repositoryKey: "repo-a",
      prNumber: 9,
      actionToken: validToken,
    }),
  });
  expect(response.status).toBe(422);
  expect(insertJob).not.toHaveBeenCalled();
});

it("does not turn a manual request into explicit_request persistence", () => {
  facade.requestAnalyze({ repositoryKey: "repo-a", prNumber: 7 });
  expect(loadPr("repo-a", 7).explicit_request).toBe(0);
});
```

- [ ] **Step 2: Run the focused tests.**

Run:

```bash
pnpm vitest run tests/orchestrator/work-graph.test.ts tests/orchestrator/facade.test.ts tests/api/queue-projection.test.ts tests/api/jobs-analyze.test.ts tests/orchestrator/enqueue.test.ts tests/daemon/manual-analyze.test.ts
```

Expected: FAIL because the current WorkGraph joins `attention_items` and manual Analyze builds an explicit-request stub.

- [ ] **Step 3: Query eligible `prs` directly.**

Replace `AllTrackedItem` with `ReviewQueueItem`. `WorkGraph` must load `prs.policy_json`, parse it, and build only the three priority lanes. Keep `prioritySortOrdinal < 4` as a defensive invariant; persisted rows must already be eligible. Load check summaries only if still exposed by a retained queue field; do not retain the old all-tracked body/labels/files projection.

Move the type declaration and export in `src/policy/evaluate.ts`, then update each current `AllTrackedItem` consumer: `work-graph.ts`, `facade.ts`, `daemon/runtime.ts`, `api/projections/queue.ts`, and their fixtures. Do not leave a compatibility alias.

- [ ] **Step 4: Remove attention/advisor API state.**

Reduce the queue contract to real review information:

```ts
export interface ReviewQueueRow {
  jobId: string | null;
  repositoryKey: string;
  repository: string;
  prNumber: number;
  title: string;
  url: string;
  author: string;
  headSha: string;
  eligibilityReasons: EligibilityReason[];
  priority: "p0" | "p1" | "p2" | "p3";
  priorityReasons: PriorityReason[];
  queueOrder: QueueOrder;
  domains: string[];
  jobState: string | null;
  updatedAt: string;
}
```

Delete `AdvisorResult`, `attentionState`, `exclusionReasons`, attention enrichment queries, `projectAllTracked`, and the facade/runtime `getAllTracked` plumbing.

- [ ] **Step 5: Separate manual action from explicit GitHub review request.**

Extend `EnqueueInput`:

```ts
manualRequest: boolean;
```

Compute scheduling as:

```ts
const shouldEnqueue =
  input.manualRequest ||
  input.policy.analysisMode === "auto" ||
  (input.policy.analysisMode === "on_demand" && input.explicitRequest);
```

Load the existing eligible row and its parsed `policy_json` in `enqueueAnalysis`; reject when absent or `policy.eligible === false`. Resolve the real source mode from local configuration, use the persisted `head_sha`, and pass `manualRequest: true` without mutating `prs.explicit_request`.

- [ ] **Step 6: Run the read/enqueue tests.**

Run:

```bash
pnpm vitest run tests/orchestrator/work-graph.test.ts tests/orchestrator/facade.test.ts tests/api/queue-projection.test.ts tests/api/jobs-analyze.test.ts tests/orchestrator/enqueue.test.ts tests/daemon/manual-analyze.test.ts
```

Expected: PASS.

## Task 5: Delete product Coverage and simplify the queue API/client

**Files:**
- Delete: `client/src/routes/AllTracked.tsx`
- Delete: `client/tests/coverage-action.test.ts`
- Modify: `src/api/routes/queue.ts`
- Modify: `src/api/server.ts`
- Modify: `src/daemon/runtime.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/lib/navigation.ts`
- Modify: `client/src/lib/routes.ts`
- Modify: `client/src/hooks/useQueueQuery.ts`
- Modify: `client/src/lib/review-route.ts`
- Modify: `client/src/lib/queue-display.ts`
- Modify: `client/src/lib/inbox-context.ts`
- Modify: `client/src/components/PriorityIndicator.tsx`
- Modify: `client/src/index.css`
- Modify or delete: `tests/api/spa-fallback.test.ts`
- Modify: `tests/daemon/runtime.test.ts`
- Modify: `tests/client/review-route.test.ts`
- Modify: `tests/client/queue-display.test.ts`
- Modify: `tests/client/navigation.test.ts`
- Modify: `tests/client/routes.test.ts`
- Modify: `tests/integration/analysis-pipeline.test.ts`
- Modify: `tests/e2e/fake-adapters.test.ts`
- Modify: `tests/api/server-spa-fallback.test.ts`
- Modify: `client/tests/component-contracts.test.ts`
- Modify: `client/tests/shell-interactions.test.ts`
- Modify: `client/tests/shell-primitives.test.ts`

- [ ] **Step 1: Update API/client contract tests first.**

Make `GET /api/queue` expect exactly:

```ts
{
  focusQueue: { now: [], next: [], monitor: [] },
}
```

Assert `allTracked` is absent. Update queue query/refetch tests to flatten only the three focus lanes.

- [ ] **Step 2: Run the affected API/client tests.**

Run:

```bash
pnpm vitest run tests/daemon/runtime.test.ts tests/api/spa-fallback.test.ts tests/api/server-spa-fallback.test.ts tests/client/review-route.test.ts tests/client/queue-display.test.ts tests/client/navigation.test.ts tests/client/routes.test.ts tests/integration/analysis-pipeline.test.ts tests/e2e/fake-adapters.test.ts client/tests/component-contracts.test.ts client/tests/shell-interactions.test.ts client/tests/shell-primitives.test.ts
```

Expected: FAIL because `/coverage`, `allTracked`, Coverage filters, and unranked presentation branches still exist.

- [ ] **Step 3: Delete the all-PR route and contract.**

Change `queueRoutes()` to return only `focusQueue`. Remove `getAllTracked` from server/runtime dependencies. Remove the `/coverage` route, navigation entry, route constant, `AllTracked` import, coverage CSS, coverage tests, `CoverageFilter`, `filterCoverageRows`, and the unranked-only UI branches.

`collectQueueRows` must return only:

```ts
[
  ...queue.focusQueue.now,
  ...queue.focusQueue.next,
  ...queue.focusQueue.monitor,
];
```

Keep `CoverageWarning`, `CoverageInfo`, and all Workbench source/diff-inspection warnings unchanged.

- [ ] **Step 4: Run affected API/client tests and build the client.**

Run:

```bash
pnpm vitest run tests/daemon/runtime.test.ts tests/api/spa-fallback.test.ts tests/api/server-spa-fallback.test.ts tests/client/review-route.test.ts tests/client/queue-display.test.ts tests/client/navigation.test.ts tests/client/routes.test.ts tests/integration/analysis-pipeline.test.ts tests/e2e/fake-adapters.test.ts client/tests/
pnpm --dir client build
```

Expected: PASS.

## Task 6: Remove governed learning, proposals, and attention placeholders

**Files:**
- Delete: `src/learning/`
- Delete: `src/proposals/`
- Delete: `src/api/routes/signals.ts`
- Delete: `src/api/routes/proposals.ts`
- Delete: `client/src/routes/ProposeChange.tsx`
- Delete: `config/harnesses/pr-attention/`
- Delete: `eval/metrics/attention.ts`
- Modify: `src/api/server.ts`
- Modify: `src/daemon/bootstrap.ts`
- Modify: `src/daemon/runtime.ts`
- Modify: `src/orchestrator/pipeline.ts`
- Modify: `src/orchestrator/pipeline-runner.ts`
- Modify: `src/context/harness-manifest.ts`
- Modify: `src/cursor/adapter.ts`
- Modify: `src/cli/main.ts`
- Modify: `client/src/App.tsx`
- Modify: `client/src/lib/navigation.ts`
- Modify: `client/src/lib/routes.ts`
- Delete: `client/src/hooks/useSignalsQuery.ts`
- Delete: `client/src/hooks/useProposalMutations.ts`
- Delete: `client/src/lib/proposal-adopt.ts`
- Modify: `client/src/lib/api.ts`
- Modify: `client/src/lib/query-keys.ts`
- Modify: `client/src/lib/query-invalidation.ts`
- Delete or rewrite: `tests/client/query-invalidation.test.ts`
- Delete: `tests/client/proposal-adopt.test.ts`
- Modify: `tests/api/server-spa-fallback.test.ts`
- Modify: `tests/context/harness-manifest.test.ts`
- Modify: `tests/cursor/adapter.fixtures.test.ts`
- Modify: `tests/eval/metrics.test.ts`
- Delete or rewrite: `tests/learning/`, `tests/proposals/`, proposal/signal API tests, and Propose client tests

- [ ] **Step 1: Write/remove tests to establish the remaining product boundary.**

Delete tests that verify proposal creation, proposal adoption, signal listing, or attention-role behavior. Add/retain a runtime test that boots the server without `signalRecorder`, proposal store, proposal routes, or a Propose navigation item.

- [ ] **Step 2: Remove the runtime wiring.**

Delete `SignalRecorder`, proposal-store creation, signal hooks, proposal startup, proposal API routes, and related `RuntimePublishContext` fields. Remove `signalRecorder` from `runPipelineForJob` inputs and remove signal-hook arguments/transitions from `pipeline.ts`.

Constrain harness/agent roles to:

```ts
role: "primaryReview";
```

and make `buildHarnessManifest` always select `config/harnesses/pr-review`.

- [ ] **Step 3: Remove the user-facing Propose surface and doctor false positives.**

Delete the Propose route/nav item and client tests. Make `buildHarnessManifests()` return only `pr-review`; no doctor check may reference a deleted `pr-attention` file.

Remove proposal/signal request functions and invalidation keys from `client/src/lib/api.ts`, `query-keys.ts`, and `query-invalidation.ts`; delete the signal/proposal hooks and proposal-adoption helper. Update SPA fallback tests so `/propose` is no longer treated as an application route.

- [ ] **Step 4: Run affected backend/client tests.**

Run:

```bash
pnpm vitest run tests/api/ tests/daemon/ tests/orchestrator/ tests/cursor/ client/tests/
pnpm typecheck
pnpm --dir client build
```

Expected: PASS.

## Task 7: Update operator documentation and record the future extension boundary

**Files:**
- Modify: `README.md`
- Modify: `ONBOARDING.md`
- Modify: `ARCHITECTURE.md`
- Modify: `POLLING.md`
- Modify: `DEFER.md`
- Modify: `docs/principal-engineer-control-tower-architecture.html`
- Modify: `docs/handoff/phase-1-baseline-manifest.json` if it references deleted attention artifacts

- [ ] **Step 1: Remove obsolete product claims.**

Delete or rewrite every claim that the app provides “complete coverage,” “All Tracked,” “tracked-but-ineligible,” a Coverage tab, a Propose tab, proposals, advisor runs, learning signals, or `pr-attention`.

- [ ] **Step 2: Make reset requirements explicit.**

Add this exact operator migration note to README and ONBOARDING:

```markdown
This development version has a new review-core schema. Stop the daemon, run
`pnpm ct reset --yes`, then start Control Tower again. This clears local review
cache and run data; it keeps your profile and local config.
```

- [ ] **Step 3: Preserve the Delivery Intelligence seam without implementation.**

In the Phase 2C roadmap, state:

```markdown
Delivery Intelligence will be a separately scoped, read-only workflow. It may
collect GitHub/Linear observations and retain its own time-aware linkage ledger.
It must not reuse the review queue or cause non-reviewable PRs to be persisted
by the review-core database.
```

- [ ] **Step 4: Validate removed terminology and remaining run-coverage language.**

Run:

```bash
rg -n "All Tracked|tracked-but-ineligible|pr-attention|advisor_runs|/coverage|learning_signals" README.md ONBOARDING.md ARCHITECTURE.md POLLING.md DEFER.md docs/principal-engineer-control-tower-architecture.html docs/handoff
rg -n "CoverageInfo|CoverageWarning|coverage.json" src client README.md ONBOARDING.md ARCHITECTURE.md POLLING.md
```

Expected: the first command finds no active-product references in operator documentation or active architecture artifacts. Do not scan historical `docs/superpowers/plans/**`; those plans intentionally preserve historical terminology. The second command still finds per-run evidence coverage.

## Task 8: Full verification and implementation review

**Files:**
- Modify only if verification identifies a regression.

- [ ] **Step 1: Reset local development data before exercising the daemon.**

Run:

```bash
pnpm ct reset --yes
```

Expected: data directory wiped; profile/config retained.

- [ ] **Step 2: Run the complete automated verification suite.**

Run:

```bash
pnpm vitest run
pnpm typecheck
pnpm --dir client build
```

Expected: all tests pass, root typecheck is clean, and the client builds.

- [ ] **Step 3: Inspect the final change surface.**

Run:

```bash
git status --short
git diff --check
git diff --stat
```

Expected: only review-core simplification, deleted obsolete modules, schema/config/doc updates, and tests are present; no generated data, local configuration, or secrets are staged.

- [ ] **Step 4: Independently review the final implementation.**

Use a code-review subagent to check:

1. no ineligible PR reaches any durable review table;
2. no product Coverage/Propose/attention endpoint or route remains;
3. manual Analyze cannot create an all-zero-SHA or fabricated-explicit-request job;
4. normal eligible auto/manual review, draft staleness, and publication guards still work;
5. per-run source/diff coverage remains distinct from deleted product Coverage;
6. no Linear/Delivery Intelligence storage was added prematurely.

---

## Plan self-review

- **Spec coverage:** Tasks 1–3 implement eligible-only persistence, schema reset, lifecycle confirmation, and honest manual enqueue. Tasks 4–5 remove the approved user-facing and governed-learning noise. Task 6 documents the future boundary. Task 8 validates end-to-end behavior.
- **No placeholder scan:** Every task names affected files, tests, code shape, and verification commands. No Delivery Intelligence implementation is deferred inside the refactor.
- **Type consistency:** `ReviewQueueItem` / `ReviewQueueRow` are the replacement names; `PolicyDecision` remains the sole eligibility/priority contract; `manualRequest` is the explicit replacement for fabricated `explicitRequest`.
- **Scope:** The plan deliberately does not add Linear clients, portfolio tables, advisor roles, event buses, or migration compatibility.
