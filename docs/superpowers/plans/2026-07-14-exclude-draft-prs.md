# Exclude Draft PRs Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Unconditionally exclude GitHub draft PRs from policy eligibility so they never enter the review inbox or analysis pipeline.

**Architecture:** Add an `is_draft` exclusion as the first check in `evaluateEligibility`, wire `pr.isDraft` from `evaluatePolicy`, and extend eligibility tests. Discovery poll/reconcile already retire ineligible PRs — no discovery, schema, or adapter changes.

**Tech Stack:** TypeScript, Vitest, existing policy modules under `src/policy/`

**Spec:** [`docs/superpowers/specs/2026-07-14-exclude-draft-prs-design.md`](../specs/2026-07-14-exclude-draft-prs-design.md)

---

## File map

| File | Responsibility |
|------|----------------|
| `src/policy/reasons.ts` | Add `IsDraftExclusion` to `ExclusionReason` union |
| `src/policy/eligibility.ts` | Accept `isDraft`; reject drafts first |
| `src/policy/evaluate.ts` | Pass `input.pr.isDraft` |
| `tests/policy/eligibility.test.ts` | Truth-table + dedicated draft cases |

---

### Task 1: Failing eligibility tests for draft exclusion

**Files:**
- Modify: `tests/policy/eligibility.test.ts`

- [ ] **Step 1: Extend the truth-table input type and every existing call site with `isDraft: false`**

In `TruthTableRow.input`, add `isDraft: boolean`.

For every existing truth-table row, add `isDraft: false` to `input`.

Update the three direct `evaluateEligibility({...})` calls in the file (truth-table runner + the two standalone `it` blocks) to pass `isDraft: input.isDraft` or `isDraft: false` respectively.

- [ ] **Step 2: Add draft truth-table rows and a dedicated assert**

Append these rows to `truthTable` (before the closing `];`):

```ts
  {
    name: "draft PR with explicit request is ineligible",
    input: {
      explicitRequest: true,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/a.ts"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
      isDraft: true,
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "is_draft" }],
    },
  },
  {
    name: "draft PR with path match is ineligible",
    input: {
      explicitRequest: false,
      activeRepo: true,
      registeredRepoId: "pba-webapp",
      changedFiles: ["src/components/Button.tsx"],
      authorLogin: "alice",
      eligiblePaths: ["src/**"],
      eligibleAuthors: [],
      operatorLogin: "shubh-array",
      githubOwnerRepo: "Org/pba-webapp",
      isDraft: true,
    },
    expected: {
      eligible: false,
      exclusions: [{ code: "is_draft" }],
    },
  },
```

In the truth-table runner, pass `isDraft: input.isDraft`.

- [ ] **Step 3: Run tests to verify they fail**

Run: `pnpm vitest run tests/policy/eligibility.test.ts`

Expected: FAIL — either TypeScript/compile error on missing `isDraft` in `EligibilityInput`, or runtime assertions that draft rows are still eligible / missing `is_draft` exclusion.

- [ ] **Step 4: Commit test scaffolding**

```bash
git add tests/policy/eligibility.test.ts
git commit -m "$(cat <<'EOF'
test: expect draft PRs to be policy-ineligible

EOF
)"
```

---

### Task 2: Implement unconditional `is_draft` exclusion

**Files:**
- Modify: `src/policy/reasons.ts`
- Modify: `src/policy/eligibility.ts`
- Modify: `src/policy/evaluate.ts`
- Test: `tests/policy/eligibility.test.ts`

- [ ] **Step 1: Add exclusion reason type**

In `src/policy/reasons.ts`, add:

```ts
export interface IsDraftExclusion {
  code: "is_draft";
}
```

Extend:

```ts
export type ExclusionReason =
  | InactiveRepositoryExclusion
  | NoMatchExclusion
  | IsDraftExclusion;
```

- [ ] **Step 2: Gate drafts first in `evaluateEligibility`**

In `src/policy/eligibility.ts`:

1. Add `isDraft: boolean` to `EligibilityInput`.
2. At the top of `evaluateEligibility`, before the `explicitRequest` block:

```ts
  if (input.isDraft) {
    exclusions.push({ code: "is_draft" });
    return { eligible: false, reasons, exclusions, authorOnly: false };
  }
```

- [ ] **Step 3: Wire `evaluatePolicy`**

In `src/policy/evaluate.ts`, add to the `evaluateEligibility({...})` call:

```ts
    isDraft: input.pr.isDraft,
```

- [ ] **Step 4: Run eligibility tests**

Run: `pnpm vitest run tests/policy/eligibility.test.ts`

Expected: PASS (all rows, including draft exclusions).

- [ ] **Step 5: Run broader policy + discovery smoke**

Run: `pnpm vitest run tests/policy tests/discovery`

Expected: PASS. Discovery tests construct `isDraft: false` fixtures already; no production discovery code changes required — ineligible drafts flow through existing retire path.

- [ ] **Step 6: Commit implementation**

```bash
git add src/policy/reasons.ts src/policy/eligibility.ts src/policy/evaluate.ts tests/policy/eligibility.test.ts
git commit -m "$(cat <<'EOF'
fix: exclude draft PRs from eligibility unconditionally

EOF
)"
```

---

### Task 3: Verify typecheck

**Files:** none additional

- [ ] **Step 1: Typecheck**

Run: `pnpm typecheck`

Expected: PASS (any other call sites of `evaluateEligibility` must include `isDraft`; production only calls via `evaluatePolicy`).

- [ ] **Step 2: Final commit only if typecheck required doc touch-ups**

If no further file changes, skip. If README/ARCHITECTURE mention eligibility reasons and need a one-line note, update and commit separately — **do not** expand scope beyond a single factual sentence under eligibility exclusions.

---

## Done when

- [x] Spec written
- [ ] Draft + explicit request → ineligible (`is_draft`)
- [ ] Draft + path match → ineligible (`is_draft`)
- [ ] Non-draft eligibility unchanged
- [ ] `pnpm vitest run tests/policy tests/discovery` and `pnpm typecheck` pass
