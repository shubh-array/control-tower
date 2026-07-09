# Principal Engineer Control Tower

**Date:** 2026-07-09  
**Status:** Approved design  
**Audience:** Principal engineer and implementation team

## Summary

Build a single-user, local-first attention control tower for a principal engineer overseeing high-velocity engineering work across GitHub and Linear.

The product is not an activity dashboard. Its primary surface is a small, ranked queue of decisions that need the principal engineer's attention. A deterministic local control plane guarantees source coverage, persistence, and safe actions. Local coding agents provide judgment for PR review, cross-repository analysis, delivery interpretation, briefings, and contextual questions.

Version 1 combines two vertical capabilities:

1. **Attention and delegated PR review:** discover every eligible PR, perform an evidence-backed review using the principal engineer's explicit persona, and prepare gated external actions.
2. **Delivery intelligence:** connect GitHub changes to Linear issues, projects, milestones, and initiatives so progress, blockers, scope changes, and missing follow-up work are visible.

The primary success criterion is time saved. A routine reviewed PR should require approximately one to two minutes of human verification.

## Product principles

1. **Optimize attention, not information volume.** The home screen shows decisions, not a stream of everything that happened.
2. **Deterministic coverage, probabilistic judgment.** Code discovers and tracks all eligible work; agents interpret it.
3. **Evidence before confidence.** Every conclusion identifies inspected evidence, inferences, and unresolved unknowns.
4. **Authority remains explicit.** No external mutation occurs without recorded human approval.
5. **Local first.** The daemon, database, repository workspaces, agent execution, and UI run on the principal engineer's machine.
6. **Persona changes are governed.** Feedback can propose a lesson, but cannot silently alter future behavior.
7. **Progress is not PR volume.** Linear scope and status define planned progress; GitHub supplies delivery evidence.

## Goals

- Ensure no explicitly requested or policy-selected PR is missed while the daemon is online.
- Reduce active human review time for routine eligible PRs to approximately one to two minutes.
- Produce high-quality, evidence-backed review drafts using an explicit, versioned reviewer persona.
- Detect likely cross-repository implications and missing companion work across the core product repositories.
- Connect PR activity to Linear issues, projects, milestones, and initiatives.
- Surface a small ranked set of decisions with an understandable explanation of why each matters now.
- Provide daily and weekly in-app briefings.
- Support natural-language questions that open bounded, evidence-backed views over the work graph.
- Preserve a complete local audit trail of source state, agent work, human edits, approvals, and publications.

## Non-goals for version 1

- Slack, email, calendar, or other notification ingestion.
- Continuous cloud operation while the laptop is offline.
- Autonomous GitHub approvals, requested changes, merges, or Linear updates.
- Reviewing every PR across the organization.
- Replacing Linear as the planning system or GitHub as the code-review system.
- Full team project management, sprint planning, or individual productivity scoring.
- Silent persona learning from user behavior.
- Arbitrary agent-generated executable interfaces.
- A microservice platform, message broker, graph database, vector database, or container orchestration platform.

## Version 1 scope

### Eligible work

A PR is eligible for delegated review when either condition is true:

1. The principal engineer's review is explicitly requested.
2. The PR matches a configured repository or path policy.

Agent judgment may rank eligible work, but it cannot make an ineligible PR eligible. Policies may assign hard priority tiers and specialist review triggers.

Policy configuration can cover entire repositories or selected paths within:

- The four core product repositories: web application, agents, infrastructure, and API.
- Internal developer-productivity repositories that require principal approval.

No repository is implicitly treated as a whole-repository watch. The initial policy must explicitly identify each whole repository or path scope.

### External action boundary

- The agent prepares a review and proposed comments.
- The principal engineer verifies and may edit the draft.
- A dedicated bot identity posts approved analysis and inline comments.
- The principal engineer's GitHub identity performs the final approve or request-changes action.
- Every mutation is previewed, authorized, idempotent, and audited.

### Linear scope

Linear supplies planning context and the source-of-truth hierarchy:

`issue → project/milestone → initiative`

GitHub PRs are linked to Linear issues through the organization's mandatory ticket-link convention. The system uses these links to connect code delivery with planned work.

Progress is calculated from Linear scope, status, and estimates. GitHub state is supporting evidence. Merged PR count and code volume are never presented as progress.

## System architecture

Version 1 is one local TypeScript application with:

- A Node.js daemon hosting the local HTTP API, scheduler, connectors, and a bounded worker pool.
- A React browser client built as static assets and served by the daemon.
- A SQLite database for structured state.
- Filesystem storage for large logs, diffs, and review artifacts.
- A local agent-runner adapter that launches Cursor agent sessions.
- Disposable Git worktrees for checkout isolation.
- Optional per-repository Docker sandboxes for explicitly allowlisted commands.
- macOS `launchd` integration so the daemon runs whenever the laptop is awake.

The architecture has four layers:

1. **Authoritative sources:** GitHub and Linear.
2. **Deterministic core:** connectors, normalization, work graph, policy, scheduling, and audit.
3. **Agent runtime:** review, specialist analysis, delivery interpretation, briefings, and contextual question answering.
4. **Human workspace:** Focus Queue, Review Workbench, Delivery Map, briefings, command bar, and approval publisher.

The browser UI never calls GitHub, Linear, or an agent directly. All access passes through the local daemon.

## Components

### 1. GitHub connector

The connector incrementally retrieves:

- Organization-wide PRs that explicitly request the principal engineer's review, regardless of repository policy
- PRs and repositories covered by whole-repository or path policy
- PR metadata, authors, reviewers, labels, head and base SHAs
- Changed files and diff metadata
- Commits
- Existing reviews and comments
- CI/check status
- Linked Linear ticket identifiers

It uses existing local GitHub credentials, stores no token in SQLite, and checkpoints pagination and update timestamps. The default polling interval is five minutes while the daemon is online, with an immediate on-demand refresh from the UI.

### 2. Linear connector

The connector incrementally retrieves:

- Issues referenced by covered PRs
- Issues that mention, assign, or otherwise explicitly require the principal engineer
- Issues scoped to configured Linear teams, projects, milestones, and initiatives
- Projects, milestones, and initiatives containing those issues
- Status, estimate, assignee, priority, target date, and relationship changes

It uses a Linear API credential stored in the operating system credential store. The default polling interval is five minutes, with checkpointed catch-up after sleep or restart.

### 3. Normalizer and work graph

SQLite stores a relational graph rather than a separate graph database.

Core entity groups:

- GitHub: repositories, PRs, commits, files, checks, reviews, and comments
- Linear: issues, projects, milestones, initiatives, statuses, and estimates
- Links: PR-to-issue and Linear hierarchy/relationship edges
- Operations: attention items, jobs, agent runs, findings, evidence, drafts, approvals, and publications
- Governance: policy versions, persona versions, lesson proposals, and audit events
- History: source events and daily delivery snapshots

Large diffs, command output, and complete agent transcripts remain filesystem artifacts referenced by content hash and path.

### 4. Policy engine

Policy is declarative and versioned. It defines:

- Eligible repositories and paths
- Hard priority tiers
- Required principal approval areas
- Tracked Linear teams, projects, milestones, and initiatives
- Specialist triggers
- Allowed repository checks
- Maximum agent concurrency
- Retention rules

Eligibility is deterministic. The default rules are explicit review request or repository/path match.

Hard priority is also deterministic. Agent ranking operates only within those boundaries and considers:

- Urgency and deadlines
- Potential impact
- Whether other work is blocked
- Uncertainty or missing context
- Whether a decision is immediately actionable

The visible UI uses human-readable reasons. Internal numeric values are never the primary explanation.

If the ranking agent fails, deterministic hard priority followed by item age provides the fallback order. Ranking failure cannot hide an eligible item.

### 5. Job orchestrator

Each PR review job is identified by:

`repository + PR number + head SHA + policy version + persona version`

This identity deduplicates repeated discovery while ensuring that new commits or changed guidance trigger a new review.

Job states:

- `queued`
- `gathering_context`
- `running`
- `draft_ready`
- `awaiting_approval`
- `published`
- `failed`
- `superseded`

The initial worker pool runs at most two agent jobs concurrently. This is sufficient for the expected 10–20 daily PRs without creating a local resource spike.

### 6. Context builder

Before launching an agent, deterministic code assembles a bounded context bundle:

- PR metadata, diff, changed files, commits, and existing review state
- Linked Linear issue and its project, milestone, and initiative
- Relevant policy and persona snapshot
- CI/check results
- Repository-specific architectural guidance
- Related open or recent PRs across covered repositories
- Known contracts or paths implicated by the change

The bundle records missing data explicitly. Agent output may not imply that unavailable evidence was inspected.

### 7. Review worker

One primary agent session reviews each eligible PR. It receives read-only access to the disposable worktree, context bundle, and exact persona version.

Specialist passes run only when policy or change patterns trigger them. Initial specialists are:

- **Concurrency specialist:** races, ordering, reentrancy, retries, idempotency, and multi-instance behavior.
- **Cross-repository specialist:** contracts, companion changes, migrations, rollout ordering, and missing follow-up work.

The primary reviewer consolidates triggered specialist findings into one strict result:

- Change intent and implementation summary
- Evidence inspected
- Checks observed or run
- Findings with severity, confidence, file/line references, and rationale
- Draft inline and summary comments
- Cross-repository implications
- Unresolved unknowns
- Recommended disposition

A default multi-agent swarm is intentionally excluded. Additional sessions must be justified by a trigger because redundant agents increase cost, latency, and contradictory output.

### 8. Delivery analyzer

The analyzer creates daily snapshots and detects:

- PRs without valid mandatory issue links
- Completed issues with unmerged work
- Merged work linked to incomplete issues
- Stalled PRs or required reviews
- Scope added or removed after a milestone baseline
- Blocked issues and dependency chains
- Cross-repository change sets
- Likely missing companion PRs
- Target-date risk

Deterministic anomalies are separated from agent interpretations.

Milestone progress uses:

`completed estimate / total scoped estimate`

When estimates are missing, the UI shows estimate coverage and a separately labeled issue-count ratio. It does not blend the two measures.

The Delivery Map shows both:

- Source health/status from Linear
- Agent-observed risks with evidence and uncertainty

### 9. Persona pack

The reviewer persona consists of:

- Versioned Markdown skills describing engineering judgment and review technique
- Declarative repository/path policies
- Repository-specific architectural notes
- Approved review examples

Every job snapshots the exact persona content and records its content hash.

When the principal edits or rejects a draft, the system records feedback and may propose a concrete persona or policy diff. The proposal explains which behavior would change. Only explicit approval creates a new persona version.

### 10. Local workspace API

The daemon exposes a loopback-only API for:

- Querying current and historical work-graph state
- Reading Focus Queue items and evidence
- Starting, canceling, or retrying jobs
- Reading and editing review drafts
- Recording approval
- Publishing authorized actions
- Delivery views and snapshots
- Briefing generation
- Command-bar queries
- Health and audit views

At startup, the daemon creates a random local session secret for the browser client. It rejects non-loopback requests, cross-origin requests, and requests without the session secret.

Mutating endpoints additionally require a short-lived approval token created by an explicit UI action.

### 11. Approval publisher

The publisher is the only component with external write capability.

Before posting, it verifies:

- The recorded approval is present and unexpired.
- The PR head SHA still matches the reviewed SHA.
- The exact approved draft matches the content to publish.
- The required bot or user credential is available.
- The idempotency key has not already completed.

The bot posts approved analysis and comments. The user identity performs the final GitHub review disposition. Partial failure records each completed operation so retry resumes only unfinished actions.

## Core data flows

### Discover and prioritize

1. Poll GitHub and Linear from saved checkpoints.
2. Normalize source objects and update graph links.
3. Apply deterministic eligibility and hard-priority policy.
4. Create or update attention items.
5. Ask the ranking agent to order eligible items within policy boundaries.
6. Store the ranking rationale and source evidence.
7. Render the Focus Queue.

### Produce a PR review

1. Freeze job identity from head SHA, policy version, and persona version.
2. Build the context bundle.
3. Create a disposable worktree.
4. Read CI evidence and run only allowlisted sandbox checks.
5. Run the primary reviewer.
6. Run triggered specialist passes.
7. Consolidate and validate the structured review result.
8. Store the immutable draft and evidence.
9. Add or update the corresponding Focus Queue decision.
10. If the head SHA changes, mark the draft superseded and queue a fresh job.

### Publish a review decision

1. The principal opens the Review Workbench.
2. The UI presents summary, evidence, checks, findings, unknowns, and exact draft actions.
3. The principal edits or approves the bot draft.
4. The publisher revalidates SHA, content, permissions, and idempotency.
5. The bot posts approved comments.
6. The principal explicitly approves or requests changes through the user identity.
7. The system records results, active review time, edits, and any lesson proposal.

### Generate delivery intelligence

1. Daily snapshots capture Linear scope/status and linked GitHub state.
2. Deterministic analyzers identify discrepancies and changes.
3. An analysis agent interprets significant patterns.
4. The Delivery Map distinguishes source facts from inferred risks.
5. Daily and weekly briefings summarize changes, decisions, handled work, and unknowns.

### Answer a command-bar question

1. Parse the question into an allowlisted query plan.
2. Retrieve a bounded result set from the local work graph.
3. Invoke an agent only when semantic interpretation is required.
4. Return a contextual view with source citations, inferred conclusions, and missing context.
5. Never execute arbitrary generated code or SQL.

## User experience

### Focus Queue

The Focus Queue is the default route.

It has three sections:

- **Now:** at most three decisions.
- **Next:** lower-urgency eligible items.
- **Monitor:** items that do not yet require action.

Every item shows:

- What changed
- Why it needs attention now
- Whether the statement is fact or inference
- Agent/job state
- Evidence and freshness
- Estimated human effort
- One primary next action

The home screen also contains a compact daily brief and unobtrusive connector/agent health. Agent throughput metrics are secondary.

### PR Review Workbench

The workbench supports the one-to-two-minute verification target through three columns:

1. **Understand:** intent, linked goal, cross-repository context, and checks.
2. **Verify:** findings, evidence, confidence, and unknowns.
3. **Act:** exact draft comments and final disposition controls.

The underlying diff and complete artifacts remain available through progressive disclosure.

### Delivery Map

The map begins at initiative or milestone level and shows:

- Estimate-based progress and estimate coverage
- Scope changes over time
- Linked PR delivery state by repository
- Blockers and stalled decisions
- Source health and agent-observed risk separately
- Missing or uncertain repository coverage

It avoids a dense node-link visualization when a structured hierarchy communicates the same information more clearly.

### Daily and weekly briefings

Briefings are in-app only in version 1.

They contain:

- What materially changed
- What agents handled
- What still needs the principal
- Progress and scope movement
- New blockers or uncertainty
- Decisions made and their outcomes

### Command bar

The persistent command bar supports questions such as:

- "Why is the Identity milestone at risk?"
- "Show auth-related changes across all four repositories this week."
- "Which requested reviews are blocking other work?"
- "What changed after the milestone scope was set?"

Answers open known contextual views rather than creating arbitrary dashboards.

## Failure handling

### Connector failure

- Preserve the last known-good state.
- Show source freshness and degraded coverage.
- Retry with exponential backoff and jitter.
- Resume from the last completed checkpoint.
- Never display an unqualified all-clear state while coverage is degraded.

### Laptop sleep or daemon restart

- Persist job and connector checkpoints transactionally.
- On resume, run catch-up synchronization before claiming freshness.
- Recover interrupted jobs as queued or failed according to their last durable stage.

### Agent failure

- Keep the attention item visible.
- Show the failed stage and bounded logs.
- Permit retry without duplicating completed deterministic work.
- Escalate repeated failure to the principal rather than silently dropping the item.

### Stale source state

- Bind every draft to its reviewed head SHA.
- Supersede drafts after new commits.
- Recheck SHA and permissions immediately before publication.
- Show GitHub/Linear disagreement rather than automatically reconciling it.

### Uncertainty

All claims are classified as:

- Observed fact
- Agent inference
- Unresolved unknown

Missing context lowers confidence and increases the need for human verification. "No findings" is never presented as proof of safety.

## Security model

### Untrusted content

PR descriptions, code, comments, issue text, repository documentation, and test output are data, not trusted instructions.

They cannot:

- Change system or persona instructions
- Change policy
- Grant tools or permissions
- Enable publication
- Modify credentials

Analysis-agent processes receive a sanitized environment and filesystem access limited to the job worktree and context artifacts. Their tool policy permits read-only inspection and denies host shell execution; allowlisted checks can run only through the sandbox adapter.

### Repository execution

A worktree is checkout isolation, not a security boundary.

- Repository code and scripts do not run directly on the host by default.
- Existing CI results are the default dynamic-test evidence.
- Optional local commands must be repository-policy allowlisted.
- Allowlisted commands run in an ephemeral Docker sandbox with no host credentials.
- Network access is disabled by default and must be explicitly justified per command.

### Credentials

- GitHub user, GitHub bot, and Linear credentials remain in operating-system or existing CLI credential stores.
- Credentials are not stored in SQLite, prompts, logs, review artifacts, or agent transcripts.
- Analysis agents receive read-only access.
- Only the publisher can request write credentials.

### Audit

Each review records:

- Source entity versions and head SHA
- Policy and persona versions
- Context bundle hash
- Agent sessions and model metadata
- Checks and evidence
- Draft, human edits, and approval
- External operations and responses

## Testing and evaluation

### Deterministic tests

- Connector fixtures: pagination, checkpointing, rate limits, retries, closure/deletion, and deduplication
- Graph tests: mandatory ticket links and hierarchy resolution
- Policy tests: exact eligibility and hard-priority behavior
- State-machine tests: restart, cancellation, retry, failure, and supersession
- Publisher tests: authorization, head-SHA guard, exact-content guard, idempotency, and partial failure
- End-to-end tests with fake GitHub, Linear, agent, credential, and publisher adapters

### Agent evaluation corpus

Maintain a versioned set of historical and synthetic cases covering:

- Known races and concurrency mistakes
- Cross-repository contract changes
- Missing and present companion work
- Internal developer-tool changes
- Benign changes that should not attract findings
- Incomplete context and failed CI
- Prompt-injection attempts in every untrusted content channel

Each case defines:

- Required findings
- Forbidden claims
- Acceptable uncertainty
- Required evidence
- Expected disposition range

Evaluation measures:

- Finding recall
- False-positive rate
- Evidence validity
- Unsupported-claim rate
- Disposition quality
- Draft usefulness
- Stability across repeated runs

### Rollout

1. **Baseline:** measure current active review time on representative PRs.
2. **Historical replay:** evaluate against the curated corpus with publishing disabled.
3. **Live shadow mode:** ingest current work and prepare drafts with all external actions disabled.
4. **Gated publishing:** enable bot comments only after deterministic and agent gates pass.

Autonomous approval is not unlocked by the version 1 pilot.

### Metric definitions

- **Healthy connector operation:** both source connectors report a successful sync within the current five-minute polling window and are not rate-limited or degraded.
- **Routine PR:** an eligible PR outside the highest deterministic risk tier, with passing or neutral CI and no high-severity specialist finding.
- **Verification time:** cumulative foreground time in the Review Workbench from first open to final decision, excluding agent wait time and pauses after 60 seconds without interaction.
- **Draft outcome:** the principal labels each draft as accepted, wording-only edit, substantive edit, or rejected. Adding/removing a finding, changing severity, or changing disposition is substantive.

## Acceptance criteria

- During healthy connector operation, all explicitly requested and policy-matched PRs become attention items within one five-minute polling window.
- No external mutation occurs without explicit, recorded approval.
- No stale-head or duplicate review is published.
- Every finding references valid evidence and labels inference or missing context.
- Median human verification time for routine PRs with no critical finding is at most two minutes.
- At least 70% of routine drafts are accepted or receive wording-only edits during the 30-day pilot.
- Delivery links and displayed progress reconcile exactly to source GitHub and Linear facts.
- Untrusted content cannot alter policy, gain write authority, expose credentials, or execute repository code on the host.
- Connector, agent, or publication failure remains visible and recoverable.

## Explicit design decisions

- Use a deterministic local control plane rather than an agent-first ingestion system.
- Use SQLite rather than a graph database.
- Use one daemon and a bounded worker pool rather than microservices.
- Use a Focus Queue rather than a metric-heavy mission-control home page.
- Use explicit policy plus agent ranking rather than rules-only or agent-only prioritization.
- Use one primary reviewer with triggered specialists rather than a default agent swarm.
- Use bot-authored analysis plus a human-authored final disposition.
- Use approved persona proposals rather than automatic learning.
- Use existing CI by default and sandboxed allowlisted local checks only.
- Use in-app daily and weekly briefings rather than additional notification channels.
- Use a bounded command/query bar rather than a chat-first or arbitrary generated-UI model.

