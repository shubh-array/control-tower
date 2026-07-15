# Architecture Overview

This document is the living architecture map for **Control Tower**: how the system is structured, where authority lives, and how to customize or extend it safely. Update it as the codebase evolves.

For operator quick start, see [`README.md`](./README.md). For step-by-step local setup and customization, see [`ONBOARDING.md`](./ONBOARDING.md). Tracked Phase 1 artifacts: `docs/handoff/phase-1-baseline-manifest.json` and `docs/principal-engineer-control-tower-architecture.html`.

---

## 1. Project Structure

```
[Project Root]
├── src/                         # Application backend (Node/TypeScript)
│   ├── api/                     # Loopback Hono API, CSP, sessions, projections
│   ├── app-safety/              # Safety + output contract text/hashes for harnesses
│   ├── cli/                     # `pnpm ct` — doctor, init, daemon, publication
│   ├── config/                  # Loaders, Zod schemas, author-login
│   ├── context/                 # Run dirs, harness manifests, coverage, seal
│   ├── cursor/                  # Cursor CLI adapter, NDJSON, validation
│   ├── daemon/                  # Bootstrap, runtime loop, HTTP server wiring
│   ├── discovery/               # Poll, checkpoints, rate-limit resilience
│   ├── github/                  # gh process adapters, search/list/view, publish
│   ├── normalize/               # Discovered PR → SQLite upsert
│   ├── orchestrator/            # Jobs/runs, pipeline, scheduler, facade
│   ├── paths/                   # CanonicalPathMatcher (shared path/glob contract)
│   ├── policy/                  # Eligibility, priority, domains, auto-analyze
│   ├── publisher/               # Operation plans, guards, gated publish
│   ├── security/                # Child-process env builders (credential isolation)
│   ├── source/                  # Fetch, worktree, source-manifest, cleanup helpers
│   ├── store/                   # SQLite open + migrations
│   └── util/                    # Hash + canonical JSON helpers
├── client/                      # React loopback UI (Vite production bundle)
│   └── src/
│       ├── components/          # App shell, accessible UI primitives, safe renderers
│       ├── hooks/               # TanStack Query data and mutation hooks
│       ├── lib/                 # API, routes, polling, display, and query helpers
│       └── routes/              # Inbox and Review route components
├── config/                      # Committed org catalog + plugins + examples
│   ├── organization.json        # Shared org/repo catalog (no secrets)
│   ├── plugins/                 # Cursor feature plugins (control-tower-pr-review)
│   └── examples/                # Starter profile + local-config templates
├── docs/                        # Handoff manifest, architecture artifact, implementation plans
├── eval/                        # Primary-review eval corpus
├── tests/                       # Vitest unit/integration/e2e coverage
├── package.json                 # Root package (`control-tower`)
├── README.md                    # Operator-facing overview
├── ONBOARDING.md                # Step-by-step local setup + customization
└── ARCHITECTURE.md              # This document
```

**Separation of concerns**

| Concern | Owner |
|---------|--------|
| Eligibility, auto-analysis, state, publication | Application code under `src/` |
| Review judgment and drafting | Cursor agents via plugin under `config/plugins/control-tower-pr-review/` (`--plugin-dir`) |
| Org/repos/defaults | `config/organization.json` |
| Per-engineer policy/persona | `~/.control-tower/profile/` |
| Machine paths, models, publication mode | `~/.control-tower/config.json` |

---

## 2. High-Level System Diagram

```
                    ┌─────────────────────────────────────────┐
                    │         Operator (principal)            │
                    │  browser UI  ·  CLI (ct)  ·  approvals  │
                    └───────────────┬─────────────────────────┘
                                    │ loopback :9120
                    ┌───────────────▼─────────────────────────┐
                    │         Control Tower Daemon            │
                    │  API  ·  Orchestrator  ·  Publisher     │
                    │  Discovery poller                       │
                    └───────┬─────────────────┬───────────────┘
                            │                 │
              ┌─────────────▼──────┐   ┌──────▼──────────────┐
              │  SQLite + run dirs │   │  Cursor Agent CLI   │
              │  (~/.control-tower │   │  (only AI harness)  │
              │   /data)           │   └─────────────────────┘
              └─────────────┬──────┘
                            │
              ┌─────────────▼──────┐
              │  GitHub via `gh`   │
              │  discover + publish│
              └────────────────────┘
```

**Data / authority flow (Phase 1)**

```
gh poll → normalize → policy evaluate
              ├─ eligible → upsert `prs` (+ checks/comments) → enqueue (auto | manual)
              └─ ineligible → retirement (delete `prs`, supersede active jobs)
        reconcile persisted `prs` missing from current poll (positive GitHub lookup)
                                    └─ prepare context + source
                                         → Cursor primaryReview
                                         → validate provenance → seal
                                         → Review draft (`draft_ready`)
                                         → human approve op → publisher → gh
```

**Architectural boundary:** deterministic eligibility and authority; agentic judgment and advice. Agents cannot change eligibility, start runs outside policy/human request, validate their own evidence, or authorize publication.

---

## 3. Core Components

### 3.1. Frontend

**Name:** Control Tower Inbox UI

**Description:** Single-operator React SPA served from the loopback daemon. React Router provides `/inbox` and `/review/:jobId` only; the Hono server returns the SPA entry point for direct GET/HEAD navigation to extensionless, non-API paths except explicitly removed client paths such as `/propose`, which return 404, and the client redirects an unmatched route to Inbox. TanStack Query owns API caching, focus refetching, mutation invalidation, and visible-tab polling: the queue refreshes every **3 seconds** when any job is in an active pipeline state and every **30 seconds** otherwise; health refreshes every **30 seconds**; an unavailable Review draft retries every **3 seconds** until it is available. There is no all-tracked or Coverage product page — per-run evidence coverage appears only as a Review coverage notice. The UI renders sanitized Markdown under a restrictive CSP; every mutation uses a session-authenticated, single-use action token.

**Technologies:** React 19, TypeScript, React Router, TanStack Query, Vite, and Tailwind CSS under `client/`

**Deployment:** Local only — served by the daemon on loopback (default port `9120`)

### 3.2. Backend Services

Control Tower is a **single local process**, not a microservice mesh. Logical services below map to modules inside that process.

#### 3.2.1. CLI (`src/cli`)

**Description:** Operator entrypoint: `init`, `doctor`, `start`/`stop`/`status`, `reset`/`reset --all`, and `publication enable|disable`.

**Technologies:** Commander, tsx

#### 3.2.2. Daemon + API (`src/daemon`, `src/api`)

**Description:** Bootstraps config/DB/adapters, runs discovery + job scheduling, exposes the Hono HTTP API and the static UI bundle. The API server requires a valid loopback session for every `/api/*` request; it serves static assets and then performs SPA fallback for GET/HEAD extensionless, non-API navigation paths except explicitly removed client paths such as `/propose`, which return 404; never for `/api` paths or file-like paths. The UI uses health (`GET /api/health` returns `{ healthy, issues }` — issues include missing discovery freshness and recent failures), queue (`GET /api/queue` returns `{ focusQueue: { now, next, monitor } }` only), jobs, drafts, approval, publication, and audit routes. Mutations first obtain a single-use action token (`POST /api/action-token`, 60s TTL, single consume).

**Technologies:** Hono, `@hono/node-server`, better-sqlite3

**HTTP surface:** `GET /api/health`, `GET /api/queue`, `GET /api/jobs/:jobId`,
`GET /api/drafts/:jobId`, `GET /api/audit/:jobId`, `POST /api/action-token`,
`POST /api/jobs/analyze`, `POST /api/jobs/:jobId/retry`, `POST /api/approvals`,
and `POST /api/publish`.

#### 3.2.3. Discovery (`src/discovery`, `src/github`, `src/normalize`)

**Description:** Polls GitHub for (1) open PRs in **active** catalog repos and (2) open explicit-review requests for the operator within each org in `config/organization.json` → `github.organizations` (these may be in repos outside the catalog). Each candidate is normalized, **policy-evaluated before persistence**, and only **eligible** PRs are upserted into SQLite `prs`. Ineligible discoveries are queued for retirement. After the main scan, `reconcileReviewCache` positively re-looks up persisted `prs` rows missing from the current poll (via `enrichPr`); confirmed closed/merged or newly ineligible rows are retired; still-eligible rows are re-upserted. Retirement deletes the `prs` row and supersedes active jobs for that PR. Checkpoints record last successful poll freshness only.

**Technologies:** `gh` subprocess, TypeScript discovery types, SQLite

#### 3.2.4. Policy (`src/policy`, `src/paths`)

**Description:** Deterministic eligibility (explicit request / path / author), priority tiers (`p0`–`p3`, plus `unranked` for ineligible), domain selection, auto-analysis rules, Focus Queue ordering. All path consumers share `CanonicalPathMatcher`.

**Technologies:** Pure TypeScript evaluators + compiled glob matcher

#### 3.2.5. Orchestrator (`src/orchestrator`)

**Description:** Job/run identity hashing, guarded state transitions, enqueue/scheduler/work-graph, pipeline runner (context → source → agent → validate → seal), recovery/retry, and draft loading for Review. The analysis pipeline's terminal success state is **`draft_ready`**. Schema also defines `awaiting_approval`, `publishing`, and `published`, but current review-core does not transition jobs through those states on publish — `POST /api/publish` executes GitHub mutations via the in-memory publisher without updating job rows. Manual **Retry** requeues a **`failed`** job with the **same job ID** (clears `accepted_run_id`); the scheduler starts a new **run** on the next pipeline attempt. The same failed job identity yields **`existing_job_current`** and requires **Retry**; a changed identity (head SHA, policy, or source mode) may enqueue a new job while the failed job remains terminal and is not PR-scoped superseded.

**Technologies:** SQLite transactional pointers, immutable run directories under `data/jobs/...`

**Description:** Cursor argv/env construction, NDJSON transcript capture, and structured primary-review output validation. Production concurrency is enforced by the scheduler's configured `maxConcurrentAgents`.

**Technologies:** Cursor Agent CLI child process

#### 3.2.7. Source + context (`src/source`, `src/context`, `src/github/fetch-pr-diff.ts`)

**Description:** Just-in-time PR-head fetches into daemon-owned admin worktrees for registered repos, followed by a protected-path-filtered source tree (`src/source/materialize.ts`) materialized into a sealed source view for Cursor and a source manifest with accurate line counts; remote-evidence-only path for unregistered repos; in-process filtering of `gh pr diff` output before writing the filtered `github/pr-diff.patch` artifact during context prep (`src/github/fetch-pr-diff.ts`); nine-layer harness composition; provenance catalog (commits, CI checks, PR comments, and diff hunks); per-run coverage records finalized after diff filtering and source-tree inspection (surfaced in Review as a coverage notice, not a separate product page); and run sealing.

**Technologies:** Git (credential-isolated fetch vs local), filesystem run artifacts

#### 3.2.8. Publisher (`src/publisher`)

**Description:** Builds exact external operations from drafts; enforces shadow vs gated mode; single-use TTL approvals bound to operation hash, head SHA, accepted run, and run-input hash; executes via `gh`.

**Technologies:** Hash-bound operation plan + GitHub publish adapter

---

## 4. Data Stores

### 4.1. SQLite (primary)

**Name:** Control Tower runtime database

**Type:** SQLite (better-sqlite3, WAL)

**Purpose:** Authoritative **eligible-only** review cache (`prs` rows exist only for policy-eligible PRs), jobs/runs, discovery checkpoints, and operational state.

**Key tables (see `src/store/migrations/001_initial.sql`):**
`schema_migrations`, `repositories`, `prs`, `pr_checks`, `pr_comments`,
`discovery_checkpoints`, `jobs`, `runs`, and `audit_events`.

**Database file:** `<dataDirectory>/control-tower.sqlite` (default data directory `~/.control-tower/data`).

**In-memory (daemon lifetime, not SQLite):** single-use action tokens (`ActionTokenStore`, 60s TTL) and per-operation publication approvals (`ApprovalStore`, 10-minute TTL). Both are cleared on daemon restart.

**`audit_events` today:** table exists and `GET /api/audit/:jobId` reads it, but no current writer populates rows — expect empty trails until audit emission is implemented.

### 4.2. Sealed run filesystem

**Name:** Per-run artifact store

**Type:** Local filesystem

**Purpose:** Immutable run attempts — harness manifest, GitHub evidence (including filtered `pr-diff.patch`), source coverage and manifest metadata, Cursor transcript/output, validation, provenance, and terminal state.

**Layout:** `data/jobs/<jobId>/runs/<runId>/`.

---

## 5. External Integrations / APIs

| Service | Purpose | Integration method |
|---------|---------|--------------------|
| **GitHub** | Discovery (PR metadata, files, checks, review requests), analysis context prep (protected `gh pr diff`), and gated publication | GitHub CLI (`gh`) subprocess; operator identity |
| **Cursor Agent CLI** | Primary review drafts | Local authenticated CLI; named model roles |
| **Git** | Partial mirror fetch, admin worktree checkout, and source-manifest generation | Credential-isolated child env builders in `src/security/child-env.ts` |

**Not integrated in the current runtime:** Linear resolution, Slack/email, browser automation, and direct model-provider SDKs.

---

## 6. Deployment & Infrastructure

**Cloud Provider:** None required — **local-first on the operator machine**

**Key runtime pieces:** Node 22+, pnpm, Git, `gh`, Cursor Agent CLI, Vite-built client assets, loopback HTTP

**Build and tests:** Root tests run through Vitest (`pnpm test`) and root
typechecking uses `pnpm typecheck` for `src/` and `tests/`. The client is
independently typechecked and bundled with `pnpm --dir client build`; the daemon
serves `client/dist`. There are no `.github` workflows or cloud control-plane
deployments in this repository.

**Monitoring & Logging:** Daemon health API, SQLite/run-dir audit trail; failures remain visible in queue/UI rather than silent drop

**Optional later:** `launchd` autostart is a post-pilot convenience, not an architecture dependency

---

## 7. Security Considerations

**Authentication**
- GitHub: authenticated `gh` as the configured operator login (doctor-validated)
- Cursor: local Cursor account authentication for Agent CLI
- UI: loopback-only; all `/api/*` routes require a session, and mutating routes also use single-use action tokens

**Authorization**
- Application owns every external mutation decision
- Publication blocked in `shadow` mode
- Gated mode requires exact human approval per operation (`POST /api/approvals` takes one `operationHash`; there is no batch-approve endpoint)
- Agent confidence never grants authority

**Credential isolation**
- Distinct child-env builders: `buildGhEnv`, `buildCursorEnv`, `buildGitFetchEnv`, `buildGitLocalEnv`
- Agents do not receive host credentials for arbitrary shell/network use
- Phase 1 constrains agents via safety/output contracts and Cursor `--sandbox enabled` / `--mode=ask`; harness text forbids shell, write/delete, MCP, and browser/network tools. Protected paths are enforced by those contracts plus application-side source/diff filtering — there is no runtime read-hook enforcement path.

**Data protection**
- Organization `security.protectedPaths` drives registered-source tree filtering (`src/source/materialize.ts`) and in-process filtering of `gh pr diff` output before writing the filtered `github/pr-diff.patch` artifact during analysis context prep (`src/github/fetch-pr-diff.ts`). Only org-configured patterns are applied today.
- Safe Markdown rendering + restrictive CSP against stored XSS from PR content

**Key practices**
- Fail-closed path canonicalization (`CanonicalPathMatcher`)
- Immutable run attempts; restart recovery without mutating engineer checkouts
- Exact head SHA / run-input hash / accepted-run binding on publish

---

## 8. Development & Testing Environment

**Local setup**

```bash
pnpm install
pnpm --dir client install
pnpm --dir client build
pnpm ct init
# edit ~/.control-tower/profile + config.json
pnpm ct doctor
pnpm ct start
```

**Testing frameworks:** Vitest (`pnpm test`, `pnpm test:watch`); client tests that need a DOM opt into happy-dom via per-file `// @vitest-environment happy-dom` pragmas — the root Vitest config does not globally set happy-dom

**Typechecking:** `pnpm typecheck` (`tsc --noEmit`)

**Client bundle:** `pnpm --dir client build` (`tsc -b && vite build`)

**Client development:** Start the daemon, then run `pnpm --dir client dev`. Vite
proxies `/api` to `http://127.0.0.1:9120` by default; set `CT_DAEMON_PORT` for
another daemon port.

**Eval corpora:** `eval/primary-review` — used for rollout quality gates

**Code quality:** Prefer matching existing module contracts in `docs/superpowers/plans/` (shared symbols: `openDatabase`, `CanonicalPathMatcher`, config loaders, orchestrator facade). Do not invent parallel APIs or table names.

**Fake adapters:** Tests under `tests/` cover policy, discovery, orchestrator, publisher guards, API, client, eval gates — use injectable adapters rather than live GitHub/Cursor in unit tests.

---

## 9. Future Considerations / Roadmap

**Phase 1 posture:** Shadow → historical replay → live shadow → gated publishing.

**Current AI scope:** `cursor.modelRoles.primaryReview` only — no `attention`, proposals, or learning roles in config or runtime.

**Phase 2 (independently gated capabilities — not implemented in review-core; do not weaken Phase 1 contracts):**
- **2A** Advanced / cross-repository review
- **2B** Bot publication
- **2C** Delivery Intelligence — separately scoped, read-only workflow. It may collect GitHub/Linear observations and retain its own time-aware linkage ledger. It must not reuse the review queue or cause non-reviewable PRs to be persisted by the review-core database.
- **2D** Sandboxed repository checks

**Not in this codebase:** `/api/signals`, `/api/proposals/*`, an all-tracked or Coverage product page, or Delivery Intelligence persistence.

**Known constraints / non-goals that shape architecture**
- No microservices, message broker, vector DB, or container orchestration for this product shape
- No silent profile or policy mutation by agents
- App must not mutate the engineer’s day-to-day development checkout

---

## 10. Project Identification

| Field | Value |
|-------|-------|
| **Project Name** | Control Tower (`control-tower`) |
| **Repository** | `git@github.com:shubh-array/sidekick.git` (local checkout may be named `assistant`) |
| **Primary audience** | Principal engineers operating the product locally; implementation agents extending Phase 1/2 |
| **Date of Last Update** | 2026-07-14 |

---

## 11. Glossary / Acronyms

| Term | Meaning |
|------|---------|
| **Inbox** | Deterministically ordered eligible triage home; optional Now / Next / Monitor grouping |
| **Review** | Draft review + provenance + publication approval UI for a job |
| **Eligibility** | Deterministic rule: explicit request, or active repo + path/author match |
| **Author-only** | Eligible via author match without path match; usually on-demand analysis |
| **Auto-analyze** | Deterministic policy that enqueues Cursor primary review without human click |
| **Job / Run** | Job identity is stable work item; each attempt is an immutable run |
| **Sealed run** | Terminal run artifacts + validation committed; pointers updated after seal |
| **Provenance (`pv_`)** | Application-created evidence IDs binding findings to verified file/blob/range facts |
| **Shadow mode** | `publication.mode = shadow` — discover/analyze allowed; publisher disabled |
| **Gated mode** | Publishing allowed only with exact per-operation human approval |
| **Registered-source** | Review path using a configured local repo to fetch the PR head into a daemon-owned admin worktree, materialize a protected-path-filtered source tree for Cursor, and generate a source manifest with allowed/omitted entries |
| **Remote-evidence-only** | Review without admin worktree/source view (unregistered or explicit) |
| **CanonicalPathMatcher** | Single app-owned path/glob contract for eligibility, domains, protection, materialization |
| **Harness** | Feature-grouped review guidance; Phase 1 ships as Cursor plugin `control-tower-pr-review` |
| **Nine-layer composition** | Fixed harness layering order with explicit policy snapshot (no deep-merge) |
| **Control Tower** | This product — local PE desk for delegated, human-gated PR review |

---

## How to customize and extend

Use this section as the practical companion to the module map above.

### Customize without code (preferred)

1. **Org catalog** — add/edit repositories in `config/organization.json` (IDs are stable keys).
2. **Active set** — choose `activeRepositoryIds` in profile.
3. **Policy** — edit `eligiblePaths`, `eligibleAuthors`, `priorityRules`, `domainRules`, and `autoAnalyze` in profile `policy.json`.
4. **Persona / review plugin** — tune `persona.md` and the primary-review pack under `config/plugins/control-tower-pr-review/`.
5. **Models** — set `cursor.modelRoles.primaryReview` in local config; `pnpm ct doctor` checks model **availability** (`agent models`) and runs a separate **smoke** check per distinct configured model (no silent fallback).
6. **Publication** — keep `shadow` until you validate draft quality; then `pnpm ct publication enable`, which runs `doctor` and requires confirmation.

### Extend with code (rules of engagement)

| If you want to… | Touch | Do not |
|-----------------|-------|--------|
| Change eligibility/priority semantics | `src/policy/*` + tests + design contract | Let agents decide eligibility |
| Add discovery fields | `src/github`, `src/normalize`, migrations | Change the public projection without updating its tests |
| Change analysis pipeline stages | `src/orchestrator/pipeline*.ts` | Overwrite prior run attempts |
| Add UI surface | `client/src/routes`, `src/api/routes` | Trust unsanitized PR HTML |
| Add publish operation type | `src/publisher/*` + guards | Skip approval hash / SHA binding |
| Add Phase 2 capability | New plan/branch/flags per Phase 2 spec | Mix capabilities or weaken Phase 1 invariants |

### Shared contracts (do not fork)

Plans and modules share these symbols — inventing aliases breaks the product:

- `openDatabase` / `runMigrations` — `src/store/`
- `CanonicalPathMatcher` — `src/paths/`
- `buildGhEnv` / `buildCursorEnv` / `buildGitFetchEnv` / `buildGitLocalEnv` — `src/security/child-env.ts`
- Config loaders — `src/config/load.ts`
- `OrchestratorFacade` — `src/orchestrator/facade.ts`
- SQLite PR table name: **`prs`**
- Default loopback port: **9120**

### Mental model for contributors

```
Config (org + profile + local)
        ↓
Discovery (deterministic facts)
        ↓
Policy (deterministic decisions)
        ↓
Orchestrator (deterministic scheduling + sealed runs)
        ↓
Cursor (probabilistic judgment inside a cage)
        ↓
Validation + human approval (authority)
        ↓
GitHub (external effect)
```

If a change moves a box leftward (gives agents more authority) or skips a box (publish without validation/approval), it violates the architecture.
