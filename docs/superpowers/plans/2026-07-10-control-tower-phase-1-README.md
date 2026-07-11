# Control Tower Phase 1 — Implementation Plans

> **Spec:** `docs/superpowers/specs/2026-07-09-principal-engineer-control-tower-phase-1-delegated-pr-review-design.md`

**Plan status:** `Repaired 2026-07-10 — ready for subagent-driven execution 01→05` (independent re-review: PASS after contract fixes)

This README is the index and contract authority for the five Phase 1 implementation plans. Execute plans sequentially (`01` → `05`). Plans 02–05 MUST follow the Shared Contracts below; do not invent parallel symbols, aliases, or table names.

## Plans (execute sequentially 01 → 05)

| # | Plan | Scope | Depends On |
|---|------|-------|-----------|
| 01 | `2026-07-10-control-tower-phase-1-01-foundation.md` | Project bootstrap, CanonicalPathMatcher, config schemas/loaders, protected-path union, SQLite migrations, child-env builders, CLI doctor/init/start/stop/status | — |
| 02 | `2026-07-10-control-tower-phase-1-02-discovery.md` | GitHub adapter, streaming protected-diff filter, normalizer, eligibility/priority/domains/auto-analysis, queue ordering, discovery poll | 01 |
| 03 | `2026-07-10-control-tower-phase-1-03-analysis.md` | Orchestrator, pr-attention advisor, source workspace manager, nine-layer context/provenance, Cursor CLI adapter, review validation | 01, 02 |
| 04 | `2026-07-10-control-tower-phase-1-04-workbench-publication.md` | Loopback API, All Tracked / Focus Queue / Workbench UI, sanitizer/CSP, operation planner, gated publisher | 01–03 |
| 05 | `2026-07-10-control-tower-phase-1-05-evaluation-rollout.md` | Learning signals, governed proposals, eval corpora/gates, fake adapters, rollout checklist, Phase 1 baseline manifest | 01–04 |

## Dependency Graph

```
01-foundation
├── 02-discovery
│   ├── 03-analysis
│   │   └── 04-workbench-publication
│   │       └── 05-evaluation-rollout
```

## Shared Contracts (authoritative)

Plans 02–05 MUST import these exact Plan 01 symbols. Do not invent aliases.

| Symbol | Module | Notes |
|--------|--------|-------|
| `openDatabase(path)` | `src/store/db.ts` | NOT `getDb` |
| `runMigrations(db)` | `src/store/migrate.ts` | Plan 01 owns `001_initial.sql` |
| `buildGhEnv` / `buildCursorEnv` / `buildGitFetchEnv` / `buildGitLocalEnv` | `src/security/child-env.ts` | NOT `createChildEnv` |
| `CanonicalPathMatcher.compile` / `.matches(path)` / `.canonicalize` | `src/paths/matcher.ts` | compiled patterns |
| `pathMatchesAny(canonicalPath, patterns)` | `src/paths/match-patterns.ts` | for policy globs |
| `sha256Hex` / `sha256OfCanonicalJson` | `src/util/hash.ts` | bare 64-char hex, NO `sha256:` prefix |
| `normalizeLogin` | `src/config/author-login.ts` | |
| `loadOrganizationConfig` / `loadProfileConfig` / `loadPolicyConfig` / `loadLocalConfig` | `src/config/load.ts` | |

### Canonical types (Plan 02 owns; Plan 03+ consume)

- `AnalysisMode = 'auto' | 'on_demand'` — never `'none'`
- `PolicyDecision` — flat shape from `src/policy/evaluate.ts`
- `QueueTuple = { prioritySortOrdinal, explicitRequestSort: 0|1, queueTimestampSort: string, normalizedRepositoryIdentity, prNumber }`
- `repositoryKey` — catalog `id` OR `github:<host>/<owner>/<repo>` for unregistered
- SQL column `policy_hash` ↔ TS field `policyDecisionHash` (map in repository layer)
- Default loopback port: **9120**
- SQLite table for PRs: **`prs`** (never `pull_requests`)

### Runtime facade (Plan 03 owns; Plan 04 consumes)

`src/orchestrator/facade.ts` exports `OrchestratorFacade` with:
`getAllTracked`, `getFocusQueue`, `getJob`, `getDraft`, `getHealthStatus`, `getAuditTrail`, `requestAnalyze`, `requestRetry`, `requestAdvice`

Plan 04 MUST NOT invent parallel orchestrator methods.

## Recommended Execution

Each plan is designed for **subagent-driven development** (one subagent per task, sequentially within a plan):

1. Start a fresh session per plan.
2. Use `superpowers:subagent-driven-development` skill to dispatch tasks.
3. Complete all tasks in plan N before starting plan N+1.
4. Run `pnpm vitest run` after each plan to confirm no regressions.
5. Plan 05 gates must pass before Phase 2 work begins.

## Rollout Sequence (Plan 05)

1. **Offline fixtures** — deterministic tests + corpus gates
2. **Historical replay** — closed PRs, no publication
3. **Live shadow** — real discovery, publisher disabled
4. **Gated publishing** — enabled after quality gates pass

## Phase 2 Handoff

Plan 05 produces a sealed baseline manifest (§17) that Phase 2 capabilities reference. No Phase 2 field exists in Phase 1 schemas, migrations, or manifests.
