# Control Tower

Local-first control tower for principal engineers who need an eligible-PR review inbox, evidence-backed review drafts, and human-gated publication — without giving agents authority over eligibility, scheduling, or GitHub mutations.

Array’s repositories are the starter organization catalog. The example engineer
profile selects repositories from that catalog. Organization repos, priorities,
prompts, and review judgment are **configuration**, not application code.
Another engineer can onboard different repositories without forking the app.

## Who this is for

- Principal / staff engineers who are review bottlenecks across several repos
- Operators who want an authoritative “what needs my attention” queue, not an autonomous reviewer
- Teams that require human approval before any comment, approval, or request-changes action lands on GitHub

## What it does

| Capability | What you get |
|------------|--------------|
| **Inbox** | Eligible-only triage from SQLite `prs`, deterministically ordered by the queue tuple. Optional **Group by lane** maps priority tiers: `p0`/`p1` → Now, `p2` → Next, `p3` → Monitor. Ineligible PRs are not persisted. |
| **Delegated review** | Cursor CLI (`primaryReview` role only) produces evidence-backed drafts without a manual checkout. Registered-source reviews fetch the PR head into a daemon-owned worktree, materialize a protected-path-filtered source tree, and record a source manifest; unregistered repos use remote evidence. Drafts are checked for staleness when loaded or refetched against the current PR head; when marked stale, publication is blocked until re-analysis. Review shows a per-run **coverage notice** when evidence is incomplete — not a separate Coverage product page. |
| **Gated publication** | Human review and per-operation approval before GitHub mutations |

## Design invariants (read these)

1. **Deterministic eligibility and authority; agentic judgment and advice.** The app owns discovery, eligibility, auto-analysis, evidence validation, and publication. Agents advise and draft.
2. **Eligible ≠ analyzed.** Explicit review requests (and configured auto-analyze rules) start Cursor automatically. Author-only matches are usually on-demand.
3. **Evidence before confidence.** Findings must cite application-verifiable provenance. Model confidence never authorizes an action.
4. **Human authority.** No review, comment, approval, or request-changes without recorded per-operation human approval.
5. **CI-first.** Phase 1 does not install dependencies, run repository code, or drive a browser. Existing GitHub checks are the dynamic build/test evidence.
6. **Cursor is the only AI harness.** No second model SDK or agent runtime.
7. **Starts in shadow mode.** Publishing stays off until you explicitly enable it after quality gates.

## Prerequisites

| Tool | Requirement |
|------|-------------|
| Node.js | ≥ 22 |
| pnpm | ≥ 10 |
| Git | ≥ 2.40 |
| GitHub CLI (`gh`) | ≥ 2.70, authenticated to the GitHub host in `config/organization.json` |
| Cursor Agent CLI | Authenticated with your Cursor account (`agent` by default; configurable) |

The product is developed and tested from a source checkout on macOS. `doctor`
validates tools and authentication, not the operating system.

## Quick start

**Full step-by-step onboarding and customization:** see [`ONBOARDING.md`](./ONBOARDING.md).

```bash
pnpm install
cd client && pnpm install && pnpm build && cd ..

# Create ~/.control-tower/config.json from examples, copy profile/ from examples, and create an empty data/ directory
pnpm ct init

# Edit profile, policy, and local machine paths (see ONBOARDING.md)
# Then verify the environment
pnpm ct doctor

# Start the foreground local daemon + loopback UI
pnpm ct start
```

The daemon serves `client/dist`, so the client build must succeed before starting
the UI. The default UI is `http://127.0.0.1:9120`. If you set another
`daemon.port`, restart the daemon and set `CT_DAEMON_PORT` for Vite development.
`pnpm ct start` remains in the foreground; use another terminal for `status` or
`stop`.

```bash
pnpm ct status
pnpm ct stop
```

This development version uses the review-core schema. **Stop the daemon**, then run a full reset and re-bootstrap:

```bash
pnpm ct reset --all --yes
pnpm ct init
```

`reset` attempts to stop a running daemon first. `--all` recursively deletes the configured **data** directory (SQLite `control-tower.sqlite`, sealed run artifacts, discovery checkpoints), **profile** directory, and **local config file**; repo plugins under `config/plugins/` are kept. No backward compatibility is preserved — legacy keys such as `cursor.modelRoles.attention` are removed and must be recreated by `init`. After `init`, start Control Tower again.

### Enable publishing (after operator validation)

Publication starts as `shadow` (publisher disabled). After you validate draft
quality, enable gated publication:

```bash
pnpm ct publication enable   # re-runs doctor, requires confirmation
pnpm ct publication disable  # restore shadow immediately
```

## Configuration layers

Three non-overlapping layers — there is no generic deep-merge.

| Layer | Location | Contents |
|-------|----------|----------|
| **Organization catalog** | `config/organization.json` (in repo) | GitHub host/orgs, repo IDs, protected paths |
| **Engineer profile** | `~/.control-tower/profile/` | `profile.json` (`profileId`, login, active repos), `policy.json` (eligibility/priority/domains/auto-analyze), `persona.md` |
| **Local machine** | `~/.control-tower/config.json` | Absolute paths, workspace roots, repository paths, Cursor binary/model roles/concurrency, worktree limit, data directory, daemon port, `publication.mode` |

Secrets and absolute paths stay in local machine config. Shared defaults and profile content are versionable.

### Minimal personalization checklist

1. Set `profileId` and `githubLogin` in `profile.json`.
2. Set `activeRepositoryIds` to the catalog repos you want tracked.
3. Map repos to local checkouts in `repositoryPaths` for registered-source reviews. Without a path, analysis can still use remote-evidence-only mode.
4. Tune `eligiblePaths`, `eligibleAuthors`, `priorityRules`, and `domainRules` in `policy.json`.
5. Confirm Cursor `modelRoles.primaryReview` via `pnpm ct doctor`.
6. Leave `publication.mode` as `"shadow"` until you are ready.

Examples live under `config/examples/`. Full walkthrough with copy-paste examples: [`ONBOARDING.md`](./ONBOARDING.md).

## Day-to-day UI

The daemon serves a React single-page app. Navigation has durable URLs; a
direct Review link resolves its job against the current queue.

| Visible surface | URL | Purpose |
|-----------------|-----|---------|
| **Inbox** | `/inbox` | Default triage groups eligible items into Now / Next / Monitor lanes; disable **Group by lane** for a flat ordered list |
| **Review** | `/review/:jobId` | Inspect a draft's summary, findings, evidence, provenance, and approval operations; staleness is evaluated when the draft is loaded or refetched against the current PR head — when stale, publication is blocked until re-analysis |

The UI refreshes **queue** and **health** on independent timers while the tab is visible: queue **3s** when any job is in an active pipeline state (`queued` through `publishing`), **30s** when idle; health **30s** always. See [`POLLING.md`](./POLLING.md) for discovery (~15 min), scheduler (5s), and analysis pipeline timing. `GET /api/queue` returns `{ focusQueue: { now, next, monitor } }` only — there is no all-tracked feed. The header **Refresh** action and connection/stale-data indicators are also available.

## CLI reference

| Command | Purpose |
|---------|---------|
| `pnpm ct init` | Bootstrap local config and profile from `config/examples/` when missing; **every run** rewrites `profileDirectory` and `dataDirectory` to absolute paths under `~/.control-tower/` and forces `publication.mode` back to `"shadow"` if it was anything else |
| `pnpm ct init --non-interactive [--github-login LOGIN]` | Apply the optional login and run `doctor` without pausing for input |
| `pnpm ct doctor` | Environment, identity, models, harness, and path checks |
| `pnpm ct start` / `stop` / `status` | Daemon lifecycle |
| `pnpm ct publication enable` / `disable` | Switch gated publishing on/off |
| `pnpm ct reset` | Delete local runtime data after confirmation |
| `pnpm ct reset --all` | Delete local runtime data, profile, and local config after confirmation |

Override config path with `CONTROL_TOWER_CONFIG` if needed.

## Development

```bash
pnpm test          # vitest
pnpm test:watch    # vitest watch mode
pnpm typecheck     # tsc --noEmit
pnpm --dir client build  # typecheck and build the production UI bundle
```

For UI development, start the daemon, then run `pnpm --dir client dev`. Vite
proxies `/api` to `http://127.0.0.1:9120` by default; set
`CT_DAEMON_PORT` when the daemon uses a different port.

Operator setup and customization: see [`ONBOARDING.md`](./ONBOARDING.md).

Architecture, module map, and extension guidance: see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

Polling, jobs, and the analysis pipeline: see [`POLLING.md`](./POLLING.md).

Tracked Phase 1 artifacts: `docs/handoff/phase-1-baseline-manifest.json` and `docs/principal-engineer-control-tower-architecture.html`.

## What this is not

- Continuous cloud operation while your machine is offline
- Autonomous approvals, merges, or Linear mutations
- A replacement for GitHub as the review system of record
- Silent profile or policy mutation by agents
- An all-tracked PR inventory, Coverage product page, proposals, learning, attention scoring, or Delivery Intelligence (Phase 2C — not implemented)
- Execution of untrusted PR code/tests on your machine (Phase 1); registered-source reviews may still fetch PR heads into daemon-owned admin worktrees, copy allowed files into a materialized source view, and generate source manifests

## Roadmap posture

**Phase 1** — Review-core delegated PR review (discovery → analysis → Review → gated publish).

**Phase 2C (future, separately scoped)** — Delivery Intelligence will be a separately scoped, read-only workflow. It may collect GitHub/Linear observations and retain its own time-aware linkage ledger. It must not reuse the review queue or cause non-reviewable PRs to be persisted by the review-core database.
