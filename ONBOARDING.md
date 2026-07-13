# Control Tower onboarding

Step-by-step guide to run Control Tower on your machine and tailor it to the repos and review rules you care about.

For product overview and design invariants, see [`README.md`](./README.md). For module map and extension rules, see [`ARCHITECTURE.md`](./ARCHITECTURE.md).

---

## What you get after setup

1. A local daemon that polls GitHub for PRs in your active repos (and PRs that request your review).
2. A loopback React UI at `http://127.0.0.1:9120` (default), with **Inbox**, **Coverage**, **Review**, and **Propose** surfaces.
3. Cursor-backed review drafts. GitHub comments / approvals stay off until you enable gated publication and approve each operation.

---

## 0. Prerequisites

Install and authenticate these before anything else:

| Tool | Minimum | How to check |
|------|---------|--------------|
| Node.js | 22+ | `node --version` |
| pnpm | 10+ | `pnpm --version` |
| Git | 2.40+ | `git --version` |
| GitHub CLI (`gh`) | 2.70+ | `gh --version` then `gh auth status` |
| Cursor Agent CLI | Authenticated; version at/above the floor checked by `doctor` | `agent --version` and `agent models` |

`doctor` uses the Cursor binary name from local config (default: `agent`).

First supported distribution: **source checkout on macOS**. `doctor` validates tool versions and auth, not OS.

---

## 1. Clone and install

```bash
git clone <this-repo-url>
cd <checkout-directory>

# Backend + CLI
pnpm install

# UI (served from client/dist — that folder is gitignored)
cd client
pnpm install
pnpm build
cd ..
```

You need a successful `client` build before the daemon can serve the UI.

---

## 2. Bootstrap local config

```bash
pnpm ct init
```

This creates (only if missing):

| Path | Source |
|------|--------|
| `~/.control-tower/profile/` | Copied from `config/examples/profile/` |
| `~/.control-tower/config.json` | Copied from `config/examples/local-config.json` |
| `~/.control-tower/data/` | Empty data directory |

`init` also:

- Rewrites `profileDirectory` and `dataDirectory` in local config to **absolute** paths under `~/.control-tower/` on every run
- Forces `publication.mode` to `"shadow"` on every run when it was anything else

Optional flags:

```bash
# Apply GitHub login and run doctor
pnpm ct init --non-interactive --github-login YOUR_GITHUB_LOGIN
```

`--non-interactive` always runs `doctor`. `--github-login` only takes effect
with `--non-interactive`; otherwise edit `profile.json` yourself (next step).

Existing profile files and data are preserved, but `init` always rewrites local
config paths and can reset publication mode to `shadow`. Do not re-run it after
customizing either setting unless you intend that change.

---

## 3. Set your identity and active repos

Edit `~/.control-tower/profile/profile.json`.

**Example — track two Array repos as operator `alice`:**

```json
{
  "schemaVersion": 1,
  "profileId": "alice-control-tower",
  "githubLogin": "alice",
  "activeRepositoryIds": [
    "pba-webapp",
    "pba-agents"
  ]
}
```

Rules:

- `githubLogin` must match the login `gh` is authenticated as (same host as org config).
- Every ID in `activeRepositoryIds` must exist in `config/organization.json` → `repositories[].id`. `doctor` does not validate those IDs, so check them before starting.

Starter catalog IDs today: `pba-webapp`, `pba-agents`, `pba-microservices`, `pba-infra`.

Discovery polls:

- Open PRs in each **active** catalog repo
- Plus PRs that **explicitly request your review** (even outside the active set, if GitHub returns them)

---

## 4. Map local checkouts (recommended)

Edit `~/.control-tower/config.json`.

**Example:**

```json
{
  "schemaVersion": 1,
  "profileDirectory": "/Users/alice/.control-tower/profile",
  "dataDirectory": "/Users/alice/.control-tower/data",
  "workspaceRoots": [],
  "repositoryPaths": {
    "pba-webapp": "/Users/alice/src/pba-webapp",
    "pba-agents": "/Users/alice/src/pba-agents"
  },
  "cursor": {
    "binary": "agent",
    "modelRoles": {
      "primaryReview": { "modelId": "composer-2.5-fast" }
    },
    "maxConcurrentAgents": 1
  },
  "worktrees": { "maxMaterialized": 4 },
  "publication": { "mode": "shadow" },
  "daemon": { "port": 9120 }
}
```

How source mode is chosen:

| Local path for that repo ID | Mode used for analysis |
|-----------------------------|------------------------|
| Present and directory exists | `registered-source` |
| Missing or path does not exist | `remote-evidence-only` |

Notes:

- Use **absolute** paths (after `init`, directories are already absolute).
- If you list a path in `repositoryPaths`, `doctor` checks that it exists, is a Git repo, and that `origin` matches the catalog `github` slug.
- You can leave `repositoryPaths` as `{}` and still run; reviews fall back to remote evidence.

Also confirm:

- `cursor.modelRoles.primaryReview.modelId` — always required
- `publication.mode` stays `"shadow"` until you intentionally enable publishing

---

## 5. Tune what you review (policy)

Edit `~/.control-tower/profile/policy.json`.

### Eligibility (what can enter Inbox)

An explicit GitHub review request is eligible even when the repository is not
active. For an active repo, a PR is also eligible if either of these holds:

1. GitHub requested **your** review (`explicit_review_request`) — always eligible
2. A changed file matches `eligiblePaths`
3. The author is in `eligibleAuthors`

Otherwise the PR stays tracked but ineligible (visible in **Coverage**).

**Example — only frontend paths in `pba-webapp`:**

```json
"pba-webapp": {
  "eligiblePaths": ["src/**"],
  "eligibleAuthors": [],
  "domainRules": [
    { "domain": "frontend", "paths": ["src/**"], "priority": 100 }
  ],
  "priorityRules": [
    { "paths": ["src/lib/auth/**"], "tier": "p1" }
  ]
}
```

**Example — also treat PRs from a mentee as eligible in `pba-webapp`:**

```json
"pba-webapp": {
  "eligibleAuthors": ["mentee-login"]
}
```

Author-only matches are usually **on-demand** analysis (not auto), unless an independent priority rule also matches.

### Priority (Inbox lanes)

Allowed tiers: `p0`, `p1`, `p2`, `p3`.

| Tier | Inbox lane when **Group by lane** is enabled |
|------|------------------|
| `p0`, `p1` | **Now** |
| `p2` | **Next** |
| `p3` (default when eligible but no rule matches) | **Monitor** |
| ineligible / `unranked` | Not shown in Inbox (still visible in Coverage) |

### Auto-analyze

```json
"autoAnalyze": {
  "explicitReviewRequests": true,
  "priorityTiers": ["p0", "p1"]
}
```

Meaning in code:

- Eligible + explicit review request + `explicitReviewRequests: true` → auto enqueue Cursor primary review
- Eligible + priority in `priorityTiers` → auto enqueue (with author-only caveats)
- Everything else → on-demand (use **Analyze** in Coverage)

### Persona

Edit `~/.control-tower/profile/persona.md` for review tone. Example starter text is copied from `config/examples/profile/persona.md`.

### Domain rules

- Max **3** `domainRules` per repository (schema limit)
- Prefer domain names that match files under `config/harnesses/pr-review/domains/` (for example `frontend`, `backend`, `infrastructure`) so guidance stays consistent with the shipped harness pack

If a repo is in `activeRepositoryIds` but missing from `policy.repositories`, eligibility uses empty path/author lists — so only **explicit review requests** make those PRs eligible.

---

## 6. (Optional) Change the org catalog

Edit `config/organization.json` in the repo when you need new shared defaults (usually a team commit, not a personal-only edit).

**Example — add a repo:**

```json
{
  "id": "my-service",
  "github": "Powered-By-Array/my-service",
  "defaultBranch": "main",
  "resourceClass": "medium"
}
```

Then:

1. Add `"my-service"` to your `activeRepositoryIds`
2. Add a matching block under `policy.repositories`
3. Optionally map a local path in `repositoryPaths`

Also in org config:

- `github.host` / `github.organizations` / `github.pollIntervalSeconds`
- `security.protectedPaths` — configured protection patterns passed to registered-source preparation
- `reviewDefaults` — job timeout, retention, storage cap

---

## 7. (Optional) Change review prompts

Without touching application code:

| Goal | Edit |
|------|------|
| Your voice / bar | `~/.control-tower/profile/persona.md` |
| Primary review prompt/skills | `config/harnesses/pr-review/` |
| Domain guidance | `config/harnesses/pr-review/domains/*.md` |

---

## 8. Validate with doctor

```bash
pnpm ct doctor
```

Fix every failing check, then re-run until you see `All checks passed.`

Typical failures:

- `gh` not authenticated to the configured host
- GitHub login ≠ `profile.githubLogin`
- Cursor CLI version, authentication, or configured model smoke check fails
- `repositoryPaths` entry missing, not a Git repo, or wrong `origin`
- Invalid profile/policy JSON schema
- Missing `persona.md` or empty persona
- Missing harness files or invalid policy globs
- Data directory missing, not writable, or with insufficient free space
- Daemon port already in use

If the UI cannot load after start, rebuild it with:

```bash
pnpm --dir client build
```

The daemon serves `client/dist`; a missing build can leave client routes without
an `index.html` entry point.

Override local config path if needed:

```bash
export CONTROL_TOWER_CONFIG=/path/to/config.json
pnpm ct doctor
```

---

## 9. Start using it

```bash
pnpm ct start
```

Open the printed URL (default: `http://127.0.0.1:9120`). The server binds to loopback only.

| Visible UI surface | URL | What to do |
|--------------------|-----|----------------|
| **Inbox** | `/inbox` | Triage the eligible Focus Queue in its default flat order. Enable **Group by lane** to show Now / Next / Monitor. Start/retry analysis; Review opens when a draft is available. |
| **Coverage** | `/coverage` | See complete coverage, including ineligible PRs through its filters, and start on-demand analysis. |
| **Review** | `/review/:jobId` | Inspect a job's draft, findings, supporting evidence, provenance, and gated publication operations. |
| **Propose** | `/propose` | Build, validate, preview, and adopt governed profile-policy proposals from learning signals. |

While the tab is visible, the queue polls every 3 seconds when a job is active
and every 30 seconds otherwise; health polls every 30 seconds; and an
unavailable Review draft retries every 3 seconds. These polls pause in
background tabs, the queue refetches when the tab becomes visible, and all
queries refetch on window focus. The header provides a **Refresh** action for
queue and health status and reports connection and stale-data state.

Useful commands:

```bash
pnpm ct status
pnpm ct stop
```

---

## 10. Enable publishing (only when ready)

Default is **shadow**: drafts and approvals stay local; the publisher does not mutate GitHub.

When draft quality is good enough:

```bash
pnpm ct publication enable
```

This re-runs `doctor`, asks for confirmation (`y`), and sets `publication.mode` to `"gated"`.

To turn publishing off immediately:

```bash
pnpm ct publication disable
```

Even in gated mode, every GitHub mutation requires an exact per-operation approval in Review.

---

## 11. Reset local state

Use reset only when you intend to discard local Control Tower state. It
recursively deletes the configured data directory and, with `--all`, the
configured profile directory and local config file. Verify that those configured
paths do not point at a source checkout or repository harness before running it.

```bash
# Remove only local runtime data (database, runs, signals, and proposals).
pnpm ct reset

# Also remove the configured profile directory and local config file.
pnpm ct reset --all
```

Both commands prompt for confirmation. Add `--yes` only when running an
intentional non-interactive reset. After `reset --all`, run `pnpm ct init`
again.

---

## Customization cheat sheet

| I want to… | Change this |
|------------|-------------|
| Track different catalog repos | `profile.json` → `activeRepositoryIds` |
| Add a new shared repo | `config/organization.json` + profile + policy (+ optional path) |
| Review only certain paths | `policy.json` → `eligiblePaths` |
| Prefer certain authors | `policy.json` → `eligibleAuthors` |
| Raise urgency for hot paths | `policy.json` → `priorityRules` |
| Auto-run Cursor more/less | `policy.json` → `autoAnalyze` |
| Change models | local `config.json` → `cursor.modelRoles` |
| Change UI port | local `config.json` → `daemon.port` |
| Prefer local checkout evidence | local `config.json` → `repositoryPaths` |
| Change review voice | `persona.md` and/or harness files |
| Publish to GitHub | `pnpm ct publication enable` + Review approvals |

Three config layers — **no deep-merge**:

1. **Org catalog** — `config/organization.json` (shared)
2. **Engineer profile** — `~/.control-tower/profile/` (you)
3. **Local machine** — `~/.control-tower/config.json` (paths, models, port, publication)

Templates live under `config/examples/`.

---

## Minimal happy path (copy/paste)

```bash
pnpm install
cd client && pnpm install && pnpm build && cd ..
pnpm ct init
# edit ~/.control-tower/profile/profile.json  (githubLogin + activeRepositoryIds)
# edit ~/.control-tower/profile/policy.json   (paths / priority / autoAnalyze)
# edit ~/.control-tower/config.json           (repositoryPaths + models; keep shadow)
pnpm ct doctor
pnpm ct start
# open http://127.0.0.1:9120
```

Stay in shadow mode until you trust drafts, then `pnpm ct publication enable`.
