# Phase 1 Rollout Gate Checklist

## Stage 1: Offline Fixtures

- [ ] All deterministic unit tests pass (`pnpm test`)
- [ ] Signal schema validation covers all 6 signal types
- [ ] Proposal target allowlist rejects all non-engineer-owned files
- [ ] Proposal adoption is atomic and single-use
- [ ] Historical replay runs with role-specific evaluators
- [ ] Attention corpus gate: ≥90% must-escalate recall
- [ ] Attention corpus gate: ≤10% false escalation rate
- [ ] Attention corpus gate: ≥0.80 Jaccard top-3 stability (5 repeats)
- [ ] Primary review corpus gate: 100% provenance validity (hard gate)
- [ ] Baseline manifest generates reproducible canonical hash
- [ ] Baseline manifest excludes all Phase 2 fields
- [ ] Scale test: 20 repos, 200 PRs, 20 jobs/day without timeout

## Stage 2: Historical Replay

- [ ] Current engineer profile loaded
- [ ] Exact configured model roles used (doctor-validated)
- [ ] Harness manifests match configured composition
- [ ] Filtered evidence/provenance for closed PRs
- [ ] Both source modes tested (registered-source + remote-evidence-only)
- [ ] Multiple immutable run attempts created (no overwriting)
- [ ] No publication attempted
- [ ] Learning signals recorded for each replay run
- [ ] Replay results stored with corpus/manifest hashes

## Stage 3: Live Shadow

- [ ] Authoritative All Tracked coverage verified (no missing PRs)
- [ ] Deterministic auto-analysis triggers correctly
- [ ] Advisory attention output generated (when enabled)
- [ ] Drafts created with filtered/source-limited evidence
- [ ] Recovery from sleep/restart verified
- [ ] State telemetry captured
- [ ] Learning signals appended for every run outcome
- [ ] Stored-XSS probes pass (PR titles, bodies, labels, comments, findings)
- [ ] Proposal previews render correctly
- [ ] Publisher remains disabled
- [ ] Deterministic queue order is default view

## Stage 4: Gated Publishing

- [ ] All Stage 1–3 gates pass
- [ ] `pnpm ct publication enable` runs successfully
- [ ] Doctor re-validates before enabling
- [ ] Operator confirms active identity and gate evidence
- [ ] `publication.mode: "gated"` written to machine config
- [ ] Per-operation single-use approval enforced
- [ ] Published comments have non-empty validated provenance
- [ ] `APPROVE` review is bodyless with empty provenance
- [ ] Partial failure recovery creates fresh approvals only
- [ ] `pnpm ct publication disable` restores shadow immediately

## Acceptance (§15)

- [ ] 20 repositories, 200 open PRs tracked
- [ ] 20 review jobs per day scheduled and completed
- [ ] Default concurrency = 1, max = 2
- [ ] Median verification time ≤ 2 minutes (after 30 PRs in 30-day pilot)
- [ ] ≥70% drafts accepted or wording-only edits

## Plan 04 Residuals (Phase 1 final review)

- [ ] Pipeline `sealRun` awaits disk seal before `updatePointers` sets `accepted_run_id` — **fixed** in `pipeline-runner.ts` / `pipeline.ts`
- [ ] Pipeline agent wiring: `buildPipelineDeps.runAgent` remains a stub pending full Cursor adapter integration
