# Control Tower

Local-first control tower for principal engineers who need complete coverage of GitHub pull requests, evidence-backed review drafts, and human-gated publication — without giving agents authority over eligibility, scheduling, or GitHub mutations.

Array’s repositories are the starter profile. Organization repos, priorities, prompts, and review judgment are **configuration**, not application code. Another engineer can onboard different repositories without forking the app.

## Who this is for

- Principal / staff engineers who are review bottlenecks across several repos
- Operators who want an authoritative “what needs my attention” queue, not an autonomous reviewer
- Teams that require human approval before any comment, approval, or request-changes action lands on GitHub

## What it does

| Capability | What you get |
|------------|--------------|
| **All Tracked** | Authoritative coverage of configured repos and explicit review requests. Agents cannot hide items. |
| **Focus Queue** | Eligible-only Now / Next / Monitor view for day-to-day triage |
| **Delegated review** | Cursor CLI produces evidence-backed drafts without a manual checkout or local runtime |
| **Attention advisor** (optional) | Metadata-only relevance/risk advice; never changes coverage or auto-analysis |
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
| GitHub CLI (`gh`) | ≥ 2.70, authenticated to every configured host |
| Cursor Agent CLI | Authenticated with your Cursor account |

First supported distribution: **source checkout on macOS** (product target; `doctor` validates tool versions and auth, not OS).

## Quick start

**Full step-by-step onboarding and customization:** see [`ONBOARDING.md`](./ONBOARDING.md).

```bash
pnpm install
cd client && pnpm install && pnpm build && cd ..

# Create ~/.control-tower/{config.json,profile,data} from examples
pnpm ct init

# Edit profile, policy, and local machine paths (see ONBOARDING.md)
# Then verify the environment
pnpm ct doctor

# Start the local daemon + loopback UI
pnpm ct start
```

Default UI: `http://127.0.0.1:9120` (port configurable in local config).

```bash
pnpm ct status
pnpm ct stop
```

### Enable publishing (after shadow validation)

Publication starts as `shadow` (publisher disabled). When rollout gates pass:

```bash
pnpm ct publication enable   # re-runs doctor, requires confirmation
pnpm ct publication disable  # restore shadow immediately
```

## Configuration layers

Three non-overlapping layers — there is no generic deep-merge.

| Layer | Location | Contents |
|-------|----------|----------|
| **Organization catalog** | `config/organization.json` (in repo) | GitHub host/orgs, repo IDs, protected paths, ticket extractors, review defaults |
| **Engineer profile** | `~/.control-tower/profile/` | `profile.json` (login + active repos), `policy.json` (eligibility/priority/domains/auto-analyze), `persona.md` |
| **Local machine** | `~/.control-tower/config.json` | Absolute paths, Cursor binary/models, data directory, daemon port, `publication.mode` |

Secrets and absolute paths stay in local machine config. Shared defaults and profile content are versionable.

### Minimal personalization checklist

1. Set `githubLogin` in `profile.json` to your GitHub login.
2. Set `activeRepositoryIds` to the catalog repos you want tracked.
3. Map those repos to local checkouts in `repositoryPaths` (for registered-source reviews).
4. Tune `eligiblePaths`, `eligibleAuthors`, `priorityRules`, and `domainRules` in `policy.json`.
5. Confirm Cursor `modelRoles` (`attention`, `primaryReview`) via `pnpm ct doctor`.
6. Leave `publication.mode` as `"shadow"` until you are ready.

Examples live under `config/examples/`.

## Day-to-day UI

| Route | Purpose |
|-------|---------|
| **Focus Queue** | Default triage — eligible PRs only |
| **All Tracked** | Complete coverage, including tracked-but-ineligible items |
| **Workbench** | Inspect draft findings, provenance, and approve publication operations |
| **Propose Change** | Preview and adopt governed profile/policy proposals |

## CLI reference

| Command | Purpose |
|---------|---------|
| `pnpm ct init` | Bootstrap local config and profile |
| `pnpm ct doctor` | Environment, identity, models, harness, and path checks |
| `pnpm ct start` / `stop` / `status` | Daemon lifecycle |
| `pnpm ct publication enable` / `disable` | Switch gated publishing on/off |

Override config path with `CONTROL_TOWER_CONFIG` if needed.

## Development

```bash
pnpm test          # vitest
pnpm typecheck     # tsc --noEmit
```

Operator setup and customization: see [`ONBOARDING.md`](./ONBOARDING.md).

Architecture, module map, and extension guidance: see [`Architecture.md`](./Architecture.md).

Detailed Phase 1 design and implementation plans: `docs/superpowers/`.

## What this is not

- Continuous cloud operation while your machine is offline
- Autonomous approvals, merges, or Linear mutations
- A replacement for GitHub as the review system of record
- Silent learning or agent-owned policy mutation
- Execution of untrusted PR code on your machine (Phase 1)

## Roadmap posture

**Phase 1** — Delegated PR review (discovery → analysis → workbench → gated publish → learning/eval).

**Phase 2** (independently gated, after Phase 1 gates) — advanced/cross-repo review, bot publication, delivery-provider intelligence, sandboxed checks. See `docs/superpowers/specs/`.
