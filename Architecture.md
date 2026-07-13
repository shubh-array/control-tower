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
│   ├── attention/               # Optional pr-attention advisor (advisory only)
│   ├── cli/                     # `pnpm ct` — doctor, init, daemon, publication
│   ├── config/                  # Loaders, Zod schemas, author-login, protected paths
│   ├── context/                 # Run dirs, harness manifests, coverage, seal
│   ├── cursor/                  # Cursor CLI adapter, pool, NDJSON, validation
│   ├── daemon/                  # Bootstrap, runtime loop, HTTP server wiring
│   ├── discovery/               # Poll, checkpoints, rate-limit resilience
│   ├── github/                  # gh process adapters, diff filter, publish
│   ├── handoff/                 # Phase 1 baseline manifest helpers
│   ├── learning/                # Signal recording and pipeline hooks
│   ├── normalize/               # Discovered PR → SQLite upsert
│   ├── orchestrator/            # Jobs/runs, pipeline, scheduler, facade
│   ├── paths/                   # CanonicalPathMatcher (shared path/glob contract)
│   ├── policy/                  # Eligibility, priority, domains, auto-analyze
│   ├── proposals/               # Governed profile-change proposals
│   ├── publisher/               # Operation plans, guards, gated publish
│   ├── security/                # Child-process env builders (credential isolation)
│   ├── source/                  # Fetch/materialize/cleanup source views
│   ├── store/                   # SQLite open + migrations
│   ├── tickets/                 # Deterministic ticket-id extraction (opaque)
│   └── util/                    # Hash + canonical JSON helpers
├── client/                      # React loopback UI (Focus / All Tracked / Workbench)
│   └── src/
│       ├── components/          # SafeMarkdown, coverage/advisor badges
│       ├── lib/                 # API client helpers
│       └── routes/              # FocusQueue, AllTracked, Workbench, ProposeChange
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
gh poll → normalize → policy evaluate → All Tracked
                                    ├─ optional attention advisor (advisory)
                                    └─ enqueue (auto | human)
                                         → prepare context + source
                                         → Cursor primaryReview
                                         → validate provenance → seal
                                         → Workbench draft
                                         → human approve op → publisher → gh
```

**Architectural boundary:** deterministic coverage and authority; agentic judgment and advice. Agents cannot hide covered PRs, change eligibility, start runs outside policy/human request, validate their own evidence, or authorize publication.

---

## 3. Core Components

### 3.1. Frontend

**Name:** Control Tower Workbench UI

**Description:** Single-operator React app served from the loopback daemon. Routes: Focus Queue (eligible triage), All Tracked (authoritative coverage), Workbench (draft + approvals), Propose Change (governed profile edits). Renders sanitized Markdown under a restrictive CSP; mutating actions use single-use action tokens.

**Technologies:** React, TypeScript, Vite-style client package under `client/`

**Deployment:** Local only — served by the daemon on loopback (default port `9120`)

### 3.2. Backend Services

Control Tower is a **single local process**, not a microservice mesh. Logical services below map to modules inside that process.

#### 3.2.1. CLI (`src/cli`)

**Description:** Operator entrypoint: `init`, `doctor`, `start`/`stop`/`status`, `publication enable|disable`.

**Technologies:** Commander, tsx

#### 3.2.2. Daemon + API (`src/daemon`, `src/api`)

**Description:** Bootstraps config/DB/adapters, runs discovery + job scheduling, exposes Hono HTTP API and static UI. Facade surface for the UI: `getAllTracked`, `getFocusQueue`, `getJob`, `getDraft`, `requestAnalyze`, `requestRetry`, `requestAdvice`, health/audit.

**Technologies:** Hono, `@hono/node-server`, better-sqlite3

#### 3.2.3. Discovery (`src/discovery`, `src/github`, `src/normalize`)

**Description:** Polls configured orgs/repos and explicit review requests via GitHub CLI; applies line-oriented streaming protected-diff filtering; upserts authoritative PR state; evaluates policy and persists decisions.

**Technologies:** `gh` subprocess, TypeScript discovery types, SQLite

#### 3.2.4. Policy (`src/policy`, `src/paths`)

**Description:** Deterministic eligibility (explicit request / path / author), priority tiers (`p0`–`p3`, plus `unranked` for ineligible), domain selection, auto-analysis rules, Focus Queue ordering. All path consumers share `CanonicalPathMatcher`.

**Technologies:** Pure TypeScript evaluators + compiled glob matcher

#### 3.2.5. Orchestrator (`src/orchestrator`)

**Description:** Job/run identity hashing, guarded state transitions, enqueue/scheduler/work-graph, pipeline runner (context → source → agent → validate → seal), recovery/retry, draft loading for the workbench.

**Technologies:** SQLite transactional pointers, immutable run directories under `data/jobs/...`

#### 3.2.6. Attention advisor (`src/attention`)

**Description:** Optional metadata-only Cursor pass over a bounded candidate set. Output is advisory; application derives Advisor order. Never changes All Tracked membership or auto-analysis.

**Technologies:** Cursor CLI + schema validation

#### 3.2.7. Cursor adapter (`src/cursor`)

**Description:** Bounded worker pool, argv/env construction, NDJSON transcript capture, structured output validation for primary review and attention.

**Technologies:** Cursor Agent CLI child process

#### 3.2.8. Source + context (`src/source`, `src/context`)

**Description:** Just-in-time partial mirrors and filtered source views for registered repos; remote-evidence-only path for unregistered; nine-layer harness composition; coverage/provenance records; run sealing.

**Technologies:** Git (credential-isolated fetch vs local), filesystem run artifacts

#### 3.2.9. Publisher (`src/publisher`)

**Description:** Builds exact external operations from drafts; enforces shadow vs gated mode; single-use TTL approvals bound to operation hash, head SHA, accepted run, and run-input hash; executes via `gh`.

**Technologies:** Hash-bound operation plan + GitHub publish adapter

#### 3.2.10. Learning + proposals (`src/learning`, `src/proposals`)

**Description:** Records structured pipeline/attention/disposition signals. Proposals require validation, historical replay, exact preview, and explicit human adoption — no silent policy mutation.

**Technologies:** Filesystem proposal store under `data/proposals/`

---

## 4. Data Stores

### 4.1. SQLite (primary)

**Name:** Control Tower runtime database

**Type:** SQLite (better-sqlite3, WAL)

**Purpose:** Authoritative discovered PR coverage, policy decision projections, jobs/runs, approvals, and operational state.

**Key tables (see `src/store/migrations/`):**
`repositories`, `prs`, `pr_files`, `pr_checks`, `pr_reviews`, `pr_comments`, jobs/runs and related projection tables (migrations `001_initial.sql`, `002_projection_columns.sql`)

**Location:** Under `dataDirectory` from local config (default `~/.control-tower/data`)

### 4.2. Sealed run filesystem

**Name:** Per-run artifact store

**Type:** Local filesystem

**Purpose:** Immutable run attempts — harness manifest, GitHub evidence, filtered source refs, Cursor transcript/output, validation, provenance, terminal state.

**Layout (conceptual):** `data/jobs/<jobId>/runs/<runId>/` plus attention runs under `data/attention-runs/`

### 4.3. Proposal store

**Name:** Governed change proposals

**Type:** Local filesystem

**Purpose:** Durable proposal packages and single-use adoption markers under `data/proposals/`

---

## 5. External Integrations / APIs

| Service | Purpose | Integration method |
|---------|---------|--------------------|
| **GitHub** | Discovery (PR metadata, files, checks, review requests) and gated publication | GitHub CLI (`gh`) subprocess; operator identity |
| **Cursor Agent CLI** | Attention advice and primary review drafts | Local authenticated CLI; named model roles |
| **Git** | Partial mirror fetch / admin worktree / filtered source materialization | Credential-isolated child env builders in `src/security/child-env.ts` |

**Not integrated in Phase 1:** Linear (ticket IDs extracted as opaque metadata only), Slack/email, browser automation, direct model-provider SDKs.

---

## 6. Deployment & Infrastructure

**Cloud Provider:** None required — **local-first on the operator machine**

**Key runtime pieces:** Node 22+, pnpm, Git, `gh`, Cursor Agent CLI, loopback HTTP

**CI/CD Pipeline:** Local/repo tests via Vitest (`pnpm test`). No `.github` workflows or cloud control-plane deployment in this repository for Phase 1

**Monitoring & Logging:** Daemon health API, SQLite/run-dir audit trail, structured learning signals; failures remain visible in queue/UI rather than silent drop

**Optional later:** `launchd` autostart is a post-pilot convenience, not an architecture dependency

---

## 7. Security Considerations

**Authentication**
- GitHub: authenticated `gh` as the configured operator login (doctor-validated)
- Cursor: local Cursor account authentication for Agent CLI
- UI: loopback-only; mutating routes use session + single-use action tokens

**Authorization**
- Application owns every external mutation decision
- Publication blocked in `shadow` mode
- Gated mode requires exact human approval per operation (`POST /api/approvals` takes one `operationHash`; there is no batch-approve endpoint)
- Agent confidence never grants authority

**Credential isolation**
- Distinct child-env builders: `buildGhEnv`, `buildCursorEnv`, `buildGitFetchEnv`, `buildGitLocalEnv`
- Agents do not receive host credentials for arbitrary shell/network use
- Phase 1 constrains agents via safety/output contracts, Cursor `--sandbox enabled` / `--mode=ask`, and a fail-closed protected-path read hook; harness text forbids shell, write/delete, MCP, and browser/network tools

**Data protection**
- Organization `security.protectedPaths` unioned with hardcoded defaults — cannot be removed by profile
- Streaming protected-diff filter before sinks; sensitive paths excluded from agent-visible source views
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
pnpm ct init
# edit ~/.control-tower/profile + config.json
pnpm ct doctor
pnpm ct start
```

**Testing frameworks:** Vitest (`pnpm test`, `pnpm test:watch`)

**Typechecking:** `pnpm typecheck` (`tsc --noEmit`)

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
| **All Tracked** | Authoritative UI/API coverage of every discovered active-repo PR and explicit review request; never agent-filtered |
| **Focus Queue** | Eligible-only triage view (Now / Next / Monitor) |
| **Workbench** | Draft review + provenance + publication approval UI for a job |
| **Eligibility** | Deterministic rule: explicit request, or active repo + path/author match |
| **Author-only** | Eligible via author match without path match; usually on-demand analysis |
| **Auto-analyze** | Deterministic policy that enqueues Cursor primary review without human click |
| **Attention advisor** | Optional metadata-only Cursor pass; advisory relevance/risk only |
| **Advisor order** | Application-derived sort over current advice + deterministic queue tuple |
| **Job / Run** | Job identity is stable work item; each attempt is an immutable run |
| **Sealed run** | Terminal run artifacts + validation committed; pointers updated after seal |
| **Provenance (`pv_`)** | Application-created evidence IDs binding findings to verified file/blob/range facts |
| **Shadow mode** | `publication.mode = shadow` — discover/analyze allowed; publisher disabled |
| **Gated mode** | Publishing allowed only with exact per-operation human approval |
| **Registered-source** | Review path using local repo path + filtered source materialization |
| **Remote-evidence-only** | Review without admin worktree/source view (unregistered or explicit) |
| **CanonicalPathMatcher** | Single app-owned path/glob contract for eligibility, domains, protection, materialization |
| **Harness** | Feature-grouped prompt/skills/domain pack (`pr-attention`, `pr-review`) |
| **Nine-layer composition** | Fixed harness layering order with explicit policy snapshot (no deep-merge) |
| **Governed proposal** | Profile/policy change package requiring replay, preview, and explicit adopt |
| **Control Tower** | This product — local PE desk for delegated, human-gated PR review |

---

## How to customize and extend

Use this section as the practical companion to the [architecture.md](https://architecture.md/) template above.

### Customize without code (preferred)

1. **Org catalog** — add/edit repositories in `config/organization.json` (IDs are stable keys).
2. **Active set** — choose `activeRepositoryIds` in profile.
3. **Policy** — edit `eligiblePaths`, `eligibleAuthors`, `priorityRules`, `domainRules`, `autoAnalyze`, `attentionAdvisor` in profile `policy.json`.
4. **Persona / harnesses** — tune `persona.md` and files under `config/harnesses/` (prompts, skills, domain guidance).
5. **Models** — set named roles in local `cursor.modelRoles`; validate with `pnpm ct doctor` (no silent fallback).
6. **Publication** — keep `shadow` until gates pass; then `pnpm ct publication enable`.

### Extend with code (rules of engagement)

| If you want to… | Touch | Do not |
|-----------------|-------|--------|
| Change eligibility/priority semantics | `src/policy/*` + tests + design contract | Let agents decide eligibility |
| Add discovery fields | `src/github`, `src/normalize`, migrations | Bypass protected-diff filter |
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
