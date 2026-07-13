# Polling, jobs, and the analysis pipeline

Control Tower uses **three independent timers** that are easy to confuse because they all involve periodic work. They poll **different things** for **different reasons**. This document explains what each loop does, how jobs run, and how data flows from GitHub to the UI.

For daemon architecture and module boundaries, see [`Architecture.md`](./Architecture.md).

## At a glance

| Loop | Where it runs | What it reads/writes | Default interval | Network? |
|------|---------------|----------------------|------------------|----------|
| **Discovery** | Daemon | GitHub → SQLite (`prs`, `attention_items`, new `jobs`) | 900s (15 min) | Yes (`gh` API) |
| **Scheduler** | Daemon | SQLite `jobs` → starts analysis pipeline | 5s | No (local DB only) |
| **Client refresh** | Browser (React) | Daemon HTTP API → UI state | 3s active / 30s idle | Yes (loopback API) |

**Discovery** ingests PRs. **Scheduler** executes queued work. **Client refresh** displays current daemon state. Only discovery talks to GitHub. Only the scheduler starts Cursor agents. The browser never starts jobs.

```
GitHub
  │  discovery (~15 min, backoff on errors)
  ▼
SQLite  (prs, attention_items, jobs)
  │  scheduler (every 5s)
  ▼
Analysis pipeline  (minutes per job)
  │
  ▼
HTTP API  ←── client refresh (3s / 30s) ──  Browser UI
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

If you click **Analyze** on a PR, a job is enqueued immediately via the API — discovery is not involved. The scheduler still picks it up on its next 5s tick (after a 2s debounce).

## 1. Discovery polling (GitHub → database)

**Purpose:** Answer *“What PRs exist that I should track?”*

On daemon start (`pnpm ct start`), the discovery poller:

1. Verifies `gh` authentication and operator identity.
2. Searches for PRs with explicit review requests for your login.
3. Lists open PRs in your **active** repositories (`profile.json` → `activeRepositoryIds`).
4. Enriches each PR, upserts into SQLite, evaluates policy, and may **enqueue** analysis jobs when policy says auto-analyze.

**Scheduling:** A `setTimeout` chain (not a fixed `setInterval`). The first poll runs immediately; after each poll completes, the next is scheduled at `pollIntervalSeconds` from `config/organization.json` (default **900** = 15 minutes).

**Resilience:** `ResilientPoller` wraps the core `DiscoveryPoller`. On rate limits or transient GitHub errors, the next poll is delayed with exponential backoff (5s base, 300s cap) instead of the normal interval. Last-known DB state is preserved.

**Freshness signal:** `lastPollTimestamp` in health status comes from discovery checkpoints. If discovery has never completed, `/api/health` reports an issue.

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

- Policy auto-analyze matches (via discovery), or
- You request analysis from the UI/API (`on_demand` + explicit request), or
- You retry a failed job.

If the PR head SHA, policy hash, or source mode changes, an existing active job may be **superseded** and a new one enqueued.

### Pipeline states (happy path)

```
queued
  → preparing_context      build review harness (prompt, coverage, metadata)
  → preparing_source       git checkout into daemon worktree (registered-source only)
  → running_agent          Cursor agent executes (slow — often minutes)
  → validating_output      validate agent JSON output
  → draft_ready            sealed draft available for Review UI
  → awaiting_approval      human approves operations
  → publishing             GitHub mutations (gated mode)
  → published              terminal success
```

Terminal or side states: `failed`, `cancelled`, `superseded`. After a daemon crash, in-flight agent work is recovered to `failed` on next start (`daemon_restart`).

### What “start pipeline” means

`runPipelineForJob()` loads the job (must be `queued`), builds dependencies (Cursor binary, profile paths, signal recorder), and runs `executePipeline()`. That function walks the state transitions above, seals artifacts under your data directory, and stops at `draft_ready` (publication is a separate human-gated step).

The scheduler **does not await** the pipeline. One long-running `running_agent` phase does not block the timer; it only blocks **starting additional jobs** until a slot frees up.

## 4. Client refresh (browser → API)

**Purpose:** Keep the UI aligned with daemon state.

React updates only **in-browser** state. The daemon is a separate process writing SQLite. There is **no WebSocket or SSE** today — the UI **pulls** `/api/queue`, `/api/health`, and `/api/draft/:jobId` on a timer via React Query.

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
2. **Discovery is slow and external** — rate-limited; 15-minute cadence is intentional.
3. **Scheduler is fast and local** — picks up new `queued` jobs within seconds of enqueue.
4. **Pipeline is long and async** — one job can run many minutes; states exist so the UI and recovery logic know where work stopped.
5. **UI polling is a mirror** — it reflects daemon state; changing React state does not change jobs. To observe background progress, the client must refetch or use a future push mechanism.
6. **Eligible ≠ queued** — discovery tracks PRs and policy decisions; a job exists only when analysis is enqueued (auto or on-demand).
7. **Human gates after `draft_ready`** — the pipeline produces a draft; publication requires explicit approval (see README design invariants).

When debugging “why hasn’t my PR been analyzed?”, check in order: Is it **eligible** in policy? Was a **job enqueued**? Is the scheduler **blocked** by `maxConcurrentAgents`? Did the **pipeline fail** (`failed` state / audit trail)? Is the **UI stale** (try Refresh)?
