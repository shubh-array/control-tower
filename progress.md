## Plan Item 1: Resolve GitHub remote from DB/catalog (U-01)
- Status: complete
- Files modified: src/orchestrator/resolve-remote.ts, src/orchestrator/pipeline-runner.ts, src/daemon/bootstrap.ts, tests/orchestrator/source-pipeline.test.ts
- Tests run: pnpm vitest run tests/orchestrator/source-pipeline.test.ts tests/orchestrator/pipeline.test.ts tests/integration/pipeline-production-deps.test.ts
- Acceptance criteria addressed: U-01
- Notes: commit c88c4e4

## Plan Item 2: Materialize allowed source files (U-02 pt1)
- Status: complete
- Files modified: src/source/materialize.ts, src/orchestrator/source-pipeline.ts, tests/orchestrator/source-pipeline.test.ts, tests/source/materialize.test.ts
- Tests run: pnpm vitest run tests/orchestrator/source-pipeline.test.ts tests/source/materialize.test.ts
- Acceptance criteria addressed: U-02
- Notes: commit 0e747fe

## Plan Item 3: Use real lineCount in validation (U-02 pt2)
- Status: complete
- Files modified: src/orchestrator/pipeline-runner.ts, tests/cursor/validate-review.test.ts
- Tests run: pnpm vitest run tests/cursor/validate-review.test.ts
- Acceptance criteria addressed: U-02
- Notes: commit 248d440

## Plan Item 4: Fetch and write PR diff (U-03)
- Status: complete
- Files modified: src/github/fetch-pr-diff.ts, src/orchestrator/context-build.ts, src/orchestrator/pipeline-runner.ts, src/daemon/bootstrap.ts, tests/orchestrator/context-build.test.ts
- Tests run: pnpm vitest run tests/orchestrator/context-build.test.ts tests/orchestrator/pipeline.test.ts tests/integration/pipeline-production-deps.test.ts
- Acceptance criteria addressed: U-03
- Notes: commit ed30f4b

## Plan Item 5: Honest coverage finalization (U-05)
- Status: complete
- Files modified: src/context/coverage.ts, src/orchestrator/context-build.ts, src/orchestrator/pipeline-runner.ts, tests/orchestrator/context-build.test.ts, tests/integration/pipeline-production-deps.test.ts, tests/learning/pipeline-signals.test.ts
- Tests run: pnpm vitest run tests/orchestrator/ tests/context/ tests/integration/
- Acceptance criteria addressed: U-05
- Notes: commit f4bff54; allocateRun uses deferred sourceHash for stable runId per URGENT.md

## Plan Item 6: Full provenance catalog (U-04)
- Status: complete
- Files modified: src/orchestrator/context-build.ts, src/orchestrator/pipeline-runner.ts, tests/orchestrator/context-build.test.ts
- Tests run: pnpm vitest run tests/orchestrator/context-build.test.ts tests/context/provenance.test.ts
- Acceptance criteria addressed: U-04
- Notes: included in ed30f4b with U-03 (no separate commit)

## Plan Item 7: PR-scoped supersede (U-06 pt1)
- Status: complete
- Files modified: src/orchestrator/enqueue.ts, src/daemon/bootstrap.ts, tests/orchestrator/enqueue.test.ts
- Tests run: pnpm vitest run tests/orchestrator/enqueue.test.ts
- Acceptance criteria addressed: U-06
- Notes: commit 451ac17

## Plan Item 8: Stale detection in draft APIs (U-06 pt2)
- Status: complete
- Files modified: src/orchestrator/draft-loader.ts, src/api/contracts.ts, client/src/lib/api.ts, src/daemon/bootstrap.ts, tests/orchestrator/draft-loader.test.ts
- Tests run: pnpm vitest run tests/orchestrator/draft-loader.test.ts tests/publisher/guards.test.ts
- Acceptance criteria addressed: U-06
- Notes: commit 6abd128

## Plan Item 9: Stale banner in Workbench (U-06 pt3)
- Status: complete
- Files modified: client/src/routes/Workbench.tsx
- Tests run: pnpm vitest run client/tests/
- Acceptance criteria addressed: U-06
- Notes: commit 8d025fe

## Plan Item 10: Final integration verification
- Status: complete
- Files modified: none (verification only)
- Tests run: pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: all U-01 through U-06
- Notes: 763 tests pass; typecheck clean; client builds

## Code Review Fix 1: Diff-hunk provenance records (U-04 gap)
- Status: complete
- Files modified: src/github/fetch-pr-diff.ts, src/orchestrator/context-build.ts, src/orchestrator/pipeline-runner.ts, tests/orchestrator/context-build.test.ts
- Tests run: pnpm vitest run; pnpm typecheck
- Acceptance criteria addressed: U-04 diff-hunk records when filtered diff exists
- Notes: parseDiffHunks + createDiffHunkRecord wired through materializeDiffArtifact → buildFullProvenanceCatalog

## Code Review Fix 2: Required findActiveJobsByPr
- Status: complete
- Files modified: src/orchestrator/enqueue.ts, tests/integration/analysis-pipeline.test.ts
- Tests run: pnpm vitest run; pnpm typecheck
- Acceptance criteria addressed: PR-scoped supersede cannot silently degrade
- Notes: removed optional guard on findActiveJobsByPr

## Code Review Fix 3: Deduplicate computeRunContext
- Status: complete
- Files modified: src/orchestrator/pipeline-runner.ts
- Tests run: pnpm vitest run; pnpm typecheck
- Acceptance criteria addressed: prepareContext reuses allocateRun state; layout uses final runId
- Notes: prepareContext materializes only; allocateRun sets layout after runId allocation

## Plan Item 11: Update operator docs for pipeline fixes
- Status: complete
- Files modified: ARCHITECTURE.md, POLLING.md, README.md, ONBOARDING.md
- Tests run: pnpm vitest run; pnpm typecheck
- Acceptance criteria addressed: documentation accuracy for U-01 through U-06 pipeline behavior
- Notes: 16 surgical doc fixes across four files; 764 tests pass; typecheck clean

## Plan Item 1 (review-core): Replace schema with review-core schema
- Status: complete
- Files modified: src/store/migrations/001_initial.sql, src/store/migrations/002_projection_columns.sql (deleted), src/store/migrate.ts, src/config/types.ts, src/config/schemas.ts, config/organization.json, src/source/cleanup.ts, tests/store/migrate.test.ts, tests/config/load.test.ts, tests/config/schemas.test.ts
- Tests run: pnpm vitest run tests/store/migrate.test.ts tests/config/load.test.ts tests/config/schemas.test.ts; pnpm typecheck
- Acceptance criteria addressed: review-core table set, prs policy columns, legacy DB guard, reviewDefaults removal, cleanupAbandonedPairs removal
- Notes: worktree review-core-simplification; no commit

## Plan Item 1 (review-core): Strengthen migration test assertions
- Status: complete
- Files modified: tests/store/migrate.test.ts
- Tests run: pnpm vitest run tests/store/migrate.test.ts tests/config/load.test.ts tests/config/schemas.test.ts; pnpm typecheck
- Acceptance criteria addressed: exact review-core table set assertion; zero-pending legacy guard test
- Notes: no production code changes required; guard already runs after no-pending path

## Plan Item 1/2 fix: learning_signals legacy guard regression
- Status: complete
- Files modified: src/store/migrate.ts, tests/store/migrate.test.ts
- Tests run: pnpm vitest run tests/store/migrate.test.ts tests/config/load.test.ts tests/config/schemas.test.ts; pnpm typecheck
- Acceptance criteria addressed: remove learning_signals from LEGACY_TABLES; SignalRecorder bootstrap sequence regression test; retain attention_items zero-pending guard
- Notes: typecheck still fails on unrelated work-graph/upsert exports (Tasks 2/4)

## Plan Item 2 (review-core): Eligibility-gated discovery persistence
- Status: complete
- Files modified: src/discovery/poll.ts, src/discovery/poll-resilience.ts, src/normalize/upsert.ts, src/daemon/bootstrap.ts, tests/discovery/poll.test.ts, tests/discovery/poll-resilience.test.ts, tests/discovery/eligible-persistence.test.ts, tests/normalize/upsert.test.ts, tests/orchestrator/draft-loader.test.ts
- Tests run: pnpm vitest run tests/discovery/poll.test.ts tests/discovery/poll-resilience.test.ts tests/discovery/eligible-persistence.test.ts tests/normalize/upsert.test.ts; pnpm typecheck
- Acceptance criteria addressed: single policy evaluation before persist; ineligible PRs not persisted/enqueued; eligible PRs persist policy_json/hash and checks/comments; eligible→ineligible retires cache row with job supersede in bootstrap
- Notes: worktree review-core-simplification; no commit; typecheck still fails on tests/orchestrator/work-graph.test.ts until Task 4

## Plan Item 3 (review-core): Reconcile review-cache without false closure inference
- Status: complete
- Files modified: src/discovery/reconcile-review-cache.ts, src/discovery/poll.ts, src/discovery/poll-resilience.ts, src/daemon/bootstrap.ts, tests/discovery/reconcile-review-cache.test.ts, tests/discovery/poll.test.ts, tests/discovery/poll-resilience.test.ts, tests/discovery/eligible-persistence.test.ts
- Tests run: pnpm vitest run tests/discovery/poll.test.ts tests/discovery/poll-resilience.test.ts tests/discovery/reconcile-review-cache.test.ts tests/discovery/eligible-persistence.test.ts; pnpm typecheck
- Acceptance criteria addressed: positive-confirmation reconciliation for absent persisted rows; OPEN+eligible upsert/enqueue; CLOSED/MERGED retire; OPEN+ineligible retire; null/throw retain; wired after successful poll before checkpoint; bootstrap listPersistedReviewPrs join; failed polls skip reconciliation
- Notes: worktree review-core-simplification; no commit; typecheck deferred failures remain in tests/orchestrator/work-graph.test.ts (Task 4)

## Plan Item 3 fix (review-core): Deferred retirement and failed-job exclusion
- Status: complete
- Files modified: src/discovery/reconcile-review-cache.ts, src/discovery/poll.ts, src/daemon/bootstrap.ts, tests/discovery/poll.test.ts, tests/discovery/reconcile-review-cache.test.ts, tests/discovery/retire-review-pr.test.ts, tests/orchestrator/enqueue.test.ts
- Tests run: pnpm vitest run tests/discovery/poll.test.ts tests/discovery/poll-resilience.test.ts tests/discovery/reconcile-review-cache.test.ts tests/discovery/eligible-persistence.test.ts tests/discovery/retire-review-pr.test.ts tests/orchestrator/enqueue.test.ts; pnpm typecheck
- Acceptance criteria addressed: per-poll retirement candidate collection applied only after successful poll+reconcile; enrich throw aborts retirements and checkpoint; findActiveJobsByPr excludes failed; retirement supersedes only non-terminal jobs
- Notes: worktree review-core-simplification; no commit; Task4 work-graph typecheck failures remain deferred

## Plan Item 4 (review-core): Collapse read model and honest manual Analyze
- Status: complete
- Files modified: src/policy/evaluate.ts, src/orchestrator/work-graph.ts, src/orchestrator/facade.ts, src/orchestrator/enqueue.ts, src/orchestrator/analyze-errors.ts, src/api/contracts.ts, src/api/projections/queue.ts, src/api/routes/queue.ts, src/api/routes/jobs.ts, src/daemon/bootstrap.ts, src/daemon/runtime.ts, tests/orchestrator/work-graph.test.ts, tests/orchestrator/facade.test.ts, tests/api/queue-projection.test.ts, tests/api/jobs-analyze.test.ts, tests/daemon/manual-analyze.test.ts, tests/orchestrator/enqueue.test.ts, tests/integration/analysis-pipeline.test.ts, tests/e2e/fake-adapters.test.ts, tests/daemon/runtime.test.ts, tests/api/server-spa-fallback.test.ts
- Tests run: pnpm vitest run (focused Task 4 suite); pnpm typecheck
- Acceptance criteria addressed: ReviewQueueItem read model from prs; manualRequest enqueue; honest bootstrap analyze; HTTP 422 for ineligible; focusQueue-only API contract
- Notes: worktree review-core-simplification; no commit

## Plan Item 5 (review-core): Delete product Coverage UI
- Status: complete
- Files modified: client/src/App.tsx, client/src/lib/api.ts, client/src/lib/navigation.ts, client/src/lib/routes.ts, client/src/lib/queue-display.ts, client/src/lib/review-route.ts, client/src/lib/queue-polling.ts, client/src/hooks/useQueueQuery.ts, client/src/components/PriorityIndicator.tsx, client/src/components/StatusBadge.tsx, client/src/routes/Workbench.tsx, client/src/index.css, client/tests/*, tests/client/*, tests/api/spa-fallback.test.ts
- Files deleted: client/src/routes/AllTracked.tsx, client/tests/coverage-action.test.ts
- Tests run: pnpm vitest run (focused suite + client/tests/); pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: /coverage removed; allTracked API/UI gone; focus lanes only; Workbench CoverageWarning preserved
- Notes: worktree review-core-simplification; no commit

## Plan Item 6 (review-core): Remove learning, proposals, and attention placeholders
- Status: complete
- Files modified: src/api/server.ts, src/daemon/bootstrap.ts, src/daemon/runtime.ts, src/orchestrator/pipeline.ts, src/orchestrator/pipeline-runner.ts, src/orchestrator/context-build.ts, src/context/harness-manifest.ts, src/cursor/adapter.ts, src/cli/main.ts, src/store/migrate.ts, client/src/App.tsx, client/src/lib/api.ts, client/src/lib/navigation.ts, client/src/lib/routes.ts, client/src/lib/query-keys.ts, client/src/lib/query-invalidation.ts, client/tests/*, tests/api/server-spa-fallback.test.ts, tests/daemon/runtime.test.ts, tests/client/*, tests/context/harness-manifest.test.ts, tests/cursor/adapter.fixtures.test.ts, tests/eval/metrics.test.ts, tests/store/migrate.test.ts
- Files deleted: src/learning/, src/proposals/, src/api/routes/signals.ts, src/api/routes/proposals.ts, client/src/routes/ProposeChange.tsx, client/src/hooks/useSignalsQuery.ts, client/src/hooks/useProposalMutations.ts, client/src/lib/proposal-adopt.ts, config/harnesses/pr-attention/, eval/metrics/attention.ts, tests/learning/, tests/proposals/, tests/client/proposal-adopt.test.ts
- Tests run: pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: no signal/proposal API or UI; primaryReview-only harness; pr-review doctor manifest; pipeline without signal hooks
- Notes: worktree review-core-simplification; no commit

## Plan Item 7 (review-core): Update operator docs and Delivery Intelligence seam
- Status: complete
- Files modified: README.md, ONBOARDING.md, ARCHITECTURE.md, POLLING.md, DEFER.md, docs/principal-engineer-control-tower-architecture.html, docs/handoff/phase-1-baseline-manifest.json
- Tests run: rg validation on operator docs; pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: removed Coverage/Propose/learning claims; reset instructions added; Phase 2C Delivery Intelligence boundary documented; per-run coverage language preserved
- Notes: worktree review-core-simplification; no commit

## Plan Item 6/7 blocker fixes: Spec-review cleanup
- Status: complete
- Files modified: config/examples/local-config.json, ONBOARDING.md, README.md, POLLING.md, tests/config/schemas.test.ts, docs/principal-engineer-control-tower-architecture.html, client/tests/workbench-readability.test.ts, tests/cli/doctor.test.ts
- Tests run: pnpm vitest run tests/config/ client/tests/ tests/cli/doctor.test.ts; pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: primaryReview-only example config; accurate reset wording; pipeline docs without signal recorder; schema tests guard example config
- Notes: proposal CSS already absent in index.css; no commit

## Plan Item Tasks6/7: Inbox review terminology
- Status: complete
- Files modified: client/src/lib/inbox-context.ts, client/src/routes/FocusQueue.tsx, tests/client/inbox-context.test.ts, client/tests/shell-primitives.test.ts
- Tests run: pnpm vitest run tests/client/inbox-context.test.ts client/tests/; pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: formatReviewReason + Review reason label; FocusQueue review-focused copy; client tests updated
- Notes: worktree review-core-simplification; no commit

## Plan Item code-review blockers: reset docs, ONBOARDING, /propose fallback
- Status: complete
- Files modified: README.md, ONBOARDING.md, docs/principal-engineer-control-tower-architecture.html, src/api/spa-fallback.ts, src/store/migrate.ts, tests/api/spa-fallback.test.ts, tests/api/server-spa-fallback.test.ts, tests/store/migrate.test.ts
- Tests run: pnpm vitest run tests/api/spa-fallback.test.ts tests/api/server-spa-fallback.test.ts tests/store/migrate.test.ts tests/client/routes.test.ts tests/client/navigation.test.ts; pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: full reset+init upgrade path documented; Coverage/reviewDefaults removed from ONBOARDING; /propose returns 404 not SPA fallback
- Notes: worktree review-core-simplification; no commit

## Plan Item doc blocker: ineligible PR persistence
- Status: complete
- Files modified: ONBOARDING.md
- Tests run: docs grep; pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: policy-ineligible PRs documented as not persisted; priority table aligned; grammar fix (either→any)
- Notes: worktree review-core-simplification; no commit

## Plan Item: Fix retry lifecycle double-allocation bug
- Status: complete
- Files modified: src/orchestrator/retry.ts, src/api/routes/jobs.ts, client/src/lib/api.ts, client/src/routes/Workbench.tsx, tests/orchestrator/retry.test.ts, tests/integration/analysis-pipeline.test.ts, tests/orchestrator/facade.test.ts, tests/api/jobs-analyze.test.ts, tests/e2e/fake-adapters.test.ts, tests/api/server-spa-fallback.test.ts, tests/daemon/runtime.test.ts, tests/daemon/manual-analyze.test.ts
- Tests run: pnpm vitest run tests/orchestrator/retry.test.ts tests/integration/analysis-pipeline.test.ts tests/orchestrator/facade.test.ts tests/api/jobs-analyze.test.ts tests/e2e/fake-adapters.test.ts (red then green); pnpm vitest run; pnpm typecheck; pnpm --dir client build
- Acceptance criteria addressed: retry is job requeue only; no preallocated run; accepted pointer cleared; API/client return jobId; Workbench no premature run log; integration proves single pipeline allocation; non-failed retry rejected
- Notes: worktree review-core-simplification; no commit

## Plan Item: Align review-core operator docs with source
- Status: complete
- Files modified: .worktrees/review-core-simplification/ARCHITECTURE.md, .worktrees/review-core-simplification/README.md, .worktrees/review-core-simplification/POLLING.md, .worktrees/review-core-simplification/ONBOARDING.md
- Tests run: pnpm vitest run; pnpm typecheck; pnpm --dir client build (worktree)
- Acceptance criteria addressed: eligible-only cache, discovery scope, manual analyze/retry, queue/health cadence, backoff effective behavior, reset/init lifecycle, auth tokens, primaryReview-only, publication job-state honesty, audit_events reader-only, no allTracked/Coverage page
- Notes: verified against src/discovery/*, src/daemon/bootstrap.ts, src/orchestrator/*, src/api/*, client/src/lib/queue-polling.ts; no commit

## Plan Item: Source-verified documentation corrections (final)
- Status: complete
- Files modified: .worktrees/review-core-simplification/README.md, .worktrees/review-core-simplification/ONBOARDING.md, .worktrees/review-core-simplification/POLLING.md, .worktrees/review-core-simplification/ARCHITECTURE.md
- Tests run: focused grep (old phrases absent); pnpm vitest run; pnpm typecheck; pnpm --dir client build (worktree)
- Acceptance criteria addressed: 1 stale on load/refetch; 2 init empty data dir; 3 tracked artifact paths; 4 model smoke re-validates IDs not inference; 5 GitHub calls beyond discovery; 6 in-process diff filtering; 7 no read-hook enforcement claim
- Notes: docs-only; no commit

## Plan Item: Final documentation corrections (truthful wording)
- Status: complete
- Files modified: .worktrees/review-core-simplification/README.md, .worktrees/review-core-simplification/POLLING.md, .worktrees/review-core-simplification/ARCHITECTURE.md
- Tests run: grep (old phrases absent); pnpm vitest run; pnpm typecheck; pnpm --dir client build (worktree)
- Acceptance criteria addressed: 1 gated publication wording; 2 discovery resilience incremental upserts; 3 manual analyze scheduler timing; 4 authoritative contract paths; 5 remove gate-checklist ref; 6 remove pathMatchesAny; 7 happy-dom per-file pragma
- Notes: docs-only; no commit

## Plan Item: Final ARCHITECTURE.md corrections (SPA + retry)
- Status: complete
- Files modified: .worktrees/review-core-simplification/ARCHITECTURE.md
- Tests run: source phrase grep; pnpm vitest run; pnpm typecheck; pnpm --dir client build (worktree)
- Acceptance criteria addressed: 1 SPA fallback except removed paths like /propose return 404; 2 failed job identity returns existing_job_current, changed identity may enqueue new job, failed remains terminal
- Notes: docs-only; no commit

## Plan Item: ARCHITECTURE.md docs/ description correction
- Status: complete
- Files modified: .worktrees/review-core-simplification/ARCHITECTURE.md
- Tests run: focused grep (old phrase absent); pnpm vitest run; pnpm typecheck; pnpm --dir client build (worktree)
- Acceptance criteria addressed: docs/ comment truthfully describes handoff manifest, architecture artifact, implementation plans
- Notes: docs-only; no commit
