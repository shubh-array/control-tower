# Architecture Overview

This document is the living architecture map for **Control Tower**: how the system is structured, where authority lives, and how to customize or extend it safely. Update it as the codebase evolves.

For operator quick start, see [`README.md`](./README.md). For step-by-step local setup and customization, see [`ONBOARDING.md`](./ONBOARDING.md). Authoritative Phase 1 product contracts live in `docs/superpowers/specs/`.

---

## 1. Project Structure

```
[Project Root]
├── src/                         # Application backend (Node/TypeScript)
│   ├── api/                     # Loopback Hono API, CSP, sessions, projections
│   ├── app-safety/              # Safety + output contract text/hashes for harnesses
│   ├── attention/               # Deferred pr-attention advisor helpers
│   ├── cli/                     # `pnpm ct` — doctor, init, daemon, publication
│   ├── config/                  # Loaders, Zod schemas, author-login, protected paths
│   ├── context/                 # Run dirs, harness manifests, coverage, seal
│   ├── cursor/                  # Cursor CLI adapter, pool, NDJSON, validation
│   ├── daemon/                  # Bootstrap, runtime loop, HTTP server wiring
│   ├── discovery/               # Poll, checkpoints, rate-limit resilience
│   ├── github/                  # gh process adapters, diff-filter helpers, publish
│   ├── handoff/                 # Phase 1 baseline manifest helpers
│   ├── learning/                # Signal recording and pipeline hooks
│   ├── normalize/               # Discovered PR → SQLite upsert
│   ├── orchestrator/            # Jobs/runs, pipeline, scheduler, facade
│   ├── paths/                   # CanonicalPathMatcher (shared path/glob contract)
│   ├── policy/                  # Eligibility, priority, domains, auto-analyze
│   ├── proposals/               # Governed profile-change proposals
│   ├── publisher/               # Operation plans, guards, gated publish
│   ├── security/                # Child-process env builders (credential isolation)
│   ├── source/                  # Fetch, worktree, source-manifest, cleanup helpers
│   ├── store/                   # SQLite open + migrations
│   ├── tickets/                 # Deterministic ticket-id extraction (opaque)
│   └── util/                    # Hash + canonical JSON helpers
├── client/                      # React loopback UI (Vite production bundle)
│   └── src/
│       ├── components/          # App shell, accessible UI primitives, safe renderers
│       ├── hooks/               # TanStack Query data and mutation hooks
│       ├── lib/                 # API, routes, polling, display, and query helpers
│       └── routes/              # Inbox, Coverage, Review, and Propose route components
├── config/                      # Committed org catalog + harnesses + examples
│   ├── organization.json        # Shared org/repo catalog (no secrets)
│   ├── harnesses/               # pr-attention + pr-review prompts/skills/domains
│   └── examples/                # Starter profile + local-config templates
├── docs/                        # Design specs, plans, rollout checklist
├── eval/                        # Attention + primary-review eval corpora
├── tests/                       # Vitest unit/integration/e2e coverage
├── package.json                 # Root package (`control-tower`)
├── README.md                    # Operator-facing overview
├── ONBOARDING.md                # Step-by-step local setup + customization
└── Architecture.md              # This document
```

**Separation of concerns**

| Concern | Owner |
|---------|--------|
| Coverage, eligibility, auto-analysis, state, publication | Application code under `src/` |
| Review judgment, drafting, attention advice | Cursor agents via harnesses under `config/harnesses/` |
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
                    │  Discovery poller  ·  Learning/Proposals│
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
gh poll → normalize → policy evaluate → Coverage
                                    └─ enqueue (auto | human)
                                         → prepare context + source
                                         → Cursor primaryReview
                                         → validate provenance → seal
                                         → Review draft
                                         → human approve op → publisher → gh
```

**Architectural boundary:** deterministic coverage and authority; agentic judgment and advice. Agents cannot hide covered PRs, change eligibility, start runs outside policy/human request, validate their own evidence, or authorize publication.

---

## 3. Core Components

### 3.1. Frontend

**Name:** Control Tower Inbox UI

**Description:** Single-operator React SPA served from the loopback daemon. React Router provides `/inbox`, `/coverage`, `/propose`, and `/review/:jobId`; the Hono server returns the SPA entry point for direct GET/HEAD navigation to extensionless, non-API paths, and the client redirects an unmatched route to Inbox. TanStack Query owns API caching, focus refetching, mutation invalidation, and visible-tab polling: the queue refreshes every 3 seconds with an active job and every 30 seconds otherwise, while an unavailable Review draft retries every 3 seconds until it is available. The UI renders sanitized Markdown under a restrictive CSP; every mutation uses a session-authenticated, single-use action token.

**Technologies:** React 19, TypeScript, React Router, TanStack Query, Vite, and Tailwind CSS under `client/`

**Deployment:** Local only — served by the daemon on loopback (default port `9120`)

### 3.2. Backend Services

Control Tower is a **single local process**, not a microservice mesh. Logical services below map to modules inside that process.

#### 3.2.1. CLI (`src/cli`)

**Description:** Operator entrypoint: `init`, `doctor`, `start`/`stop`/`status`, `reset`/`reset --all`, and `publication enable|disable`.

**Technologies:** Commander, tsx

#### 3.2.2. Daemon + API (`src/daemon`, `src/api`)

**Description:** Bootstraps config/DB/adapters, runs discovery + job scheduling, exposes the Hono HTTP API and the static UI bundle. The API server requires a valid loopback session for every `/api/*` request; it serves static assets and then performs SPA fallback for GET/HEAD extensionless, non-API paths, never for `/api` paths or file-like paths. The UI uses health, queue, jobs, drafts, approval, publication, audit, learning-signal, and proposal routes. Mutations first obtain a single-use action token.

**Technologies:** Hono, `@hono/node-server`, better-sqlite3

**HTTP surface:** `GET /api/health`, `GET /api/queue`, `GET /api/jobs/:jobId`,
`GET /api/drafts/:jobId`, `GET /api/audit/:jobId`, `GET /api/signals`,
`POST /api/action-token`, `POST /api/jobs/analyze`,
`POST /api/jobs/:jobId/retry`, `POST /api/approvals`, `POST /api/publish`, and
the proposal start/validate/adopt routes under `/api/proposals`.

#### 3.2.3. Discovery (`src/discovery`, `src/github`, `src/normalize`)

**Description:** Polls configured orgs/repos and explicit review requests via GitHub CLI; upserts authoritative PR state; evaluates policy and persists decisions. The module also contains protected-diff helpers that are not wired into the production discovery path.

**Technologies:** `gh` subprocess, TypeScript discovery types, SQLite

#### 3.2.4. Policy (`src/policy`, `src/paths`)

**Description:** Deterministic eligibility (explicit request / path / author), priority tiers (`p0`–`p3`, plus `unranked` for ineligible), domain selection, auto-analysis rules, Focus Queue ordering. All path consumers share `CanonicalPathMatcher`.

**Technologies:** Pure TypeScript evaluators + compiled glob matcher

#### 3.2.5. Orchestrator (`src/orchestrator`)

**Description:** Job/run identity hashing, guarded state transitions, enqueue/scheduler/work-graph, pipeline runner (context → source → agent → validate → seal), recovery/retry, and draft loading for Review.

**Technologies:** SQLite transactional pointers, immutable run directories under `data/jobs/...`

#### 3.2.6. Attention advisor (`src/attention`)

**Description:** Deferred advisor implementation. The module contains run, validation, and ordering helpers, but the production daemon does not schedule Cursor advisor runs or persist advisor results. Current Inbox ordering falls back to the deterministic queue tuple.

**Technologies:** Cursor CLI integration helpers and schema validation (not wired into the production runtime)

#### 3.2.7. Cursor adapter (`src/cursor`)

**Description:** Cursor argv/env construction, NDJSON transcript capture, and structured primary-review output validation. Production concurrency is enforced by the scheduler's configured `maxConcurrentAgents`; the `WorkerPool` helper is not used by the runtime.

**Technologies:** Cursor Agent CLI child process

#### 3.2.8. Source + context (`src/source`, `src/context`)

**Description:** Just-in-time PR-head fetches into daemon-owned admin worktrees for registered repos, followed by a source manifest; remote-evidence-only path for unregistered repos; nine-layer harness composition; coverage/provenance records; and run sealing. The current pipeline does not materialize a filtered source tree for Cursor.

**Technologies:** Git (credential-isolated fetch vs local), filesystem run artifacts

#### 3.2.9. Publisher (`src/publisher`)

**Description:** Builds exact external operations from drafts; enforces shadow vs gated mode; single-use TTL approvals bound to operation hash, head SHA, accepted run, and run-input hash; executes via `gh`.

**Technologies:** Hash-bound operation plan + GitHub publish adapter

#### 3.2.10. Learning + proposals (`src/learning`, `src/proposals`)

**Description:** Records structured pipeline, attention-outcome, and disposition signals in SQLite. Proposals are filesystem packages that require validation, historical replay, exact preview, and explicit human adoption — no silent policy mutation.

**Technologies:** Filesystem proposal store under `data/proposals/`

---

## 4. Data Stores

### 4.1. SQLite (primary)

**Name:** Control Tower runtime database

**Type:** SQLite (better-sqlite3, WAL)

**Purpose:** Authoritative discovered PR coverage, policy decision projections, jobs/runs, approvals, and operational state.

**Key tables (see `src/store/migrations/`):**
`schema_migrations`, `repositories`, `prs`, `pr_files`, `pr_checks`,
`pr_reviews`, `pr_comments`, `review_requests`, `discovery_checkpoints`,
`attention_items`, `jobs`, `runs`, `advisor_runs`, and `audit_events` are
created by migrations. `SignalRecorder` initializes `learning_signals`.

**Location:** Under `dataDirectory` from local config (default `~/.control-tower/data`)

### 4.2. Sealed run filesystem

**Name:** Per-run artifact store

**Type:** Local filesystem

**Purpose:** Immutable run attempts — harness manifest, GitHub evidence, source
manifest metadata, Cursor transcript/output, validation, provenance, and terminal
state.

**Layout:** `data/jobs/<jobId>/runs/<runId>/`. The deferred attention module has
a helper for `data/attention-runs/`, but production does not create those runs.

### 4.3. Proposal store

**Name:** Governed change proposals

**Type:** Local filesystem

**Purpose:** Durable proposal packages and single-use adoption markers under `data/proposals/`

### 4.4. Learning signals

**Name:** Pipeline and disposition signal store

**Type:** SQLite table (`learning_signals`)

**Purpose:** Queryable input to governed proposals, exposed to the client through
`GET /api/signals`.

---

## 5. External Integrations / APIs

| Service | Purpose | Integration method |
|---------|---------|--------------------|
| **GitHub** | Discovery (PR metadata, files, checks, review requests) and gated publication | GitHub CLI (`gh`) subprocess; operator identity |
| **Cursor Agent CLI** | Primary review drafts | Local authenticated CLI; named model roles |
| **Git** | Partial mirror fetch, admin worktree checkout, and source-manifest generation | Credential-isolated child env builders in `src/security/child-env.ts` |

**Not integrated in the current runtime:** Cursor attention-advisor execution (the configuration and helpers are present but unscheduled), Linear resolution (ticket IDs are extracted as opaque metadata only), Slack/email, browser automation, and direct model-provider SDKs.

---

## 6. Deployment & Infrastructure

**Cloud Provider:** None required — **local-first on the operator machine**

**Key runtime pieces:** Node 22+, pnpm, Git, `gh`, Cursor Agent CLI, Vite-built client assets, loopback HTTP

**Build and tests:** Root tests run through Vitest (`pnpm test`) and root
typechecking uses `pnpm typecheck` for `src/` and `tests/`. The client is
independently typechecked and bundled with `pnpm --dir client build`; the daemon
serves `client/dist`. There are no `.github` workflows or cloud control-plane
deployments in this repository.

**Monitoring & Logging:** Daemon health API, SQLite/run-dir audit trail, structured learning signals; failures remain visible in queue/UI rather than silent drop

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
- Phase 1 constrains agents via safety/output contracts and Cursor `--sandbox enabled` / `--mode=ask`; harness text forbids shell, write/delete, MCP, and browser/network tools. A fail-closed protected-path read hook exists only as an unmaterialized template and is not a production enforcement mechanism.

**Data protection**
- Organization `security.protectedPaths` is configuration for registered-source preparation. The planned built-in default union and streaming protected-diff filter are not wired into the current runtime.
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

**Testing frameworks:** Vitest (`pnpm test`, `pnpm test:watch`); client component tests use happy-dom through the root Vitest configuration

**Typechecking:** `pnpm typecheck` (`tsc --noEmit`)

**Client bundle:** `pnpm --dir client build` (`tsc -b && vite build`)

**Client development:** Start the daemon, then run `pnpm --dir client dev`. Vite
proxies `/api` to `http://127.0.0.1:9120` by default; set `CT_DAEMON_PORT` for
another daemon port.

**Eval corpora:** `eval/attention`, `eval/primary-review` — used for rollout quality gates

**Code quality:** Prefer matching existing module contracts in `docs/superpowers/plans/` (shared symbols: `openDatabase`, `CanonicalPathMatcher`, config loaders, orchestrator facade). Do not invent parallel APIs or table names.

**Fake adapters:** Tests under `tests/` cover policy, discovery, orchestrator, publisher guards, API, client, eval gates — use injectable adapters rather than live GitHub/Cursor in unit tests.

---

## 9. Future Considerations / Roadmap

**Phase 1 posture:** Shadow → historical replay → live shadow → gated publishing (see `docs/superpowers/rollout/phase-1-gate-checklist.md`).

**Phase 2 (independently gated capabilities — do not weaken Phase 1 contracts):**
- **2A** Advanced / cross-repository review
- **2B** Bot publication
- **2C** Delivery-provider intelligence (e.g. Linear resolution of ticket IDs)
- **2D** Sandboxed repository checks

**Known constraints / non-goals that shape architecture**
- No microservices, message broker, vector DB, or container orchestration for this product shape
- No silent learning or autonomous profile/policy mutation
- App must not mutate the engineer’s day-to-day development checkout

---

## 10. Project Identification

| Field | Value |
|-------|-------|
| **Project Name** | Control Tower (`control-tower`) |
| **Repository** | `git@github.com:shubh-array/sidekick.git` (local checkout may be named `assistant`) |
| **Primary audience** | Principal engineers operating the product locally; implementation agents extending Phase 1/2 |
| **Date of Last Update** | 2026-07-13 |

---

## 11. Glossary / Acronyms

| Term | Meaning |
|------|---------|
| **Coverage** | Authoritative UI/API audit of every discovered active-repo PR and explicit review request; never agent-filtered |
| **Inbox** | Deterministically ordered eligible triage home; optional Now / Next / Monitor grouping |
| **Review** | Draft review + provenance + publication approval UI for a job |
| **Eligibility** | Deterministic rule: explicit request, or active repo + path/author match |
| **Author-only** | Eligible via author match without path match; usually on-demand analysis |
| **Auto-analyze** | Deterministic policy that enqueues Cursor primary review without human click |
| **Attention advisor** | Deferred metadata-only Cursor capability; its configuration and helpers exist, but the production daemon does not execute it |
| **Advisor order** | Ordering helper reserved for advisor results; current Inbox ordering uses the deterministic queue tuple because advisor results are not persisted |
| **Job / Run** | Job identity is stable work item; each attempt is an immutable run |
| **Sealed run** | Terminal run artifacts + validation committed; pointers updated after seal |
| **Provenance (`pv_`)** | Application-created evidence IDs binding findings to verified file/blob/range facts |
| **Shadow mode** | `publication.mode = shadow` — discover/analyze allowed; publisher disabled |
| **Gated mode** | Publishing allowed only with exact per-operation human approval |
| **Registered-source** | Review path using a configured local repo to fetch the PR head into a daemon-owned admin worktree and generate a source manifest |
| **Remote-evidence-only** | Review without admin worktree/source view (unregistered or explicit) |
| **CanonicalPathMatcher** | Single app-owned path/glob contract for eligibility, domains, protection, materialization |
| **Harness** | Feature-grouped prompt/skills/domain pack (`pr-attention`, `pr-review`) |
| **Nine-layer composition** | Fixed harness layering order with explicit policy snapshot (no deep-merge) |
| **Governed proposal** | Profile/policy change package requiring replay, preview, and explicit adopt |
| **Control Tower** | This product — local PE desk for delegated, human-gated PR review |

---

## How to customize and extend

Use this section as the practical companion to the module map above.

### Customize without code (preferred)

1. **Org catalog** — add/edit repositories in `config/organization.json` (IDs are stable keys).
2. **Active set** — choose `activeRepositoryIds` in profile.
3. **Policy** — edit `eligiblePaths`, `eligibleAuthors`, `priorityRules`, `domainRules`, and `autoAnalyze` in profile `policy.json`. `attentionAdvisor` only preconfigures the deferred advisor feature.
4. **Persona / harnesses** — tune `persona.md` and the active primary-review files under `config/harnesses/pr-review/`. `pr-attention` files are retained for the deferred advisor feature.
5. **Models** — set named roles in local `cursor.modelRoles`; validate with `pnpm ct doctor` (no silent fallback).
6. **Publication** — keep `shadow` until you validate draft quality; then `pnpm ct publication enable`, which runs `doctor` and requires confirmation.

### Extend with code (rules of engagement)

| If you want to… | Touch | Do not |
|-----------------|-------|--------|
| Change eligibility/priority semantics | `src/policy/*` + tests + design contract | Let agents decide eligibility |
| Add discovery fields | `src/github`, `src/normalize`, migrations | Change the public projection without updating its tests |
| Change analysis pipeline stages | `src/orchestrator/pipeline*.ts` | Overwrite prior run attempts |
| Add UI surface | `client/src/routes`, `src/api/routes` | Trust unsanitized PR HTML |
| Add publish operation type | `src/publisher/*` + guards | Skip approval hash / SHA binding |
| Add learning signal | `src/learning/*` | Auto-apply to policy files |
| Add Phase 2 capability | New plan/branch/flags per Phase 2 spec | Mix capabilities or weaken Phase 1 invariants |

### Shared contracts (do not fork)

Plans and modules share these symbols — inventing aliases breaks the product:

- `openDatabase` / `runMigrations` — `src/store/`
- `CanonicalPathMatcher` / `pathMatchesAny` — `src/paths/`
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
