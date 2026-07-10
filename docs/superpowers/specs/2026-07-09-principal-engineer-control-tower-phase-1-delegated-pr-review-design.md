# Principal Engineer Control Tower — Phase 1: Delegated PR Review

**Date:** 2026-07-09  
**Revised:** 2026-07-10  
**Status:** Draft pending final design approval
**Audience:** Implementation agents and principal engineers operating the product locally  
**Scope:** A complete, independently deliverable first phase. Each independently gated Phase 2 capability may begin only after Phase 1 is delivered and the Phase 1 rollout gates relevant to that capability pass.

## 1. Summary

Build a single-operator, local-first control tower that deterministically discovers and covers GitHub pull requests requiring a principal engineer's attention, optionally asks a Cursor CLI advisor for attention guidance, and prepares evidence-backed review drafts with Cursor CLI agents.

The product is a generic engine. Organization-specific repositories, priorities, prompts, and review judgment are configuration, not application code. Array's four repositories are the initial starter profile, but another principal engineer can onboard different repositories without changing or forking the application.

The architecture boundary is **deterministic coverage and authority, agentic judgment and advice**. Application code owns discovery, eligibility, mandatory coverage, auto-analysis, source and evidence validation, state transitions, and every external authorization decision. Agents may assess priority, explain, identify risk, draft findings, and recommend actions. They cannot hide a covered PR, change eligibility, start a run outside deterministic policy or a human request, validate their own evidence, or authorize publication.

Phase 1 is deliberately CI-first:

- GitHub metadata, changed-file names, review-request state, and check summaries are collected for every deterministically tracked PR. The authoritative **All Tracked** view is never filtered by an agent.
- An explicit review request is always eligible. Otherwise, a PR is eligible only when its repository is active and either a changed path matches `eligiblePaths` or its exact normalized GitHub author login matches `eligibleAuthors`.
- A Cursor review starts automatically only for an explicit review request or another configured deterministic auto-analysis rule. Author-only eligibility is on-demand unless another such rule applies. Other eligible PRs remain visible and can be analyzed on demand.
- An optional metadata-only `pr-attention` Cursor advisor may assess relevance and risk, explain, and recommend actions over a bounded candidate set. Its output is advisory and never changes deterministic coverage or auto-analysis.
- A no-checkout administrative worktree and a separate filtered source view are created just in time for a registered repository's active review job and removed afterward. Unregistered repositories use an explicit remote-evidence-only path with neither.
- Phase 1 never installs repository dependencies, copies repository environment files, or executes repository code.
- Existing GitHub checks are the only dynamic build and test evidence. Frontend validation is inspection of source, diff, test code, and CI results only; it does not execute a browser, build, test, or repository command.

All probabilistic or AI behavior runs through the authenticated local Cursor CLI. GitHub discovery, policy evaluation, domain routing, state transitions, evidence validation, authorization, and publication remain deterministic application code. Agent-reported confidence is context for a human and never authorization for an action.

## 2. Outcomes

Phase 1 must:

1. Give the principal a complete, fresh queue of configured or explicitly requested reviews.
2. Produce a useful review draft without requiring the principal to prepare a checkout or local runtime.
3. Reduce routine review verification to approximately one to two minutes.
4. Never execute PR code or expose host credentials to an analysis agent.
5. Never publish an external action without exact, recorded human approval.
6. Let another engineer install and personalize the product without application-code changes.
7. Keep deterministic All Tracked coverage authoritative while allowing bounded, optional agentic attention advice.
8. Capture structured learning signals and governed change proposals without silently changing policy, persona, prompts, or skills.

## 3. Product invariants

1. **Deterministic coverage and authority, agentic judgment and advice.** Deterministic code discovers every eligible item and owns all external authorization. Agents may advise; they cannot hide mandatory coverage or grant authority.
2. **Deterministic coverage, selective execution.** Eligibility does not imply an immediate Cursor run. Deterministic policy or an explicit human action is the only way to start analysis.
3. **Evidence before confidence.** Every finding cites application-verifiable provenance and distinguishes observation, inference, and unknown. Self-reported confidence cannot authorize an action.
4. **Human authority.** No review, comment, approval, or request-changes action is published without an explicit preview and approval.
5. **CI first.** Local build, test, browser, or other repository execution is not part of Phase 1.
6. **Cursor is the only AI harness.** No model-provider SDK, direct model API, or second agent runtime is permitted.
7. **Configuration is portable; secrets are not configuration.** Shared defaults and profile content are versionable. Machine paths and credentials are local.
8. **The app owns its runtime state.** It does not switch branches, add worktrees to, or otherwise mutate an engineer's development checkout.
9. **Failures stay visible.** A connector, fetch/materialization, agent, validation, or publication failure never removes the item from the queue.
10. **No silent learning.** Recorded signals and agent proposals do not change runtime behavior until schema validation, historical replay, exact preview, and explicit human adoption complete.

## 4. Goals and non-goals

### Goals

- Support multiple independent Git repositories with different default branches and toolchains.
- Discover explicit review requests across configured GitHub organizations and policy-matched PRs in configured repositories, including exact author-or-path eligibility.
- Provide deterministic priority tiers and a bounded hybrid auto-analysis policy.
- Optionally provide bounded metadata-only `pr-attention` advice without weakening authoritative deterministic coverage.
- Run at most one active `primaryReview` Cursor attempt per job identity; human retries create sequential immutable run attempts.
- Select review domains deterministically from configured repository/path rules.
- Preserve a local audit trail of source state, agent work, human edits, approvals, and publications.
- Preserve structured attention, draft, disposition, model, harness, context, usage, timing, failure, and supersession signals from the first run.
- Start in shadow mode and graduate to gated publishing only after measured quality gates pass.

### Durable non-goals

- Continuous cloud operation while the operator's machine is offline.
- Slack, email, calendar, or other notification ingestion.
- Reviewing every PR in an organization.
- Autonomous approvals, requested changes, merges, or Linear mutations.
- Replacing GitHub as the code-review system.
- Productivity scoring.
- Silent learning or autonomous mutation of policy, persona, prompts, skills, or profile files.
- Arbitrary generated code or SQL execution.
- Arbitrary agent shell, write, delete, MCP, browser, or repository-command access.
- Microservices, a message broker, graph database, vector database, or container orchestration platform.

### Deferred beyond Phase 1

- Linear and delivery intelligence.
- Specialist or cross-repository agent passes.
- Bot-authored comments.
- Sandboxed repository commands.
- Agent-controlled discovery, eligibility, mandatory coverage, or auto-analysis.
- Daily or weekly briefings.
- Natural-language command bar.
- Automatic adoption of learning proposals.

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
      "**/.env",
      "**/.env.*",
      "**/.cursor/mcp.json",
      "**/appsettings.secrets.json",
      "**/appsettings.Local.json",
      "**/*.pem",
      "**/*.key",
      "**/*.pfx",
      "**/deploy.*.parameters.json",
      "**/deploy.*.parameters.jsonc"
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

Ticket extractors run deterministically in Phase 1 and store normalized identifiers as opaque metadata. They do not contact or interpret Linear. Phase 2A may use exact identifier equality for candidate related work, and Phase 2C resolves the same identifiers through a delivery-provider adapter.

`security.protectedPaths` owns the complete organization-level sensitive-path denylist. Application hardcoded defaults are always unioned with this list and cannot be removed by a profile.

All repository path consumers use one application-owned `CanonicalPathMatcher` implementation: `eligiblePaths`, `priorityRules.paths`, `domainRules.paths`, protected-diff filtering, source materialization, provenance validation, and the fail-closed read hook. A canonical repository path is a root-relative, case-preserving, `/`-separated string decoded as valid UTF-8 and already in Unicode NFC. It has no leading/trailing `/`, backslash, NUL/control character, empty/`.`/`..` segment, or case-insensitive `.git` segment. Diff-only `a/` and `b/` syntax is removed before canonicalization. Invalid, non-NFC, absolute, escaping, or normalization/case-colliding paths are rejected rather than rewritten. Matching is case-sensitive and occurs before conversion to an operating-system path.

Globs are implicitly root-anchored canonical patterns with `/` separators:

- A literal matches itself.
- `*` matches zero or more Unicode scalar values within one segment, never `/`.
- `?` matches exactly one Unicode scalar value within one segment, never `/`.
- `**` is valid only as an entire segment and matches zero or more complete path segments. Therefore `**/.env` matches `.env`, `a/.env`, and `a/b/.env`; `src/**` matches `src` and every descendant.

Wildcards match leading dots and there is no implicit basename recursion: `*.pem` is root-only, while `**/*.pem` is depth-independent. Globs reject leading/trailing `/`, backslash, empty/`.`/`..` segments, non-NFC or control characters, `***`, `**` embedded in another segment, character classes, brace/extglob syntax, and unsupported escaping. Duplicate canonical globs within one configured array are schema errors; the named union of immutable application defaults and organization protected paths deduplicates exact canonical patterns while retaining both sources for audit. The application compiles validated patterns once into an immutable, content-hashed matcher artifact; every in-process consumer and generated read hook uses that exact artifact and matcher-version implementation. Adapters may not recompile with or substitute library-/platform-specific glob semantics.

Shared organization harnesses are committed under feature-specific directories:

```text
config/harnesses/
├── pr-attention/
│   ├── prompt.md
│   └── skills/
│       └── pr-attention/
│           └── SKILL.md
└── pr-review/
    ├── prompt.md
    ├── skills/
    │   └── control-tower-pr-review/
    │       └── SKILL.md
    └── domains/
        ├── backend.md
        ├── frontend.md
        └── infrastructure.md
```

`pr-attention` contains bounded metadata-triage guidance. `pr-review` contains evidence-backed review guidance. Domain files refine `pr-review` judgment for deterministically selected scopes; for example, `pr-review/domains/frontend.md` describes frontend risks that can be assessed by source, diff, test-code, and CI inspection. It must not instruct the agent to execute a frontend build, test, browser, or repository command.

### 6.2 Portable engineer profile

The active profile is a directory. The default location is `~/.control-tower/profile`; it may be a separate private Git repository, but Git is not required for operation.

```text
profile/
├── profile.json
├── policy.json
├── persona.md
├── harnesses/
│   ├── pr-attention/
│   │   ├── prompt.md
│   │   └── skills/
│   │       └── pr-attention/
│   │           └── SKILL.md
│   └── pr-review/
│       ├── prompt.md
│       ├── skills/
│       │   └── control-tower-pr-review/
│       │       └── SKILL.md
│       └── domains/
│           ├── frontend.md
│           └── infrastructure.md
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

`profile.githubLogin` is the configured operator for the organization catalog's GitHub host. The profile loader trims, validates, and lowercases it using the same normalized-login contract as `eligibleAuthors`. Discovery uses this exact normalized login, never an ambient `@me` alias. Before the host can become healthy, doctor must verify that the canonical login returned by `gh api --hostname <host> user --jq .login`, lowercased without other transformation, exactly equals the configured operator.

Engineer harness files are optional additions, not replacements for organization files. Missing optional files contribute no manifest entry. The engineer expresses natural-language attention priorities in `profile/harnesses/pr-attention/prompt.md`; those priorities guide advice only. Repository guidance remains a separate, approved file because it applies after organization domain guidance and before engineer judgment guidance.

`policy.json` defines deterministic coverage, eligibility, domain routing, auto-analysis, and advisor invocation bounds:

```json
{
  "schemaVersion": 1,
  "attentionAdvisor": {
    "enabled": true,
    "maxCandidatesPerInvocation": 50,
    "timeoutSeconds": 90
  },
  "autoAnalyze": {
    "explicitReviewRequests": true,
    "priorityTiers": ["p0", "p1"]
  },
  "repositories": {
    "pba-webapp": {
      "eligiblePaths": ["src/**"],
      "eligibleAuthors": ["shubh-array"],
      "domainRules": [
        { "domain": "frontend", "paths": ["src/**"], "priority": 100 }
      ],
      "priorityRules": [
        { "paths": ["src/api-clients/**", "src/lib/auth/**"], "tier": "p1" }
      ]
    },
    "pba-agents": {
      "eligiblePaths": ["sdk/**", "services/**"],
      "eligibleAuthors": [],
      "domainRules": [
        { "domain": "backend", "paths": ["sdk/**", "services/**"], "priority": 100 }
      ],
      "priorityRules": [
        { "paths": ["sdk/src/auth/**", "services/shared/**"], "tier": "p1" }
      ]
    },
    "pba-microservices": {
      "eligiblePaths": ["services/**", "packages/**"],
      "eligibleAuthors": [],
      "domainRules": [
        { "domain": "backend", "paths": ["services/**", "packages/**"], "priority": 100 }
      ],
      "priorityRules": []
    },
    "pba-infra": {
      "eligiblePaths": ["payg-array-apps/**", "array-internal-apps/**"],
      "eligibleAuthors": [],
      "domainRules": [
        {
          "domain": "infrastructure",
          "paths": ["payg-array-apps/**", "array-internal-apps/**"],
          "priority": 100
        }
      ],
      "priorityRules": []
    }
  }
}
```

Eligibility has exact OR semantics:

1. An explicit review request to the configured operator is always eligible, even when the repository is inactive or unregistered, provided the GitHub credential can read it.
2. Otherwise, the repository must be in `profile.activeRepositoryIds` and the PR must match at least one `eligiblePaths` glob **OR** the PR author's exact normalized login must appear in `eligibleAuthors`.
3. `eligiblePaths` matches when any changed path matches any configured glob. `eligibleAuthors` never uses globs, display names, organization membership, teams, prefixes, or substring matching.
4. A configured login is trimmed, validated as 1–100 ASCII characters matching `^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$`, and lowercased. The PR author's canonical API `login` is lowercased without other transformation. Equality of those two strings is the only author match. Duplicate normalized entries are a schema error.
5. Empty `eligiblePaths` and `eligibleAuthors` arrays match nothing. Path and author matches are independent; they are never ANDed.

The evaluator stores every matching reason, not only the first. Reason records use stable codes and exact matched values:

```json
[
  {
    "code": "eligible_path",
    "repositoryId": "pba-webapp",
    "matchedPath": "src/components/Button.tsx",
    "matchedRule": "src/**"
  },
  {
    "code": "eligible_author",
    "repositoryId": "pba-webapp",
    "normalizedLogin": "shubh-array"
  }
]
```

An explicit request uses `{"code":"explicit_review_request","requestedLogin":"shubh-array"}`. If both path and author match, both reason records are stored. For tracked but ineligible PRs, the evaluator stores deterministic exclusion codes such as `inactive_repository` or `no_eligible_path_or_author_match`; these remain visible in All Tracked.

An author-only match means `eligible_author` is present and neither `explicit_review_request` nor `eligible_path` is present. It is on-demand by default. It may auto-analyze only when another deterministic rule independently applies, such as a changed path matching a `priorityRules` entry whose tier is listed in `autoAnalyze.priorityTiers`. `pr-attention` output, including a high-risk recommendation, never changes this decision.

An explicit request in a repository that is not both cataloged and active uses the remote-evidence-only review path until the operator explicitly registers and activates that repository. Full source-tree review requires registration.

Every agent run snapshots the exact policy subset and materializes the complete ordered harness manifest defined below. Content hashes, not Git commits, are the authoritative audit versions. Git history is an optional governance and sharing mechanism.

### 6.3 Harness composition and precedence

The application composes each `pr-attention` or `pr-review` run in this exact order:

1. Immutable application-owned safety instructions, tool restrictions, evidence rules, publication boundary, and strict output contract.
2. Exact run-relevant policy snapshot. For `pr-review`, this is the complete canonical review-relevant subset used for eligibility, priority, auto-analysis, and domain selection; its pre-context facts contribute to the policy-decision hash, while the materialized snapshot/manifest hash is run-only and never a job-ID input. For `pr-attention`, it is the complete canonical attention-relevant subset used for candidate selection and advisor bounds.
3. Organization feature guidance: `config/harnesses/<feature>/prompt.md`, then that feature's single allowlisted `SKILL.md`.
4. Selected organization domain guidance in deterministic domain-selection order: `config/harnesses/pr-review/domains/<domain>.md`; empty for `pr-attention`.
5. Approved repository guidance: `profile/repository-guidance/<repository-id>.md`; review-only and empty for `pr-attention`.
6. Engineer feature guidance: `profile/harnesses/<feature>/prompt.md`, then that feature's single allowlisted `SKILL.md`.
7. Engineer domain guidance for the already selected domains and in the same order: `profile/harnesses/pr-review/domains/<domain>.md`; empty for `pr-attention`.
8. `profile/persona.md`.
9. Delimited untrusted PR inputs, followed for `pr-review` by the application-created provenance catalog.

No other file is loaded. There is no recursive discovery and no generic deep merge. The schema defines each scalar and list's owner; lists that combine, such as protected paths, use an explicitly named operation. Organization and engineer Markdown is concatenated only in the order above. The metadata-only advisor never receives organization domain guidance, engineer domain guidance, or repository guidance.

Engineer guidance may change judgment, style, priorities, explanation, and recommendations. It cannot override or weaken application safety, permissions, protected paths, evidence/provenance rules, output schemas, deterministic eligibility, deterministic auto-analysis, or publication authority. Conflicting engineer text is recorded as untrusted-to-authority guidance and the immutable rule wins.

Before each run, the context builder writes `harness-manifest.json`. Each artifact appears exactly once and has a `layerOrdinal` from 1 through 9, a globally unique `entryOrdinal`, layer name, feature, optional domain, logical path, SHA-256 content hash, and byte length. Layer 1 contains the application safety contract followed by the strict output contract. Layer 2 contains only `policy.snapshot.json`. Feature prompts precede their single allowlisted skill within layers 3 and 6. For `pr-review`, domain entries follow deterministic domain order within layers 4 and 7 and layer 5 contains only the applicable repository-guidance file when one exists. For `pr-attention`, layers 4, 5, and 7 are always empty. Layer 8 contains only persona. Layer 9 follows the fixed input-artifact order declared by the versioned run-input schema: `pr-review` ends with its application-created provenance catalog, while `pr-attention` contains only its ordered batched metadata artifacts and has no provenance catalog. Missing optional artifacts produce no entry and do not shift layer ordinals.

The policy snapshot is canonical JSON with schema version and policy hash; it is not inferred from Markdown and cannot share another layer. Generated application contracts include application version and schema hash. No artifact appears in more than one layer, and directory enumeration order never affects entry order. The application hashes canonical JSON for the complete ordered manifest and records that manifest hash on the run. A retry materializes a new manifest even if the hash is unchanged.

Domain selection is deterministic application code and applies only to `pr-review`. Declaration index is the zero-based position in the repository's ordered `domainRules` array. For every changed path, the evaluator records every matching domain rule as `{domain, numericPriority, declarationIndex, matchedPath, matchedRule}`. Each domain is selected once. When multiple rules match the same domain, its selected reason identifies the rule with highest numeric priority, then earliest declaration index, and includes that winning rule's matched paths in bytewise ascending order; all path-level and non-winning reasons remain stored. Selected domains are ordered by descending selected numeric priority, then ascending selected declaration index, then domain name as a final stable tie-breaker. Only configured domain names whose organization `pr-review` domain file exists are valid. Numeric priority must be an integer from 0 through 1000. Zero matches selects no domain. Agents cannot select or add a domain. Phase 1 permits at most three distinct domain names in one repository policy; schema validation rejects more, so one run can never select more than three.

### 6.4 Local machine config

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
    "modelRoles": {
      "attention": {
        "modelId": "composer-2.5-fast"
      },
      "primaryReview": {
        "modelId": "composer-2.5-fast"
      }
    },
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

Local repository paths are used for onboarding validation and catalog mapping only. They are not the authoritative source for a review because a development checkout may be dirty, on another branch, or changed by workspace hooks.

Only `CONTROL_TOWER_CONFIG` may override the local-config path. The control tower defines no secret-bearing environment variables and requires no application `.env` file.

`attention` and `primaryReview` are named model roles, not aliases. Every run records the role, the complete validated model specification object, its canonical hash, and the actual model reported by the Cursor initialization event. There is no fallback from one role to another and no silent model substitution.

### 6.5 Validation

All JSON documents are validated with versioned schemas before the daemon starts. Unknown keys are errors. A missing or invalid normalized configured operator, missing active repository, duplicate GitHub identity, duplicate normalized eligible author, invalid author login, invalid/duplicate canonical glob, unknown domain, invalid/out-of-range domain priority, unsupported priority tier, unavailable exact model specification, or path/remote mismatch produces an actionable error and does not partially activate the invalid entry.

Schema migrations create a backup before changing local files. An older unsupported schema blocks startup and prints the exact migration command.

## 7. Credentials and dependency integration

Secrets stay in the credential stores already used by their owning tools:

| Dependency | Authentication | Consumer | Persisted by control tower |
| --- | --- | --- | --- |
| Cursor | Existing `agent login` session | Cursor child process | No |
| GitHub API and publication | Existing `gh auth login` keychain entry | `gh` adapter | No |
| Git remote fetch | Existing SSH agent or Git credential helper | authenticated mirror/fetch adapter | No |
| Git local materialization | None | hardened local-object/worktree adapter | No |
| Local browser API | Random daemon session secret | browser and daemon | Memory only |

Linear and bot credentials do not exist in Phase 1.

The application never calls `gh auth token`, copies a token into a child environment, or stores credentials in SQLite. It constructs each child environment from an empty object:

- Common non-secret variables: `PATH`, `HOME`, `TMPDIR`, `LANG`, `LC_ALL`, and `USER` when present.
- Cursor process: common variables only. Phase 1 requires stored `agent login` authentication and explicitly removes `CURSOR_API_KEY` and `CURSOR_AUTH_TOKEN`.
- `gh` process: common variables plus `GH_HOST` and `GH_CONFIG_DIR` when explicitly configured. It removes `GH_TOKEN`, `GITHUB_TOKEN`, and all other `GH_*` values.
- Authenticated Git fetch process: common variables plus `SSH_AUTH_SOCK` when using SSH and the user's existing trusted Git credential-helper configuration when using HTTPS. It removes token variables, `GIT_ASKPASS`, `SSH_ASKPASS`, arbitrary `GIT_SSH_COMMAND`, and repository-provided environment; overrides hooks/submodule recursion off; and receives only the catalog remote and explicit refspec.
- Hardened local-materialization process: common variables but explicitly removes `SSH_AUTH_SOCK`, all askpass/token/GitHub variables, and credential-helper access. It sets `GIT_TERMINAL_PROMPT=0`, disables system/global Git config and attributes, overrides `credential.helper` to empty and `protocol.allow=never`, and accepts only local object IDs/paths selected by the parent.

The authenticated fetch process terminates before any local materialization process starts; child environments are built independently and never reused. The publisher launches its own `gh` process under the same GitHub allowlist. No local-materialization, Cursor, or other analysis process inherits GitHub, SSH, Git credential-helper, Linear, package-registry, cloud, or repository environment variables.

Logs redact authorization headers, URL credentials, values matching known secret formats, and all environment values. Agent transcripts and artifacts never contain environment dumps.

## 8. Onboarding

### 8.1 Doctor

`pnpm ct doctor` is read-only and checks:

1. Supported operating system and required tool versions.
2. `agent status --format json` reports `isAuthenticated: true`.
3. `agent models` includes the exact `modelId` configured for every enabled named role, and a bounded smoke invocation reports that exact model for each distinct specification. A missing, aliased, substituted, or differently reported specification is an error.
4. `gh auth status --hostname <host>` succeeds for each configured host.
5. `gh api --hostname <host> user --jq .login` succeeds and its canonical login, lowercased without other transformation, exactly equals normalized `profile.githubLogin`. A mismatch keeps that host and the overall control tower unhealthy.
6. Each configured local repository path exists, is a Git repository, and its `origin` matches the catalog.
7. The profile, policy, feature harness, domain, repository-guidance, and persona schemas/allowlists are valid; every path glob compiles with the single `CanonicalPathMatcher` version; and a sample ordered manifest including the explicit policy layer can be materialized.
8. The `attention` and `primaryReview` model-role specifications are exact and available; `attention` may be omitted only when `attentionAdvisor.enabled` is false.
9. The data directory is writable and has at least 10 GB free.
10. The loopback API port can be allocated.

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
4. Asks the engineer to confirm active repositories, normalized configured GitHub operator, exact models for `attention` and `primaryReview`, optional advisor enablement, and deterministic auto-analysis policy.
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
- The filesystem stores bounded filtered diffs, manifests, per-run transcripts/results, provenance catalogs, immutable review artifacts, and governed change proposals by content hash.
- `gh` and Git subprocess adapters provide deterministic GitHub, fetch, tree/object plumbing, and no-checkout worktree administration.
- Cursor CLI subprocesses provide all AI analysis.

Runtime data lives under the configured data directory:

```text
data/
├── control-tower.sqlite
├── artifacts/
├── jobs/
├── attention-runs/
├── proposals/
├── proposal-runs/
├── mirrors/
├── worktrees/
└── logs/
```

The browser never calls GitHub, Git, or Cursor directly.

## 10. Components

### 10.1 GitHub adapter

The adapter uses authenticated `gh` commands and machine-readable JSON.

It discovers:

- Open PRs requesting review from the exact normalized `profile.githubLogin`.
- Open PRs in active repositories.
- PR metadata, head/base SHAs, authors, reviewers, labels, changed files, commits, comments, reviews, and check runs.

The initial discovery contracts are:

```text
gh search prs --owner <org> --review-requested=<configured-normalized-login> --state=open --json ...
gh pr list --repo <owner/repo> --state open --json ...
gh pr view <number> --repo <owner/repo> --json ...
gh pr diff <number> --repo <owner/repo>
gh api --hostname <host> user --jq .login
gh api rate_limit
```

The adapter runs host-sensitive `gh search`/`gh pr` commands with `GH_HOST=<host>` in the sanitized child environment defined in section 7; `gh search prs` has no `--hostname` flag. The implementation may replace individual commands with `gh api` when pagination or fields require it, but it may not extract and persist the underlying token. The adapter never substitutes `@me` for the configured operator. It repeats the exact authenticated-login lookup before each polling cycle; failure or mismatch transitions the host to unhealthy before any search/list request or new job enqueue.

Polling defaults to five minutes with checkpointed pagination and an on-demand refresh. Rate-limit exhaustion preserves last-known state, exposes freshness, and pauses nonessential enrichment.

Full diff ingestion is fail-closed and streaming. The `gh pr diff` stdout pipe is connected directly to an application parser and is never inherited by generic subprocess logging, buffered into a diagnostic string, or written to a temporary file. Raw stderr from this command is not retained; only normalized exit/error codes are recorded. The parser canonicalizes each unified-diff path with `CanonicalPathMatcher` before accepting any body line. For a path matching the unioned protected-path denylist, it discards all text/binary patch bytes in memory and retains only the canonical path plus `protected_path_content` missing-coverage metadata. Rename/copy blocks are entirely omitted when either old or new path is protected, and only their canonical path names/reasons survive. If a path header is malformed, ambiguous, unsafe, or cannot be canonicalized, the parser discards the entire diff body and records `diff_filter_failed`.

Only the filtered allowed-path patch may reach disk, logs, filesystem artifacts, SQLite, provenance generation, or an agent context. Protected patch bytes never reach those sinks, and the application creates no diff-hunk or file provenance for an omitted protected path. This contract is identical for registered-source and remote-evidence-only review; registration never weakens diff filtering.

### 10.2 Normalizer and work graph

SQLite is relational. Phase 1 stores:

- GitHub repositories, PRs, commits, files, checks, reviews, and comments.
- Attention items, all exact deterministic eligibility/exclusion reasons, eligible default/selected priority or ineligible `unranked` status plus every priority/domain/auto-analysis reason, and the latest valid per-PR advisor output keyed to its exact staleness identity. Historical advisor run artifacts remain under normal retention.
- Attention candidates/runs, review jobs and immutable run attempts, transactional latest/accepted run pointers, context bundles, application-created provenance, findings, drafts, approvals, publications, and audit events.
- Allowed/omitted source manifests and explicit filtered/missing coverage; no protected source bytes or protected-path provenance.
- Content hashes for catalog, profile, policy, complete ordered harness manifests, model specifications, persona, feature prompts/skills, selected domains, repository guidance, and input contexts.
- Structured learning signals: attention outcomes (`relevant`, `ignored`, `escalated`), draft outcomes (`accepted`, `edited`, `rejected`), final disposition, model/harness/context hashes, timing and usage, failures, and supersession.
- Versioned change proposals, replay results, exact previews, adoption decisions, and the identity and timestamp of the adopting human.

Large payloads are filesystem artifacts referenced by hash. Phase 1 does not reserve speculative Phase 2 columns; future changes use normal versioned migrations.

Every GitHub/Git changed path is passed through `CanonicalPathMatcher` at normalization time. Only canonical paths participate in eligibility, priority, domain, protection, provenance, or UI path fields. An invalid path is stored only as an escaped diagnostic plus `unsafe_path` reason, cannot satisfy a positive policy rule, and creates explicit missing coverage.

### 10.3 Policy evaluator

Policy deterministically computes:

- Tracking and eligibility.
- Eligible priority tier or tracked-ineligible `unranked` sort sentinel.
- Auto-analysis versus on-demand status.
- Review domains.
- The exact policy subset relevant to a job.

Eligibility reasons:

1. Explicit review request.
2. Active repository and one or more changed-file matches.
3. Active repository and exact normalized author-login match.

The non-explicit rule is `activeRepository && (eligiblePathMatch || eligibleAuthorMatch)`. The evaluator records every exact matching path/rule and normalized author, plus explicit-request reason when present. It also records deterministic exclusion reasons for tracked but ineligible PRs.

Phase 1 supports exactly four eligibility priority tiers with this total order: `p0` (sort ordinal 0, highest), `p1` (1), `p2` (2), and `p3` (3, lowest eligible). Every eligible PR starts at default `p3` with reason `{"code":"default_priority","tier":"p3"}`. Declaration index is the zero-based position in the repository's ordered `priorityRules` array. For every changed path, the evaluator records every matching priority-rule reason as `{code:"priority_rule", tier, declarationIndex, matchedPath, matchedRule}`. The selected tier is the matched tier with the lowest ordinal; when multiple rules produce that winning tier, the selected reason identifies the earliest declaration and includes that rule's matched paths in bytewise ascending order. All path-level and non-winning matching reasons remain stored. Unknown tiers and duplicate/unsupported `autoAnalyze.priorityTiers` values are schema errors.

Every tracked-but-ineligible PR has `priorityStatus:"unranked"`, sort ordinal 4, and reason `{"code":"unranked_ineligible","eligibilityExclusionCodes":[...]}` using its exact stored exclusion codes. `unranked` is not a priority tier, is invalid in priority rules and `autoAnalyze.priorityTiers`, and can never create an auto-analysis reason. It exists only so All Tracked and advisor candidate selection have a total order.

Auto-analysis reasons:

1. Explicit review request when enabled.
2. A configured auto-analysis priority tier.

Auto-analysis is evaluated only after eligibility succeeds and uses the selected tier; `unranked` is never evaluated for auto-analysis. Author-only eligibility does not add an auto-analysis reason. Agent advice does not add an auto-analysis reason. The complete All Tracked/advisor-candidate ordering tuple is `(prioritySortOrdinal, explicitRequestSort, queueTimestampSort, normalizedRepositoryIdentity, prNumber)`: ordinals are `p0=0`, `p1=1`, `p2=2`, `p3=3`, `unranked=4`; `explicitRequestSort=0` for explicit requests and `1` otherwise; then timestamp, repository identity, and PR number sort ascending. The queue timestamp is the oldest active explicit-review-request timestamp when one exists, otherwise the PR's GitHub `updatedAt`, parsed to a UTC instant. A missing/unparseable timestamp uses a deterministic `unknown` sentinel after all valid instants; equal timestamps proceed to repository/PR tie-breakers. No local observation time is used. Focus Queue membership remains restricted to eligible actionable/monitor items as defined in section 10.9; `unranked` items remain only in All Tracked and optional advisor coverage.

### 10.4 Optional `pr-attention` advisor

`pr-attention` is an optional Cursor agent for bounded metadata triage. It receives natural-language priorities through the ordered `pr-attention` harness and may assess relevance and risk, explain, and recommend. It does not determine tracking, eligibility, domain selection, auto-analysis, or publication authority.

When enabled, after deterministic discovery and policy evaluation complete, the scheduler invokes the advisor at most once per completed poll for at most `maxCandidatesPerInvocation` current identities needing advice: never-advised, stale/changed, or previously `not_scheduled`. Failed exact identities are excluded from automatic selection. Candidate selection uses the complete deterministic All Tracked tuple from section 10.3, so eligible tiers precede tracked-ineligible `unranked`; advice for an unranked item still cannot authorize analysis. A human may also request fresh advice for one tracked PR, including a failed exact identity. PRs outside the current batch retain previous valid advice when its exact per-PR staleness identity still matches. Only a PR that has never received valid advice, or whose previous advice is stale, shows `No current advisor result`.

Each candidate input is metadata only:

- Stable repository key and GitHub identity, PR number, current head/base SHA, title, canonical author login, draft state, labels, additions/deletions, changed-file names, review-request state, deterministic eligibility/priority/auto-analysis reasons, check summary, and age/update timestamps. The key is the catalog repository ID when registered; otherwise it is the application-normalized `github:<host>/<owner>/<repo>` identity.
- Body text truncated to 8 KiB, at most 50 labels, 500 changed paths, and 100 check summaries. Truncation is explicit.
- No diff body, discussion body, source file/view, administrative worktree, credential, arbitrary URL content, or repository-local instruction.

The strict output is:

```json
{
  "schemaVersion": 1,
  "items": [
    {
      "repositoryKey": "pba-webapp",
      "prNumber": 123,
      "headSha": "40-character-git-sha",
      "relevance": "critical|high|medium|low|unknown",
      "risk": "critical|high|medium|low|unknown",
      "explanation": "string",
      "recommendedAction": "analyze_now|analyze_on_demand|monitor|human_triage",
      "confidence": "high|medium|low",
      "unknowns": ["string"]
    }
  ]
}
```

The schema requires exactly one item for each input candidate, no additional item, explanation length at most 1,000 characters, at most ten unknowns, and exact equality of repository key, PR number, and head SHA to application input. Item array order has no meaning. The contract has no model-authored numeric or batch-relative rank. The application records but does not act on `recommendedAction` or confidence. `analyze_now` is advice displayed to a human; it does not enqueue work unless deterministic auto-analysis already applies or the human explicitly requests analysis.

An attention run identity is:

```text
role=attention + ordered candidate metadata snapshot hash
+ relevant policy hash + complete pr-attention harness manifest hash
+ exact attention model specification hash
```

Each valid item is also stored as the latest advice for its PR under this exact per-PR staleness identity:

```text
repository key + PR number + head SHA + per-PR metadata snapshot hash
+ canonical per-PR attention-policy subset hash
+ pr-attention feature-guidance hash for manifest layers 1, 3, 6, and 8
+ exact attention model specification hash
```

The per-PR policy hash excludes unrelated batch candidates while including the `CanonicalPathMatcher` version and that PR's deterministic eligibility, selected priority/`unranked` status, auto-analysis status, and advisor policy. The feature-guidance hash includes application constraints/contracts, organization attention guidance, engineer attention guidance, and persona; attention layers 4, 5, and 7 are empty by contract. Layer 9 candidate batching and review-only domain/repository guidance cannot make otherwise identical per-PR advice current or stale. Advice is current only while that complete per-PR identity still matches. A changed head SHA, title, body hash, author, labels, changed paths, review-request state, checks, relevant policy/matcher, attention guidance, persona, or model marks it stale. Stale advice may be shown with its age but is treated as no current advice for ordering. A valid batch atomically promotes one current item per input PR; malformed batch output promotes none. Previous valid advice for PRs outside the batch remains current only when its own identity still matches. Every batch output and superseded per-PR result remains an immutable historical artifact under normal retention.

The application computes **Advisor order** globally across All Tracked; the agent does not supply a cross-PR rank. Items with current advice sort first by fixed relevance ordinal (`critical=0`, `high=1`, `medium=2`, `low=3`, `unknown=4`), then fixed risk ordinal using the same mapping, then by the existing deterministic queue tuple from section 10.3. Items without current advice follow all items with current advice and preserve that deterministic relative order. Recomputing this order over the same current per-PR advice and queue facts must produce the same result regardless of which bounded batches produced those advice records.

The advisor runs in a generated metadata-only run directory with no source view, administrative worktree, or `--add-dir`. Writes, deletes, shell, MCP, browser, network-fetch, and repository reads are denied. The parent enforces the configured timeout and the same redacted 10 MB stream limits as review. There is no automatic retry. Timeout, crash, malformed output, missing candidate, or schema mismatch produces a visible `Advisor unavailable — manual retry` state for that exact identity, preserves deterministic ordering and All Tracked coverage, records a failure signal, and never blocks deterministic auto-analysis. `not_scheduled` displays `Deferred by advisor capacity — eligible next poll` and is not a failure.

### 10.5 Orchestrator

Discovery and execution are separate records.

Attention states:

- `monitoring`: tracked but currently ineligible or not actionable.
- `ready_for_analysis`: eligible and on-demand with no current draft.
- `analysis_queued`: a current-identity review job is queued, preparing, running, or validating.
- `draft_ready`: a current validated draft exists.
- `needs_human`: a current job failed, coverage is materially incomplete, or a decision/retry is required.
- `completed`: the human completed the workflow for the current identity.
- `closed`: GitHub reports the PR closed.

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

Attention items are deterministic projections over current PR facts, policy, jobs, runs, and publication records. Eligibility can move `monitoring` to `ready_for_analysis`; deterministic auto-analysis or an explicit human action can move `ready_for_analysis` to `analysis_queued`; accepted runs produce `draft_ready`; failure or an explicit coverage gate produces `needs_human`; human disposition produces `completed`; GitHub closure produces `closed`. A new identity supersedes current jobs/drafts and re-evaluates the item into `monitoring`, `ready_for_analysis`, or `analysis_queued`. Reopening a closed PR performs the same fresh evaluation.

A review job follows only:

```text
queued -> preparing_context
preparing_context -> preparing_source -> running_agent   (registered-source)
preparing_context -> running_agent                       (remote-evidence-only)
running_agent -> validating_output -> draft_ready
draft_ready -> awaiting_approval -> publishing -> published
```

`awaiting_approval`, `publishing`, and `published` are job-level projections over separate immutable external-operation records. They do not create batch authority: each operation independently remains unapproved, approved-and-unconsumed, attempted/consumed, completed, or incomplete.

An error may move any nonterminal pre-publication state to `failed`. For an actual failed attempt, `failed -> queued` is allowed only by an explicit human retry while the exact job identity is still current; it creates a new run attempt and never reuses artifacts. A changed run-input hash cancels/supersedes any active run, invalidates its draft/approval, and moves the non-published job to `failed` with reason `run_inputs_changed` without changing the job ID. That specific failure may return to `queued` when deterministic auto-analysis still applies or a human explicitly requests a fresh run. `cancelled`, `superseded`, and `published` are terminal. A changed job-level identity creates a new job and moves an older current nonterminal or failed job to `superseded`; already terminal jobs remain immutable history. Cancellation is explicit or shutdown-driven and never publishes.

Each `primaryReview` Cursor attempt has its own run state `allocated -> running -> validating -> succeeded|failed`, with `cancelled` and `superseded` terminal alternatives. Every terminal outcome is sealed in `terminal.json`; no run state transitions after sealing. Job `draft_ready` is reachable only from a succeeded, schema/provenance-validated run.

Advisor scheduling has a separate per-candidate state. A current identity outside batch capacity is `not_scheduled`; it creates no attempt and is eligible at the next poll. Selection transactionally creates an advisor run and moves it through `queued -> running -> validating -> succeeded|failed`. `cancelled` and `superseded` are terminal. A failed exact identity is not automatically selected again; only an explicit human retry may create another attempt for that identity, or changed metadata/policy/guidance/model may create a new identity while superseding the old one. Advisor failure never changes deterministic review-job scheduling.

Every state change is a compare-and-set on expected state and exact identity/version. The new state, monotonically increasing attempt number when applicable, run ID, lease, and audit event commit in one SQLite transaction before the corresponding Cursor child process starts. Unique constraints on identity/idempotency key and `(job-or-advisor-identity, attemptNumber)` make duplicate delivery a no-op. `latestRunId` updates transactionally after any run is sealed; `acceptedRunId` updates only after that sealed run passes validation and is accepted.

On restart, queued records remain queued. Expired preparation leases may resume idempotently only after verifying every create-once artifact hash. Orphaned `running_agent`, advisor `running`/`validating`, or output-validation attempts become failed with `daemon_restart` and receive no automatic retry. A `publishing` record is reconciled from stored per-operation receipts and GitHub idempotency facts but never replayed automatically; if all operations completed it moves to `published`, while each incomplete operation has no reusable approval, moves the job to `awaiting_approval`, projects the attention item as `needs_human`, and requires its own fresh preview and single-use approval. Completed operations remain recorded and are never replayed. Terminal job/advisor/run records never transition; the `closed` attention state remains a projection that can be recomputed after GitHub reopens the PR. Abandoned admin/source pairs are removed only after no live lease references them.

A primary review job identity is:

```text
role=primaryReview + github repository + PR number + head SHA
+ source mode + pre-context review-policy decision hash
```

The policy-decision hash is canonical JSON over the `CanonicalPathMatcher` version, eligibility reasons, selected tier/auto-analysis decision, selected domains/reasons, and the exact review-relevant policy subset; all are available after discovery/policy evaluation and before context preparation. `source mode` is `registered-source` or `remote-evidence-only`. Job identity excludes the queue trigger, model, harness manifest, filtered diff/discussion/check artifacts, source/coverage artifacts, and provenance catalog. A deterministic auto trigger and a human trigger coalesce onto the same current job identity and are retained as separate audit events. Retention settings and unrelated policy do not affect identity.

The orchestrator creates and queues this job before context preparation. A 30-second debounce coalesces rapid PR updates. A changed repository/PR/head SHA, source mode, or policy-decision hash creates a new job, supersedes the old non-published job/draft, and cancels any active run. Changes discovered only during context preparation or in harness/model configuration do not mutate job identity; they produce a different immutable run-input hash within the same current job.

Default agent concurrency is one. The supported configurable maximum is two. The queue is fair across repositories within the total order from section 10.3 and runs no more than one active job per PR identity.

### 10.6 Source workspace manager

Tracking a PR creates no checkout.

For source preparation, a repository is `registered-source` only when it has a stable organization-catalog entry, is active in the engineer profile, and passes doctor remote validation. A registered-source job uses this deterministic safe-materialization algorithm:

Authenticated remote-fetch boundary:

1. Create or update a control-tower-owned partial bare mirror under `data/mirrors/<owner>/<repo>.git`. The mirror's local config is application-owned and contains only the catalog remote/ref settings.
2. Start one authenticated fetch subprocess with the fetch-only environment from section 7. It performs only an explicit fetch of the catalog remote and GitHub pull ref into a control-tower ref; no PR-controlled remote, refspec, command, hook, checkout, filter, or submodule operation is allowed.
3. After fetch exits, destroy its child environment. In a separate credential-free, network-disabled local verification child, resolve the fetched commit and verify exact equality with the frozen GitHub head SHA. A mismatch fails the job before materialization.

Hardened local-materialization boundary:

4. Start separate local-only Git subprocesses with no SSH socket, credential helper, askpass, token, or GitHub variables. Set `GIT_CONFIG_NOSYSTEM=1`, `GIT_CONFIG_GLOBAL=/dev/null`, `GIT_ATTR_NOSYSTEM=1`, `GIT_TERMINAL_PROMPT=0`, an application-controlled `PATH`, command-scoped `core.hooksPath=/dev/null`, `core.attributesFile=/dev/null`, `credential.helper=`, `protocol.allow=never`, and `submodule.recurse=false`. These subprocesses may address only the verified local mirror and object IDs; any network/remote operation is rejected.
5. Create the administrative entry at `data/worktrees/<job-id>/admin` with `git worktree add --detach --no-checkout`. The admin directory is never exposed to Cursor. No checkout command is subsequently run.
6. Enumerate the exact verified commit tree with NUL-delimited local Git plumbing. Canonicalize every path with `CanonicalPathMatcher`, then additionally reject normalization or filesystem case-fold collisions before creating any directory/file.
7. Before reading an object, apply the same compiled protected-path matcher to its canonical path. For a protected match, retain only `{path, reason:"protected_path_content"}` and never request its blob bytes.
8. Accept only regular blob modes `100644` and `100755`. Omit symlinks, gitlinks/submodules, trees as file entries, special/unknown modes, and unsafe paths without reading their blob content. Submodule contents are never initialized or fetched.
9. For each allowed regular entry, read raw bytes with local `git cat-file` plumbing, verify object type, expected blob SHA and size, then create the file with exclusive/no-follow semantics under `data/worktrees/<job-id>/source`. Files are made read-only; executable bits are not used. No checkout, attributes, clean/smudge/process filter, hook, submodule, setup script, repository-defined command, credential helper, or network protocol is invoked.
10. Write a content-hashed source manifest bound to repository ID, head commit, root tree SHA, matcher version, and protected-pattern-set hash. Allowed entries record canonical path, blob SHA, size, and Git mode. Omitted protected entries record only path and reason; other omitted entries record path/escaped path and deterministic reason. The source view contains no Git metadata.
11. Expose only the filtered `source` directory to the review agent. After each run is sealed, remove its source view and no-checkout administrative worktree entry. A manual retry repeats local safe materialization from the already verified commit; a refetch uses a new authenticated-fetch boundary.

The manager never uses a developer checkout as the review source, copies untracked files, or executes repository/global Git behavior. Fetch credentials can reach only the fetch subprocess and never local materialization or Cursor. It keeps at most four materialized admin/source pairs and removes abandoned pairs after restart. When total control-tower storage approaches the configured 10 GB limit, the storage manager removes expired artifacts, abandoned pairs, and least-recently-used inactive mirrors in that order; it never removes an active job's source or evidence.

Fork PRs use GitHub's pull ref and do not require direct access to the contributor's fork.

An explicit request from any repository that is not `registered-source` is `remote-evidence-only`. The job fetches GitHub PR metadata, the streaming-filtered GitHub diff, commits, discussion, reviews, and checks; records protected/unsafe/truncated/unavailable coverage omissions; records `sourceTreeInspected: false` and `missingCoverage: ["source_tree"]`; and launches review without a mirror, administrative worktree, source view, or `--add-dir`. It does not imply that a checkout exists. Full source-tree inspection is unavailable until the repository is cataloged, activated, and passes doctor. A registered repository whose source preparation fails is not silently downgraded: the failed job remains visible and the human may explicitly start a new remote-evidence-only job.

### 10.7 Context builder

A review job is an immutable identity plus one or more immutable run attempts. `job.json` is written once. SQLite, not a mutable job file, holds transactional `latestRunId` and `acceptedRunId` pointers:

```text
jobs/<job-id>/
├── job.json
└── runs/
    └── <run-id>/
        ├── run.json
        ├── context-refs.json
        ├── harness-manifest.json
        ├── harness/
        │   ├── policy.snapshot.json
        │   └── ordered-input.md
        ├── github/
        │   ├── pr.json
        │   ├── diff.filtered.patch
        │   ├── checks.json
        │   ├── discussion.json
        │   └── provenance-catalog.json
        ├── source/
        │   ├── coverage.json
        │   ├── source-manifest.json
        │   └── source-index.json
        ├── .cursor/
        │   ├── cli.json
        │   ├── hooks.json
        │   ├── hooks/
        │   │   └── protect-inputs.mjs
        │   └── skills/
        │       └── <active-feature-skill>/
        │           └── SKILL.md
        ├── transcript.ndjson
        ├── stderr.log
        ├── output.json
        ├── validation.json
        ├── validated-provenance.json
        └── terminal.json
```

Context preparation first creates content-addressed, filtered artifacts and their hashes without changing the job identity. The run-input hash is:

```text
sha256(
  complete harness manifest canonical hash
  + filtered GitHub/context artifact-set hash
  + source manifest/coverage hash or remote-only coverage hash
  + application provenance-catalog hash
  + exact primaryReview model-specification hash
)
```

Only after those values exist does the attempt transaction allocate a monotonic attempt number and exclusive run directory. The run ID is `sha256(jobId + runInputHash + attemptNumber)`. `run.json` records both identities and every component hash; `context-refs.json` records the content hash and logical identity of every frozen input/context artifact. Input/context files and the harness manifest are create-once and fsynced before execution; transcripts are append-only while the process is active; output, validation, provenance, and terminal records are create-once. Writing `terminal.json` seals the run, after which the entire run directory is read-only and never modified.

A manual retry against unchanged inputs gets a new attempt number/run ID under the same job. If context, provenance, harness, or model changes while the job-level identity remains current, a new run-input hash and run attempt are created under that same job and prior current run/draft is superseded. If a job-level identity component changes, a new job is created. Earlier runs and their failures remain addressable until normal retention removes the whole expired job.

Advisor and profile-proposal attempts use the same create-once/append-only/seal rules under `attention-runs/<run-id>/` and `proposal-runs/<run-id>/`, with their own manifest, frozen input references, transcript, output, validation, and terminal record. No Cursor attempt writes into another attempt's directory.

`source/source-index.json` and `source-manifest.json` exist only for `registered-source` jobs and contain only allowed regular blobs plus omission metadata. The source index records validated repository ID, canonical path, blob SHA, and line count for allowed blobs available to citation. It is bounded to 100,000 entries or 20 MiB, whichever comes first; truncation and omitted path prefixes are recorded in `coverage.json`. Protected entries appear only by path and omission reason and have no blob SHA, content hash, line count, or bytes. The agent may submit a file locator for an inspected allowed file, whether or not it appears in the bounded index, but the locator is untrusted and does not become evidence unless the application independently resolves and validates its exact repository/blob/path/range.

The context records unavailable, filtered, or truncated data explicitly. `coverage.json` includes source mode, `sourceTreeInspected`, `diffFiltered`, `omittedProtectedPaths`, `omittedSourceEntries`, and `missingCoverage`. Protected-path omissions add `protected_path_content`; a filtering failure adds `diff_filter_failed`. Remote-evidence-only context always adds `source_tree` and contains no source index/manifest. Repository guidance is copied only for `pr-review`; `pr-attention` has no repository guidance. Arbitrary repository rules, hooks, MCP configuration, skills, and instructions are not activated automatically.

`harness/ordered-input.md` is the deterministic byte-for-byte rendering of the manifest entries in `entryOrdinal` order. It is stored and hashed as a derived run artifact, not added as another manifest entry, so source artifacts and their rendered composition are never double-counted. Its diff input is always `diff.filtered.patch`; raw diff stdout and omitted protected blob bytes do not exist anywhere in the job/run tree.

The application creates the provenance catalog before agent execution:

- A diff-hunk record is created only from `diff.filtered.patch` and binds an application-generated opaque ID to repository ID, base/head SHA, canonical allowed path, hunk hash, and exact left/right ranges.
- A check record binds an application-generated opaque ID to the GitHub check-run ID, attempt, name, status, conclusion, URL, and observation timestamp.
- A comment or review record binds an application-generated opaque ID to its GitHub node/database ID, author login, body hash, commit association, and timestamps.
- A commit record binds an application-generated opaque ID to the repository ID and exact commit SHA.

IDs use `pv_<base32-sha256-of-canonical-record>` and are created only by application code. The agent receives and may copy these IDs, but cannot define new provenance records.

File provenance is validated after agent output. Each claimed file range must provide the registered repository ID, exact blob SHA, canonical repository-relative path, and inclusive one-based `startLine`/`endLine`. The validator requires the path/blob pair to exist in the allowed source manifest, resolves it at the reviewed head commit, verifies the line range against that blob, rejects protected/omitted/unsafe paths and path traversal, then creates the same canonical application-owned provenance record and ID. A file claim is invalid for remote-evidence-only jobs. Omitted protected content can produce neither diff nor file provenance.

The generated Cursor permissions deny:

- All writes and deletes.
- All shell commands.
- All MCP tools.
- Reads whose canonical repository path matches the same compiled unioned protected-path matcher used by diff/source filtering.

The `beforeReadFile` protection hook is `failClosed: true`. For source-view reads it strips only the exact configured source-view root, canonicalizes the remaining repo-relative path, and loads the same content-hashed matcher artifact/version; canonicalization failure denies the read. Untrusted PR and repository content cannot alter this job workspace.

### 10.8 Cursor CLI adapter

The adapter executes the configured role with this common surface:

```text
agent
--print
--mode=ask
--sandbox enabled
--trust
--workspace <absolute-run-directory>
--model <doctor-validated-exact-role-model-id>
--output-format stream-json
<single positional prompt>
```

For a `registered-source` `primaryReview` run only, the adapter adds `--add-dir <absolute-filtered-source-view>`. It never exposes the administrative worktree. It omits `--add-dir` for `attention` and `remote-evidence-only` runs. This exact surface was verified against CLI `2026.07.09-a3815c0`. `--add-dir` was verified to expose an additional directory to read tools. `stream-json` was verified as NDJSON containing an initialization event with session ID and model, assistant events, and a terminal result with status, result text, timing, request ID, and usage.

The adapter:

- Passes the prompt as one argument; it does not depend on stdin, `@file`, undocumented flags, or plugin loading.
- Parses each NDJSON line independently and ignores unknown event types.
- Records the session ID and actual model from the init event and rejects a model that differs from the exact configured role specification.
- Treats non-zero process exit, `is_error: true`, missing terminal result, invalid JSON result text, or schema mismatch as failure.
- Enforces the role-specific parent timeout: policy-bounded 90 seconds by default for `attention` and organization-default 20 minutes for `primaryReview`.
- Sends `SIGTERM`, waits five seconds, then sends `SIGKILL`.
- Does not automatically retry an agent run. A human retry creates a new immutable run under the same still-current job.
- Stores redacted stream events and stderr only in that run directory, truncates each at 10 MB, and never captures raw `gh pr diff` stdout.

The `primaryReview` output text must be one JSON object matching:

```json
{
  "schemaVersion": 1,
  "coverage": {
    "mode": "registered-source|remote-evidence-only",
    "sourceTreeInspected": true,
    "diffFiltered": true,
    "omittedProtectedPaths": [],
    "omittedSourceEntries": [],
    "missingCoverage": []
  },
  "summary": {
    "intent": "string",
    "implementation": "string"
  },
  "observations": [
    {
      "type": "observation|inference",
      "statement": "string",
      "provenanceRefs": ["pv_application_created_id"],
      "fileReferences": [
        {
          "repositoryId": "pba-webapp",
          "blobSha": "exact-git-blob-sha",
          "path": "src/components/Button.tsx",
          "startLine": 10,
          "endLine": 18
        }
      ]
    }
  ],
  "checks": [
    {
      "provenanceRef": "pv_application_created_check_id",
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
      "observationIndexes": [0],
      "draftComment": "string"
    }
  ],
  "unknowns": ["string"],
  "recommendedDisposition": "approve|comment|request_changes|needs_human",
  "draftSummary": {
    "body": "string",
    "observationIndexes": [0],
    "provenanceRefs": ["pv_application_created_id"]
  }
}
```

The agent never mints or defines evidence/provenance IDs and never emits an evidence catalog. It may echo application-created provenance IDs in observations and may submit exact file locators for application validation. Every observation must contain at least one provenance reference or file reference. Every finding must reference at least one valid observation index. `draftSummary.body` is non-empty, and both summary citation arrays are non-empty, deduplicated, and bounded. Every summary observation index must resolve to a valid observation, every explicit summary provenance reference must be application-created and present in the validated provenance reachable from those observations, and the resulting summary provenance set must be non-empty. Every supplied catalog ID must exist in the immutable input catalog; every file locator must pass repository/blob/path/range validation. Unknown, invented, cross-repository, stale, protected, or out-of-range references fail the result rather than becoming evidence.

The validator writes a separate immutable `validated-provenance.json` containing the input catalog records actually cited plus application-created records for validated file ranges. Agent-written statements remain observations attached to those records and cannot redefine the underlying source.

`coverage` must equal the application-provided coverage object. Protected path names may appear only in `omittedProtectedPaths`/omission reasons; protected contents may not appear. A remote-evidence-only result must use `sourceTreeInspected: false`, include `source_tree` in `missingCoverage`, contain no file references, and include that limitation in `unknowns` and `draftSummary.body`. Every protected or filtering omission must also remain visible in `unknowns` and `draftSummary.body`. `location` is required only for an inline draft comment; `side` and `line` use GitHub's diff-coordinate semantics, and optional `startSide`/`startLine` identify a multiline range. The context builder supplies only the filtered patch required to validate that the location exists on the reviewed head/base pair. Invalid or omitted-path locations remain summary findings and are never submitted as inline comments.

For every inline draft comment, application code derives its immutable citation set as the sorted union of validated provenance attached to the finding's `observationIndexes`, application-created file-range provenance validated from those observations, and the matching filtered diff-hunk provenance for the inline location. The inline operation is invalid unless that derived set is non-empty. For the summary draft, application code freezes the non-empty validated set selected by `draftSummary.observationIndexes` and `draftSummary.provenanceRefs`. Agent text cannot remove, replace, or broaden those underlying records.

`checks[].provenanceRef` must identify the matching application-created check record, and the reported name/status must agree with that record's normalized GitHub facts. `recommendedDisposition` and finding confidence are advice only. Neither confidence nor disposition creates approval or publication authority. `needs_human` is a non-publishable recommendation and cannot be selected as a GitHub review event. Schema and provenance validation are deterministic; malformed or unverifiable output never becomes a draft.

### 10.9 All Tracked, Focus Queue, and Review Workbench

**All Tracked** is the authoritative coverage route. It shows every open PR discovered from active repositories plus every explicit review request, including tracked-but-ineligible items. It can be filtered only by explicit human UI controls; advisor output never removes an item or changes the total. Every row shows current/stale discovery time and exact eligibility or exclusion reason records.

The Focus Queue is the default eligible-only action route:

- **Now:** at most three highest-priority actionable items.
- **Next:** other eligible items, including on-demand analysis candidates.
- **Monitor:** eligible items with pending checks, drafts superseded by new commits, or other temporarily non-actionable states.

Tracked-but-ineligible `unranked` items never enter Now, Next, or Monitor; they remain visible in All Tracked.

Deterministic queue order is always the default. When current advisor output exists, the queue may show relevance, risk, explanation, recommended action, confidence, unknowns, and an explicitly selected **Advisor order** view. Advisor order is computed globally by the fixed current-advice, relevance, risk, and deterministic tie-break rules in section 10.4; it never uses batch position, alters Now/Next/Monitor membership, or hides items. Items with stale, failed, or no advice follow currently advised items and retain deterministic relative order. Stale or failed advice remains visibly labeled.

Every item shows all eligibility reasons, selected priority or `Unranked — ineligible`, every matching priority reason, deterministic analysis mode, selected domains and their winning reasons, source mode and freshness, CI state, current job state, optional advisor reason/staleness, and one primary action. For example, a dual match displays both `Path: src/**` and `Author: shubh-array`; author-only displays `On demand — author match does not auto-analyze`; an explicit unregistered request displays `Eligible — explicit request` and `Remote evidence only — source tree unavailable`.

The Review Workbench has:

1. **Understand:** intent, changed scope, commits, and checks.
2. **Verify:** application-verifiable provenance, findings, confidence, selected domains, source coverage, and unknowns.
3. **Act:** editable structured summary/inline comments with visible citations, and a separately selected `comment`, `request_changes`, or `approve` disposition.

The UI always states that CI results were observed and local checks were not run. Remote-evidence-only reviews additionally show a persistent missing-source-tree warning. Protected/filter omissions show a persistent coverage warning with omitted path names/reasons but never content. Editing a summary or inline body retains its current validated observation/provenance selections by default; the principal may explicitly select other current records from `validated-provenance.json`, but cannot type or invent a citation ID. A body-bearing operation with no current valid citation is visibly blocked from preview/publication. Inline citations remain derived from the selected finding observations and validated file/diff provenance. Agent confidence and recommended disposition are labeled advisory and cannot enable the publish control.

The workbench materializes one explicit summary-use choice before preview. For selected `comment` or `request_changes`, `draftSummary.body` and its non-empty validated citations become the body/evidence of that single GitHub `COMMENT` or `REQUEST_CHANGES` review operation and no separate summary-comment operation is created. For selected `approve`, the GitHub `APPROVE` operation is bodyless; the principal may separately choose to publish `draftSummary` once as its own body-bearing summary-comment operation with separate approval, or choose not to publish it. `needs_human` has no publish plan. The operation planner stores `draftSummaryUse: "review_body|separate_summary|not_published"` and rejects any plan that maps the same summary body hash to more than one external operation.

Every PR title/body, author/label/path, comment/review, check output, agent explanation/finding/draft, and Markdown field is untrusted browser content. The client renders plain fields through text nodes. Markdown parsing has raw HTML disabled and passes the resulting AST/HTML through a strict allowlist sanitizer before DOM insertion. Links permit only same-origin relative URLs, fragments, `https:`, and `mailto:`; all other schemes, event attributes, forms, iframes, objects, SVG, script, style, and active media are removed. External links use `rel="noopener noreferrer"`.

The client loads no runtime-generated script or style text, uses no `eval`/`Function`, and never derives a script URL, stylesheet, selector, element ID, event handler, or state-changing control markup from untrusted content. Action labels, confirmation text, hidden values, and preview content use typed data binding/text nodes rather than HTML interpolation.

### 10.10 Local API

The daemon binds only to loopback. It serves static UI assets and JSON endpoints for queue state, job control, drafts, approval, publication, health, and audit.

At startup it creates a random session secret and delivers it in a `Secure`, `HttpOnly`, `SameSite=Strict` cookie through the initial loopback page response. State-changing requests require same-origin checks and a single-use action token created by an explicit UI gesture and valid for 60 seconds. The API rejects non-loopback host headers and all cross-origin requests.

Every UI response includes a restrictive Content Security Policy equivalent to:

```text
default-src 'self'; script-src 'self'; style-src 'self'; img-src 'self';
font-src 'self'; connect-src 'self'; object-src 'none'; base-uri 'none';
frame-ancestors 'none'; form-action 'self'; worker-src 'none'; media-src 'none'
```

The server emits no inline script/style and also sets `X-Content-Type-Options: nosniff`. Sanitization and CSP are defense in depth; same-origin and single-use action-token checks remain mandatory even if untrusted rendering is compromised.

### 10.11 Publisher

`publication.mode` is `shadow` by default and disables the publisher. After rollout gates pass, the operator runs `pnpm ct publication enable`; the command reruns doctor, displays the active identity and gate evidence, requires confirmation, and writes `publication.mode: "gated"` to local machine config. `pnpm ct publication disable` immediately restores shadow mode.

When gated publishing is enabled, the publisher is the only component allowed to mutate GitHub. Before every operation it verifies:

- One unconsumed, single-use approval created within the previous 10 minutes exists for the exact canonical external-operation hash.
- The current PR head SHA equals the reviewed SHA.
- The approved run ID/run-input hash equals the job's current accepted sealed run.
- The exact operation type, actor, target, GitHub review event when applicable, body hash/null, disposition, and content hash equal the approved values.
- Every body-bearing inline, summary-comment, `COMMENT`, or `REQUEST_CHANGES` review operation has a non-empty cited provenance set and every cited record remains valid for the reviewed source and GitHub snapshot.
- The authenticated GitHub login equals the configured operator.
- The approved idempotency key has not completed.

One external operation has exactly one type: `inline_comment`, `summary_comment`, `comment_review`, `request_changes_review`, or `approve_review`. Its canonical hash binds operation type; normalized principal actor identity; repository/PR and, for an inline comment, exact path/side/line range; exact GitHub review event (`COMMENT`, `REQUEST_CHANGES`, or `APPROVE`) when applicable; exact non-empty body hash or null; selected disposition; `draftSummaryUse`/summary body hash when relevant; current head SHA; accepted run ID and run-input hash; exact coverage hash; sorted cited provenance ID/record-hash set; and idempotency key.

`inline_comment` and `summary_comment` are body-bearing and require non-empty validated provenance. `comment_review` is one body-bearing GitHub `COMMENT` review operation using `draftSummary.body` and its non-empty validated provenance. `request_changes_review` is one body-bearing GitHub `REQUEST_CHANGES` review operation using the same structured summary contract. `approve_review` is the only operation permitted a null body hash and empty provenance set; it represents bodyless GitHub `APPROVE` and still binds accepted run/input, head SHA, and coverage hash. `needs_human` maps to no operation. If approval includes summary text, it is a distinct `summary_comment` with non-empty citations and its own approval; the summary-use plan and idempotency keys prevent that body from also being posted as a review body. The UI may preview the complete ordered operation set together, but it must create one explicit approval per operation and cannot create a batch approval.

Phase 1 uses the principal's GitHub identity for every inline/summary comment and every `COMMENT`, `REQUEST_CHANGES`, or `APPROVE` review operation. In the same transaction that records the first publication attempt, the publisher consumes that operation's approval before launching the subprocess; success, failure, timeout, or indeterminate response cannot reuse it. Partial failure records each completed operation. Continuation previews only the incomplete operations and requires one new approval for each; completed operations are never reapproved or replayed.

An operation approval is invalidated by any bound-field or summary-use change, draft edits, accepted-run/run-input change, a new PR head, policy/harness/context/provenance change, configured model-specification change, authenticated-login change, publication-mode change, daemon restart, first publication attempt, or the 10-minute TTL. An approval for one operation cannot authorize another operation or review event. Operation-type plus summary-body hash plus target/head/run forms part of the idempotency identity, so retry/reconciliation cannot post the same summary once as a standalone comment and again as a `COMMENT`/`REQUEST_CHANGES` review body.

Agent-reported confidence, risk, relevance, recommended action, or recommended disposition is never an approval and cannot satisfy any publisher guard.

### 10.12 Learning signals and governed proposals

Phase 1 records structured learning signals from day one. Signals are append-only audit events linked to immutable run identities:

- Attention outcome: `relevant`, `ignored`, or `escalated`, recorded from an explicit human action or final workflow transition rather than inferred from agent confidence.
- Draft outcome: `accepted`, `edited`, or `rejected`; edited drafts store the agent draft hash, final draft hash, and a structured text/inline-comment diff.
- Final disposition: no publication, comment, approve, request changes, closed, or superseded.
- Exact job ID/policy-decision hash, run ID/run-input hash, model role/specification/hash, complete harness manifest/hash, context/provenance hashes, source mode, selected domains, and provenance schema version.
- Queue wait, context preparation, agent duration, human verification duration when measurable from explicit UI events, publication duration, and the Cursor-reported usage fields.
- Connector, source, agent, validation, and publication failures, plus retry, cancellation, supersession, and stale-advice relationships.

Signals do not directly modify behavior. An agent may create a governed, versioned proposal only after a human explicitly starts `Propose profile change` and selects a bounded set of historical signals. The proposal agent receives redacted structured signals, current target files, applicable schemas, and a maximum of 50 historical runs or 2 MiB. It has the same no-shell, no-write, no-delete, no-MCP, no-network, no-source-view, and no-administrative-worktree restrictions as `pr-attention`.

Proposal generation uses the exact doctor-validated `primaryReview` model specification with run kind `profile-proposal`; it never falls back to `attention`. Its identity is the selected-signal hash, target base-content hashes, immutable proposal-contract hash, persona hash, and exact model-specification hash. It writes and hashes a complete ordered proposal manifest containing those application constraints and every input artifact.

A proposal may target at most four versioned engineer-owned files chosen from `policy.json`, `persona.md`, `harnesses/<feature>/prompt.md`, or the single allowlisted `harnesses/<feature>/skills/<skill>/SKILL.md`. Its strict result, capped at 1 MiB total and 256 KiB per replacement file, names each target, base content hash, complete proposed replacement content, rationale, expected effect, risks, and replay cases. It cannot target local machine config, credentials, application safety, permissions, schemas, organization authority, protected paths, evidence rules, or publisher guards.

Before adoption, application code must:

1. Validate the proposal schema, exact base hashes, target allowlist, and resulting policy/harness schemas.
2. Materialize a candidate ordered harness manifest and run the versioned historical replay corpus for the affected role using the exact proposed content and configured model specification.
3. Store replay inputs, outputs, failures, role-specific evaluation metrics, and before/after manifest hashes.
4. Present an exact line-by-line preview, replay deltas, failures, and all resulting hashes to the human.
5. Require an explicit single-use adoption action naming the exact proposal version and content hashes.
6. Recheck base hashes and atomically write only the previewed engineer-owned files; otherwise reject as stale.

Rejected, stale, or failed proposals remain audit records and change nothing. There is no background proposal generation, automatic adoption, autonomous profile mutation, or silent learning.

## 11. Core flows

### 11.1 Discover

1. Confirm the host remains healthy and its authenticated login still equals normalized `profile.githubLogin`.
2. Poll explicit review requests using that exact configured login and poll active repositories; never substitute `@me`.
3. Normalize source facts and update checkpoints.
4. Retrieve canonical author login, changed-file names, review-request state, and check summaries for policy evaluation and queue display.
5. Upsert every discovered PR into authoritative All Tracked coverage.
6. Compute exact eligibility or exclusion reasons using `explicitRequest || (activeRepository && (eligiblePath || eligibleAuthor))`.
7. For eligible items compute default/selected priority with all rule reasons; for tracked-ineligible items assign `unranked`; deterministically deduplicate/order selected review domains with all rule reasons.
8. Compute auto-analysis only from eligible selected tiers and queue only deterministic auto-analysis items; leave on-demand, unranked, stale, and failed items visible.

### 11.2 Advise

1. If `pr-attention` is enabled, select the bounded candidate batch deterministically; mark over-capacity current identities `not_scheduled` for the next poll and do not automatically select failed exact identities.
2. Freeze candidate metadata, materialize the canonical attention-relevant policy snapshot as manifest layer 2, complete the ordered attention manifest, and freeze the exact `attention` model specification.
3. Launch one metadata-only Cursor process without a source view, administrative worktree, or `--add-dir`.
4. Validate exact candidate coverage, identities, enums, lengths, absence of a model-authored rank field, and strict schema.
5. Atomically store the latest valid per-PR advice under each exact staleness identity while retaining the immutable batch artifact.
6. Recompute global Advisor order from fixed relevance/risk ordinals and the deterministic queue tie-breaker without changing coverage, eligibility, auto-analysis, or default order.
7. Mark advice stale when any identity input changes and record attention outcome signals from subsequent explicit human actions.

### 11.3 Analyze

1. From discovery/policy facts only, create or reuse the queued job identity and freeze its repository/PR/head SHA, source mode, and policy-decision hash; record auto/human queue triggers as audit events, not identity inputs.
2. Stream and filter the GitHub diff before any persistence; fetch commits, discussion, reviews, and detailed checks; record protected/unsafe/truncated omissions without protected contents.
3. For `registered-source`, perform authenticated mirror/fetch, terminate that boundary, then perform credential-free exact SHA verification and safely materialize an allowed regular-blob source view/manifest. For `remote-evidence-only`, record missing source-tree coverage and create neither.
4. Create application-owned provenance only for allowed filtered diff hunks, checks, comments/reviews, and commits.
5. Materialize the complete ordered review harness manifest, including canonical policy snapshot and frozen input/provenance hashes, and freeze the exact `primaryReview` model specification.
6. Compute the run-input hash, transactionally allocate a new attempt/run directory, write create-once frozen inputs/refs/manifest, and commit run state before Cursor launch.
7. Launch one Cursor CLI review process, adding only the filtered source view for `registered-source`.
8. Validate the terminal result, strict review schema, exact coverage declaration, catalog references, allowed-manifest file repository/blob/path/ranges, and filtered inline diff locations.
9. Create output/validation/provenance/terminal artifacts once, seal the run, then transactionally update `latestRunId`; update `acceptedRunId` only on successful validation, and record learning signals.
10. Remove the run's administrative worktree/source-view pair and show the accepted draft, explicit missing coverage, or visible failure. Retry creates a new immutable run; changed job-level facts create a new job.

### 11.4 Publish

1. The principal verifies and edits the draft.
2. The principal selects `comment`, `request_changes`, or `approve`; `needs_human` cannot proceed.
3. The UI freezes exactly one summary-use plan: review body for `COMMENT`/`REQUEST_CHANGES`, optional separate summary comment for `APPROVE`, or not published for bodyless `APPROVE`.
4. The UI previews the complete ordered external-operation set, including each operation's principal actor, exact type/event/target, body hash or null, disposition, summary-use choice, head SHA, accepted run/run-input, coverage hash, provenance set, idempotency key, and canonical operation hash. Every body-bearing operation shows non-empty application-validated citations; only `approve_review` shows empty provenance.
5. The principal explicitly approves each operation separately; each approval is single-use and binds only that operation hash. The preview creates no batch approval.
6. For each approved operation, the publisher revalidates every bound input and transactionally consumes that approval when recording the first attempt.
7. It performs only that one approved operation through the principal identity and records its GitHub response/idempotency state.
8. After a partial failure, it presents only incomplete operations for fresh per-operation approval; completed operations and consumed summary-body mappings are retained and not replayed under another operation type.
9. It records structured draft feedback after the operation set reaches a terminal human-selected outcome.

### 11.5 Propose and adopt a profile change

1. A human selects bounded learning signals and explicitly starts a proposal run.
2. The proposal agent returns a strict, versioned replacement proposal without writing files.
3. The application validates targets, schemas, and base hashes.
4. Historical replay runs for the affected named role and stores exact inputs, results, and role-specific metrics.
5. The human previews the exact patch and replay deltas.
6. Explicit adoption with matching hashes atomically updates only allowlisted engineer-owned files.
7. The application records adoption or rejection; no proposal silently changes runtime behavior.

## 12. Failure handling

- **GitHub unavailable or rate-limited:** preserve last-known state, show freshness, back off with jitter, and never claim complete coverage.
- **GitHub operator identity mismatch:** keep the host and overall control tower unhealthy, preserve last-known state, and disable polling and new jobs for that host until `gh api --hostname <host> user --jq .login` exactly matches normalized `profile.githubLogin`. The publisher's separate authenticated-login recheck remains mandatory for every attempted mutation.
- **Diff filter ambiguity/failure:** retain no diff body or hunk provenance, record `diff_filter_failed`, keep path names already safely parsed, and require visible human handling of incomplete coverage.
- **Laptop sleep or daemon restart:** apply the guarded recovery rules in section 10.5, catch up before declaring freshness, and clean abandoned agent processes and admin/source pairs.
- **Unregistered repository:** run remote-evidence-only analysis with explicit missing source-tree coverage; do not create a mirror, administrative worktree, or source view or imply full-source review.
- **Authenticated mirror/fetch failure:** terminate the credential-bearing child/environment, keep the item visible, and fail the source-backed job without entering verification/materialization.
- **Credential-free SHA/tree/object/materialization failure:** keep the item visible and fail the source-backed job without reintroducing credentials/network, substituting a developer checkout, running checkout behavior, or silently downgrading. Offer an explicit human-started remote-evidence-only run.
- **Cursor auth/model/version/role mismatch:** doctor blocks the affected role's new runs while discovery remains active. There is no fallback model.
- **Attention advisor failure or staleness:** show unavailable/stale advice, preserve All Tracked and deterministic order, and continue deterministic auto-analysis.
- **Agent timeout/crash/malformed output:** seal the immutable run as failed, retain bounded per-run logs, remove its admin/source pair, and offer manual retry as a new run.
- **Unknown or invalid provenance:** fail validation, retain the agent result for audit, and create no draft.
- **New PR commit:** cancel or supersede the old job and never publish its draft.
- **Publication partial failure:** retain per-operation completion and the frozen summary-use/idempotency mapping, preview only incomplete operations, and require a fresh single-use approval for each incomplete operation before continuing; never reapprove, replay, or remap a completed summary/review body.
- **Configuration error:** retain the last valid runtime configuration; do not partially apply an invalid edit.
- **Proposal validation or replay failure:** preserve the proposal and failure evidence, disable adoption, and leave profile files unchanged.

## 13. Security model

PR metadata, text, code, comments, CI output, repository documentation, historical signal text, proposal-agent output, and repository-local Cursor assets are untrusted data.

They cannot:

- Change system, profile, or skill instructions.
- Change deterministic discovery, eligibility, auto-analysis, domain routing, policy, or permissions.
- Activate MCP servers, hooks, setup scripts, or subagents.
- Execute repository code.
- Read protected files or host credentials.
- Enable publication.
- Create trusted provenance, authorize an action through confidence, or adopt their own learning proposal.

A no-checkout Git administrative worktree is lifecycle bookkeeping, not a security boundary. Security comes from streaming protected-diff filtering, direct allowlisted blob materialization without checkout behavior, an isolated primary workspace, ask mode, sandboxing, explicit permissions, a fail-closed read hook, sanitized child environments, and a human publication gate.

The authenticated Git fetch boundary is the only Git subprocess boundary with SSH-agent or credential-helper access and accepts only the catalog remote/refspec. Fetch-process exit closes that boundary; a separately constructed credential-free/network-disabled child verifies exact SHA before hardened local materialization proceeds with local object IDs only.

Every agent role in Phase 1 denies shell, writes, deletes, MCP, browser/network fetches, and arbitrary commands. `pr-attention`, proposal runs, and remote-evidence-only review receive no source view. Registered filtered source views are transient, contain only allowed regular blobs, and are available only to `primaryReview` read tools. No agent process receives GitHub, SSH, Git credential-helper, Linear, package-registry, cloud, or repository credentials.

Sensitive default patterns include:

```text
**/.env
**/.env.*
**/.cursor/mcp.json
**/appsettings.secrets.json
**/appsettings.Local.json
**/*.pem
**/*.key
**/*.pfx
**/deploy.*.parameters.json
**/deploy.*.parameters.jsonc
```

Changed-path names may be inventoried after canonicalization. Source bytes obtained from a protected path are never read from Git objects, persisted, logged, placed in SQLite/artifacts, assigned provenance, rendered in the browser, or sent to an agent. Protected diff bytes are discarded by the streaming parser before any sink. Only canonical omitted path names and explicit missing-coverage reasons survive. These guarantees apply equally to registered-source and remote-evidence-only paths.

PR bodies, comments, check text, and agent text remain arbitrary untrusted user-supplied strings and could independently quote any text; they are not represented as protected-file contents or trusted evidence. Known secret-pattern redaction still applies to logs, but the protected-path guarantee is specifically enforced by never ingesting system-retrieved protected source/diff bytes. Browser text/Markdown additionally follows the sanitizer and CSP boundary in sections 10.9–10.10.

## 14. Testing and evaluation

### Deterministic tests

- Config schemas, migrations, repository mapping, named model roles, feature/domain harness allowlists, complete ordered manifests, and invalid-config rollback.
- Canonical path/glob conformance fixtures shared by eligibility, priority, domain, protected diff/source, provenance, and read-hook consumers: root anchoring, case sensitivity, UTF-8/NFC, `/`, `*`, `?`, whole-segment `**` with zero/multiple segments, nested protected defaults, unsafe paths, unsupported syntax, duplicate patterns, and proof every consumer uses the same content-hashed matcher artifact/version.
- `gh` fixture parsing, pagination, checkpoints, rate limits, retries, deduplication, and streaming diff filtering before every persistence/log/context sink.
- Protected-diff fixtures for text, binary, rename/copy, deletion, quoted paths, malformed headers, parser failure, and mixed allowed/protected files in both source modes; assert only omitted path names/coverage remain and no protected bytes or provenance occur in files, SQLite, logs, transcripts, prompts, or browser payloads.
- Per-host operator-identity fixtures proving discovery sets sanitized `GH_HOST`, passes the exact normalized configured login to `--review-requested`, never uses `@me`, lowercases only for equality, and keeps the system unhealthy with polling/new jobs disabled when `gh api --hostname <host> user --jq .login` differs or fails.
- Eligibility truth-table fixtures for: explicit request in active and inactive/unregistered repositories; active path-only; active author-only; active path-and-author; active neither; and inactive path/author matches. Assert exact `explicit || (active && (path || author))` semantics and every reason record.
- Author normalization fixtures for ASCII case, surrounding config whitespace, invalid logins, duplicate normalized logins, exact equality, and rejected prefix/substring/display-name/team matches.
- Priority fixtures for the exact `p0 > p1 > p2 > p3 > unranked` sort order, default eligible `p3`, tracked-ineligible `unranked` reasons, all matching reasons, winning tier/earliest declaration, rejection of `unranked` in policy, impossibility of unranked auto-analysis, unknown timestamps, the complete All Tracked/advisor tuple, eligible-only Focus Queue membership, author-only on-demand behavior, fairness, and stable coverage.
- Deterministic domain fixtures for all matching reasons, per-domain highest-numeric/earliest-declaration winner, single selection per domain, cross-domain order/tie-breakers, priority range, three-domain bound, missing domain file, and review-only organization/engineer domain routing.
- Attention-manifest fixtures proving layers 4/5/7 are empty, repository/domain guidance never affects attention currentness, per-PR policy/guidance hashes exclude unrelated batch candidates, and layer 9 contains only batched metadata.
- Attention candidate bounds, input truncation, deterministic candidate selection, exact candidate output coverage, rejection of a model-authored rank field, batch and per-PR identities, metadata staleness, atomic per-PR promotion, schema failure, timeout, and proof that advice cannot hide a PR or enqueue/publish work.
- Advisor candidate-state fixtures for over-capacity `not_scheduled`, next-poll eligibility, exact-identity failure suppression, manual retry, changed-identity supersession, and transactional attempt allocation.
- Global Advisor-order fixtures merging current per-PR advice from different partial batches: fixed relevance ordinal, then risk ordinal, then deterministic queue tuple; stale/no-advice items last in deterministic relative order; and identical results regardless of batch partition or arrival history.
- Guarded attention/job/run state-transition tests for expected-state/version compare-and-set, duplicate event idempotency, terminal immutability, manual-only failed retry, restart leases, publication reconciliation, cancellation, closure/reopen, and supersession.
- Pre-context job-identity fixtures proving queueing requires no harness/context/provenance/model hash; context/harness/model changes produce distinct run-input hashes under the same job; job-level fact/policy-decision changes create/supersede jobs; retries get sequential immutable run IDs; and no attempt overwrites an earlier run.
- Authenticated-fetch versus local-materialization boundary tests inspect argv/environment and network calls: fetch alone may receive the SSH socket/trusted credential helper and explicit catalog remote/refspec; local SHA/tree/object/worktree commands receive no network credentials/helpers, use hardened config/protocol denial, and cannot invoke a remote.
- No-checkout admin worktree and direct-blob materialization tests with malicious repository/global hooks, attributes, clean/smudge/process filters, submodules, symlinks, special modes, unsafe/Unicode/case-colliding paths, protected blobs, fork refs, SHA/tree/blob verification, crash cleanup, and disk limits. Assert no hook/filter/submodule/setup/network execution and no Git metadata in the exposed view.
- Remote-evidence-only explicit-request fixtures proving complete filtered GitHub evidence retrieval, missing source-tree coverage, no mirror/admin/source-view/`--add-dir`, no file provenance, and full-source gating on registration.
- Cursor NDJSON success/error/truncation fixtures for both model roles, role-specific timeout escalation, exact init-model validation, malformed result, and schema validation.
- Application-created provenance fixtures for valid and invented diff/check/comment/commit IDs; repository mismatch; stale/wrong blob; protected/traversal path; invalid/reversed/out-of-range file range; remote file claim; invalid inline diff location; structured summary observation/provenance validation; and deterministic non-empty inline citation derivation from finding observations plus file/diff provenance.
- Harness precedence fixtures proving immutable rules win, all nine layers retain order, `policy.snapshot.json` is the sole layer-2 artifact, every artifact has one layer and stable entry ordinal, untrusted PR input is last, filesystem enumeration cannot affect order, and every entry contributes to the manifest hash.
- Protected-path hook and child-environment filtering.
- Browser security tests inject stored-XSS payloads through PR titles/bodies, labels, paths, comments, checks, agent Markdown/findings/drafts, links, and action previews; assert text/sanitized rendering, raw HTML disabled, unsafe schemes/attributes removed, no untrusted control interpolation, restrictive CSP/no inline script-style, and unchanged same-origin/action-token enforcement.
- Publisher fixtures proving one canonical hash and one explicit single-use approval per `inline_comment`, `summary_comment`, `comment_review`, `request_changes_review`, or `approve_review`; exact principal actor/type/event/target/body-or-null/disposition/summary-use/head/run/coverage/provenance/idempotency binding; required non-empty body/citations for GitHub `COMMENT` and `REQUEST_CHANGES`; mandatory non-empty validated summary/inline provenance after edits; blocked empty/stale/invented body-bearing citations; bodyless/empty-provenance-only `APPROVE`; non-publishable `needs_human`; explicit `draftSummary` mapping and rejection of duplicate standalone/review-body publication; optional separately approved summary comment for `APPROVE`; no batch approval from a complete-set preview; first-attempt consumption on success/failure/timeout/indeterminate response; cross-operation/event rejection; and fresh approvals only for incomplete operations after partial failure without summary remapping.
- Learning-signal completeness for attention/draft/disposition outcomes, hashes, timing/usage, failures, and supersession.
- Proposal target allowlist, schema/base-hash validation, historical replay requirement, exact preview hash, single-use adoption, stale rejection, atomic write, and no silent mutation.
- Phase 1 handoff-baseline fixtures proving canonical sealed contract/implementation manifest hashing, immutable corpus/results and metric-definition/schema hashes, reproducible references, and exclusion of Phase 2 identity/evaluation fields.
- End-to-end tests with fake `gh`, Git, Cursor, credential, and publisher adapters.

### Agent evaluation corpus

Maintain separate, versioned corpora for each named role.

The `attention` corpus contains bounded candidate batches with natural-language priority profiles and expected relevance/risk ranges, must-escalate candidates, forbidden escalations, unknowns, and acceptable recommended actions. It includes metadata truncation, prompt injection, conflicting priorities, indistinguishable candidates, stale metadata, incomplete checks, and different batch partitions of the same PR set. Measure must-escalate recall, false escalation, explanation usefulness, unknown disclosure, and stability of the application-derived Advisor order over five repeated runs with the exact same model and manifest. The offline gate is at least 90% must-escalate recall, at most 10% false escalation on explicitly low-risk cases, and at least 0.8 Jaccard similarity for the derived top-three set across repeats. Any omitted/extra candidate, model-authored rank field, or invalid schema is a failed run, not a low score.

The `primaryReview` corpus contains historical and synthetic single-PR cases covering:

- Correctness and maintainability findings.
- Benign changes with no findings.
- Failed/pending CI and incomplete context.
- Large or truncated diffs.
- Registered-source and remote-evidence-only versions of the same review, with required missing-coverage disclosure.
- Protected-path changes whose contents are absent and must remain explicit unknown coverage without invented provenance.
- Frontend cases whose validation is limited to source, diff, test-code, and CI inspection.
- Prompt injection through every untrusted input.
- Sensitive tracked files that must not be read.
- Valid and tempting-but-unverifiable provenance references.

Each case defines required findings, forbidden claims, acceptable uncertainty, required evidence, and disposition range.

Measure finding recall, false-positive rate, provenance validity, unsupported claims, draft usefulness, and repeated-run stability. Provenance validity is a hard application gate: no draft with an unknown or invalid reference enters the workbench.

Proposal replays use the affected role's same corpus, pinned case inputs, exact candidate harness manifest, and exact configured model specification. Role metrics are reported separately; attention relevance/risk and derived-order metrics are never substituted for primary-review finding metrics.

### Rollout

1. **Offline fixtures:** all deterministic gates and role-specific agent corpus gates.
2. **Historical replay:** current profile, exact model roles, harness manifests, filtered evidence provenance, immutable multi-attempt runs, and both source modes against closed PRs; no publication.
3. **Live shadow:** authoritative All Tracked coverage, deterministic auto-analysis, advisory attention output, filtered/source-limited drafts, recovery/state telemetry, learning signals, stored-XSS probes, and proposal previews; publisher disabled and deterministic queue order remains the default.
4. **Gated publishing:** enabled only after quality and security gates pass.

`pr-attention` can be disabled independently at every stage. Its outage or failure cannot block discovery, deterministic auto-analysis, primary review, or human publication workflow. No learning proposal may be adopted until its schema, replay, and preview gates pass.

## 15. Acceptance criteria

### Onboarding and portability

- A new authenticated engineer reaches a healthy queue within 15 minutes without editing application code.
- Repositories can be added, disabled, removed, or remapped through config alone.
- Doctor verifies the authenticated GitHub login equals normalized `profile.githubLogin` for each host before healthy operation; discovery queries that exact login rather than `@me`.
- Doctor rejects any noncanonical path glob, and eligibility/priority/domain/protection/materialization/provenance/read-hook fixtures produce identical case-sensitive root-anchored matcher results.
- Feature-grouped organization and engineer harnesses compose in the specified nine-layer order without a generic deep merge, and every run stores the explicit policy snapshot, complete manifest, and hash.
- Doctor validates the exact configured `attention` and `primaryReview` model specifications and rejects unavailable or substituted models before the affected role runs.
- The implementation passes fixture scale tests for 20 repositories, 200 open PRs, and 20 review jobs per day.
- Different default branches, dirty developer checkouts, and repository/global Git hooks, attributes, filters, and submodule settings do not affect or execute during reviewed-source materialization.

### Coverage and resources

- During healthy operation, explicit requests and policy matches appear within one five-minute poll.
- Every explicit review request is eligible. Every non-explicit PR is eligible exactly when its repository is active and path OR normalized author matches; all matching and exclusion reasons are visible and auditable.
- Author-only eligibility remains on-demand unless an independent deterministic auto-analysis rule matches.
- Every eligible PR receives exactly one selected tier from `p0 > p1 > p2 > p3`, defaults to `p3`, retains every matching priority reason, and uses the specified winner and complete stable queue tie-breakers.
- Every tracked-ineligible PR is `unranked` after `p3` in All Tracked/advisor ordering, can never auto-analyze, and never enters the Focus Queue.
- Every review domain is selected once from all stored matching reasons using highest numeric priority/earliest declaration and is globally ordered deterministically; attention receives no domain or repository guidance.
- All Tracked retains every discovered active-repository PR and explicit request regardless of advisor result, failure, filtering, or confidence.
- Deterministic domain rules select the same ordered domains for the same repository/path set, and frontend guidance never causes execution.
- Tracking 200 PRs creates zero administrative worktrees or source views until jobs start.
- Default concurrency never exceeds one agent; configured concurrency never exceeds two.
- At most four active admin/source pairs exist, abandoned pairs are removed after restart, and storage stays within the configured budget.
- Auto-analysis follows the hybrid policy exactly; on-demand items remain visible.
- Attention and remote-evidence-only jobs create no administrative worktree or source view. An unregistered explicit request can produce a filtered GitHub-evidence draft with persistent missing-source-tree coverage, while full-source review stays disabled until registration.

### Agent contract and safety

- Doctor detects unauthenticated Cursor/GitHub, authenticated/configured GitHub-login mismatch, unavailable exact role model, model substitution, unsupported CLI, mismatched remotes, invalid harness/domain files, and invalid config.
- Timeout, signal termination, non-zero exit, missing result, malformed JSON, and schema mismatch are visible and recoverable.
- No repository-defined command, hook, filter, submodule action, dependency installation, build, test, Compose stack, or `.cursor/worktrees.json` setup runs in Phase 1; only sanitized application-owned Git fetch/tree/object/worktree plumbing runs.
- Only the authenticated fetch subprocess can access SSH/credential-helper state and an explicit catalog remote/refspec. After SHA verification, local materialization has no network credential/helper/protocol path, and Cursor inherits neither boundary.
- No analysis or proposal agent has shell, write, delete, MCP, browser/network-fetch, arbitrary-command, or credential access.
- System-retrieved protected source/diff bytes never enter a prompt, transcript, artifact, log, browser payload, or SQLite. Only omitted protected path names and missing-coverage metadata persist, and no provenance exists for omitted content.
- Every finding resolves through application-created catalog provenance or a validated repository/blob/path/line range; invented or stale references fail validation and every unknown remains explicit.
- Attention advice is useful and stable against its role corpus, and timeout, malformed output, stale advice, or total advisor failure leaves deterministic coverage and auto-analysis unchanged.
- Advisor order is globally reproducible from current per-PR relevance/risk outputs and deterministic queue tie-breakers across arbitrary bounded batch partitions; no current advice is compared by a batch-relative rank.
- Self-reported relevance, risk, confidence, recommended action, and recommended disposition cannot authorize analysis or an external action.
- Every Cursor retry has a distinct immutable run ID/directory and sealed manifest/input/transcript/output/validation; earlier attempts are never overwritten and job pointers reference only sealed runs.

### Runtime state and recovery

- Attention items, review jobs, advisor candidates/runs, and Cursor attempts accept only the guarded transitions in section 10.5; duplicate delivery is idempotent and terminal states are immutable.
- A review job is created from pre-context facts only. Complete manifest, context/source/coverage, provenance catalog, and model hashes participate only in immutable run-input/run identity; changing them cannot circularly change the owning job ID.
- Over-capacity advisor candidates are `not_scheduled` and eligible next poll; failed exact identities receive no automatic retry, while manual retry and changed-identity supersession behave as specified.
- Attempt allocation and state/audit/pointer changes are transactional. Restart recovers queued/preparing work, fails orphaned agent attempts without retrying them, reconciles publication without replay, and removes only unleased source pairs.

### Human workflow

- No external mutation occurs without an exact recorded single-use approval for that one hashed operation; a complete operation-set preview creates no batch authority.
- Every published inline/summary comment and every `COMMENT`/`REQUEST_CHANGES` review body is non-empty and has a non-empty application-validated provenance set that survives or is explicitly reselected after editing; only bodyless `APPROVE` has empty provenance, while still binding accepted run/input/head/coverage.
- `needs_human` cannot publish, and `draftSummary` is used exactly once: as the required `COMMENT`/`REQUEST_CHANGES` review body, or optionally as a separately approved summary comment accompanying bodyless `APPROVE`, never both.
- No stale-head, wrong-actor, wrong-type/event/target, wrong-run/coverage/provenance/idempotency, edited-after-approval, cross-operation, duplicate summary, or duplicate review is published; first attempt consumes the approval, and the publisher rechecks authenticated GitHub identity independently even though doctor already gates host health.
- Stored-XSS payloads from every untrusted PR/agent/Markdown field execute no script/style or automatic navigation, cannot alter state-changing controls, and are constrained by text/sanitized rendering, safe URL schemes, CSP, same-origin checks, and action tokens.
- After at least 30 routine PRs in the 30-day pilot, median active verification time is at most two minutes and at least 70% of drafts are accepted or receive wording-only edits.
- Connector, source-materialization, agent, validation, or publication failures remain visible and recoverable.

### Learning and governance

- Every attention result can be resolved to `relevant`, `ignored`, or `escalated`; every draft to `accepted`, `edited`, or `rejected`; and every run records final disposition, model/harness/context hashes, timing/usage, failures, and supersession.
- A proposal cannot be adopted without an allowlisted target, valid schema and base hashes, affected-role historical replay, stored exact preview and deltas, and explicit single-use human adoption.
- Proposal agents never write profile files. Rejected, failed, or stale proposals leave runtime behavior unchanged and remain auditable.
- Replaying the audit record reproduces the exact proposal version, before/after content hashes, manifest hashes, model specification, corpus inputs, evaluation results, preview, and adoption identity.

## 16. Explicit decisions

- Generic engine plus organization/profile configuration, not hard-coded repositories.
- Independent application checkout with configurable workspace roots.
- Shared organization catalog, portable engineer profile, and local machine config.
- Deterministic coverage and authority; agentic judgment and advice.
- Explicit configured-operator discovery with per-host doctor identity equality; no `@me` alias and no weakening of the publisher's per-mutation identity recheck.
- One root-anchored, case-sensitive canonical path/glob contract and compiled matcher across policy, protection, materialization, provenance, and read enforcement; depth-independent protected defaults.
- Author-or-path eligibility for active repositories, with explicit review requests always eligible and exact reasons retained.
- Author-only eligibility is on-demand unless another deterministic auto-analysis rule applies.
- Optional metadata-only `pr-attention` relevance/risk advice with authoritative All Tracked coverage, no model-authored numeric rank, and globally derived deterministic Advisor order.
- Exact `p0 > p1 > p2 > p3 > unranked` sort semantics, where `unranked` is an ineligible-only non-tier, with all reasons, deterministic winner, and total All Tracked/advisor order.
- Feature-grouped `pr-attention` and `pr-review` harnesses, review-only domain/repository guidance, deterministic domain dedup/order, exact nine-layer composition with an explicit policy snapshot, and complete per-run manifest hashes.
- Named `attention` and `primaryReview` model roles with exact doctor validation, run recording, and role-specific evaluation.
- No secret `.env` for the control tower.
- `gh`/Git for deterministic GitHub operations; Cursor CLI for all AI.
- Hybrid auto-analysis, not a Cursor run for every tracked PR.
- Separate authenticated explicit-fetch and credential-free hardened local-materialization subprocess boundaries.
- Control-tower-owned mirrors, no-checkout administrative worktrees, and directly materialized filtered regular-blob source views for registered review; no developer checkout, hooks, filters, submodules, setup, network protocol, or Git metadata exposure.
- Streaming protected-diff filtering before every sink, path-name/missing-coverage retention only, and no protected-content provenance in either source mode.
- Concrete remote-evidence-only review for unregistered repositories, with filtered diff and explicit missing source-tree coverage.
- CI/source/diff/test-code inspection only; no local PR, frontend, browser, build, or test execution in Phase 1.
- Application-created provenance IDs and validated file repository/blob/path/ranges, never model-authored evidence IDs.
- One `primaryReview` reviewer; no specialists or default agent swarm.
- Pre-context fact/policy job identities plus immutable content-hashed run-input identities/directories containing manifest/context/provenance/model hashes; retries never overwrite prior attempts and Git history is optional.
- Guarded transactional item/job/advisor/run transitions, explicit retry/supersession rules, and idempotent restart recovery.
- Text/sanitized untrusted rendering, safe URL schemes, restrictive CSP, and unchanged same-origin/action-token controls.
- Structured learning signals and governed, replayed, explicitly adopted proposals; no silent learning or autonomous profile mutation.
- SQLite migrations for delivered Phase 1 records instead of speculative Phase 2 fields.
- Shadow mode before gated publication.
- Exact per-operation human approval for every GitHub mutation through the principal identity; first attempt consumes it, batch approval is forbidden, and agent confidence never grants authority.

## 17. Phase 2 handoff contract

Phase 2 may rely only on delivered, tested Phase 1 interfaces:

- Repository catalog and local mappings.
- GitHub adapter and normalized work graph.
- Deterministic tracking/eligibility/auto-analysis reasons, configured-operator identity contract, authoritative All Tracked coverage, latest current per-PR attention advice, and globally derived Advisor order.
- Canonical repository path/glob matcher and `unranked` All Tracked/advisor ordering sentinel.
- Versioned schemas and migration runner.
- Named model-role specifications and role-specific run identities.
- Exact priority/domain reason, winner, ordering, and tie-break contracts.
- Feature-grouped nine-layer harness composition, review-only domain/repository guidance, exact run-relevant policy snapshots, complete ordered manifests, and hashes.
- Streaming filtered-diff boundary, safe regular-blob source materializer, allowed/omitted source manifest, context coverage declaration, strict attention/review results, application-owned provenance catalog, and validated file provenance.
- Pre-context job identity, run-input identity with manifest/context/provenance/model hashes, guarded state machines, transactional attempts/pointers, immutable sealed per-run artifacts, and restart/idempotency rules.
- Cursor CLI runner and bounded worker pool.
- Authenticated-fetch/credential-free-local boundary, registered-source mirror/no-checkout-admin/filtered-view manager, and remote-evidence-only review path.
- Browser untrusted-rendering, sanitizer, CSP, same-origin, and action-token boundary.
- Human approval and publisher guards.
- Structured learning-signal schema and governed proposal/replay/adoption audit records.
- A sealed immutable Phase 1 baseline release manifest whose canonical contract/implementation hash binds the delivered application version, schemas/migrations, safety/provenance contracts, model-role/harness contracts, and acceptance scope, together with separately content-hashed evaluation corpus/results and metric-definition/schema artifacts. These hashes contain no Phase 2 capability identity or evaluation field and are the only Phase 1 baseline inputs a Phase 2 `phase1_contract` declared-baseline payload may reference.

Phase 2 must treat Phase 1 provenance IDs as application-owned and must not reintroduce model-authored evidence identifiers. It must preserve repository/blob/path/range validation when adding new evidence types or specialist inputs.

Phase 2 must not weaken canonical path/glob semantics, streaming protected-content exclusion, the authenticated-fetch/credential-free-local boundary, safe no-checkout object materialization, immutable per-run attempts, guarded transitions, or the browser sanitizer/CSP/action-token boundary.

Phase 2 must not assume reserved database fields or an unchanged job identity. Each Phase 2 increment defines its own migrations, context versions, staleness rules, and acceptance gates in the companion specification. It may consume learning signals and adopted versions, but it may not infer permission for silent learning, autonomous profile mutation, repository execution, or publication.
