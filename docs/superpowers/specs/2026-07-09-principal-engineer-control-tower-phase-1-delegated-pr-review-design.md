# Principal Engineer Control Tower — Phase 1: Delegated PR Review

**Date:** 2026-07-09  
**Revised:** 2026-07-10  
**Status:** Approved for implementation  
**Audience:** Implementation agents and principal engineers operating the product locally  
**Scope:** A complete, independently deliverable first phase. Phase 2 begins only after the rollout gates in this document pass.

## 1. Summary

Build a single-operator, local-first control tower that discovers GitHub pull requests requiring a principal engineer's attention and prepares evidence-backed review drafts with Cursor CLI agents.

The product is a generic engine. Organization-specific repositories, priorities, prompts, and review judgment are configuration, not application code. Array's four repositories are the initial starter profile, but another principal engineer can onboard different repositories without changing or forking the application.

Phase 1 is deliberately CI-first:

- GitHub metadata, changed-file names, review-request state, and check summaries are collected for every tracked PR. Full diffs, discussion, and file contents are fetched only when an analysis job starts.
- A Cursor run starts automatically only for an explicit review request or a configured high-priority match. Other eligible PRs remain visible and can be analyzed on demand.
- A source-only worktree is created just in time for an active review job and removed afterward.
- Phase 1 never installs repository dependencies, copies repository environment files, or executes repository code.
- Existing GitHub checks are the only dynamic build and test evidence.

All probabilistic or AI behavior runs through the authenticated local Cursor CLI. GitHub discovery, policy evaluation, state transitions, authorization, and publication remain deterministic application code.

## 2. Outcomes

Phase 1 must:

1. Give the principal a complete, fresh queue of configured or explicitly requested reviews.
2. Produce a useful review draft without requiring the principal to prepare a checkout or local runtime.
3. Reduce routine review verification to approximately one to two minutes.
4. Never execute PR code or expose host credentials to an analysis agent.
5. Never publish an external action without exact, recorded human approval.
6. Let another engineer install and personalize the product without application-code changes.

## 3. Product invariants

1. **Deterministic coverage, selective execution.** Deterministic code discovers every eligible item. Eligibility does not imply an immediate Cursor run.
2. **Evidence before confidence.** Every finding cites inspected evidence and distinguishes observation, inference, and unknown.
3. **Human authority.** No review, comment, approval, or request-changes action is published without an explicit preview and approval.
4. **CI first.** Local build or test execution is not part of Phase 1.
5. **Cursor is the only AI harness.** No model-provider SDK, direct model API, or second agent runtime is permitted.
6. **Configuration is portable; secrets are not configuration.** Shared defaults and profile content are versionable. Machine paths and credentials are local.
7. **The app owns its runtime state.** It does not switch branches, add worktrees to, or otherwise mutate an engineer's development checkout.
8. **Failures stay visible.** A connector, checkout, agent, validation, or publication failure never removes the item from the queue.

## 4. Goals and non-goals

### Goals

- Support multiple independent Git repositories with different default branches and toolchains.
- Discover explicit review requests across configured GitHub organizations and policy-matched PRs in configured repositories.
- Provide deterministic priority tiers and a bounded hybrid auto-analysis policy.
- Run one primary Cursor review session per selected PR head SHA.
- Preserve a local audit trail of source state, agent work, human edits, approvals, and publications.
- Start in shadow mode and graduate to gated publishing only after measured quality gates pass.

### Durable non-goals

- Continuous cloud operation while the operator's machine is offline.
- Slack, email, calendar, or other notification ingestion.
- Reviewing every PR in an organization.
- Autonomous approvals, requested changes, merges, or Linear mutations.
- Replacing GitHub as the code-review system.
- Productivity scoring.
- Silent persona learning.
- Arbitrary generated code or SQL execution.
- Microservices, a message broker, graph database, vector database, or container orchestration platform.

### Deferred beyond Phase 1

- Linear and delivery intelligence.
- Specialist or cross-repository agent passes.
- Bot-authored comments.
- Sandboxed repository commands.
- Agent-based queue ranking.
- Daily or weekly briefings.
- Natural-language command bar.
- In-app persona governance.

## 5. Supported environment and distribution

The first supported distribution is a source checkout on macOS. The application must not hard-code its own checkout path or require membership in a VS Code workspace.

Required tools:

- Node.js 22 or newer.
- pnpm 10 or newer.
- Git 2.40 or newer.
- GitHub CLI 2.70 or newer, authenticated to every configured GitHub host.
- Cursor Agent CLI authenticated with the operator's Cursor account.

The implementation must expose these commands:

```text
pnpm ct doctor
pnpm ct init
pnpm ct start
pnpm ct stop
pnpm ct status
```

`pnpm ct start` starts the daemon and prints the loopback UI URL. Automatic startup through `launchd` is an optional post-pilot convenience, not a Phase 1 architecture dependency.

The application repository may remain anywhere, including `/Users/sshukla/Desktop/src/assistant`. On the initial machine, the local config points to `/Users/sshukla/Desktop/src/array-hq`. Adding the control tower folder to `array-hq.code-workspace` is optional and has no runtime effect.

## 6. Configuration and profile model

Configuration has three non-overlapping layers. There is no generic deep-merge algorithm.

### 6.1 Shared organization catalog

`config/organization.json` is committed with the application. It defines repository identities and organization-wide defaults, but never absolute paths or credentials.

```json
{
  "schemaVersion": 1,
  "github": {
    "host": "github.com",
    "organizations": ["Powered-By-Array"],
    "pollIntervalSeconds": 300
  },
  "ticketExtractors": [
    {
      "id": "linear-key",
      "sources": ["title", "body", "branch"],
      "pattern": "\\b[A-Z][A-Z0-9]+-[0-9]+\\b"
    }
  ],
  "security": {
    "protectedPaths": [
      ".env",
      ".env.*",
      ".cursor/mcp.json",
      "appsettings.secrets.json",
      "appsettings.Local.json",
      "*.pem",
      "*.key",
      "*.pfx",
      "deploy.*.parameters.json",
      "deploy.*.parameters.jsonc"
    ]
  },
  "reviewDefaults": {
    "jobTimeoutSeconds": 1200,
    "retentionDays": 30,
    "maxStorageBytes": 10737418240
  },
  "repositories": [
    {
      "id": "pba-webapp",
      "github": "Powered-By-Array/pba-webapp",
      "defaultBranch": "main",
      "resourceClass": "medium"
    },
    {
      "id": "pba-agents",
      "github": "Powered-By-Array/pba-agents",
      "defaultBranch": "main",
      "resourceClass": "medium"
    },
    {
      "id": "pba-microservices",
      "github": "Powered-By-Array/pba-microservices",
      "defaultBranch": "dev",
      "resourceClass": "heavy"
    },
    {
      "id": "pba-infra",
      "github": "Powered-By-Array/pba-infra",
      "defaultBranch": "dev",
      "resourceClass": "light"
    }
  ]
}
```

Repository IDs are stable keys. A catalog edit is schema-validated at startup. Auto-discovery may propose catalog changes but never silently activates a repository.

Ticket extractors run deterministically in Phase 1 and store normalized identifiers as opaque metadata. They do not contact or interpret Linear. Phase 2A may use exact identifier equality for candidate related work, and Phase 2B resolves the same identifiers through a delivery-provider adapter.

`security.protectedPaths` owns the complete organization-level sensitive-path denylist. Application hardcoded defaults are always unioned with this list and cannot be removed by a profile.

### 6.2 Portable engineer profile

The active profile is a directory. The default location is `~/.control-tower/profile`; it may be a separate private Git repository, but Git is not required for operation.

```text
profile/
├── profile.json
├── policy.json
├── persona.md
├── prompts/
│   └── pr-review.md
├── skills/
│   └── control-tower-pr-review/
│       └── SKILL.md
└── repository-guidance/
    ├── pba-webapp.md
    ├── pba-agents.md
    ├── pba-microservices.md
    └── pba-infra.md
```

`profile.json` selects repositories and identifies the operator:

```json
{
  "schemaVersion": 1,
  "profileId": "shubh-array",
  "githubLogin": "shubh-array",
  "activeRepositoryIds": [
    "pba-webapp",
    "pba-agents",
    "pba-microservices",
    "pba-infra"
  ]
}
```

`policy.json` defines deterministic attention and execution rules:

```json
{
  "schemaVersion": 1,
  "autoAnalyze": {
    "explicitReviewRequests": true,
    "priorityTiers": ["p0", "p1"]
  },
  "repositories": {
    "pba-webapp": {
      "eligiblePaths": ["src/**"],
      "priorityRules": [
        { "paths": ["src/api-clients/**", "src/lib/auth/**"], "tier": "p1" }
      ]
    },
    "pba-agents": {
      "eligiblePaths": ["sdk/**", "services/**"],
      "priorityRules": [
        { "paths": ["sdk/src/auth/**", "services/shared/**"], "tier": "p1" }
      ]
    },
    "pba-microservices": {
      "eligiblePaths": ["services/**", "packages/**"],
      "priorityRules": []
    },
    "pba-infra": {
      "eligiblePaths": ["payg-array-apps/**", "array-internal-apps/**"],
      "priorityRules": []
    }
  }
}
```

An explicit review request is eligible even when its repository is not active, provided the GitHub credential can read it. Such an item is remote-evidence-only until the operator explicitly registers the repository.

Every review job snapshots and hashes the exact profile files used. The hash, not a Git commit, is the authoritative audit version. Git history is an optional governance and sharing mechanism.

### 6.3 Local machine config

`~/.control-tower/config.json` is local and must never be committed. It contains only machine-specific paths and limits:

```json
{
  "schemaVersion": 1,
  "profileDirectory": "/Users/sshukla/.control-tower/profile",
  "dataDirectory": "/Users/sshukla/.control-tower/data",
  "workspaceRoots": ["/Users/sshukla/Desktop/src/array-hq"],
  "repositoryPaths": {
    "pba-webapp": "/Users/sshukla/Desktop/src/array-hq/pba-webapp",
    "pba-agents": "/Users/sshukla/Desktop/src/array-hq/pba-agents",
    "pba-microservices": "/Users/sshukla/Desktop/src/array-hq/pba-microservices",
    "pba-infra": "/Users/sshukla/Desktop/src/array-hq/pba-infra"
  },
  "cursor": {
    "binary": "agent",
    "model": "composer-2.5-fast",
    "maxConcurrentAgents": 1
  },
  "worktrees": {
    "maxMaterialized": 4
  },
  "publication": {
    "mode": "shadow"
  }
}
```

Local repository paths are used for onboarding validation and guidance discovery only. They are not the authoritative source for a review because a development checkout may be dirty, on another branch, or changed by workspace hooks.

Only `CONTROL_TOWER_CONFIG` may override the local-config path. The control tower defines no secret-bearing environment variables and requires no application `.env` file.

### 6.4 Validation

All JSON documents are validated with versioned schemas before the daemon starts. Unknown keys are errors. A missing active repository, duplicate GitHub identity, invalid glob, unknown priority tier, unavailable model, or path/remote mismatch produces an actionable error and does not partially activate the invalid entry.

Schema migrations create a backup before changing local files. An older unsupported schema blocks startup and prints the exact migration command.

## 7. Credentials and dependency integration

Secrets stay in the credential stores already used by their owning tools:

| Dependency | Authentication | Consumer | Persisted by control tower |
| --- | --- | --- | --- |
| Cursor | Existing `agent login` session | Cursor child process | No |
| GitHub API and publication | Existing `gh auth login` keychain entry | `gh` adapter | No |
| Git transport | Existing SSH agent or Git credential helper | mirror/worktree adapter | No |
| Local browser API | Random daemon session secret | browser and daemon | Memory only |

Linear and bot credentials do not exist in Phase 1.

The application never calls `gh auth token`, copies a token into a child environment, or stores credentials in SQLite. It constructs each child environment from an empty object:

- Common non-secret variables: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `USER` when present.
- Cursor process: common variables only. Phase 1 requires stored `agent login` authentication and explicitly removes `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`.
- `gh` process: common variables plus `GH_HOST` and `GH_CONFIG_DIR` when explicitly configured. It removes `GH_TOKEN`, `GITHUB_TOKEN`, and all other `GH_*` values.
- Git/SSH process: common variables plus `SSH_AUTH_SOCK`. It removes `GIT_ASKPASS`, `SSH_ASKPASS`, `GIT_SSH_COMMAND`, and repository-defined environment.

The publisher launches its own `gh` process under the same GitHub allowlist. No analysis process inherits GitHub, SSH, Linear, package-registry, cloud, or repository environment variables.

Logs redact authorization headers, URL credentials, values matching known secret formats, and all environment values. Agent transcripts and artifacts never contain environment dumps.

## 8. Onboarding

### 8.1 Doctor

`pnpm ct doctor` is read-only and checks:

1. Supported operating system and required tool versions.
2. `agent status --format json` reports `isAuthenticated: true`.
3. `agent models` includes the selected model.
4. `gh auth status` and `gh api user` succeed for each configured host.
5. Each configured local repository path exists, is a Git repository, and its `origin` matches the catalog.
6. The profile and policy schemas are valid.
7. The data directory is writable and has at least 10 GB free.
8. The loopback API port can be allocated.

Docker is reported as optional and is never a Phase 1 failure.

The initially verified machine has:

- Cursor CLI `2026.07.09-a3815c0`, authenticated on a Team subscription.
- GitHub CLI `2.91.0`, authenticated as `shubh-array`.
- Git `2.50.1`, Node `25.9.0`, pnpm `11.11.0`, and SQLite `3.51.0`.
- Docker client and daemon `28.2.2`; Docker remains unused in Phase 1.

The implementation supports Cursor CLI `2026.07.09-a3815c0` as its initial tested version. Older versions fail doctor. Newer versions produce a compatibility warning and require the built-in CLI smoke check before agent execution is enabled.

### 8.2 Init

`pnpm ct init`:

1. Creates the local config and profile from examples if absent.
2. Scans each configured workspace root for immediate child Git repositories.
3. Maps remotes to catalog entries and proposes additions or path corrections.
4. Asks the engineer to confirm active repositories, GitHub login, model, and auto-analysis policy.
5. Writes only the local config and profile directory.
6. Runs doctor.
7. Starts in shadow mode.

Init never edits a product repository, reads `.env` contents, or creates a worktree.

### 8.3 Time target

An engineer with installed and authenticated prerequisites must reach a healthy empty Focus Queue within 15 minutes, excluding network time for a first selected PR's partial mirror.

## 9. Architecture

Phase 1 is one local TypeScript application:

- A Node.js daemon hosts the scheduler, adapters, worker pool, local API, and static React client.
- SQLite stores structured state.
- The filesystem stores bounded diffs, transcripts, and immutable review artifacts by content hash.
- `gh` and Git subprocess adapters provide deterministic GitHub and checkout operations.
- Cursor CLI subprocesses provide all AI analysis.

Runtime data lives under the configured data directory:

```text
data/
├── control-tower.sqlite
├── artifacts/
├── jobs/
├── mirrors/
├── worktrees/
└── logs/
```

The browser never calls GitHub, Git, or Cursor directly.

## 10. Components

### 10.1 GitHub adapter

The adapter uses authenticated `gh` commands and machine-readable JSON.

It discovers:

- Open PRs requesting review from the configured GitHub login.
- Open PRs in active repositories.
- PR metadata, head/base SHAs, authors, reviewers, labels, changed files, commits, comments, reviews, and check runs.

The initial discovery contracts are:

```text
gh search prs --owner <org> --review-requested=@me --state=open --json ...
gh pr list --repo <owner/repo> --state open --json ...
gh pr view <number> --repo <owner/repo> --json ...
gh pr diff <number> --repo <owner/repo>
gh api rate_limit
```

The implementation may replace individual commands with `gh api` when pagination or fields require it, but it may not extract and persist the underlying token.

Polling defaults to five minutes with checkpointed pagination and an on-demand refresh. Rate-limit exhaustion preserves last-known state, exposes freshness, and pauses nonessential enrichment.

### 10.2 Normalizer and work graph

SQLite is relational. Phase 1 stores:

- GitHub repositories, PRs, commits, files, checks, reviews, and comments.
- Attention items and their deterministic reasons.
- Review jobs, context bundles, Cursor runs, findings, drafts, approvals, publications, and audit events.
- Content hashes for catalog, profile, policy, persona, prompts, and repository guidance.

Large payloads are filesystem artifacts referenced by hash. Phase 1 does not reserve speculative Phase 2 columns; future changes use normal versioned migrations.

### 10.3 Policy evaluator

Policy deterministically computes:

- Eligibility.
- Priority tier.
- Auto-analysis versus on-demand status.
- The exact policy subset relevant to a job.

Eligibility reasons:

1. Explicit review request.
2. Active repository and changed-file match.

Auto-analysis reasons:

1. Explicit review request when enabled.
2. A configured auto-analysis priority tier.

Ranking is `priority tier`, then explicit-request first, then oldest request/update. No agent ranks or hides items.

### 10.4 Orchestrator

Discovery and execution are separate records.

Attention states:

- `monitoring`
- `ready_for_analysis`
- `analysis_queued`
- `draft_ready`
- `needs_human`
- `completed`
- `closed`

Job states:

- `queued`
- `preparing_context`
- `preparing_source`
- `running_agent`
- `validating_output`
- `draft_ready`
- `awaiting_approval`
- `publishing`
- `published`
- `failed`
- `cancelled`
- `superseded`

A review job identity is:

```text
github repository + PR number + head SHA
+ review-relevant policy hash + profile content hash + model ID
```

Retention settings and unrelated repository policy do not affect the identity. A 30-second debounce coalesces rapid PR updates. A new head SHA cancels a queued job and supersedes a completed draft. Running jobs receive cancellation, then the new job is queued.

Default agent concurrency is one. The supported configurable maximum is two. The queue is fair across repositories within priority tiers and runs no more than one job per PR head.

### 10.5 Source workspace manager

Tracking a PR creates no checkout.

When a review job starts, the manager:

1. Creates or updates a control-tower-owned partial bare mirror under `data/mirrors/<owner>/<repo>.git`.
2. Fetches the PR head through GitHub's pull ref into a control-tower namespace.
3. Verifies the fetched commit equals the recorded head SHA.
4. Creates a detached source-only worktree under `data/worktrees/<job-id>`.
5. Skips all `.cursor/worktrees.json` setup and never installs dependencies.
6. Removes the worktree after the immutable review artifacts are stored.

The manager never uses a developer checkout as the review source and never copies untracked files. It keeps at most four materialized worktrees and removes abandoned worktrees after restart. When total control-tower storage approaches the configured 10 GB limit, the storage manager removes expired artifacts, abandoned worktrees, and least-recently-used inactive mirrors in that order; it never removes an active job's source or evidence.

Fork PRs use GitHub's pull ref and do not require direct access to the contributor's fork.

### 10.6 Context builder

The builder creates an immutable job directory:

```text
jobs/<job-id>/
├── job.json
├── github/
│   ├── pr.json
│   ├── diff.patch
│   ├── checks.json
│   └── discussion.json
├── profile/
│   ├── persona.md
│   ├── prompt.md
│   ├── policy.json
│   └── repository-guidance.md
└── .cursor/
    ├── cli.json
    ├── hooks.json
    ├── hooks/
    │   └── protect-inputs.mjs
    └── skills/
        └── control-tower-pr-review/
            └── SKILL.md
```

The context records unavailable or truncated data explicitly. Repository guidance is copied only from the approved profile and allowlisted repository files. Arbitrary repository rules, hooks, MCP configuration, and skills are not activated automatically.

The generated Cursor permissions deny:

- All writes and deletes.
- All shell commands.
- All MCP tools.
- Reads of `.env*`, `.cursor/mcp.json`, `appsettings.secrets.json`, private keys, certificates, deployment credentials, and configured sensitive paths.

The `beforeReadFile` protection hook is `failClosed: true`. Untrusted PR and repository content cannot alter this job workspace.

### 10.7 Cursor CLI adapter

The adapter executes:

```text
agent
--print
--mode=ask
--sandbox enabled
--trust
--workspace <absolute-job-directory>
--add-dir <absolute-source-worktree>
--model <doctor-validated-model-id>
--output-format stream-json
<single positional prompt>
```

This exact surface was verified against CLI `2026.07.09-a3815c0`. `--add-dir` was verified to expose an additional repository to read tools. `stream-json` was verified as NDJSON containing an initialization event with session ID and model, assistant events, and a terminal result with status, result text, timing, request ID, and usage.

The adapter:

- Passes the prompt as one argument; it does not depend on stdin, `@file`, undocumented flags, or plugin loading.
- Parses each NDJSON line independently and ignores unknown event types.
- Records the session ID from the init event and cross-checks the terminal result.
- Treats non-zero process exit, `is_error: true`, missing terminal result, invalid JSON result text, or schema mismatch as failure.
- Enforces the configured 20-minute timeout in the parent process.
- Sends `SIGTERM`, waits five seconds, then sends `SIGKILL`.
- Does not automatically retry an agent run. A human retry creates a new run under the same job.
- Stores stdout/stderr after redaction and truncates each stream at 10 MB.

The output text must be one JSON object matching:

```json
{
  "schemaVersion": 1,
  "summary": {
    "intent": "string",
    "implementation": "string"
  },
  "evidence": [
    {
      "id": "E1",
      "kind": "diff|file|check|comment|commit",
      "source": "string",
      "observation": "string"
    }
  ],
  "checks": [
    {
      "name": "string",
      "status": "success|failure|pending|skipped|unknown",
      "source": "github"
    }
  ],
  "findings": [
    {
      "severity": "blocking|high|medium|low",
      "confidence": "high|medium|low",
      "title": "string",
      "rationale": "string",
      "file": "string",
      "location": {
        "side": "LEFT|RIGHT",
        "line": 1,
        "startSide": null,
        "startLine": null
      },
      "evidenceIds": ["E1"],
      "draftComment": "string"
    }
  ],
  "unknowns": ["string"],
  "recommendedDisposition": "approve|comment|request_changes|needs_human",
  "draftSummary": "string"
}
```

Every finding requires at least one valid evidence ID. `location` is required only for an inline draft comment; `side` and `line` use GitHub's diff-coordinate semantics, and optional `startSide`/`startLine` identify a multiline range. The context builder supplies the patch required to validate that the location exists on the reviewed head/base pair. Invalid locations remain summary findings and are never submitted as inline comments. Schema validation is deterministic; malformed output never becomes a draft.

### 10.8 Focus Queue and Review Workbench

The Focus Queue is the default route:

- **Now:** at most three highest-priority actionable items.
- **Next:** other eligible items, including on-demand analysis candidates.
- **Monitor:** pending checks, drafts superseded by new commits, and non-actionable tracked work.

Every item shows its eligibility reason, priority reason, analysis mode, source freshness, CI state, current job state, and one primary action.

The Review Workbench has:

1. **Understand:** intent, changed scope, commits, and checks.
2. **Verify:** evidence, findings, confidence, and unknowns.
3. **Act:** editable draft comments and disposition.

The UI always states that CI results were observed and local checks were not run.

### 10.9 Local API

The daemon binds only to loopback. It serves static UI assets and JSON endpoints for queue state, job control, drafts, approval, publication, health, and audit.

At startup it creates a random session secret and delivers it in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie through the initial loopback page response. State-changing requests require same-origin checks and a single-use action token created by an explicit UI gesture and valid for 60 seconds. The API rejects non-loopback host headers and all cross-origin requests.

### 10.10 Publisher

`publication.mode` is `shadow` by default and disables the publisher. After rollout gates pass, the operator runs `pnpm ct publication enable`; the command reruns doctor, displays the active identity and gate evidence, requires confirmation, and writes `publication.mode: "gated"` to local machine config. `pnpm ct publication disable` immediately restores shadow mode.

When gated publishing is enabled, the publisher is the only component allowed to mutate GitHub. Before every operation it verifies:

- A single-use recorded approval created within the previous 10 minutes exists.
- The current PR head SHA equals the reviewed SHA.
- The exact content hash equals the approved draft hash.
- The authenticated GitHub login equals the configured operator.
- The idempotency key has not completed.

Phase 1 uses the principal's GitHub identity for comments and final disposition. Partial failure records each completed operation and retries only incomplete operations after renewed approval.

An approval is invalidated by draft edits, a new PR head, profile/policy change, authenticated-login change, publication-mode change, daemon restart, first publication attempt, or the 10-minute TTL. A partial-failure continuation always requires a newly previewed approval.

## 11. Core flows

### 11.1 Discover

1. Poll explicit review requests and active repositories.
2. Normalize source facts and update checkpoints.
3. Retrieve changed-file names, review-request state, and check summaries for policy evaluation and queue display.
4. Compute eligibility, priority, and auto-analysis deterministically.
5. Upsert attention items.
6. Queue only auto-analysis items; leave all others visible.

### 11.2 Analyze

1. Freeze PR head SHA, relevant policy hash, profile hash, and model.
2. Fetch full diff, commits, discussion, reviews, and detailed checks for the selected PR.
3. Prepare the isolated job workspace.
4. Materialize the control-tower-owned source worktree.
5. Launch one Cursor CLI review process.
6. Validate the terminal result and strict review schema.
7. Store immutable evidence and draft artifacts.
8. Remove the worktree.
9. Show the draft or visible failure in the Focus Queue.

### 11.3 Publish

1. The principal verifies and edits the draft.
2. The UI previews exact external operations.
3. Explicit approval records the content and head hashes.
4. The publisher revalidates identity, SHA, content, and idempotency.
5. It posts approved comments and the selected review disposition.
6. It records GitHub responses and structured draft feedback.

## 12. Failure handling

- **GitHub unavailable or rate-limited:** preserve last-known state, show freshness, back off with jitter, and never claim complete coverage.
- **Laptop sleep or daemon restart:** recover checkpoints transactionally, catch up before declaring freshness, clean abandoned job processes and worktrees.
- **Mirror/fetch failure:** keep the item visible and provide remote evidence; do not substitute a developer checkout.
- **Cursor auth/model/version failure:** doctor blocks new runs while discovery remains active.
- **Agent timeout/crash/malformed output:** mark the run failed, retain bounded logs, remove the worktree, and offer manual retry.
- **New PR commit:** cancel or supersede the old job and never publish its draft.
- **Publication partial failure:** retain per-operation completion and require a fresh preview before continuing.
- **Configuration error:** retain the last valid runtime configuration; do not partially apply an invalid edit.

## 13. Security model

PR text, code, comments, CI output, repository documentation, and repository-local Cursor assets are untrusted data.

They cannot:

- Change system, profile, or skill instructions.
- Change policy or permissions.
- Activate MCP servers, hooks, setup scripts, or subagents.
- Execute repository code.
- Read protected files or host credentials.
- Enable publication.

A Git worktree is checkout isolation, not a security boundary. Security comes from no repository execution, an isolated primary workspace, ask mode, sandboxing, explicit permissions, a fail-closed read hook, sanitized child environments, and a human publication gate.

Sensitive default patterns include:

```text
.env
.env.*
.cursor/mcp.json
appsettings.secrets.json
appsettings.Local.json
*.pem
*.key
*.pfx
deploy.*.parameters.json
deploy.*.parameters.jsonc
```

The context builder inventories filenames but never reads or sends protected contents.

## 14. Testing and evaluation

### Deterministic tests

- Config schemas, migrations, repository mapping, and invalid-config rollback.
- `gh` fixture parsing, pagination, checkpoints, rate limits, retries, and deduplication.
- Exact eligibility, priority, hybrid auto-analysis, and fairness.
- Job identity, debounce, cancellation, retry, restart, and supersession.
- Mirror/worktree creation, fork refs, SHA verification, crash cleanup, and disk limits.
- Cursor NDJSON success/error/truncation fixtures, timeout escalation, malformed result, and schema validation.
- Protected-path hook and child-environment filtering.
- Publisher approval, identity, SHA, content, idempotency, and partial-failure guards.
- End-to-end tests with fake `gh`, Git, Cursor, credential, and publisher adapters.

### Agent evaluation corpus

Maintain versioned historical and synthetic single-PR cases covering:

- Correctness and maintainability findings.
- Benign changes with no findings.
- Failed/pending CI and incomplete context.
- Large or truncated diffs.
- Prompt injection through every untrusted input.
- Sensitive tracked files that must not be read.

Each case defines required findings, forbidden claims, acceptable uncertainty, required evidence, and disposition range.

Measure finding recall, false-positive rate, evidence validity, unsupported claims, draft usefulness, and repeated-run stability.

### Rollout

1. **Offline fixtures:** deterministic and agent corpus gates.
2. **Historical replay:** current profile against closed PRs, no publication.
3. **Live shadow:** discovery and drafts, publisher disabled.
4. **Gated publishing:** enabled only after quality and security gates pass.

## 15. Acceptance criteria

### Onboarding and portability

- A new authenticated engineer reaches a healthy queue within 15 minutes without editing application code.
- Repositories can be added, disabled, removed, or remapped through config alone.
- The implementation passes fixture scale tests for 20 repositories, 200 open PRs, and 20 review jobs per day.
- Different default branches and dirty developer checkouts do not affect reviewed source.

### Coverage and resources

- During healthy operation, explicit requests and policy matches appear within one five-minute poll.
- Tracking 200 PRs creates zero worktrees until jobs start.
- Default concurrency never exceeds one agent; configured concurrency never exceeds two.
- At most four worktrees exist, abandoned worktrees are removed after restart, and storage stays within the configured budget.
- Auto-analysis follows the hybrid policy exactly; on-demand items remain visible.

### Agent contract and safety

- Doctor detects unauthenticated Cursor/GitHub, unavailable model, unsupported CLI, mismatched remotes, and invalid config.
- Timeout, signal termination, non-zero exit, missing result, malformed JSON, and schema mismatch are visible and recoverable.
- No repository commands, dependency installation, build, test, Compose stack, or `.cursor/worktrees.json` setup runs in Phase 1.
- Protected files and credential values never appear in a prompt, transcript, artifact, log, or SQLite.
- Every finding references valid evidence and every unknown remains explicit.

### Human workflow

- No external mutation occurs without exact recorded approval.
- No stale-head, wrong-identity, edited-after-approval, or duplicate review is published.
- After at least 30 routine PRs in the 30-day pilot, median active verification time is at most two minutes and at least 70% of drafts are accepted or receive wording-only edits.
- Connector, checkout, agent, validation, or publication failures remain visible and recoverable.

## 16. Explicit decisions

- Generic engine plus organization/profile configuration, not hard-coded repositories.
- Independent application checkout with configurable workspace roots.
- Shared organization catalog, portable engineer profile, and local machine config.
- No secret `.env` for the control tower.
- `gh`/Git for deterministic GitHub operations; Cursor CLI for all AI.
- Hybrid auto-analysis, not a Cursor run for every tracked PR.
- Control-tower-owned mirrors and transient worktrees, not developer checkouts.
- CI evidence only; no local PR execution in Phase 1.
- One primary reviewer; no specialists or default agent swarm.
- Content-hashed profile snapshots; Git history optional.
- SQLite migrations instead of speculative Phase 2 fields.
- Shadow mode before gated publication.

## 17. Phase 2 handoff contract

Phase 2 may rely only on delivered, tested Phase 1 interfaces:

- Repository catalog and local mappings.
- GitHub adapter and normalized work graph.
- Attention-versus-job separation.
- Versioned schemas and migration runner.
- Context bundle and strict review result.
- Cursor CLI runner and bounded worker pool.
- Mirror/worktree manager.
- Human approval and publisher guards.

Phase 2 must not assume reserved database fields or an unchanged job identity. Each Phase 2 increment defines its own migrations, context versions, staleness rules, and acceptance gates in the companion specification.
