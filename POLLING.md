# Polling, jobs, and the analysis pipeline

Control Tower uses **three independent timers** that are easy to confuse because they all involve periodic work. They poll **different things** for **different reasons**. This document explains what each loop does, how jobs run, and how data flows from GitHub to the UI.

For daemon architecture and module boundaries, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

## At a glance

| Loop | Where it runs | What it reads/writes | Default interval | Network? |
|------|---------------|----------------------|------------------|----------|
| **Discovery** | Daemon | GitHub → policy → eligible SQLite `prs` (+ optional enqueue) | 900s (15 min) from `organization.json` | Yes (`gh` API) |
| **Scheduler** | Daemon | SQLite `jobs` → starts analysis pipeline | 5s | No (local DB only) |
| **Client refresh** | Browser (React) | Daemon HTTP API → UI state | 3s active / 30s idle | Yes (loopback API) |

**Discovery** ingests PRs from GitHub. **Scheduler** selection is local-DB based and starts queued work; started pipeline runs may call GitHub for diff/context during analysis, and publication calls GitHub for approved operations. **Client refresh** displays current daemon state. Only the scheduler starts Cursor agents. The browser never starts jobs.

```
GitHub
  │  discovery (~15 min; ResilientPoller backoff on errors — see below)
  ▼
SQLite  (eligible `prs` only, jobs)
  │  scheduler (every 5s)
  ▼
Analysis pipeline  (minutes per job; terminal success = `draft_ready`)
  │
  ▼
HTTP API  ←── client refresh (queue 3s/30s, health 30s) ──  Browser UI
```

## End-to-end example

Suppose two PRs are discovered in the same poll:

| Job | PR | Priority | Review requested? | Result |
|-----|-----|----------|-------------------|--------|
| Job A | `my-repo#842` | p0 | Yes | Enqueued (`queued`) |
| Job B | `my-repo#799` | p2 | No | Enqueued (`queued`) |

With `maxConcurrentAgents: 1` (the default in `config/examples/local-config.json`):

1. **Discovery** upserts both PRs, evaluates policy, inserts two `queued` jobs.
2. **Scheduler** (within ~5s) orders candidates by priority, picks Job A, calls `runPipelineForJob()` **without waiting** for it to finish.
3. Job A moves through pipeline states (`preparing_context` → … → `running_agent` → … → `draft_ready`). Job B stays `queued` because the agent slot is full.
4. When Job A reaches `draft_ready`, the scheduler frees a slot and eventually starts Job B.
5. **Client refresh** re-fetches `/api/queue` so the Inbox shows state changes (e.g. `running_agent` → `draft_ready`).

If you click **Analyze** on a PR, the API enqueues immediately from the persisted eligible `prs` row (`manualRequest: true`) — discovery is not involved and explicit-request flags on the row are not mutated. The scheduler considers the queued job on a later periodic tick once the 2-second debounce has elapsed and available capacity permits — not necessarily the immediate next tick.

## 1. Discovery polling (GitHub → database)

**Purpose:** Answer *“What open PRs should I track in the eligible cache?”*

On daemon start (`pnpm ct start`), `ResilientPoller` wraps the core discovery poll:

1. Verifies `gh` authentication and operator identity.
2. Searches for **open** PRs with explicit review requests for your login in each org listed in `config/organization.json` → `github.organizations` (may include repos outside the catalog).
3. Lists **open** PRs in each **active** catalog repo (`profile.json` → `activeRepositoryIds`).
4. Enriches each candidate, normalizes, **evaluates policy**, and **only upserts eligible PRs** into SQLite `prs` (with checks/comments). Ineligible candidates are queued for retirement.
5. **Reconciles** persisted `prs` rows missing from the current scan: positive `enrichPr` lookup per row; re-upsert if still eligible, retire if closed/merged/ineligible; retain row unchanged if `enrichPr` returns null.
6. Retires queued rows: deletes `prs` and supersedes active jobs for that PR.

**Scheduling:** Daemon bootstrap uses a `setTimeout` chain (not `setInterval`). The first poll runs immediately (`schedule(0)`); after each poll **completes**, bootstrap schedules the next poll at `github.pollIntervalSeconds` from `config/organization.json` (default **900** = 15 minutes).

**Resilience:** `ResilientPoller` tracks GitHub rate limits (`RateLimitTracker`) and computes exponential backoff on failures (5s base, 300s cap, jitter). Discovery writes eligible rows incrementally during a poll; a later transient or rate-limit error can leave earlier upserts from that poll in SQLite, but the discovery freshness checkpoint and queued retirements do **not** advance or apply on a failed poll. **Effective backoff:** when `ResilientPoller` calls `scheduleNextPoll(backoffMs)` during a failing poll, daemon bootstrap still schedules the following poll at the normal `pollIntervalSeconds` as soon as the current poll callback finishes — so production cadence is effectively the configured interval, not the computed backoff delay.

**Freshness / checkpoints:** `discovery_checkpoints` (`poll:<host>:lastCompleted`) updates only after a **successful** complete poll. `GET /api/health` reports `healthy: false` with issue `"Discovery poll has not completed"` when no checkpoint exists yet; internal facade metrics also track `lastPollTimestamp`, active/queued jobs, and failures in the last 24h, but the HTTP health response exposes only `{ healthy, issues }`.

## 2. Job scheduler (database → pipeline)

**Purpose:** Answer *“Which queued jobs can I start now?”*

Every **5 seconds** (hardcoded `schedulerIntervalMs` in the daemon), `selectNextJobs()`:

1. Counts jobs in active pipeline states: `preparing_context`, `preparing_source`, `running_agent`, `validating_output`.
2. Computes free slots: `maxConcurrentAgents − activeCount` (configured in `~/.control-tower/config.json`, allowed range **1–2**).
3. Selects `queued` jobs in priority order (see below).
4. Skips jobs queued less than **2 seconds** ago (debounce).
5. Fires `runPipelineForJob()` asynchronously for each selected job.

The scheduler does **not** re-fetch GitHub. It only reads the local job queue. Jobs in `publishing` or `draft_ready` do not consume agent slots.

### Job selection order

Among `queued` jobs, the scheduler picks first by:

1. **Priority tier** — lower `priority_sort_ordinal` wins (`p0`=0, `p1`=1, `p2`=2, `p3`=3, `unranked`=4).
2. **Explicit review request** — requested reviews before passively discovered PRs.
3. **Queue timestamp** — earlier first.
4. **Repository key**, then **PR number** — stable tie-break.

## 3. Jobs and the analysis pipeline

### What is a job?

A **job** is one analysis unit: *review PR #N in repository X at commit SHA Y*. Jobs are rows in SQLite with a **state** and optional **runs** (each pipeline execution creates a run).

Jobs are created when:

- Policy auto-analyze matches (via discovery enqueue), or
- You request analysis from the UI/API (`POST /api/jobs/analyze` with `manualRequest`), or
- You retry a **failed** job (`POST /api/jobs/:id/retry` — same job ID, state → `queued`, no new run until the pipeline starts).

`POST /api/jobs/analyze` requires a **persisted eligible** `prs` row (cached checks/comments from discovery). It does not call GitHub discovery or change `explicit_request` on the row.

If the PR head SHA, policy hash, or source mode changes, an existing active job may be **superseded** and a new one enqueued. Enqueueing for a PR also supersedes any other active job for the same repository and PR number (one active job per PR). A **failed** job with unchanged identity is **not** auto-re-enqueued by discovery — use **Retry** or wait for superseding changes.

### Pipeline states (happy path)

```
queued
  → preparing_context      build harness, fetch/filter PR diff, build provenance catalog, materialize context artifacts
  → preparing_source       git checkout into daemon worktree (registered-source only)
  → running_agent          Cursor primaryReview agent executes (slow — often minutes)
  → validating_output      validate agent JSON output
  → draft_ready            sealed draft available for Review UI (pipeline terminal success)
```

Publication states (`awaiting_approval`, `publishing`, `published`) exist in the jobs schema for forward compatibility and daemon-restart recovery hooks, but the current pipeline and `POST /api/publish` path do **not** transition job rows through them — jobs remain at `draft_ready` after analysis while publication executes via the in-memory publisher.

Terminal or side states: `failed`, `cancelled`, `superseded`. After a daemon crash, in-flight agent work is recovered to `failed` on next start (`daemon_restart`).

### What “start pipeline” means

`runPipelineForJob()` loads the job (must be `queued`), builds pipeline dependencies (Cursor adapter, profile/app paths, GitHub diff fetch, provenance loaders, source materialization, and validation/sealing hooks), and runs `executePipeline()`. That function walks the state transitions above, seals artifacts under your data directory, and stops at `draft_ready` (publication is a separate human-gated step).

The scheduler **does not await** the pipeline. One long-running `running_agent` phase does not block the timer; it only blocks **starting additional jobs** until a slot frees up.

## 4. Client refresh (browser → API)

**Purpose:** Keep the UI aligned with daemon state.

React updates only **in-browser** state. The daemon is a separate process writing SQLite. There is **no WebSocket or SSE** — the UI **pulls** `/api/queue`, `/api/health`, and `/api/drafts/:jobId` on a timer via React Query.

`GET /api/queue` returns `{ focusQueue: { now, next, monitor } }` — eligible PR rows grouped by priority tier (`p0`/`p1` → Now, `p2` → Next, `p3` → Monitor). There is no `allTracked` field or Coverage product page; per-run evidence coverage appears only in Review (`CoverageWarning`).

| Query | Interval (tab visible) | Paused when |
|-------|------------------------|-------------|
| Queue | **3s** if any job is in an active state; **30s** otherwise | Background tab |
| Health | **30s** | Background tab |
| Draft | **3s** while draft not yet loaded; stops once draft data exists | Background tab |

Active job states for client polling: `queued`, `preparing_context`, `preparing_source`, `running_agent`, `validating_output`, `publishing`.

**Additional refresh triggers:**

- Tab becomes visible again (queue refetches on `visibilitychange`).
- Window focus (`refetchOnWindowFocus` in the shared query client).
- User actions (Analyze, Retry, Approve, Publish) invalidate relevant queries.
- Header **Refresh** button.

Client refresh is **read-only** for job execution. It does not enqueue work or call GitHub.

## Configuration reference

| Setting | Location | Effect |
|---------|----------|--------|
| `github.pollIntervalSeconds` | `config/organization.json` | Normal delay between discovery polls (default 900) |
| `cursor.maxConcurrentAgents` | `~/.control-tower/config.json` | Max parallel pipeline runs (1–2) |
| `daemon.port` | `~/.control-tower/config.json` | Loopback API + UI (default 9120) |
| `activeRepositoryIds` | `~/.control-tower/profile/profile.json` | Which catalog repos discovery scans |
| `policy.json` | profile directory | Eligibility, priority, auto-analyze rules (drives enqueue) |

Scheduler interval (5s) and debounce (2s) are fixed in daemon code, not user-configurable.

## Mental model (for operators and coding agents)

1. **Three loops, three data sources** — GitHub, SQLite jobs table, HTTP API. Do not conflate them.
2. **Discovery is slow and external** — default 15-minute cadence; partial upserts may persist on mid-poll failure, but freshness checkpoints and retirements do not advance until a successful complete poll.
3. **Scheduler is fast and local** — picks up new `queued` jobs within seconds of enqueue.
4. **Pipeline is long and async** — one job can run many minutes; terminal analysis success is `draft_ready`.
5. **UI polling is a mirror** — queue 3s/30s and health 30s reflect daemon state; changing React state does not change jobs.
6. **Eligible ≠ queued** — only eligible PRs are persisted; a job exists only when analysis is enqueued (auto or manual).
7. **Failed identity needs Retry** — discovery will not re-enqueue an unchanged failed job; Retry reuses the same job ID and the pipeline allocates the next run.
8. **Human gates after `draft_ready`** — publication uses per-operation approval + `POST /api/publish` (gated mode only).

When debugging “why hasn’t my PR been analyzed?”, check in order: Is it **eligible** in policy? Was a **job enqueued**? Is the scheduler **blocked** by `maxConcurrentAgents`? Did the **pipeline fail** (`failed` state / audit trail)? Is the **UI stale** (try Refresh)?
