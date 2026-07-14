# Control Tower — Deferred work

These items improve correctness, personalization, or operations, but do **not** block the core loop of accurate, evidence-backed PR reviews. All urgent fixes in [`URGENT.md`](./URGENT.md) are completed.

Related reading: [`ARCHITECTURE.md`](./ARCHITECTURE.md), [`POLLING.md`](./POLLING.md)

---

## D-01 — Job identity omits `policyDecisionHash` at enqueue

### Problem

`computeJobIdentity` expects `policyDecisionHash`, but enqueue never passes it. Production casts `undefined`, so the identity preimage contains `policyDecision=undefined`. Policy changes for the same head SHA are handled only via the `policy_hash` column compare on an existing job, not via identity.

### Current behavior (code)

- `JobIdentityInput` and `computeJobIdentity` in `src/orchestrator/job-identity.ts` include `policyDecision=${input.policyDecisionHash}`.
- `enqueueFromPolicyDecision` (`src/orchestrator/enqueue.ts`) calls `computeIdentityHash` with only `repositoryKey`, `prNumber`, `headSha`, `sourceMode`.
- `computeIdentityHash` in `src/daemon/bootstrap.ts` passes `input.policyDecisionHash as string` (undefined at normal enqueue).
- When an existing job is found, `existing.policy_hash !== policyHash` triggers `supersede_policy_hash`.

### Why defer

Today, same-head policy edits can still supersede via the `policy_hash` branch. This is identity hygiene and future-proofing, not a broken review-input path.

### Design constraint

If identity starts including a real policy decision hash, lookup-by-identity-alone will miss the prior job on policy change (same class of bug as head-SHA supersede before U-06). U-06 is now implemented with `findActiveJobsByPr` doing PR-scoped supersede — use that same mechanism to ensure policy-change supersede works even when identity diverges.

### Files to change

- `src/orchestrator/enqueue.ts` — pass policy decision hash into `computeIdentityHash`
- `src/daemon/bootstrap.ts` — ensure `computeIdentityHash` / `computePolicyHash` stay consistent
- `src/orchestrator/job-identity.ts` — already defines the preimage
- Tests: different policy → different `identity_hash` at same head SHA; supersede-on-policy-change still works

### Acceptance criteria

- [ ] `enqueueFromPolicyDecision` passes a real `policyDecisionHash` (from `computePolicyDecisionHash` / enqueue `computePolicyHash`) into identity.
- [ ] Test asserts different policy → different `identity_hash` at the same head SHA.
- [ ] Supersede-on-policy-change still works with the production lookup path.

### Example

Same PR and head SHA; operator edits policy so priority tier changes.  
**Today:** identity string effectively uses `policyDecision=undefined`; supersede may still occur via `policy_hash` if lookup hits.  
**Expected:** identity hash changes when the policy decision hash changes, and the prior job is still superseded correctly.

---

## D-02 — Harness layer files are hashed but not written into the run workspace

### Problem

Harness composition (prompts, skills, persona, contracts) is read and hashed into `harness-manifest.json`, but the file contents are not written under `layout.harnessDir`. Cursor `--workspace` is the run directory; the CLI prompt string is only the org `config/harnesses/pr-review/prompt.md` text.

### Current behavior (code)

- `buildHarnessManifestForJob` in `src/orchestrator/context-build.ts` hashes inlined safety/output contracts plus org/profile artifacts loaded via `readArtifact` (prompt, skill, persona, domain markdown).
- `materializeRunContext` writes `harness-manifest.json` and other JSON metadata; it does **not** write files under `harnessDir`.
- `computeRunDirectoryLayout` (`src/context/prepare.ts`) defines `harnessDir: join(runDir, 'harness')`.
- `buildCursorArgv` (`src/cursor/argv.ts`) sets `--workspace` to `runDirectory`.
- `resolveReviewPrompt` in `src/orchestrator/pipeline-runner.ts` loads only `config/harnesses/pr-review/prompt.md` for the CLI prompt argument.

### Why defer

Reviews still run with the org prompt string. Persona/skills improve quality and product differentiation but are not required for “agent can see code + diff + evidence” (URGENT).

### Files to change

- `src/orchestrator/context-build.ts` — `materializeRunContext` writes harness entry contents to paths reflected in the manifest
- Tests: after `preparing_context`, harness files exist under the run directory and hashes match manifest entries

### Acceptance criteria

- [ ] `materializeRunContext` writes harness contents (prompt, skill, persona, contracts, domain guidance as applicable) under the run directory paths listed/implied by `harness-manifest.json`.
- [ ] Manifest hashes match the materialized file bytes.
- [ ] Cursor workspace can read those files from the run directory.

### Example

Engineer `persona.md` says “prefer strict API contracts.”  
**Today:** persona is hashed in the manifest only.  
**Expected:** `persona.md` (or equivalent path) exists under the run workspace for Cursor to read.

---

## D-03 — Metadata-only PR updates do not trigger re-analysis

### Problem

Discovery refreshes comments, checks, reviews, and files on each poll, but enqueue returns `existing_job_current` when head SHA, policy hash, and source mode are unchanged. A `draft_ready` job can lag new CI failures or review comments.

### Current behavior (code)

- `upsertDiscoveredPr` / related upserts in `src/normalize/upsert.ts` refresh PR-side tables on poll.
- `enqueueFromPolicyDecision` (`src/orchestrator/enqueue.ts`) returns `{ enqueued: false, reason: 'existing_job_current' }` when an existing job matches head/policy/source mode.

### Why defer

This is a product policy choice. Operators can click **Analyze** manually. Document the limitation until product wants automatic triggers.

### Files to change (if product decides to fix)

- `src/orchestrator/enqueue.ts` and discovery/enqueue call sites
- `POLLING.md` — document triggers
- Tests for at least one trigger (e.g. check conclusion regression)

### Acceptance criteria (only if fixing)

- [ ] Defined triggers (e.g. check conclusion regression, new review comment) enqueue a superseding job or mark the draft stale.
- [ ] Tests for at least one trigger.
- [ ] Behavior documented in `POLLING.md`.

### If not fixed

Document as known limitation: only head / policy / source-mode changes auto-enqueue; use **Analyze** after comment/check-only updates.

### Example

PR head unchanged; CI goes green → red.  
**Today:** existing `draft_ready` job unchanged.  
**Expected (if product wants):** stale flag or new job.

---

## D-04 — Failed jobs block automatic re-enqueue at the same head SHA

### Problem

A failed job remains “active” for identity lookup. Later discovery with the same head SHA returns `existing_job_current` instead of scheduling a new attempt. Operators must use **Retry**.

### Current behavior (code)

- `findActiveJobByIdentity` in `src/daemon/bootstrap.ts` excludes only `superseded`, `cancelled`, and `published` — **not** `failed`.
- Same-head rediscovery hits the existing failed row and enqueue returns `existing_job_current` (`src/orchestrator/enqueue.ts`).
- Manual retry exists: `POST /api/jobs/:id/retry` (`src/api/routes/jobs.ts`) and `src/orchestrator/retry.ts` (expects job state `failed`).

### Why defer

The UI can show `failed` honestly. This is auto-recovery polish, not false coverage or missing review inputs. Manual Retry works.

### Test pitfall

The original `makeDeps` helper in `tests/orchestrator/enqueue.test.ts` still excludes `failed` from active jobs in `findActiveJobByIdentity`; production does **not** (bootstrap SQL includes `failed` as active). The PR-scoped test added for U-06 uses a separate deps builder. Align the original helper with production when fixing D-04.

### Files to change

- `src/daemon/bootstrap.ts` — exclude `failed` from active lookup, **or** discovery/enqueue explicitly re-queues failed jobs after a cooldown
- Document interaction with `POST /api/jobs/:id/retry`
- Tests: failed job at SHA `aaa` → next discovery with same SHA → new `queued` job or automatic retry

### Acceptance criteria

- [ ] Either failed jobs are not treated as blocking active jobs for enqueue, or discovery re-queues them after a defined cooldown.
- [ ] Test covers failed → subsequent same-SHA discovery → new attempt.
- [ ] Interaction with manual retry is documented (no double-run surprises).

### Example

Agent times out; job → `failed`. Head unchanged.  
**Today:** discovery skips enqueue (`existing_job_current`).  
**Expected:** new attempt scheduled, or failed job superseded and re-queued.
