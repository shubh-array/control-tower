# Exclude Draft PRs from Eligibility

**Date:** 2026-07-14  
**Status:** Approved for implementation  
**Decision:** Unconditional exclusion — draft PRs are never eligible, including explicit review requests.

## Problem

Discovery polls open PRs via `gh` and persists only policy-eligible rows. GitHub draft PRs are open (`isDraft: true`) and are currently eligible whenever path/author/explicit-request rules match. Draft PRs should not enter the review inbox or trigger analysis.

## Decision

Treat `isDraft === true` as an **unconditional eligibility exclusion** inside policy. Do not add config flags. Do not filter only in the GitHub adapter (reconcile would re-upsert drafts if policy still marks them eligible).

## Behavior

| Input | Result |
|-------|--------|
| Open non-draft PR matching policy | Eligible (unchanged) |
| Open draft PR (path/author match) | Ineligible — `is_draft` |
| Open draft PR with explicit review request | Ineligible — `is_draft` |
| Closed/merged | Handled by existing reconcile retirement (unchanged) |

On the next discovery poll, any previously persisted draft that becomes ineligible is retired via the existing path: supersede active jobs + delete `prs` row. No schema migration. No special DB cleanup required.

## Design

### Authority boundary

Eligibility remains deterministic application policy. `DiscoveredPr.isDraft` is already normalized from GitHub (`src/normalize/from-gh.ts`). Pass it into `evaluateEligibility` as the **first** check, before the explicit-request short-circuit.

### Exclusion reason

Add to `ExclusionReason`:

```ts
export interface IsDraftExclusion {
  code: "is_draft";
}
```

### Call chain (unchanged topology)

```
poll / reconcile
  → normalizePr (sets isDraft)
  → evaluatePolicy
      → evaluateEligibility({ ..., isDraft })
  → if !eligible → retire; else upsert + enqueue
```

No changes to discovery poller, GitHub adapter, SQLite schema, publisher, or UI.

## Out of scope

- Config toggle to include drafts
- `gh` query-level draft filtering (optional later optimization)
- Persisting `is_draft` on the `prs` table
- Documented operator reset (`pnpm ct reset`) as a required step

## Acceptance criteria

1. `evaluateEligibility({ isDraft: true, explicitRequest: true, ... })` returns `eligible: false` with exclusion `is_draft`.
2. Non-draft eligibility truth table rows continue to pass (with `isDraft: false` supplied).
3. `evaluatePolicy` passes `pr.isDraft` through; no other policy fields change.
4. Existing discovery retirement path remains the sole cleanup mechanism for draft rows already in SQLite.
