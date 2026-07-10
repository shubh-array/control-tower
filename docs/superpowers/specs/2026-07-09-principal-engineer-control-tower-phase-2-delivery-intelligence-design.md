# Principal Engineer Control Tower — Phase 2: Advanced Review and Delivery Intelligence

**Date:** 2026-07-09  
**Revised:** 2026-07-10  
**Status:** Approved for sequential implementation after Phase 1 gates pass  
**Audience:** Implementation agents starting with no prior conversation context  
**Prerequisite:** The revised Phase 1 delegated-review specification is implemented and its rollout gates pass.

## 1. Purpose and execution order

Phase 2 extends the proven Phase 1 control tower through three independently deliverable increments:

1. **Phase 2A — Advanced and cross-repository review**
2. **Phase 2B — Optional delivery-provider intelligence, with Linear first**
3. **Phase 2C — Bot publication and sandboxed local checks**

Implement these increments in order. Each increment receives its own implementation plan, branch, migrations, tests, rollout, and acceptance review. An implementation session must not combine 2A, 2B, and 2C into one change.

The following ideas from the original Phase 2 proposal are not part of these increments:

- Agent-based Focus Queue ranking.
- Natural-language command bar.
- Daily or weekly generated briefings.
- In-app persona and policy governance.

They remain deferred until measured Phase 1/2 usage demonstrates a concrete need. Deterministic ranking and file-based profile governance remain authoritative.

## 2. Delivered Phase 1 baseline

An implementation agent may assume only these tested Phase 1 capabilities:

- Generic repository catalog plus portable engineer profile and local machine config.
- Authenticated GitHub discovery through the deterministic `gh` adapter.
- SQLite work graph and versioned migrations.
- Separate attention items and review jobs.
- Hybrid auto-analysis: explicit requests and high-priority matches auto-run; other items are on demand.
- Control-tower-owned partial mirrors and transient source-only worktrees.
- One primary Cursor CLI reviewer using an isolated job workspace and strict JSON result schema.
- Default one, maximum two concurrent Cursor processes.
- CI-only dynamic evidence; no repository execution.
- Loopback Focus Queue, Review Workbench, audit trail, human approval, and guarded publication.

Phase 2 must preserve all Phase 1 security and authority invariants. It may extend interfaces through migrations and versioned schemas; it may not rely on speculative reserved fields.

## 3. Global Phase 2 invariants

1. **Cursor CLI remains the only AI harness.** Specialists and delivery interpretation use the same subprocess adapter and safety controls as Phase 1.
2. **Connectors remain deterministic.** GitHub and delivery-provider ingestion never runs through an agent or MCP conversation.
3. **Eligibility remains deterministic.** No agent can create, remove, or hide an eligible attention item.
4. **Progress is not PR volume.** A delivery provider defines planned scope and completion; GitHub supplies evidence.
5. **Context changes are versioned.** Related PRs, provider state, specialist outputs, and sandbox results participate in explicit context identities and staleness rules.
6. **Optional means disabled by default.** A provider, bot identity, specialist, or local check must be explicitly configured and pass doctor before activation.
7. **No credential reaches an analysis agent.** Connectors, publisher, and sandbox launcher have separate minimal credential paths.
8. **Human authority remains explicit.** Bot comments and local checks require the gates defined below; final review disposition always remains the principal's action.

## 4. Shared configuration extensions

Phase 2 extends existing documents without changing their ownership.

`config/organization.json` advances from schema version 1 to schema version 2 and may add contract groups and provider definitions:

```json
{
  "schemaVersion": 2,
  "contractGroups": [
    {
      "id": "public-api",
      "members": [
        { "repositoryId": "pba-webapp", "paths": ["src/api-clients/**"] },
        { "repositoryId": "pba-microservices", "paths": ["services/**/Contracts/**"] }
      ]
    }
  ],
  "deliveryProviders": [
    {
      "id": "linear",
      "kind": "linear",
      "baseUrl": "https://api.linear.app"
    }
  ]
}
```

`~/.control-tower/profile/policy.json` advances from schema version 1 to schema version 2 and may add the following exact fields; all Phase 1 `autoAnalyze` and `repositories` fields remain required:

```json
{
  "schemaVersion": 2,
  "specialists": {
    "concurrency": {
      "enabled": true,
      "triggers": [
        {
          "id": "agents-async-runtime",
          "repositoryId": "pba-agents",
          "paths": ["services/**/src/**"],
          "labelsAny": [],
          "diffPatternsAny": ["asyncio", "retry", "idempot"]
        }
      ]
    },
    "crossRepository": {
      "enabled": true,
      "contractGroupIds": ["public-api"]
    }
  },
  "delivery": {
    "providerId": "linear",
    "trackedTeamIds": [],
    "trackedProjectIds": [],
    "trackedInitiativeIds": [],
    "stalledReviewHours": 48,
    "dailySnapshotTimeLocal": "00:05"
  }
}
```

Specialist trigger fields are limited to `id`, `repositoryId`, `paths`, `labelsAny`, and `diffPatternsAny`. Unknown fields are errors. `repositoryId` must equal the target repository. Within each non-empty array, any value may match; all non-empty predicate groups must match. A trigger with all three arrays empty is invalid. Diff patterns are case-insensitive literal substrings, not regular expressions, and evaluate only the first 2 MB of patch text; truncation is recorded.

The local config may add credential aliases and runtime limits:

```json
{
  "credentialAliases": {
    "linear": "control-tower-linear-default",
    "githubBot": "control-tower-github-bot"
  },
  "runtime": {
    "maxSpecialistAgentsPerJob": 2,
    "maxSandboxChecks": 1,
    "specialistModels": {
      "concurrency": "composer-2.5-fast",
      "crossRepository": "composer-2.5-fast"
    }
  }
}
```

An omitted section disables the corresponding capability. Unknown IDs or fields are startup errors. Doctor validates each configured model against `agent models`; if no specialist model is configured, that specialist uses the validated primary-review model.

# Phase 2A — Advanced and Cross-Repository Review

## 5. Goal

Add targeted specialist judgment and cross-repository context without turning every review into an agent swarm.

The expected outcome is higher recall for concurrency and contract-change defects while preserving Phase 1 latency, cost, and failure visibility for routine PRs.

## 6. Scope

2A adds:

- Deterministic specialist triggers.
- A concurrency specialist.
- A cross-repository specialist.
- Deterministic related-PR and contract-group context.
- Multi-repository read-only source worktrees for triggered jobs.
- A primary-review consolidation stage with explicit versioning.

2A does not add Linear, bot credentials, local commands, agent ranking, briefings, or a command bar.

## 7. Trigger evaluation

Triggers are deterministic and evaluated from the schema-version-2 `specialists` section in `~/.control-tower/profile/policy.json`:

- Repository ID.
- Changed-file globs.
- GitHub labels.
- Case-insensitive literal diff patterns under the fixed 2 MB limit.
- Contract-group membership.

The agent does not decide whether a specialist should run.

The concurrency specialist runs only when an enabled trigger matches.

The cross-repository specialist runs when:

1. A changed path belongs to a configured contract group; or
2. Two or more open/recent PRs in active repositories share the same normalized opaque ticket identifier extracted by the Phase 1 organization-catalog rules.

Trigger evaluation and its matched evidence are stored in the job record.

## 8. Related-work resolver

Deterministic code gathers candidate related work:

- Open PRs in other active repositories sharing a normalized ticket identifier.
- PRs merged in the previous 30 days sharing that identifier.
- Open PRs touching another member of a matched contract group.

Candidates are bounded to 20 and ordered by exact ticket match, open before merged, then update time. The resolver records truncation.

The resolver does not infer semantic relationships. The cross-repository specialist evaluates only the deterministic candidate set.

## 9. Source preparation

The Phase 1 workspace manager may materialize additional source-only worktrees for related repositories. Each is bound to a specific SHA and added to the isolated Cursor job with a separate `--add-dir`.

Rules:

- Maximum three source worktrees for one review job: the target plus two related repositories.
- Maximum four materialized worktrees globally remains unchanged.
- No setup scripts, dependency installs, environment files, or repository commands.
- If a related worktree cannot be prepared, the specialist records missing coverage and continues with GitHub evidence.

Before source preparation, the orchestrator atomically reserves all required worktree slots. If capacity is unavailable, the job remains in `waiting_for_source_capacity`; it does not partially materialize or start specialists. This guarantees that two concurrent jobs cannot exceed the global limit of four.

## 10. Agent ordering and consolidation

For a job with no specialist triggers, the Phase 1 primary reviewer runs unchanged.

For a triggered job:

1. Freeze target and related source SHAs, relevant policy/profile hashes, trigger matches, and specialist model IDs.
2. Build one immutable context version.
3. Run triggered specialists first. They may run concurrently within the global Cursor limit.
4. Validate each specialist against its strict schema.
5. Run the primary reviewer once, providing the original context plus validated specialist outputs or explicit specialist failures.
6. The primary reviewer produces review-result schema version 2: all Phase 1 fields plus the required 2A fields below.

There is no second consolidation agent. The primary reviewer is the consolidator and therefore always runs after specialists.

A specialist failure does not block the primary reviewer. It becomes an unresolved unknown and is visible in the workbench.

## 11. Versioning and state

The 2A context identity is:

```text
target repository + PR + target head SHA
+ ordered related repository/PR/SHA set
+ review-relevant policy hash + profile hash
+ specialist trigger hash + specialist model IDs
```

The final analysis identity additionally includes validated specialist output hashes.

New target commits always supersede the draft. A related PR head change marks cross-repository context stale but does not automatically discard a draft. Publication is blocked until the user either reruns analysis or explicitly accepts the displayed related-context staleness; that acceptance is audited.

Add job stages:

- `resolving_related_work`
- `waiting_for_source_capacity`
- `running_specialists`
- `consolidating_review`

## 12. Specialist output

Each specialist returns:

```json
{
  "schemaVersion": 1,
  "specialist": "concurrency|cross_repository",
  "coverage": {
    "inspected": ["string"],
    "missing": ["string"]
  },
  "evidence": [
    {
      "id": "S:concurrency:E1",
      "kind": "diff|file|check|comment|commit",
      "repositoryId": "pba-agents",
      "source": "string",
      "observation": "string"
    }
  ],
  "findings": [
    {
      "severity": "blocking|high|medium|low",
      "confidence": "high|medium|low",
      "title": "string",
      "rationale": "string",
      "repositoryId": "string",
      "file": "string",
      "line": 1,
      "evidenceIds": ["S:concurrency:E1"]
    }
  ],
  "unknowns": ["string"]
}
```

Specialist evidence IDs use `S:<specialist>:<local-id>` and are unique within one review-result document. The enclosing Cursor run ID and specialist output hash provide cross-run identity. Each ID must resolve within that specialist's `evidence` array. The primary reviewer may cite specialist evidence but may not rewrite its observation.

The final primary result sets `schemaVersion` to `2`, retains every Phase 1 field, and replaces the Phase 1 `evidence` array with the deterministic union of original Phase 1 evidence plus every validated specialist evidence object. Namespaced specialist IDs remain unchanged in that merged array. The final result also adds:

```json
{
  "schemaVersion": 2,
  "specialistCoverage": [
    {
      "specialist": "concurrency",
      "status": "complete|failed|not_triggered",
      "outputHash": "string|null"
    }
  ],
  "crossRepositoryImplications": [
    {
      "repositoryId": "string",
      "prNumber": 1,
      "relationship": "string",
      "evidenceIds": ["string"]
    }
  ]
}
```

## 13. UI additions

The Review Workbench shows:

- Why each specialist triggered.
- Specialist coverage and failures.
- Related PRs and exact source SHAs.
- Consolidated findings without duplicating specialist wording.
- Related-context freshness.

The Focus Queue remains deterministically ordered.

## 14. 2A tests and acceptance

Tests cover trigger exactness, candidate bounds, multi-repository SHA binding, specialist ordering, global concurrency, malformed specialist output, specialist failure, consolidation, and related-context staleness.

2A is accepted when:

- Specialists run only for matching triggers.
- No triggered job exceeds two specialist runs or the global two-process limit.
- Specialist failure never hides or blocks the primary review.
- Related candidates and SHAs reconcile exactly to GitHub.
- Cross-repository context never reads an unregistered or protected repository path.
- On a minimum 20-case specialist corpus, concurrency and cross-repository recall improve over the Phase 1 primary-only baseline without increasing false-positive rate by more than 10 percentage points.
- Median routine-PR verification time remains at most two minutes for jobs with no specialist trigger.

# Phase 2B — Delivery Provider Intelligence

## 15. Goal

Connect code delivery to planned work without making a specific issue tracker part of the generic core.

Linear is the first provider adapter. Installations without Linear leave 2B disabled and retain all 2A behavior.

## 16. Provider interface

The deterministic provider interface supplies:

- Issues/work items.
- Teams.
- Projects.
- Milestones when supported.
- Initiatives when supported.
- Status, estimate, priority, assignee, target dates, and relationships.
- A stable source version and `observedAt` timestamp.

Unsupported provider concepts are absent, never synthesized.

The generic work graph uses `delivery_*` entity names and stores provider-specific raw IDs and payload hashes. Linear terminology appears only in the Linear adapter and UI labels derived from provider capabilities.

## 17. Linear adapter

The adapter calls Linear's API directly through deterministic TypeScript code. It does not use Cursor, an MCP tool, or an agent conversation for source synchronization.

It retrieves:

- Issues referenced by tracked PR ticket identifiers.
- Issues in configured teams, projects, milestones, and initiatives.
- Parent hierarchy, dependencies, status, estimate, assignee, priority, and target dates.

Polling defaults to five minutes and is checkpointed. The connector stores source timestamps, payload hashes, and the exact provider query scope used.

Linear is read-only throughout Phase 2.

## 18. Credential onboarding

Add:

```text
pnpm ct credentials set linear <alias>
pnpm ct credentials check linear <alias>
pnpm ct credentials delete linear <alias>
```

The set command prompts without echo and stores the credential in the macOS Keychain through the credential-store adapter. The local config contains only the alias. The credential is provided only to the Linear connector request process and is never inherited by Cursor, Docker, `gh`, Git, logs, SQLite, or artifacts.

Doctor validates the alias and a read-only identity query without printing the token.

## 19. Ticket-link resolution

Phase 1 already defines opaque ticket extractors. Organization schema version 2 adds the required `providerId` to each extractor that should resolve through a delivery provider:

```json
{
  "ticketExtractors": [
    {
      "id": "linear-key",
      "sources": ["title", "body", "branch"],
      "pattern": "\\b[A-Z][A-Z0-9]+-[0-9]+\\b",
      "providerId": "linear"
    }
  ]
}
```

Extraction is deterministic. Multiple or missing identifiers are visible discrepancies. An agent may interpret the impact but cannot silently choose or repair a link.

## 20. Work graph and snapshots

2B migrations add:

- Delivery providers and connector checkpoints.
- Work items, teams, projects, milestones, initiatives, and relationships.
- PR-to-work-item links with extraction evidence.
- Daily immutable delivery snapshots.
- Deterministic anomalies and separate agent interpretations.

The retrieval scope is the union of:

- Non-archived work items directly assigned to a tracked project.
- Non-archived work items in a project belonging to a tracked initiative.
- Non-archived, non-canceled work items in a tracked team when that team is explicitly configured.
- Work items resolved from tracked PR ticket identifiers, even when outside the configured planning hierarchy.
- Ancestor project/initiative records and one hop of blocking/blocked-by relationships needed to explain those items.

The progress scope is narrower and provider-defined: only non-archived, non-canceled work items included by the explicitly tracked team/project/initiative hierarchy. PR-linked items outside that hierarchy are context-only and cannot change progress numerator, denominator, estimate coverage, or scope-change calculations.

The connector polls source observations every five minutes. It creates one immutable daily snapshot at `delivery.dailySnapshotTimeLocal` and an additional immutable snapshot only on explicit user refresh. A snapshot includes the latest GitHub and provider observations at or before its single `asOf` timestamp; later facts wait for the next snapshot.

A provider scope ID is the content hash of provider ID plus sorted tracked team/project/initiative IDs and is displayed by `pnpm ct delivery scopes`. A baseline is an immutable pointer to one snapshot and that scope ID. The operator creates it with `pnpm ct delivery baseline create --scope <provider-scope-id>`. Creating a later baseline closes the previous baseline and starts a new comparison period; it never rewrites prior scope history.

## 21. Progress and anomaly rules

Planned progress is:

```text
completed estimated points / total estimated points in snapshot scope
```

For Linear, a work item is complete only when its workflow-state type is `completed`. State type `canceled` is excluded from the current numerator and denominator and is reported as scope removed when it existed in the active baseline. All other state types are incomplete. Unestimated items are excluded from estimate numerator/denominator but included in the separately labeled issue-count ratio and estimate-coverage denominator.

When estimates are incomplete:

- Show estimate coverage.
- Show an independently labeled completed-issue count ratio.
- Never blend estimate and count denominators.

Deterministic anomalies:

- PR missing a valid ticket link.
- Multiple ticket identifiers on one PR.
- Completed issue with open/unmerged linked PR.
- Merged PR linked to incomplete issue.
- Blocked issue with active linked work.
- Scope added or removed after the recorded baseline.
- Stalled requested review: review is still requested and no head commit, review, issue/PR comment, or check-state transition has occurred for `delivery.stalledReviewHours` (48 by default).
- Target date passed with incomplete scoped work.

Cross-repository implications remain a 2A concern. The provider link can supply candidate ticket matches, but specialist judgment remains separate.

## 22. Delivery interpretation

Every anomaly has a stable identity from `anomaly type + primary entity IDs` and a fact hash over the fields used by its rule. An optional Cursor delivery-analysis job runs only when an identity first appears, its fact hash changes, or it resolves. Repeated connector observations with the same identity and fact hash do not create another run.

It receives a bounded snapshot containing source facts and anomaly records, not repository source trees. It returns:

```json
{
  "schemaVersion": 1,
  "asOf": "ISO-8601 timestamp",
  "summary": "string",
  "risks": [
    {
      "severity": "high|medium|low",
      "statement": "string",
      "factIds": ["string"],
      "inference": true
    }
  ],
  "unknowns": ["string"]
}
```

Agent interpretation never changes progress math, issue status, scope, or deterministic anomaly state. Delivery-analysis output is displayed only in the Delivery Map; Phase 2B never inserts it into GitHub review comments or publication drafts.

## 23. Delivery Map

The Delivery Map is a structured hierarchy, not a dense graph:

- Initiative or project.
- Milestone when supported.
- Work items.
- Linked PR state by repository.

It shows:

- Estimate progress and coverage.
- Scope movement since baseline.
- Blockers and stale decisions.
- Missing/ambiguous links.
- Source freshness separately for GitHub and the provider.
- Deterministic anomalies separately from inferred risks.

No briefings or natural-language query bar are included.

## 24. Staleness and failure

A review draft records the provider context hash used, if any. A provider update does not automatically supersede code findings. It marks delivery context stale in the workbench. Publication remains allowed because the code head is unchanged and Phase 2B delivery interpretations are never publishable review content.

Provider failure:

- Preserves last-known snapshots.
- Shows stale/degraded coverage.
- Never presents an unqualified all-clear.
- Does not block Phase 2A code review.

GitHub/provider disagreement is displayed and never auto-reconciled.

## 25. 2B tests and acceptance

Tests cover connector pagination/checkpointing, credential isolation, ticket extraction, exact scope closure, hierarchy resolution, five-minute observations versus scheduled/manual snapshots, baseline replacement without history mutation, snapshot `asOf` semantics, completion/canceled normalization, estimate math, missing estimates, stalled-review age, anomaly identity/fact-hash changes, source disagreement, stale provider state, and strict analysis output.

2B is accepted when:

- Installations without a provider run unchanged.
- Linear configuration requires no application-code changes and no token in a file.
- Displayed links, hierarchy, progress, and anomalies reconcile exactly to source fixtures at the snapshot `asOf`.
- Daily/manual snapshots and immutable baselines follow their configured scope and timing exactly.
- Estimate and issue-count measures are never blended.
- Cursor interpretations cite only snapshot facts and cannot alter deterministic state.
- Provider failure remains visible and never blocks PR review.
- No Linear credential appears in Cursor, Docker, logs, SQLite, or artifacts.

# Phase 2C — Bot Publication and Sandboxed Checks

## 26. Goal

Add two separately gated capabilities:

1. Publish approved analysis through a dedicated GitHub bot identity while the principal retains final disposition.
2. Run a small, explicit set of repository checks in an ephemeral Docker sandbox when CI evidence is insufficient.

Either capability may be enabled without the other.

## 27. Bot credential and identity

Add:

```text
pnpm ct credentials set github-bot <alias>
pnpm ct credentials check github-bot <alias>
pnpm ct credentials delete github-bot <alias>
```

The credential is a dedicated fine-grained bot token stored in the macOS Keychain. It must be restricted to configured repositories with pull-request read/write permission and no administration or contents-write permission.

The publisher retrieves the token only for a bot `gh api` subprocess and passes it through a single-process environment value that is never logged or inherited elsewhere. The existing principal `gh` identity continues to perform approve/request-changes.

Doctor verifies:

- Bot login identity.
- Read access to every enabled repository.
- Bot identity differs from the configured principal.

GitHub does not provide a reliable non-mutating proof of fine-grained pull-request write permission. Before enabling bot publication for a repository, the operator runs `pnpm ct publication bot verify-write --repo <owner/repo>`. After explicit confirmation, the command creates and immediately deletes a uniquely marked comment on a designated open test PR selected by the operator. Creation and deletion are separate short-lived publisher subprocesses; each receives the bot credential only for its single API operation, and both are audited. Until this canary succeeds, doctor reports write permission as `unverified` and bot publication remains disabled for that repository.

## 28. Bot publication flow

1. The workbench separates bot analysis/comment operations from the principal disposition.
2. The principal previews and approves both sets.
3. The publisher revalidates the head SHA and exact content hashes.
4. The bot posts approved summary and inline comments.
5. The principal's authenticated identity performs the final review disposition.
6. Audit records actor, operation, response, and idempotency key separately.

If bot publication partially fails, the final disposition is blocked until the principal chooses to retry or explicitly continue without the missing bot operations. Continuing is a new audited approval.

Bot publication starts in shadow mode and does not replace Phase 1 user-identity publication until its acceptance gates pass.

## 29. Sandbox check catalog

Repository checks are versioned organization configuration. The schema is:

```typescript
type SandboxCheck = {
  id: string
  repositoryId: string
  image: string // must match ^[^@]+@sha256:[a-f0-9]{64}$
  command: [string, ...string[]]
  timeoutSeconds: number // 1 through 900
  cpu: number // 0.5 through 2
  memoryMb: number // 256 through 4096
  network: 'none'
}
```

Every image must be pinned by a real digest, and every command must be an argument array rather than a shell string. Phase 2C ships with an empty check catalog. An organization adds a check only after supplying a repository-specific image that already contains the required runtime and dependencies; jobs never install dependencies from the network.

Checks are on demand in 2C. Policy may recommend a check but may not automatically run one. The principal must select and confirm the exact command before execution.

Heavy/serviceful workflows remain excluded:

- Full `pba-microservices` build/test.
- Docker image builds and vulnerability scans.
- Compose stacks.
- E2E suites.
- Deployment commands.
- Commands requiring Azure, package-registry, ABP, application, or end-user credentials.

These remain CI-only or manually run outside the control tower.

## 30. Sandbox execution

Doctor checks the Docker client, daemon, architecture, free disk, and ability to run a pinned no-network smoke image. Image acquisition happens during an explicit administrator enablement step, before a check is available to jobs. Registry credentials are not mounted or passed to the check container.

Before Docker starts, deterministic code creates a filtered input tree from the reviewed Git tree:

1. Enumerate tracked entries at the reviewed SHA.
2. Exclude every application-default and organization-catalog `security.protectedPaths` match.
3. Exclude symlinks, Git metadata, submodule contents, and special files.
4. Copy only allowed regular files while preserving repository-relative paths.
5. Write an input manifest containing source blob hashes and excluded path names, never excluded contents.

The launcher mounts only this filtered input tree. It never mounts the original worktree.

The launcher:

- Creates a fresh container per check.
- Mounts the filtered input tree read-only.
- Provides an empty writable scratch directory.
- Passes no host environment variables or credential mounts. The only runtime values added by the launcher are `CI=true` and a scratch `HOME`; image-defined non-secret environment defaults may remain.
- Sets network to none by default.
- Sets CPU, memory, process-count, output-size, and wall-time limits.
- Runs as an unprivileged UID/GID.
- Disables privileged mode, host PID/IPC, Docker socket, and additional capabilities.
- Removes the container and scratch directory after completion or restart recovery.

No check may access protected source files, `.env`, Keychain, SSH agent, `gh`, Cursor authentication, package credentials, or cloud credentials.

The supported global maximum is one sandbox check. Cursor agents and sandbox checks use separate bounded pools.

## 31. Check evidence and failure

Check output is capped at 10 MB, redacted, content-hashed, and attached to the exact PR head SHA and check-catalog hash.

Statuses:

- `queued`
- `running`
- `passed`
- `failed`
- `timed_out`
- `cancelled`
- `unavailable`

A failed or unavailable sandbox never becomes a pass and never hides CI evidence. New commits make the result stale.

The principal may rerun or cancel. There is no automatic retry.

## 32. 2C tests and acceptance

Bot tests cover credential aliasing, actor separation, content/SHA/idempotency guards, partial failure, explicit continue-without-bot approval, and token redaction.

Sandbox tests cover pinned images, command arrays, protected-path and symlink exclusion, input blob manifests, read-only filtered source, no inherited host environment, fixed `CI`/`HOME`, no network, non-root user, CPU/memory/PID/time/output limits, cancellation, restart cleanup, and stale results.

2C is accepted when:

- Bot analysis is posted only after exact approval and always attributed to the configured bot.
- Final disposition is always attributed to the configured principal.
- Neither identity can perform the other's operation path.
- No bot token appears outside the keychain and the short-lived publisher subprocess currently performing one explicitly authorized bot API operation.
- Only catalogued commands can run.
- Containers cannot write source, access host credentials or Docker socket, or use the network.
- At most one sandbox check runs.
- Sandbox failure or unavailability never yields an unqualified pass.

## 33. Sequential rollout

### 2A rollout

1. Historical specialist corpus.
2. Live specialist shadow with outputs hidden from publication.
3. Visible specialist results after quality gates.

### 2B rollout

1. Provider connector and reconciliation fixtures.
2. Live read-only snapshots with delivery interpretations disabled.
3. Delivery Map and anomaly interpretation after source-accuracy gates.

### 2C rollout

1. Bot publication shadow.
2. Gated bot comments.
3. Docker smoke catalog.
4. Per-repository check enablement one command at a time.

Failure of a later increment never disables a previously healthy increment.

## 34. Phase 2 completion criteria

Phase 2 is complete only when 2A, 2B, and 2C have independently passed their acceptance criteria and Phase 1 criteria continue to hold.

Completion does not authorize:

- Autonomous review disposition or merge.
- Autonomous Linear updates.
- Arbitrary agent-generated commands.
- Networked sandbox commands.
- Agent ranking.
- Briefings.
- Command bar.
- Silent profile learning.

Any of those requires a new design specification based on observed usage, not an extension hidden inside Phase 2 implementation.
