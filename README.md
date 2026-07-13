# Control Tower

Local-first control tower for principal engineers who need complete coverage of GitHub pull requests, evidence-backed review drafts, and human-gated publication — without giving agents authority over eligibility, scheduling, or GitHub mutations.

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
| **Coverage** | Authoritative coverage of configured repos and explicit review requests. Agents cannot hide items. |
| **Inbox** | Eligible-only triage, deterministically ordered by the queue tuple. Users can optionally group it into Now / Next / Monitor lanes. |
| **Delegated review** | Cursor CLI produces evidence-backed drafts without a manual checkout. It runs locally; registered-source reviews fetch the PR head into a daemon-owned worktree and record a source manifest, while unregistered repos use remote evidence. |
| **Gated publication** | Exact preview + per-operation human approval before GitHub mutations |
| **Governed learning** | Structured signals and profile-change proposals; nothing silent |

## Design invariants (read these)

1. **Deterministic coverage and authority; agentic judgment and advice.** The app owns discovery, eligibility, auto-analysis, evidence validation, and publication. Agents advise and draft.
2. **Eligible ≠ analyzed.** Explicit review requests (and configured auto-analyze rules) start Cursor automatically. Author-only matches are usually on-demand.
3. **Evidence before confidence.** Findings must cite application-verifiable provenance. Model confidence never authorizes an action.
4. **Human authority.** No review, comment, approval, or request-changes without recorded, exact approval.
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

# Create ~/.control-tower/config.json plus profile/ and data/ from examples
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
| **Organization catalog** | `config/organization.json` (in repo) | GitHub host/orgs, repo IDs, protected paths, review defaults |
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
| **Inbox** | `/inbox` | Default triage: a flat eligible Focus Queue; enable **Group by lane** to show Now / Next / Monitor |
| **Coverage** | `/coverage` | Complete All Tracked coverage, including tracked-but-ineligible PRs |
| **Review** | `/review/:jobId` | Inspect a draft's summary, findings, evidence, provenance, and approval operations |
| **Propose** | `/propose` | Build, validate, preview, and adopt governed profile/policy proposals |

The UI refreshes queue and health status on a timer while the tab is visible
(3s when jobs are active, 30s when idle). See [`Polling.md`](./Polling.md) for
how discovery, the job scheduler, the analysis pipeline, and client refresh fit
together end-to-end. The header **Refresh** action and connection/stale-data
indicators are also available.

## CLI reference

| Command | Purpose |
|---------|---------|
| `pnpm ct init` | Bootstrap local config and profile; every run rewrites configured profile/data paths and restores shadow mode |
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

Architecture, module map, and extension guidance: see [`Architecture.md`](./Architecture.md).

Polling, jobs, and the analysis pipeline: see [`Polling.md`](./Polling.md).

Detailed Phase 1 design and implementation plans: `docs/superpowers/`.

## What this is not

- Continuous cloud operation while your machine is offline
- Autonomous approvals, merges, or Linear mutations
- A replacement for GitHub as the review system of record
- Silent learning or agent-owned policy mutation
- Execution of untrusted PR code/tests on your machine (Phase 1); registered-source reviews may still fetch PR heads into daemon-owned admin worktrees and generate source manifests

## Roadmap posture

**Phase 1** — Delegated PR review (discovery → analysis → Review → gated publish → learning/eval).

**Phase 2** (independently gated, after Phase 1 gates) — advanced/cross-repo review, bot publication, delivery-provider intelligence, sandboxed checks. See `docs/superpowers/specs/`.
