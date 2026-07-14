# Control Tower — Urgent fixes

> **Status: ALL COMPLETED** — Implemented on branch `urgent-pipeline-fixes` and merged to `main` (2026-07-14). See commits `c88c4e4` through `f2c7e1b`. All 764 tests pass, typecheck clean, client builds. Live-verified with daemon running against production GitHub data.

These gaps blocked trustworthy PR reviews. They have been fixed before deferred work.

All work is in this repo (`src/` daemon + `client/` SPA).

Implemented in order: **U-01 → U-02 → U-03 → U-05 → U-04 → U-06**.

Related reading: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`POLLING.md`](./POLLING.md)

---

## U-01 — Registered-source fetch uses the wrong GitHub remote

### Problem

For catalog repository ids such as `pba-webapp` (no `owner/repo` slash), mirror fetch targets `git@github.com:unknown/pba-webapp.git` instead of the catalog remote (e.g. `Powered-By-Array/pba-webapp`).

### Current behavior (code)

- `prepareRegisteredSource` calls `parseGithubOwnerRepo(input.repositoryKey, input.githubRemote)` in `src/orchestrator/source-pipeline.ts`.
- When `repositoryKey` has no `/` and `githubRemote` is omitted, `parseGithubOwnerRepo` returns `owner: "unknown"` and remote `git@github.com:unknown/{repositoryKey}.git`.
- Production wiring in `src/orchestrator/pipeline-runner.ts` (`prepareSource`) calls `prepareRegisteredSource` **without** `githubRemote`.
- Discovery already upserts correct `github_owner` / `github_repo` into `repositories` via `upsertRepository` in `src/normalize/upsert.ts` (from organization catalog `github`, e.g. `config/organization.json` → `Powered-By-Array/pba-webapp`).
- `repositoryPaths` gates registered-source vs remote-evidence-only and requires the local path exists; it is not used as the fetch remote.

### Why this is urgent

Registered-source jobs can fail fetch or fetch the wrong repository. Reviews then never run correctly for catalog repos.

### Implementation

- In `prepareSource`, resolve `owner`/`repo` from `repositories.github_owner` / `repositories.github_repo` for the job’s `repository_key` (same query pattern as `draft-loader.ts` / `queue.ts`). Prefer the DB row; if missing, fall back by loading organization catalog `repositories[].github` in bootstrap/`PipelineRunnerContext` (runner does not currently receive org config — add it if the fallback is kept).
- Pass SSH remote `git@github.com:{owner}/{repo}.git` as `githubRemote` so `parseGithubOwnerRepo` does not use the `unknown/` fallback.
- Keep `parseGithubOwnerRepo` as a last-resort parser for explicit remotes / `owner/repo` keys only.
- Note: `repositoryPaths` also gates `registered-source` vs `remote-evidence-only` in discovery; it remains unused as the fetch remote.

### Files to change

- `src/orchestrator/source-pipeline.ts` — accept/resolve catalog owner/repo/remote
- `src/orchestrator/pipeline-runner.ts` — load DB (or catalog) and pass resolved remote
- Tests under `tests/` covering `repository_key = 'pba-webapp'` → fetch remote for `Powered-By-Array/pba-webapp`

### Acceptance criteria

- [x] Mirror fetch remote for a job with `repository_key = 'pba-webapp'` resolves to the catalog GitHub repo (`Powered-By-Array/pba-webapp` per `config/organization.json`), not `unknown/pba-webapp`.
- [x] Prefer `repositories.github_owner` / `repositories.github_repo` (or organization catalog `github`) over `parseGithubOwnerRepo` fallback when that metadata exists.
- [x] Integration or unit test asserts the resolved `catalogRemote` / git remote string.

### Example

**Today:** fetch uses `git@github.com:unknown/pba-webapp.git`.  
**Expected:** fetch uses `git@github.com:Powered-By-Array/pba-webapp.git` (or equivalent from catalog).

---

## U-02 — Cursor does not get an agent-readable PR source tree

### Problem

The pipeline checks out the PR head into an admin worktree and builds a source manifest, but Cursor `--add-dir` points at a directory that contains only `source-manifest.json`. The agent cannot read changed source files. Manifest entries also lack real sizes/line counts, and validation hard-codes `lineCount: 1`.

### Current behavior (code)

- `prepareRegisteredSource` (`src/orchestrator/source-pipeline.ts`):
  - Creates admin worktree under `data/worktrees/{jobId}/admin` and checks out `headSha`.
  - Builds allowed/omitted lists with `filterTreeEntry` + `organization.security.protectedPaths`.
  - Writes `source-manifest.json` under `data/worktrees/{jobId}/source` with allowed entry `size: 0`.
  - Returns `sourceViewRoot` = source dir and `adminWorktree` = admin path.
- `pipeline-runner.ts` `runAgent` passes only `sourceViewPath: prepared.state?.sourceViewRoot` to the Cursor adapter. `adminWorktree` is not passed.
- `buildCursorArgv` (`src/cursor/argv.ts`) adds at most one `--add-dir` for `sourceViewPath`.
- `validateOutput` in `pipeline-runner.ts` maps every manifest allowed path to `{ blobSha, lineCount: 1 }`.
- `validateReviewOutput` (`src/cursor/validate-review.ts`) rejects file references when `endLine > entry.lineCount`.

### Why this is urgent

Registered-source reviews run without readable PR code. File citations either cannot be validated meaningfully or fail for any range beyond line 1.

### Implementation

- After filtering the tree, copy each **allowed** path from the admin worktree into `sourceViewRoot` (preserve relative paths). Do **not** expose the full admin worktree via `--add-dir` while it still contains protected paths. Scope remains the filtered head tree (same as today’s `listTreeAtCommit`); do not expand or shrink to “changed files only” in this ticket.
- Extend `SourceManifest.allowed` entries with a `lineCount` field (today the type only has `path`, `blobSha`, `size`, `mode` — `size` is hardcoded `0`; there is no `lineCount`). Set `size` and `lineCount` from the materialized file bytes (`lineCount` = number of lines, matching how `validateReviewOutput` interprets bounds).
- `pipeline-runner` already passes `sourceViewRoot` as `sourceViewPath`; keep that. The fix is populating the directory and feeding real `lineCount` into the validation map (never hard-coded `1`).
- Keep a single `--add-dir` pointing at `sourceViewRoot`. Change `argv.ts` only if a second dir becomes unavoidable.
- Surface `sourceManifest.omitted` to U-05 coverage finalization (today omitted lists stay on the manifest and never reach coverage).

### Files to change

- `src/source/materialize.ts` — extend allowed entry shape with `lineCount`; keep content-hash canonicalization in sync
- `src/orchestrator/source-pipeline.ts` — copy allowed files into `sourceViewRoot`; set real `size` / `lineCount`
- `src/orchestrator/pipeline-runner.ts` — validation map uses manifest `lineCount`; expose omitted paths for U-05
- `src/cursor/argv.ts` — only if more than one `--add-dir` is required
- `src/cursor/validate-review.ts` — already enforces line bounds; needs accurate `lineCount` inputs
- Tests asserting argv/`AdapterRunInput` includes a path that contains checked-out allowed files, and line-range validation uses real lengths

### Acceptance criteria

- [x] For `registered-source` jobs, Cursor receives read access to PR-head file contents for manifest **allowed** paths.
- [x] Paths omitted for `protectedPaths` are absent from the agent-visible tree.
- [x] Manifest allowed entries include accurate line counts (from materialized files).
- [x] `validateReviewOutput` uses those line counts (no hard-coded `lineCount: 1`).
- [x] Test: citation of lines 10–20 fails when the file has 5 lines; passes when the range is valid.
- [x] Test: adapter/argv includes the directory that contains real file contents (not only `source-manifest.json`).

### Example

Admin worktree has `src/api/foo.ts`. Manifest lists it as allowed.  
**Today:** `--add-dir` points at a dir with only `source-manifest.json`; validation uses `lineCount: 1`.  
**Expected:** agent can read `foo.ts`; line counts match the file at the PR head.

---

## U-03 — No PR diff is written into the run directory

### Problem

Context build writes minimal PR metadata and no diff/patch. The agent cannot see what changed. This especially breaks `remote-evidence-only` reviews.

### Current behavior (code)

- `buildPrMetadata` in `src/orchestrator/context-build.ts` writes only `repositoryKey`, `prNumber`, `headSha`, `sourceMode` to `github/pr-metadata.json`.
- No `gh pr diff`, patch file, or hunk materialization exists under `src/` (no matches for `pr diff`, `pr-diff`, `diff.patch`).
- Discovery stores changed **paths** in SQLite (`pr_files` via `upsertPrFiles`) — path list only, **not** patch text or hunks. Those paths are also not written into the run `github/` directory today.
- `ContextBuildInput` has no database handle and no `gh` client; `prepareContext` cannot currently load PR rows or fetch diffs.
- Pipeline order (`src/orchestrator/pipeline.ts`): `prepareContext` runs before `prepareSource`, so the git mirror/worktree from U-01/U-02 is **not** available yet during context prep. Diff must come from GitHub (`gh`), not from the admin worktree.

### Why this is urgent

Diff (or equivalent hunk list) is the minimum input for PR review. Without it, drafts are guesswork.

### Implementation

- Wire production `prepareContext` / `computeRunContext` / `materializeRunContext` with DB + `gh` access (extend `ContextBuildInput` / pipeline-runner deps). Bootstrap already has `db` and `execGhText`; pass them through.
- Resolve `owner/repo` from `repositories` (reuse U-01 resolver). Load `base_sha` / `head_sha` from `prs` for the job’s `repository_key` + `pr_number`.
- Add a small helper using `execGhText(["pr", "diff", String(prNumber), "--repo", ownerRepo], { host })`. `GitHubAdapter` has no `pr diff` method today — do not pretend it does. Do not rely on `pr_files` for patch content (`pr_files` is paths only; schema `additions`/`deletions` columns are unused by upsert).
- Write `github/pr-diff.patch` (unified diff after protected-path filtering). Optionally also write `github/changed-files.json` from `pr_files` paths as a convenience index — not a substitute for the patch.
- Enrich `github/pr-metadata.json`: keep existing `headSha`; add `baseSha`, `repository` (`owner/repo`), and retain `repositoryKey` / `prNumber` / `sourceMode`.
- Filter protected paths with `CanonicalPathMatcher` (same patterns as tree filtering). `filterTreeEntry` itself operates on `TreeEntry` objects — reuse the matcher, not that function, for unified-diff headers/hunks. Persist omitted protected paths for U-05.
- Update harness `prInputs` / `artifactSetHash` so the diff artifact is part of run identity. Coordinate hash timing with U-05 (diff must be in the **final** `run_input_hash` before `runAgent`).
- If diff fetch or filter fails, do not write a partial success artifact as if filtering succeeded; surface failure for coverage (`diff_filter_failed`).

### Files to change

- `src/orchestrator/context-build.ts` — fetch/filter/write diff; enrich metadata; accept DB/`gh` deps; update `prInputs` / `artifactSetHash`
- `src/orchestrator/pipeline-runner.ts` / `src/daemon/bootstrap.ts` — pass DB + gh exec + host into context prep
- Helper under `src/github/` for `gh pr diff` via `execGhText`
- Tests that assert `github/pr-diff.patch` exists after context prep and that protected paths are absent from it

### Acceptance criteria

- [x] After context materialization, the run directory includes `github/pr-diff.patch` (or equivalent reviewable unified diff) for the PR head against base.
- [x] Paths matching `config/organization.json` `security.protectedPaths` are omitted from that artifact.
- [x] Omitted protected paths from the diff filter are available to coverage (U-05).
- [x] `remote-evidence-only` runs get the diff artifact (they never get a source tree).
- [x] Test uses the production context-prep path with stubbed `gh pr diff` output, not only a hand-written run dir.

### Example

PR changes three files.  
**Today:** `github/pr-metadata.json` has four fields and no file list or diff.  
**Expected:** `github/pr-diff.patch` present (protected paths stripped) for the agent to read.

---

## U-05 — Coverage overstates source inspection and diff filtering

### Problem

Coverage metadata written into the run (and shown in Review) claims source inspection and diff filtering that the pipeline did not perform.

### Current behavior (code)

- In `computeRunContext` (`src/orchestrator/context-build.ts`), coverage is built **during** `prepareContext`, which runs **before** `prepareSource` (`src/orchestrator/pipeline.ts`).
- Registered-source path calls `buildRegisteredSourceCoverage(omittedProtected, [], false)` with empty omitted lists and `diffFilterFailed: false`.
- `buildRegisteredSourceCoverage` (`src/context/coverage.ts`) always sets `sourceTreeInspected: true` and `diffFiltered: !diffFilterFailed` (so `true` when the third arg is `false`).
- `buildRemoteOnlyCoverage(..., false)` sets `sourceTreeInspected: false`, `missingCoverage: ['source_tree']`, but still `diffFiltered: true` when `diffFilterFailed` is `false`.
- `materializeRunContext` writes `source/coverage.json` with `writeCreateOnceSync` (`wx`) — it cannot be updated later on the same path.
- `hashCoverage(coverage)` feeds `run_input_hash` at `allocateRun` / `prepareContext` time; `runId` is derived from that hash via `computeRunId`.
- The same create-once pass also writes `run.json` (embeds `runInputHash` / `sourceHash`) and `context-refs.json` (embeds coverage hash).
- `executePipeline` passes `context.coverage` from `prepareContext` into `validateOutput`. `prepareSource` updates `sourceManifest` / `sourceViewRoot` only — it does not update `prepared.state.coverage`.
- Review UI displays these flags (`client/src/routes/Workbench.tsx`: “Source tree inspected”, “Diff filtered”).

### Why this is urgent

Operators approve drafts believing source/diff were inspected and filtered when they were not. That is false confidence in the product.

### Implementation

Coverage must describe what actually ran, and the agent / validation / `runs.run_input_hash` must all use the **same final** coverage object.

**Concrete finalize model** (prefer this over inventing a dual path):

1. **Split materialization:** During early `prepareContext`, write non-coverage artifacts that are known then (metadata, diff from U-03, provenance from U-04 as available). **Do not** write `coverage.json`, and do **not** treat coverage as final in `run.json` / `context-refs.json` yet.
2. **Diff coverage (U-03):** After the diff filter step, record a tri-state outcome: `not_run` | `failed` | `succeeded`. Map to coverage as:
   - `succeeded` → `diffFiltered: true`
   - `failed` → `diffFiltered: false`, `missingCoverage` includes `diff_filter_failed`
   - `not_run` → `diffFiltered: false` (no `diff_filter_failed`)
   Adjust `buildRegisteredSourceCoverage` / `buildRemoteOnlyCoverage` (or replace them) so “not run” is not encoded as `diffFilterFailed: false`.
3. **Source coverage (U-02):** Start with `sourceTreeInspected: false` (and `source_tree` in `missingCoverage` when applicable). After successful `prepareSource`, set `sourceTreeInspected: true`, clear `source_tree` from missing, and merge omitted paths from the source manifest.
4. **Finalize before `runAgent`:** After `prepareSource` (registered) or at end of context prep (remote-only), write `coverage.json`, rewrite/update `context-refs.json` and `run.json` with the final `sourceHash` / `run_input_hash`, and `UPDATE runs SET run_input_hash = ?`. Those files today use `writeCreateOnceSync` (`wx`) — either defer their first write until finalize, or add an explicit finalize writer for these three paths only. Do not leave dishonest create-once coverage on disk.
5. **`runId` stability:** `allocateRun` currently derives `runId` from an early `run_input_hash` that includes dishonest coverage. Change allocate to compute `runId` from a preimage that **excludes coverage** (harness + artifact set + provenance + model), OR allocate the directory with the provisional `pending-…` pattern and only hash coverage at finalize. The authoritative `runs.run_input_hash` used by publish guards must include final coverage and must be set before `runAgent`.
6. **Validation path:** Change `executePipeline` / `pipeline-runner` so `validateOutput` receives final coverage from `prepared.state` (or the finalize result), not the early `prepareContext` return value. Today `prepareSource` does not update `prepared.state.coverage` at all.
7. Agent must read final `coverage.json` before producing output (`validateReviewOutput` requires exact match).

### Files to change

- `src/orchestrator/context-build.ts` — defer/finalize coverage + related refs/run.json writes; honest builder inputs
- `src/orchestrator/pipeline-runner.ts` / `src/orchestrator/pipeline.ts` / `src/orchestrator/run-identity.ts` — allocate without baking dishonest coverage; finalize before agent; pass final coverage into validation
- `src/context/coverage.ts` — tri-state diff filter support
- Client display continues to read draft coverage; fix the data, not cosmetic UI only

### Acceptance criteria

- [x] `sourceTreeInspected` is `true` only after successful registered-source preparation that inspected the source tree; otherwise `false`.
- [x] `diffFiltered` is `true` only when a protected-path diff filter actually ran and succeeded (U-03).
- [x] `missingCoverage` lists real gaps (e.g. `source_tree`, `diff_filter_failed`) when those steps did not succeed.
- [x] `omittedProtectedPaths` reflects paths omitted from source and/or diff.
- [x] Final `coverage.json`, agent-visible coverage, `validateOutput` expected coverage, and `runs.run_input_hash` all agree on the final coverage object.
- [x] Remote-evidence-only job with a successful diff filter: `diffFiltered: true`, `sourceTreeInspected: false`.
- [x] Remote-evidence-only job where diff filter did not run: `diffFiltered: false` without `diff_filter_failed`.
- [x] Remote-evidence-only job where diff filter failed: `diffFiltered: false` and `diff_filter_failed` in `missingCoverage`.

### Example

Remote-evidence-only job with no diff filter step.  
**Today:** `diffFiltered: true` in coverage.  
**Expected:** `diffFiltered: false` until a filter step runs and succeeds.

---

## U-04 — Provenance catalog contains only a commit record

### Problem

`validateReviewOutput` expects observations to cite provenance IDs, but the run catalog only includes a single commit record. Checks and comments already stored by discovery are not added.

### Current behavior (code)

- `computeRunContext` in `src/orchestrator/context-build.ts` sets `provenanceCatalog` to one `createCommitRecord(...)`.
- `createDiffHunkRecord`, `createCheckRecord`, and `createCommentRecord` exist in `src/context/provenance.ts` but have **no** production call sites under `src/` outside that file.
- Discovery persists checks and comments in SQLite (`upsertPrChecks`, `upsertPrComments` in `src/normalize/upsert.ts`):
  - `pr_checks`: `name`, `status`, `conclusion`, `details_url` (no GitHub check-run id / attempt)
  - `pr_comments`: `author_login`, `body`, `created_at`, `url` (no node id / database id / body hash columns)
- Catalog is written to `github/provenance-catalog.json` by `materializeRunContext`.
- Same wiring gap as U-03: context build needs DB access to load discovery rows for the PR.

### Why this is urgent

Agents cannot cite real check/comment/diff evidence. Reviews stay shallow or invent unsupported provenance.

### Implementation

- Load `pr_checks` / `pr_comments` for the job’s PR during context materialization. Join `jobs.repository_key` + `jobs.pr_number` → `prs` → child tables (same keying bootstrap already uses elsewhere).
- Map DB rows into provenance creators with **stable synthetic fields** when GitHub-native ids are absent:
  - Checks: `checkRunId` = SQLite `pr_checks.id`; `attempt` = `1`; `url` = `details_url ?? ""`; `observedAt` = `prs.fetched_at`.
  - Comments: `databaseId` = SQLite `pr_comments.id`; `nodeId` = comment `url` if present else `comment:{id}`; `bodyHash` = sha256(body); `commitAssociation` = `null`; `updatedAt` = `created_at`.
- Add diff-hunk records from the filtered U-03 diff (parse unified diff into hunks while filtering). Hunk IDs must be stable for a given base/head/path/hunk content.
- Extend `createCheckRecord` / `createCommentRecord` input types only if the synthetic mapping is cleaner that way; IDs must still pass `validateProvenanceRef` / `validateReviewOutput` (validators check catalog membership, not GitHub field fidelity).
- Write the full catalog to `github/provenance-catalog.json`. If harness `prInputs` / `provenanceCatalog` manifest fields need to reference the catalog artifact for identity, update them in the same change and keep U-05 finalize hash timing consistent (`provenanceCatalogHash` is part of `run_input_hash`).
- Do not add `pr_reviews` provenance in this ticket.

### Files to change

- `src/orchestrator/context-build.ts` — build catalog from discovery + diff artifacts
- `src/context/provenance.ts` — only if input shapes need extension
- Tests that exercise the production context-build path (not only hand-built catalogs)

### Acceptance criteria

- [x] At context materialization, `provenance-catalog.json` includes check and comment records derived from discovery data for that PR, plus diff-hunk records when a filtered diff exists (U-03).
- [x] Catalog IDs are accepted by `validateReviewOutput` when cited.
- [x] Tests cover the production code path that builds the catalog, including at least one check and one comment mapped from SQLite-shaped rows.

### Example

CI check “unit-tests” failed and is stored in `pr_checks`.  
**Today:** not in the run provenance catalog.  
**Expected:** catalog includes a check record the agent can cite in `provenanceRefs`.

---

## U-06 — New PR head SHA does not supersede older jobs; Review can look current when it is not

### Problem

Job identity includes `headSha`, so a new commit creates a new `identity_hash` and a **new** job without superseding the old active job. Inbox keeps only the newest job row per PR for display, but older `draft_ready` jobs remain. Publish is blocked on SHA mismatch, but read/approve paths do not label or disable stale drafts.

Two stale situations matter:

1. **New job enqueued** at a new head while an older job is still active — old job must be `superseded`.
2. **Head moved without a new job** (e.g. `on_demand` and no explicit request) — the queue-winning draft can still be for the old head while queue `headSha` shows the new PR head. That draft must be marked **stale** and non-publishable even though no supersede enqueue ran.

### Current behavior (code)

**Enqueue / identity**

- `computeJobIdentity` (`src/orchestrator/job-identity.ts`) includes `head=` in the preimage.
- `enqueueFromPolicyDecision` (`src/orchestrator/enqueue.ts`) computes identity with `repositoryKey`, `prNumber`, `headSha`, `sourceMode`, then `findActiveJobByIdentity(identityHash)`.
- Production lookup (`src/daemon/bootstrap.ts`): `WHERE identity_hash = ? AND state NOT IN ('superseded', 'cancelled', 'published')` (includes `failed`, `draft_ready`, `awaiting_approval`, etc.).
- When head SHA changes, identity changes → lookup returns `null` → insert path (no supersede).
- The `supersede_head_sha` branch in `enqueue.ts` only runs when an existing row is found for the **same** identity hash but different `head_sha` — which cannot happen if identity already includes that `head_sha`.

**Inbox / Review**

- `loadQueueEnrichment` (`src/api/projections/queue.ts`) keeps the first job per `repository_key` + `pr_number` ordered by `updated_at DESC` among states not in `superseded` / `cancelled` / `published`.
- Queue row `headSha` comes from the tracked PR item (current PR head), not from the job row. Workbench never loads `JobDetail.headSha` to compare.
- `resolveReviewRoute` (`client/src/lib/review-route.ts`) resolves by `jobId` against queue rows; if the job is not the queue winner → “Review context unavailable” (`ReviewRoute.tsx`). It does **not** open an unlabeled Workbench draft for bookmarked superseded ids.
- `loadDraftBundle` (`src/orchestrator/draft-loader.ts`) serves drafts for `draft_ready` / `awaiting_approval` / `publishing` with **no** comparison to `prs.head_sha`. `GET /api/drafts/:jobId` can still return that JSON.
- `DraftDetail` (`src/api/contracts.ts` / `client/src/lib/api.ts`) does not include `headSha`, `currentHeadSha`, or `stale`.
- `JobDetail` includes job `headSha` but not current `prs.head_sha`, so it is not sufficient alone for stale detection.
- Publish guards (`src/publisher/guards.ts`) reject when `currentHeadSha !== reviewedHeadSha`.

**Test pitfall**

- `tests/orchestrator/enqueue.test.ts` mocks `findActiveJobByIdentity` to ignore `identity_hash` and return any active job — that is **not** production behavior. Fix production and update tests to match real lookup.

### Why this is urgent

Engineers can treat an old draft as current until publish fails. Multiple active jobs for one PR confuse audit and learning. Bookmarks to superseded jobs already show “unavailable”; the dangerous case is a still-active draft whose job head no longer matches `prs.head_sha`.

### Implementation

**Enqueue / supersede**

- Because identity includes `headSha`, supersede-on-new-head must look up prior active jobs by `(repository_key, pr_number)`, not only by the new `identity_hash`.
- When enqueueing a job for a PR, supersede every other job for that PR whose state is not in `superseded` / `cancelled` / `published` (production active set today). Bootstrap’s `supersede()` already uses raw SQL (bypasses `transitionJob`); keep that for consistency. Allowed transitions already include `draft_ready` / `awaiting_approval` / `failed` → `superseded`.
- **In-flight jobs** (`preparing_*`, `running_agent`, `validating_output`, `publishing`): still mark `superseded` in SQL. Do not add a second orchestration path in this ticket; the worker should treat superseded jobs as non-actionable on its next state touch (existing failed/cancel patterns are enough). Project is in active development: change the lookup/enqueue model cleanly; no dual identity paths.
- Update `EnqueueDeps` / bootstrap SQL accordingly. Align unit tests with production lookup semantics (no “ignore identity hash” mocks; production includes `failed` as active).

**Stale detection (including on_demand head move without enqueue)**

- On draft/job read paths, compare `jobs.head_sha` to `prs.head_sha` for the same repository + PR.
- Extend `DraftDetail` (and client types) with: `reviewedHeadSha`, `currentHeadSha`, `stale: boolean` (`stale` when they differ). Optionally mirror on `JobDetail`.
- Workbench: when `draft.stale`, show a clear stale banner, disable Approve/Publish, and prompt to re-analyze.
- **Publish guards:** `registerDraftOperations` in `bootstrap.ts` currently sets **both** `currentHeadSha` and `reviewedHeadSha` to `bundle.headSha` (job head), so guards do **not** detect PR head drift. Pass live `prs.head_sha` as `currentHeadSha` and job head as `reviewedHeadSha` when registering operations / publishing.
- Do **not** require ReviewRoute to open superseded jobs. Superseded / non-queue job ids may keep “Review context unavailable”. Focus stale UX on queue-reachable active drafts whose head is behind `prs.head_sha`, and on draft API responses for those jobs.
- Leave `policyDecisionHash` identity hygiene to deferred work (`DEFER.md` D-01); do not block U-06 on it.

### Files to change

- `src/orchestrator/enqueue.ts` — supersede prior active jobs for the same PR when a new job is enqueued
- `src/daemon/bootstrap.ts` — production lookup by PR; pass live `prs.head_sha` into publish guard registration
- `src/orchestrator/draft-loader.ts` / `src/api/contracts.ts` / `client/src/lib/api.ts` — expose reviewed vs current head + `stale`
- `client/src/routes/Workbench.tsx` (and related) — stale banner; disable approve/publish when stale
- `tests/orchestrator/enqueue.test.ts` — align with production lookup semantics

### Acceptance criteria

- [x] When a new job is enqueued for `(repository_key, pr_number)` with a different `head_sha`, any prior active job for that PR (state not in `superseded` / `cancelled` / `published`) is transitioned to `superseded`.
- [x] Integration test: PR at SHA-A with `draft_ready` → enqueue at SHA-B → old job `superseded`, new job `queued`.
- [x] Queue still surfaces one winning job per PR.
- [x] When the queue-winning job’s `head_sha` differs from `prs.head_sha` (e.g. on_demand push with no new enqueue), `GET /api/drafts/:jobId` returns `stale: true` with both SHAs.
- [x] Review UI shows a clear **stale** state in that case; Approve/Publish controls disabled with a message to re-analyze.
- [x] Publish path uses live `prs.head_sha` as `currentHeadSha` so SHA-mismatch guards actually fire for stale drafts.
- [x] Bookmarked `/review/:jobId` for a job no longer in the queue continues to show “Review context unavailable” (not an unlabeled draft).
- [x] Enqueue tests exercise PR-scoped lookup consistent with bootstrap SQL (not identity-ignoring mocks).

### Example

PR #42 reviewed at `aaa` (`job-1` → `draft_ready`). Author pushes `bbb`.

- **Auto-enqueue:** discovery enqueues `job-2` → `job-1` becomes `superseded`; Inbox shows `job-2`; bookmark to `job-1` → “Review context unavailable”.
- **On-demand, no new job:** `job-1` remains queue winner but `stale: true` because `prs.head_sha` is `bbb`; Approve/Publish disabled until re-analyze.
