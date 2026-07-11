# Control Tower Phase 1 — Discovery & Policy Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Discover GitHub PRs, filter protected diffs, normalize data into SQLite, and deterministically evaluate eligibility, priority, domains, auto-analysis, and queue ordering for all tracked PRs.

**Architecture:** A `gh` subprocess adapter discovers PRs through authenticated CLI commands with sanitized child environments. A streaming diff parser filters protected content before any persistence. A normalizer upserts canonical data into SQLite. A deterministic policy evaluator computes eligibility (explicit OR active+path/author), priority tiers (p0–p3, unranked), domain selection (max 3), and auto-analysis rules. A poll loop drives periodic discovery with checkpointed pagination, rate-limit awareness, and per-poll operator identity verification.

**Tech Stack:** TypeScript (ESM), Node.js 22+, better-sqlite3, Vitest, `gh` CLI subprocess

**Depends on:** `2026-07-10-control-tower-phase-1-01-foundation.md`
**Unlocks:** plan 03 (analysis) needs policy decisions + filtered diffs + normalized PRs

---

## Assumed Plan 01 Exports

These modules exist at their locked paths from Plan 01. Import signatures used throughout this plan
(see also `2026-07-10-control-tower-phase-1-README.md` Shared Contracts):

```typescript
// src/paths/matcher.ts
export class CanonicalPathMatcher {
  static compile(sources: PatternSource[]): CanonicalPathMatcher;
  canonicalize(rawPath: string): string | null;
  matches(path: string): boolean; // against compiled patterns only
  readonly artifactHash: string;
  readonly version: string;
}

// src/paths/match-patterns.ts — use for policy eligiblePaths / priorityRules / domainRules
export function pathMatchesAny(
  canonicalPath: string,
  patterns: readonly string[],
): boolean;

// src/config/load.ts + types.ts
export function loadOrganizationConfig(path: string): OrganizationConfig;
export function loadPolicyConfig(path: string): PolicyConfig;
export function loadProfileConfig(path: string): ProfileConfig;
export function loadLocalConfig(path: string): LocalConfig;
export type { OrganizationConfig, ProfileConfig, PolicyConfig, RepositoryPolicy, DomainRule, PriorityRule, LocalConfig };

// src/config/author-login.ts
export function normalizeLogin(raw: string): string;

// src/security/child-env.ts — NOT createChildEnv; match Plan 01 signatures exactly
export function buildGhEnv(
  host: Record<string, string | undefined>,
  opts: { host: string; configDir?: string },
): Record<string, string>;
export function buildCursorEnv(host: Record<string, string | undefined>): Record<string, string>;
export function buildGitFetchEnv(
  host: Record<string, string | undefined>,
  opts: { useSSH: boolean },
): Record<string, string>;
export function buildGitLocalEnv(host: Record<string, string | undefined>): Record<string, string>;

// src/store/db.ts + migrate.ts
export function openDatabase(path: string): import('better-sqlite3').Database;
export function runMigrations(db: import('better-sqlite3').Database): void;

// src/util/hash.ts — bare hex, no sha256: prefix
export function sha256Hex(data: string | Buffer): string;
export function sha256OfCanonicalJson(value: unknown): string;
```

**Canonical types owned by this plan (consumed by 03+):**
- `AnalysisMode = 'auto' | 'on_demand'` (never `'none'`)
- `QueueTuple = { prioritySortOrdinal, explicitRequestSort: 0|1, queueTimestampSort: string, normalizedRepositoryIdentity, prNumber }`
- Flat `PolicyDecision` from `src/policy/evaluate.ts`
- SQLite table **`prs`** (never `pull_requests`)

---

## File Structure

### New files (create)

| File | Responsibility |
|------|---------------|
| `src/github/types.ts` | All GitHub API response types and internal discovery types |
| `src/github/gh-process.ts` | Spawn `gh` subprocesses with sanitized child env |
| `src/github/adapter.ts` | High-level GitHub operations: search, list, view, diff |
| `src/github/diff-filter.ts` | Streaming diff parser that filters protected content before any sink |
| `src/github/rate-limit.ts` | Track and enforce GitHub API rate limits |
| `src/github/operator-identity.ts` | Per-poll login verification via `gh api user` |
| `src/normalize/paths.ts` | Canonicalize file paths from GitHub API for upsert |
| `src/normalize/upsert.ts` | Upsert repos/PRs/files/checks/reviews/comments into Plan 01 SQLite schema |
| `src/policy/reasons.ts` | Structured reason-record types for all policy decisions |
| `src/policy/eligibility.ts` | `explicit \|\| (active && (path \|\| author))` with full reason records |
| `src/policy/priority.ts` | p0–p3 tier selection with default p3, unranked for ineligible |
| `src/policy/domains.ts` | Domain selection: max 3, highest priority / earliest declaration |
| `src/policy/auto-analyze.ts` | Auto-analysis from explicit requests and priority tiers only |
| `src/policy/evaluate.ts` | Compose eligibility + priority + domains + auto-analysis |
| `src/policy/queue-order.ts` | All Tracked / Focus Queue ordering tuple |
| `src/discovery/checkpoints.ts` | Upsert/read Plan 01 `discovery_checkpoints` for resumable polling |
| `src/discovery/poll.ts` | Discovery poll loop with 5-min default interval |
| `src/discovery/poll-resilience.ts` | §12 GitHub unavailability / rate-limit / identity-mismatch recovery |
| `src/tickets/extract.ts` | Ticket identifier extraction from PR title/body/branch |
| `tests/github/diff-filter.test.ts` | Diff filter with protected/allowed/rename/malformed fixtures |
| `tests/github/operator-identity.test.ts` | Operator identity verification tests |
| `tests/github/adapter.fixtures.test.ts` | Adapter fixture parsing tests |
| `tests/policy/eligibility.test.ts` | Eligibility truth-table tests |
| `tests/policy/priority.test.ts` | Priority tier selection and unranked tests |
| `tests/policy/domains.test.ts` | Domain selection and ordering tests |
| `tests/policy/auto-analyze.test.ts` | Auto-analysis decision tests |
| `tests/policy/queue-order.test.ts` | Queue ordering tuple tests |
| `tests/discovery/poll.test.ts` | Discovery poll loop integration tests |
| `tests/discovery/poll-resilience.test.ts` | §12 poll failure recovery: network, rate-limit, identity mismatch |
| `tests/fixtures/diffs/allowed-only.diff` | Diff with only allowed files |
| `tests/fixtures/diffs/protected-env.diff` | Diff containing a .env file |
| `tests/fixtures/diffs/mixed.diff` | Mix of allowed and protected files |
| `tests/fixtures/diffs/rename-protected.diff` | Rename where one path is protected |
| `tests/fixtures/diffs/malformed-header.diff` | Unparseable diff header |
| `tests/fixtures/diffs/binary-protected.diff` | Binary file with protected path |
| `tests/fixtures/gh/search-review-requested.json` | Sample `gh search prs` output |
| `tests/fixtures/gh/pr-list-repo.json` | Sample `gh pr list` output |
| `tests/fixtures/gh/pr-view-detail.json` | Sample `gh pr view` output |

---

### Task 1: GitHub Types and Policy Reason Records

**Files:**
- Create: `src/github/types.ts`
- Create: `src/policy/reasons.ts`

- [x] **Step 1: Create GitHub types**

```typescript
// src/github/types.ts

// --- gh CLI JSON response shapes ---

export interface GhSearchPrItem {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: { login: string };
  repository: { nameWithOwner: string };
  headRefOid: string;
  baseRefOid: string;
  labels: Array<{ name: string }>;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  reviewRequests: Array<{ login?: string; slug?: string; __typename?: string }>;
}

export interface GhPrListItem {
  number: number;
  title: string;
  url: string;
  state: string;
  isDraft: boolean;
  author: { login: string };
  headRefOid: string;
  baseRefOid: string;
  headRefName: string;
  baseRefName: string;
  labels: Array<{ name: string }>;
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  reviewRequests: Array<{ login?: string; slug?: string; __typename?: string }>;
  statusCheckRollup: GhCheckRun[] | null;
}

export interface GhPrViewResult extends GhPrListItem {
  body: string;
  files: Array<{ path: string; additions: number; deletions: number }>;
  reviews: Array<{
    author: { login: string };
    state: string;
    body: string;
    submittedAt: string;
  }>;
  comments: Array<{
    author: { login: string };
    body: string;
    createdAt: string;
    url: string;
  }>;
  commits: Array<{
    oid: string;
    messageHeadline: string;
    authors: Array<{ login?: string }>;
  }>;
}

export interface GhCheckRun {
  __typename: string;
  name: string;
  status: string;
  conclusion: string | null;
  detailsUrl: string;
}

export interface GhRateLimit {
  resources: {
    core: GhRateLimitResource;
    search: GhRateLimitResource;
    graphql: GhRateLimitResource;
  };
}

export interface GhRateLimitResource {
  limit: number;
  remaining: number;
  reset: number;
}

// --- Internal discovery types ---

export interface DiscoveredPr {
  repositoryId: string;
  githubOwnerRepo: string;
  prNumber: number;
  title: string;
  body?: string;
  url: string;
  state: string;
  isDraft: boolean;
  authorLogin: string;
  headSha: string;
  baseSha: string;
  headRef?: string;
  baseRef?: string;
  labels: string[];
  additions: number;
  deletions: number;
  createdAt: string;
  updatedAt: string;
  changedFiles: string[];
  unsafeFiles: Array<{ raw: string; diagnostic: string }>;
  reviewRequests: Array<{ login: string; requestedAt?: string }>;
  checks: GhCheckRun[];
  reviews: Array<{
    authorLogin: string;
    state: string;
    body: string;
    submittedAt: string;
  }>;
  comments: Array<{
    authorLogin: string;
    body: string;
    createdAt: string;
    url: string;
  }>;
  explicitRequest: boolean;
  explicitRequestTimestamp?: string;
}

export interface DiffFilterResult {
  files: FilteredDiffFile[];
  omitted: OmittedDiffFile[];
  failed: boolean;
  failureReason?: string;
}

export interface FilteredDiffFile {
  path: string;
  patch: string;
}

export interface OmittedDiffFile {
  path: string;
  oldPath?: string;
  reason: 'protected_path_content';
}

export interface HostHealth {
  host: string;
  healthy: boolean;
  authenticatedLogin: string | null;
  error?: string;
  checkedAt: string;
}

export type PriorityTier = 'p0' | 'p1' | 'p2' | 'p3';
export type PriorityStatus = PriorityTier | 'unranked';

export const PRIORITY_TIERS: readonly PriorityTier[] = ['p0', 'p1', 'p2', 'p3'];

export const PRIORITY_SORT_ORDINALS: Record<PriorityStatus, number> = {
  p0: 0, p1: 1, p2: 2, p3: 3, unranked: 4,
};

export type AnalysisMode = 'auto' | 'on_demand';
```

- [x] **Step 2: Create policy reason records**

```typescript
// src/policy/reasons.ts

export interface ExplicitRequestReason {
  code: 'explicit_review_request';
  requestedLogin: string;
}

export interface EligiblePathReason {
  code: 'eligible_path';
  repositoryId: string;
  matchedPath: string;
  matchedRule: string;
}

export interface EligibleAuthorReason {
  code: 'eligible_author';
  repositoryId: string;
  normalizedLogin: string;
}

export type EligibilityReason =
  | ExplicitRequestReason
  | EligiblePathReason
  | EligibleAuthorReason;

export interface InactiveRepositoryExclusion {
  code: 'inactive_repository';
  repositoryId?: string;
  githubOwnerRepo: string;
}

export interface NoMatchExclusion {
  code: 'no_eligible_path_or_author_match';
  repositoryId: string;
}

export type ExclusionReason =
  | InactiveRepositoryExclusion
  | NoMatchExclusion;

export interface DefaultPriorityReason {
  code: 'default_priority';
  tier: 'p3';
}

export interface PriorityRuleReason {
  code: 'priority_rule';
  tier: string;
  declarationIndex: number;
  matchedPath: string;
  matchedRule: string;
}

export interface UnrankedReason {
  code: 'unranked_ineligible';
  eligibilityExclusionCodes: string[];
}

export type PriorityReason =
  | DefaultPriorityReason
  | PriorityRuleReason
  | UnrankedReason;

export interface DomainMatchReason {
  code: 'domain_rule';
  domain: string;
  numericPriority: number;
  declarationIndex: number;
  matchedPath: string;
  matchedRule: string;
}

export interface AutoAnalyzeExplicitReason {
  code: 'auto_analyze_explicit_request';
}

export interface AutoAnalyzePriorityTierReason {
  code: 'auto_analyze_priority_tier';
  tier: string;
}

export type AutoAnalyzeReason =
  | AutoAnalyzeExplicitReason
  | AutoAnalyzePriorityTierReason;

export interface SelectedDomain {
  domain: string;
  selectedPriority: number;
  selectedDeclarationIndex: number;
  matchedPaths: string[];
  allReasons: DomainMatchReason[];
}
```

- [x] **Step 3: Verify types compile**

Run: `npx tsc --noEmit src/github/types.ts src/policy/reasons.ts`
Expected: no errors

- [x] **Step 4: Commit**

```bash
git add src/github/types.ts src/policy/reasons.ts
git commit -m "feat(discovery): add GitHub API types and policy reason records"
```

---

### Task 2: gh Subprocess Runner

**Files:**
- Create: `src/github/gh-process.ts`

- [x] **Step 1: Write the gh process runner**

```typescript
// src/github/gh-process.ts
import { spawn } from 'node:child_process';
import { buildGhEnv } from '../security/child-env.js';

export interface GhExecOptions {
  host: string;
  timeoutMs?: number;
}

export interface GhExecResult {
  stdout: string;
  exitCode: number;
}

export class GhProcessError extends Error {
  constructor(
    public readonly args: string[],
    public readonly exitCode: number,
    message: string,
  ) {
    super(message);
    this.name = 'GhProcessError';
  }
}

export async function execGh(
  args: string[],
  options: GhExecOptions,
): Promise<GhExecResult> {
  const env = buildGhEnv(process.env as Record<string, string | undefined>, { host: options.host });

  return new Promise<GhExecResult>((resolve, reject) => {
    const proc = spawn('gh', args, {
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });

    let stdout = '';
    proc.stdout.on('data', (chunk: Buffer) => {
      stdout += chunk.toString('utf-8');
    });

    let timer: ReturnType<typeof setTimeout> | undefined;
    if (options.timeoutMs) {
      timer = setTimeout(() => {
        proc.kill('SIGTERM');
      }, options.timeoutMs);
    }

    proc.on('close', (code) => {
      if (timer) clearTimeout(timer);
      resolve({ stdout, exitCode: code ?? 1 });
    });

    proc.on('error', (err) => {
      if (timer) clearTimeout(timer);
      reject(err);
    });
  });
}

export async function execGhJson<T>(
  args: string[],
  options: GhExecOptions,
): Promise<T> {
  const result = await execGh(args, options);
  if (result.exitCode !== 0) {
    throw new GhProcessError(args, result.exitCode, `gh exited with code ${result.exitCode}`);
  }
  return JSON.parse(result.stdout) as T;
}

export async function execGhText(
  args: string[],
  options: GhExecOptions,
): Promise<string> {
  const result = await execGh(args, options);
  if (result.exitCode !== 0) {
    throw new GhProcessError(args, result.exitCode, `gh exited with code ${result.exitCode}`);
  }
  return result.stdout.trim();
}
```

- [x] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/github/gh-process.ts`
Expected: no errors

- [x] **Step 3: Commit**

```bash
git add src/github/gh-process.ts
git commit -m "feat(discovery): add gh subprocess runner with sanitized env"
```

---

### Task 3: Operator Identity Verification

**Files:**
- Create: `src/github/operator-identity.ts`
- Create: `tests/github/operator-identity.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// tests/github/operator-identity.test.ts
import { describe, it, expect, vi } from 'vitest';
import { verifyOperatorIdentity } from '../../src/github/operator-identity.js';

describe('verifyOperatorIdentity', () => {
  it('returns healthy when authenticated login matches configured login', async () => {
    const execGhText = vi.fn().mockResolvedValue('shubh-array');
    const result = await verifyOperatorIdentity(
      'github.com',
      'shubh-array',
      execGhText,
    );
    expect(result).toEqual({
      host: 'github.com',
      healthy: true,
      authenticatedLogin: 'shubh-array',
      checkedAt: expect.any(String),
    });
    expect(execGhText).toHaveBeenCalledWith(
      ['api', '--hostname', 'github.com', 'user', '--jq', '.login'],
      { host: 'github.com' },
    );
  });

  it('lowercases authenticated login for comparison', async () => {
    const execGhText = vi.fn().mockResolvedValue('Shubh-Array');
    const result = await verifyOperatorIdentity(
      'github.com',
      'shubh-array',
      execGhText,
    );
    expect(result.healthy).toBe(true);
    expect(result.authenticatedLogin).toBe('shubh-array');
  });

  it('returns unhealthy on login mismatch', async () => {
    const execGhText = vi.fn().mockResolvedValue('other-user');
    const result = await verifyOperatorIdentity(
      'github.com',
      'shubh-array',
      execGhText,
    );
    expect(result.healthy).toBe(false);
    expect(result.authenticatedLogin).toBe('other-user');
    expect(result.error).toMatch(/mismatch/i);
  });

  it('returns unhealthy on gh failure', async () => {
    const execGhText = vi.fn().mockRejectedValue(new Error('gh auth failed'));
    const result = await verifyOperatorIdentity(
      'github.com',
      'shubh-array',
      execGhText,
    );
    expect(result.healthy).toBe(false);
    expect(result.authenticatedLogin).toBeNull();
    expect(result.error).toMatch(/auth failed/i);
  });

  it('never passes @me to gh commands', async () => {
    const execGhText = vi.fn().mockResolvedValue('shubh-array');
    await verifyOperatorIdentity('github.com', 'shubh-array', execGhText);
    const callArgs = execGhText.mock.calls[0][0] as string[];
    expect(callArgs.join(' ')).not.toContain('@me');
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/github/operator-identity.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Write the implementation**

```typescript
// src/github/operator-identity.ts
import type { HostHealth } from './types.js';
import type { GhExecOptions } from './gh-process.js';

type ExecGhTextFn = (args: string[], options: GhExecOptions) => Promise<string>;

export async function verifyOperatorIdentity(
  host: string,
  configuredLogin: string,
  execGhTextFn: ExecGhTextFn,
): Promise<HostHealth> {
  const checkedAt = new Date().toISOString();
  try {
    const rawLogin = await execGhTextFn(
      ['api', '--hostname', host, 'user', '--jq', '.login'],
      { host },
    );
    const authenticatedLogin = rawLogin.toLowerCase();

    if (authenticatedLogin !== configuredLogin) {
      return {
        host,
        healthy: false,
        authenticatedLogin,
        error: `Login mismatch: authenticated as "${authenticatedLogin}" but configured as "${configuredLogin}"`,
        checkedAt,
      };
    }

    return { host, healthy: true, authenticatedLogin, checkedAt };
  } catch (err) {
    return {
      host,
      healthy: false,
      authenticatedLogin: null,
      error: err instanceof Error ? err.message : String(err),
      checkedAt,
    };
  }
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github/operator-identity.test.ts`
Expected: all 5 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/github/operator-identity.ts tests/github/operator-identity.test.ts
git commit -m "feat(discovery): add per-poll operator identity verification"
```

---

### Task 4: Rate Limit Handler

**Files:**
- Create: `src/github/rate-limit.ts`

- [x] **Step 1: Write the rate limit tracker**

```typescript
// src/github/rate-limit.ts
import type { GhRateLimit, GhRateLimitResource } from './types.js';
import type { GhExecOptions } from './gh-process.js';

type ExecGhJsonFn = <T>(args: string[], options: GhExecOptions) => Promise<T>;

export interface RateLimitState {
  core: GhRateLimitResource | null;
  search: GhRateLimitResource | null;
  graphql: GhRateLimitResource | null;
  lastChecked: string | null;
}

export class RateLimitTracker {
  private state: RateLimitState = {
    core: null,
    search: null,
    graphql: null,
    lastChecked: null,
  };

  async refresh(
    host: string,
    execGhJsonFn: ExecGhJsonFn,
  ): Promise<RateLimitState> {
    const data = await execGhJsonFn<GhRateLimit>(
      ['api', 'rate_limit'],
      { host },
    );
    this.state = {
      core: data.resources.core,
      search: data.resources.search,
      graphql: data.resources.graphql,
      lastChecked: new Date().toISOString(),
    };
    return this.state;
  }

  isAvailable(resource: 'core' | 'search' | 'graphql'): boolean {
    const r = this.state[resource];
    if (!r) return true;
    if (r.remaining > 0) return true;
    return Date.now() / 1000 >= r.reset;
  }

  resetTime(resource: 'core' | 'search' | 'graphql'): Date | null {
    const r = this.state[resource];
    if (!r || r.remaining > 0) return null;
    return new Date(r.reset * 1000);
  }

  getState(): Readonly<RateLimitState> {
    return this.state;
  }
}
```

- [x] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/github/rate-limit.ts`
Expected: no errors

- [x] **Step 3: Commit**

```bash
git add src/github/rate-limit.ts
git commit -m "feat(discovery): add rate limit tracker"
```

---

### Task 5: GitHub Adapter and Fixture Tests

**Files:**
- Create: `src/github/adapter.ts`
- Create: `tests/fixtures/gh/search-review-requested.json`
- Create: `tests/fixtures/gh/pr-list-repo.json`
- Create: `tests/fixtures/gh/pr-view-detail.json`
- Create: `tests/github/adapter.fixtures.test.ts`

- [x] **Step 1: Create gh fixture files**

```json
// tests/fixtures/gh/search-review-requested.json
[
  {
    "number": 101,
    "title": "Add auth middleware",
    "url": "https://github.com/Powered-By-Array/pba-webapp/pull/101",
    "state": "OPEN",
    "isDraft": false,
    "author": { "login": "alice" },
    "repository": { "nameWithOwner": "Powered-By-Array/pba-webapp" },
    "headRefOid": "abc123def456abc123def456abc123def456abc1",
    "baseRefOid": "000111222333444555666777888999aaabbbcccd",
    "labels": [{ "name": "needs-review" }],
    "additions": 150,
    "deletions": 30,
    "createdAt": "2026-07-01T10:00:00Z",
    "updatedAt": "2026-07-09T14:30:00Z",
    "reviewRequests": [{ "login": "shubh-array", "__typename": "User" }]
  }
]
```

```json
// tests/fixtures/gh/pr-list-repo.json
[
  {
    "number": 42,
    "title": "Refactor API client",
    "url": "https://github.com/Powered-By-Array/pba-webapp/pull/42",
    "state": "OPEN",
    "isDraft": false,
    "author": { "login": "bob" },
    "headRefOid": "def456abc123def456abc123def456abc123def4",
    "baseRefOid": "111222333444555666777888999aaabbbcccddde",
    "headRefName": "refactor-api",
    "baseRefName": "main",
    "labels": [],
    "additions": 80,
    "deletions": 45,
    "createdAt": "2026-07-05T08:00:00Z",
    "updatedAt": "2026-07-09T11:00:00Z",
    "reviewRequests": [],
    "statusCheckRollup": [
      {
        "__typename": "CheckRun",
        "name": "CI / build",
        "status": "COMPLETED",
        "conclusion": "SUCCESS",
        "detailsUrl": "https://github.com/runs/1"
      }
    ]
  },
  {
    "number": 43,
    "title": "Update deps",
    "url": "https://github.com/Powered-By-Array/pba-webapp/pull/43",
    "state": "OPEN",
    "isDraft": true,
    "author": { "login": "shubh-array" },
    "headRefOid": "789abc123def456abc123def456abc123def4567",
    "baseRefOid": "111222333444555666777888999aaabbbcccddde",
    "headRefName": "update-deps",
    "baseRefName": "main",
    "labels": [{ "name": "dependencies" }],
    "additions": 200,
    "deletions": 180,
    "createdAt": "2026-07-08T09:00:00Z",
    "updatedAt": "2026-07-09T16:00:00Z",
    "reviewRequests": [],
    "statusCheckRollup": null
  }
]
```

```json
// tests/fixtures/gh/pr-view-detail.json
{
  "number": 42,
  "title": "Refactor API client",
  "body": "This PR refactors the API client layer.\n\nLinear: ENG-1234",
  "url": "https://github.com/Powered-By-Array/pba-webapp/pull/42",
  "state": "OPEN",
  "isDraft": false,
  "author": { "login": "bob" },
  "headRefOid": "def456abc123def456abc123def456abc123def4",
  "baseRefOid": "111222333444555666777888999aaabbbcccddde",
  "headRefName": "refactor-api",
  "baseRefName": "main",
  "labels": [],
  "additions": 80,
  "deletions": 45,
  "createdAt": "2026-07-05T08:00:00Z",
  "updatedAt": "2026-07-09T11:00:00Z",
  "reviewRequests": [],
  "statusCheckRollup": [
    {
      "__typename": "CheckRun",
      "name": "CI / build",
      "status": "COMPLETED",
      "conclusion": "SUCCESS",
      "detailsUrl": "https://github.com/runs/1"
    }
  ],
  "files": [
    { "path": "src/api-clients/base.ts", "additions": 40, "deletions": 20 },
    { "path": "src/api-clients/auth.ts", "additions": 40, "deletions": 25 }
  ],
  "reviews": [
    {
      "author": { "login": "carol" },
      "state": "COMMENTED",
      "body": "Looks good overall",
      "submittedAt": "2026-07-09T10:00:00Z"
    }
  ],
  "comments": [
    {
      "author": { "login": "bob" },
      "body": "Ready for review",
      "createdAt": "2026-07-09T09:00:00Z",
      "url": "https://github.com/Powered-By-Array/pba-webapp/pull/42#issuecomment-1"
    }
  ],
  "commits": [
    {
      "oid": "def456abc123def456abc123def456abc123def4",
      "messageHeadline": "refactor: extract base client",
      "authors": [{ "login": "bob" }]
    }
  ]
}
```

- [x] **Step 2: Write the adapter fixture tests**

```typescript
// tests/github/adapter.fixtures.test.ts
import { describe, it, expect, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { GitHubAdapter } from '../../src/github/adapter.js';

function loadFixture<T>(name: string): T {
  const raw = readFileSync(join(__dirname, '..', 'fixtures', 'gh', name), 'utf-8');
  return JSON.parse(raw) as T;
}

describe('GitHubAdapter fixture parsing', () => {
  it('parses search-review-requested fixture', async () => {
    const fixture = loadFixture('search-review-requested.json');
    const mockExec = vi.fn().mockResolvedValue(fixture);
    const adapter = new GitHubAdapter('github.com', mockExec, vi.fn());

    const results = await adapter.searchReviewRequested('shubh-array', ['Powered-By-Array']);
    expect(results).toHaveLength(1);
    expect(results[0].number).toBe(101);
    expect(results[0].author.login).toBe('alice');
    expect(results[0].reviewRequests[0].login).toBe('shubh-array');
  });

  it('passes exact login to --review-requested, never @me', async () => {
    const mockExec = vi.fn().mockResolvedValue([]);
    const adapter = new GitHubAdapter('github.com', mockExec, vi.fn());

    await adapter.searchReviewRequested('shubh-array', ['Powered-By-Array']);
    const args = mockExec.mock.calls[0][0] as string[];
    expect(args).toContain('--review-requested=shubh-array');
    expect(args.join(' ')).not.toContain('@me');
  });

  it('parses pr-list-repo fixture', async () => {
    const fixture = loadFixture('pr-list-repo.json');
    const mockExec = vi.fn().mockResolvedValue(fixture);
    const adapter = new GitHubAdapter('github.com', mockExec, vi.fn());

    const results = await adapter.listRepoPrs('Powered-By-Array/pba-webapp');
    expect(results).toHaveLength(2);
    expect(results[0].number).toBe(42);
    expect(results[1].isDraft).toBe(true);
  });

  it('parses pr-view-detail fixture', async () => {
    const fixture = loadFixture('pr-view-detail.json');
    const mockExec = vi.fn().mockResolvedValue(fixture);
    const adapter = new GitHubAdapter('github.com', mockExec, vi.fn());

    const result = await adapter.viewPr('Powered-By-Array/pba-webapp', 42);
    expect(result.body).toContain('ENG-1234');
    expect(result.files).toHaveLength(2);
    expect(result.reviews).toHaveLength(1);
    expect(result.comments).toHaveLength(1);
  });

  it('sets GH_HOST via options for all commands', async () => {
    const mockExec = vi.fn().mockResolvedValue([]);
    const adapter = new GitHubAdapter('github.example.com', mockExec, vi.fn());

    await adapter.searchReviewRequested('user', ['org']);
    const options = mockExec.mock.calls[0][1];
    expect(options.host).toBe('github.example.com');
  });
});
```

- [x] **Step 3: Run tests to verify they fail**

Run: `npx vitest run tests/github/adapter.fixtures.test.ts`
Expected: FAIL — module not found

- [x] **Step 4: Write the adapter implementation**

```typescript
// src/github/adapter.ts
import type {
  GhSearchPrItem,
  GhPrListItem,
  GhPrViewResult,
} from './types.js';
import type { GhExecOptions } from './gh-process.js';

type ExecGhJsonFn = <T>(args: string[], options: GhExecOptions) => Promise<T>;
type ExecGhTextFn = (args: string[], options: GhExecOptions) => Promise<string>;

const SEARCH_PR_FIELDS = [
  'number', 'title', 'url', 'state', 'isDraft', 'author',
  'repository', 'headRefOid', 'baseRefOid', 'labels',
  'additions', 'deletions', 'createdAt', 'updatedAt', 'reviewRequests',
].join(',');

const LIST_PR_FIELDS = [
  'number', 'title', 'url', 'state', 'isDraft', 'author',
  'headRefOid', 'baseRefOid', 'headRefName', 'baseRefName',
  'labels', 'additions', 'deletions', 'createdAt', 'updatedAt',
  'reviewRequests', 'statusCheckRollup',
].join(',');

const VIEW_PR_FIELDS = [
  ...LIST_PR_FIELDS.split(','),
  'body', 'files', 'reviews', 'comments', 'commits',
].join(',');

export class GitHubAdapter {
  constructor(
    private readonly host: string,
    private readonly execJson: ExecGhJsonFn,
    private readonly execText: ExecGhTextFn,
  ) {}

  private opts(): GhExecOptions {
    return { host: this.host };
  }

  async searchReviewRequested(
    login: string,
    organizations: string[],
  ): Promise<GhSearchPrItem[]> {
    const results: GhSearchPrItem[] = [];
    for (const org of organizations) {
      const items = await this.execJson<GhSearchPrItem[]>(
        [
          'search', 'prs',
          '--owner', org,
          `--review-requested=${login}`,
          '--state=open',
          '--json', SEARCH_PR_FIELDS,
        ],
        this.opts(),
      );
      results.push(...items);
    }
    return results;
  }

  async listRepoPrs(ownerRepo: string): Promise<GhPrListItem[]> {
    return this.execJson<GhPrListItem[]>(
      [
        'pr', 'list',
        '--repo', ownerRepo,
        '--state', 'open',
        '--json', LIST_PR_FIELDS,
      ],
      this.opts(),
    );
  }

  async viewPr(ownerRepo: string, prNumber: number): Promise<GhPrViewResult> {
    return this.execJson<GhPrViewResult>(
      [
        'pr', 'view', String(prNumber),
        '--repo', ownerRepo,
        '--json', VIEW_PR_FIELDS,
      ],
      this.opts(),
    );
  }

  async getPrDiff(ownerRepo: string, prNumber: number): Promise<string> {
    return this.execText(
      ['pr', 'diff', String(prNumber), '--repo', ownerRepo],
      this.opts(),
    );
  }
}
```

- [x] **Step 5: Run tests to verify they pass**

Run: `npx vitest run tests/github/adapter.fixtures.test.ts`
Expected: all 5 tests PASS

- [x] **Step 6: Commit**

```bash
git add src/github/adapter.ts tests/github/adapter.fixtures.test.ts tests/fixtures/gh/
git commit -m "feat(discovery): add GitHub adapter with fixture tests"
```

---

### Task 6: Diff Filter Test Fixtures

**Files:**
- Create: `tests/fixtures/diffs/allowed-only.diff`
- Create: `tests/fixtures/diffs/protected-env.diff`
- Create: `tests/fixtures/diffs/mixed.diff`
- Create: `tests/fixtures/diffs/rename-protected.diff`
- Create: `tests/fixtures/diffs/malformed-header.diff`
- Create: `tests/fixtures/diffs/binary-protected.diff`

- [x] **Step 1: Create allowed-only fixture**

```diff
// tests/fixtures/diffs/allowed-only.diff
diff --git a/src/components/Button.tsx b/src/components/Button.tsx
index 1234567..abcdef0 100644
--- a/src/components/Button.tsx
+++ b/src/components/Button.tsx
@@ -1,5 +1,6 @@
 import React from 'react';
+import { cn } from '../utils';
 
 export function Button({ label }: { label: string }) {
-  return <button>{label}</button>;
+  return <button className={cn('btn')}>{label}</button>;
 }
diff --git a/src/utils/index.ts b/src/utils/index.ts
new file mode 100644
index 0000000..1111111
--- /dev/null
+++ b/src/utils/index.ts
@@ -0,0 +1,3 @@
+export function cn(...classes: string[]) {
+  return classes.filter(Boolean).join(' ');
+}
```

- [x] **Step 2: Create protected-env fixture**

```diff
// tests/fixtures/diffs/protected-env.diff
diff --git a/.env b/.env
index aaa1111..bbb2222 100644
--- a/.env
+++ b/.env
@@ -1,2 +1,3 @@
 DATABASE_URL=postgres://localhost/dev
+API_SECRET=super-secret-value
 PORT=3000
```

- [x] **Step 3: Create mixed allowed/protected fixture**

```diff
// tests/fixtures/diffs/mixed.diff
diff --git a/src/app.ts b/src/app.ts
index 1111111..2222222 100644
--- a/src/app.ts
+++ b/src/app.ts
@@ -1,3 +1,4 @@
 import express from 'express';
+import cors from 'cors';
 const app = express();
 app.listen(3000);
diff --git a/.env.local b/.env.local
index 3333333..4444444 100644
--- a/.env.local
+++ b/.env.local
@@ -1 +1,2 @@
 NEXT_PUBLIC_API=http://localhost
+SECRET_KEY=hidden
diff --git a/src/middleware.ts b/src/middleware.ts
new file mode 100644
index 0000000..5555555
--- /dev/null
+++ b/src/middleware.ts
@@ -0,0 +1,3 @@
+export function auth(req, res, next) {
+  next();
+}
```

- [x] **Step 4: Create rename-protected fixture**

```diff
// tests/fixtures/diffs/rename-protected.diff
diff --git a/.env.example b/.env.production
similarity index 80%
rename from .env.example
rename to .env.production
index 6666666..7777777 100644
--- a/.env.example
+++ b/.env.production
@@ -1,2 +1,2 @@
-DATABASE_URL=
+DATABASE_URL=postgres://prod/db
 PORT=3000
```

- [x] **Step 5: Create malformed-header fixture**

```diff
// tests/fixtures/diffs/malformed-header.diff
diff --git
--- a/src/valid.ts
+++ b/src/valid.ts
@@ -1 +1,2 @@
 export const x = 1;
+export const y = 2;
```

- [x] **Step 6: Create binary-protected fixture**

```diff
// tests/fixtures/diffs/binary-protected.diff
diff --git a/deploy.prod.parameters.json b/deploy.prod.parameters.json
index 8888888..9999999 100644
Binary files a/deploy.prod.parameters.json and b/deploy.prod.parameters.json differ
```

- [x] **Step 7: Commit**

```bash
git add tests/fixtures/diffs/
git commit -m "test(discovery): add diff filter fixture files"
```

---

### Task 7: Streaming Diff Filter

**Files:**
- Create: `src/github/diff-filter.ts`
- Create: `tests/github/diff-filter.test.ts`

- [x] **Step 1: Write the failing test**

```typescript
// tests/github/diff-filter.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { filterDiff } from '../../src/github/diff-filter.js';

function loadDiff(name: string): string {
  return readFileSync(join(__dirname, '..', 'fixtures', 'diffs', name), 'utf-8');
}

const stubCanonicalize = (rawPath: string): string | null => {
  const stripped = rawPath.replace(/^[ab]\//, '');
  if (stripped === '' || stripped.includes('..') || stripped.startsWith('/')) return null;
  return stripped;
};

const protectedPatterns = [
  '**/.env', '**/.env.*', '**/deploy.*.parameters.json',
  '**/*.pem', '**/*.key',
];

const stubIsProtected = (path: string): boolean => {
  const basename = path.split('/').pop() ?? '';
  if (basename === '.env') return true;
  if (basename.startsWith('.env.')) return true;
  if (/^deploy\..*\.parameters\.json$/.test(basename)) return true;
  if (basename.endsWith('.pem') || basename.endsWith('.key')) return true;
  return false;
};

describe('filterDiff', () => {
  it('passes through all files when none are protected', () => {
    const diff = loadDiff('allowed-only.diff');
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files[0].path).toBe('src/components/Button.tsx');
    expect(result.files[0].patch).toContain("import { cn }");
    expect(result.files[1].path).toBe('src/utils/index.ts');
    expect(result.omitted).toHaveLength(0);
  });

  it('omits protected .env file content, retains path metadata', () => {
    const diff = loadDiff('protected-env.diff');
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0].path).toBe('.env');
    expect(result.omitted[0].reason).toBe('protected_path_content');
  });

  it('filters mixed allowed/protected, preserving allowed patches only', () => {
    const diff = loadDiff('mixed.diff');
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(2);
    expect(result.files.map(f => f.path)).toEqual([
      'src/app.ts',
      'src/middleware.ts',
    ]);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0].path).toBe('.env.local');
    // Verify no protected content leaked into allowed files
    for (const f of result.files) {
      expect(f.patch).not.toContain('SECRET_KEY');
    }
  });

  it('omits entire rename block when target path is protected', () => {
    const diff = loadDiff('rename-protected.diff');
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0].path).toBe('.env.production');
    expect(result.omitted[0].oldPath).toBe('.env.example');
    expect(result.omitted[0].reason).toBe('protected_path_content');
  });

  it('fails closed on malformed diff header (diff_filter_failed)', () => {
    const diff = loadDiff('malformed-header.diff');
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain('diff_filter_failed');
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(0);
  });

  it('omits binary protected files', () => {
    const diff = loadDiff('binary-protected.diff');
    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);

    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0].path).toBe('deploy.prod.parameters.json');
  });

  it('fails on uncanonicalizeable path', () => {
    const diff = [
      'diff --git a/../escape b/../escape',
      'index 000..111 100644',
      '--- a/../escape',
      '+++ b/../escape',
      '@@ -1 +1 @@',
      '-old',
      '+new',
    ].join('\n');

    const result = filterDiff(diff, stubCanonicalize, stubIsProtected);
    expect(result.failed).toBe(true);
    expect(result.failureReason).toContain('diff_filter_failed');
  });

  it('handles empty diff', () => {
    const result = filterDiff('', stubCanonicalize, stubIsProtected);
    expect(result.failed).toBe(false);
    expect(result.files).toHaveLength(0);
    expect(result.omitted).toHaveLength(0);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/github/diff-filter.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Write the diff filter implementation**

```typescript
// src/github/diff-filter.ts
import type { DiffFilterResult, FilteredDiffFile, OmittedDiffFile } from './types.js';

type CanonicalizeFn = (rawPath: string) => string | null;
type IsProtectedFn = (canonicalPath: string) => boolean;

const DIFF_HEADER_RE = /^diff --git a\/(.+) b\/(.+)$/;
const RENAME_FROM_RE = /^rename from (.+)$/;
const RENAME_TO_RE = /^rename to (.+)$/;
const COPY_FROM_RE = /^copy from (.+)$/;
const COPY_TO_RE = /^copy to (.+)$/;
const BINARY_RE = /^Binary files/;
const HUNK_START_RE = /^@@/;
const FILE_HEADER_RE = /^(---|\+\+\+) /;
const META_RE = /^(index |old mode |new mode |new file |deleted file |similarity |dissimilarity )/;

export function filterDiff(
  diffText: string,
  canonicalize: CanonicalizeFn,
  isProtected: IsProtectedFn,
): DiffFilterResult {
  if (!diffText.trim()) {
    return { files: [], omitted: [], failed: false };
  }

  const lines = diffText.split('\n');
  const files: FilteredDiffFile[] = [];
  const omitted: OmittedDiffFile[] = [];

  let i = 0;

  while (i < lines.length) {
    if (!lines[i].startsWith('diff --git ')) {
      i++;
      continue;
    }

    const headerMatch = DIFF_HEADER_RE.exec(lines[i]);
    if (!headerMatch) {
      return {
        files: [],
        omitted: [],
        failed: true,
        failureReason: `diff_filter_failed: malformed diff header at line ${i + 1}`,
      };
    }

    const rawPathA = headerMatch[1];
    const rawPathB = headerMatch[2];
    i++;

    let renameFrom: string | undefined;
    let renameTo: string | undefined;
    const patchLines: string[] = [];
    let isBinary = false;

    while (i < lines.length && !lines[i].startsWith('diff --git ')) {
      const line = lines[i];

      const renameFromMatch = RENAME_FROM_RE.exec(line);
      if (renameFromMatch) { renameFrom = renameFromMatch[1]; i++; continue; }

      const renameToMatch = RENAME_TO_RE.exec(line);
      if (renameToMatch) { renameTo = renameToMatch[1]; i++; continue; }

      const copyFromMatch = COPY_FROM_RE.exec(line);
      if (copyFromMatch) { renameFrom = copyFromMatch[1]; i++; continue; }

      const copyToMatch = COPY_TO_RE.exec(line);
      if (copyToMatch) { renameTo = copyToMatch[1]; i++; continue; }

      if (BINARY_RE.test(line)) { isBinary = true; i++; continue; }
      if (META_RE.test(line) || FILE_HEADER_RE.test(line)) { i++; continue; }

      if (HUNK_START_RE.test(line) || patchLines.length > 0 || line.startsWith('+') || line.startsWith('-') || line.startsWith(' ')) {
        patchLines.push(line);
      }
      i++;
    }

    const effectiveOldPath = renameFrom ?? rawPathA;
    const effectiveNewPath = renameTo ?? rawPathB;

    const canonicalNew = canonicalize(effectiveNewPath);
    const canonicalOld = canonicalize(effectiveOldPath);

    if (canonicalNew === null || canonicalOld === null) {
      return {
        files: [],
        omitted: [],
        failed: true,
        failureReason: `diff_filter_failed: unsafe or non-canonical path "${canonicalNew === null ? effectiveNewPath : effectiveOldPath}"`,
      };
    }

    const isRename = renameFrom !== undefined && renameTo !== undefined;
    const oldProtected = isProtected(canonicalOld);
    const newProtected = isProtected(canonicalNew);

    if (isRename && (oldProtected || newProtected)) {
      omitted.push({
        path: canonicalNew,
        oldPath: canonicalOld,
        reason: 'protected_path_content',
      });
    } else if (newProtected) {
      omitted.push({
        path: canonicalNew,
        reason: 'protected_path_content',
      });
    } else if (!isBinary) {
      files.push({
        path: canonicalNew,
        patch: patchLines.join('\n'),
      });
    } else {
      files.push({ path: canonicalNew, patch: '' });
    }
  }

  return { files, omitted, failed: false };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/github/diff-filter.test.ts`
Expected: all 8 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/github/diff-filter.ts tests/github/diff-filter.test.ts
git commit -m "feat(discovery): add streaming diff filter with fail-closed semantics"
```

---

### Task 8: Canonical Path Normalization for Upsert

**Files:**
- Create: `src/normalize/paths.ts`

- [x] **Step 1: Write path normalization for GitHub file lists**

```typescript
// src/normalize/paths.ts
import type { CanonicalPathMatcher } from '../paths/matcher.js';

export interface NormalizedFile {
  canonicalPath: string;
  isUnsafe: false;
}

export interface UnsafeFile {
  raw: string;
  diagnostic: string;
  isUnsafe: true;
}

export type FileNormResult = NormalizedFile | UnsafeFile;

export function normalizeFilePath(
  rawPath: string,
  matcher: CanonicalPathMatcher,
): FileNormResult {
  const canonical = matcher.canonicalize(rawPath);
  if (canonical === null) {
    return {
      raw: rawPath.slice(0, 500),
      diagnostic: `Unsafe or non-canonical path rejected: "${rawPath.slice(0, 200)}"`,
      isUnsafe: true,
    };
  }
  return { canonicalPath: canonical, isUnsafe: false };
}

export function normalizeFileList(
  paths: string[],
  matcher: CanonicalPathMatcher,
): { canonical: string[]; unsafe: Array<{ raw: string; diagnostic: string }> } {
  const canonical: string[] = [];
  const unsafe: Array<{ raw: string; diagnostic: string }> = [];

  for (const raw of paths) {
    const result = normalizeFilePath(raw, matcher);
    if (result.isUnsafe) {
      unsafe.push({ raw: result.raw, diagnostic: result.diagnostic });
    } else {
      canonical.push(result.canonicalPath);
    }
  }

  return { canonical, unsafe };
}
```

- [x] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/normalize/paths.ts`
Expected: no errors

- [x] **Step 3: Commit**

```bash
git add src/normalize/paths.ts
git commit -m "feat(discovery): add canonical path normalization for file lists"
```

---

### Task 9: Normalizer Upsert Against Plan 01 Schema

**Files:**
- Create: `src/normalize/upsert.ts`

> **Prerequisite:** Callers must run Plan 01 `runMigrations` (from `src/store/migrate.ts`) on an `openDatabase` handle before any upsert. This task does **not** CREATE TABLE — Plan 01 owns `repositories`, `prs`, `pr_files`, `pr_checks`, `pr_reviews`, `pr_comments`, and `review_requests`.

- [x] **Step 1: Write the normalizer upsert against Plan 01 schema**

```typescript
// src/normalize/upsert.ts
import type Database from 'better-sqlite3';
import type { DiscoveredPr } from '../github/types.js';

export function upsertRepository(
  db: Database.Database,
  repo: {
    id: string;
    github: string;
    defaultBranch: string;
    host: string;
    resourceClass: 'light' | 'medium' | 'heavy';
  },
): void {
  const [owner, name] = repo.github.split('/');
  const githubIdentity = `github:${repo.host}/${owner}/${name}`;
  db.prepare(`
    INSERT INTO repositories (
      id, github_identity, github_host, github_owner, github_repo,
      default_branch, resource_class, updated_at
    )
    VALUES (?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(id) DO UPDATE SET
      github_identity = excluded.github_identity,
      github_host = excluded.github_host,
      github_owner = excluded.github_owner,
      github_repo = excluded.github_repo,
      default_branch = excluded.default_branch,
      resource_class = excluded.resource_class,
      updated_at = excluded.updated_at
  `).run(
    repo.id,
    githubIdentity,
    repo.host,
    owner,
    name,
    repo.defaultBranch,
    repo.resourceClass,
  );
}

export function upsertPr(
  db: Database.Database,
  pr: DiscoveredPr,
): number {
  const upsertPrStmt = db.prepare(`
    INSERT INTO prs (
      repository_id, pr_number, title, body, url, state, draft,
      author_login, head_sha, base_sha, head_ref, base_ref,
      additions, deletions, github_created, github_updated,
      explicit_request, explicit_request_at, fetched_at
    ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
    ON CONFLICT(repository_id, pr_number) DO UPDATE SET
      title = excluded.title,
      body = excluded.body,
      url = excluded.url,
      state = excluded.state,
      draft = excluded.draft,
      author_login = excluded.author_login,
      head_sha = excluded.head_sha,
      base_sha = excluded.base_sha,
      head_ref = excluded.head_ref,
      base_ref = excluded.base_ref,
      additions = excluded.additions,
      deletions = excluded.deletions,
      github_created = excluded.github_created,
      github_updated = excluded.github_updated,
      explicit_request = MAX(prs.explicit_request, excluded.explicit_request),
      explicit_request_at = COALESCE(
        prs.explicit_request_at,
        excluded.explicit_request_at
      ),
      fetched_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    RETURNING id
  `);

  const row = upsertPrStmt.get(
    pr.repositoryId, pr.prNumber, pr.title, pr.body ?? null,
    pr.url, pr.state.toLowerCase(), pr.isDraft ? 1 : 0,
    pr.authorLogin, pr.headSha, pr.baseSha,
    pr.headRef ?? null, pr.baseRef ?? null,
    pr.additions, pr.deletions, pr.createdAt, pr.updatedAt,
    pr.explicitRequest ? 1 : 0,
    pr.explicitRequestTimestamp ?? null,
  ) as { id: number };

  return row.id;
}

export function upsertPrFiles(
  db: Database.Database,
  prId: number,
  canonicalPaths: string[],
  unsafeFiles: Array<{ raw: string; diagnostic: string }>,
): void {
  db.prepare('DELETE FROM pr_files WHERE pr_id = ?').run(prId);

  const insertFile = db.prepare(`
    INSERT INTO pr_files (pr_id, path, is_unsafe, unsafe_diagnostic)
    VALUES (?, ?, ?, ?)
  `);

  for (const path of canonicalPaths) {
    insertFile.run(prId, path, 0, null);
  }
  for (const uf of unsafeFiles) {
    insertFile.run(prId, uf.raw, 1, uf.diagnostic);
  }
}

export function upsertPrChecks(
  db: Database.Database,
  prId: number,
  checks: Array<{ name: string; status: string; conclusion: string | null; detailsUrl: string }>,
): void {
  db.prepare('DELETE FROM pr_checks WHERE pr_id = ?').run(prId);

  const insertCheck = db.prepare(`
    INSERT INTO pr_checks (pr_id, name, status, conclusion, details_url)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const c of checks) {
    insertCheck.run(prId, c.name, c.status, c.conclusion, c.detailsUrl);
  }
}

export function upsertPrReviews(
  db: Database.Database,
  prId: number,
  reviews: Array<{ authorLogin: string; state: string; body: string; submittedAt: string }>,
): void {
  db.prepare('DELETE FROM pr_reviews WHERE pr_id = ?').run(prId);

  const insertReview = db.prepare(`
    INSERT INTO pr_reviews (pr_id, author_login, state, body, submitted_at)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const r of reviews) {
    insertReview.run(prId, r.authorLogin, r.state, r.body, r.submittedAt);
  }
}

export function upsertPrComments(
  db: Database.Database,
  prId: number,
  comments: Array<{ authorLogin: string; body: string; createdAt: string; url: string }>,
): void {
  db.prepare('DELETE FROM pr_comments WHERE pr_id = ?').run(prId);

  const insertComment = db.prepare(`
    INSERT INTO pr_comments (pr_id, author_login, body, created_at, url)
    VALUES (?, ?, ?, ?, ?)
  `);

  for (const c of comments) {
    insertComment.run(prId, c.authorLogin, c.body, c.createdAt, c.url);
  }
}

export function upsertReviewRequests(
  db: Database.Database,
  prId: number,
  requests: Array<{ login: string; requestedAt?: string }>,
): void {
  db.prepare('DELETE FROM review_requests WHERE pr_id = ?').run(prId);

  const insertReq = db.prepare(`
    INSERT INTO review_requests (pr_id, requested_login, requested_at)
    VALUES (?, ?, ?)
  `);

  for (const r of requests) {
    insertReq.run(prId, r.login, r.requestedAt ?? null);
  }
}

export function upsertDiscoveredPr(
  db: Database.Database,
  pr: DiscoveredPr,
): number {
  const txn = db.transaction(() => {
    const prId = upsertPr(db, pr);
    upsertPrFiles(db, prId, pr.changedFiles, pr.unsafeFiles);
    upsertPrChecks(db, prId, pr.checks);
    upsertPrReviews(db, prId, pr.reviews);
    upsertPrComments(db, prId, pr.comments);
    upsertReviewRequests(db, prId, pr.reviewRequests);
    return prId;
  });
  return txn();
}
```

- [x] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/normalize/upsert.ts`
Expected: no errors

- [x] **Step 3: Commit**

```bash
git add src/normalize/upsert.ts
git commit -m "feat(discovery): add normalizer upsert against Plan 01 schema"
```

---

### Task 10: Eligibility Evaluator with Truth-Table Tests

**Files:**
- Create: `src/policy/eligibility.ts`
- Create: `tests/policy/eligibility.test.ts`

- [x] **Step 1: Write the eligibility truth-table test**

```typescript
// tests/policy/eligibility.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateEligibility } from '../../src/policy/eligibility.js';
import type { EligibilityReason, ExclusionReason } from '../../src/policy/reasons.js';

interface TruthTableRow {
  name: string;
  input: {
    explicitRequest: boolean;
    activeRepo: boolean;
    registeredRepoId: string | null;
    changedFiles: string[];
    authorLogin: string;
    eligiblePaths: string[];
    eligibleAuthors: string[];
    operatorLogin: string;
    githubOwnerRepo: string;
  };
  expected: {
    eligible: boolean;
    reasons?: Array<Partial<EligibilityReason>>;
    exclusions?: Array<Partial<ExclusionReason>>;
  };
}

const truthTable: TruthTableRow[] = [
  {
    name: 'explicit request in active repo',
    input: {
      explicitRequest: true, activeRepo: true,
      registeredRepoId: 'pba-webapp', changedFiles: [],
      authorLogin: 'alice', eligiblePaths: [], eligibleAuthors: [],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: true,
      reasons: [{ code: 'explicit_review_request' }],
    },
  },
  {
    name: 'explicit request in inactive repo',
    input: {
      explicitRequest: true, activeRepo: false,
      registeredRepoId: 'pba-webapp', changedFiles: [],
      authorLogin: 'alice', eligiblePaths: ['src/**'], eligibleAuthors: [],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: true,
      reasons: [{ code: 'explicit_review_request' }],
    },
  },
  {
    name: 'explicit request in unregistered repo',
    input: {
      explicitRequest: true, activeRepo: false,
      registeredRepoId: null, changedFiles: [],
      authorLogin: 'alice', eligiblePaths: [], eligibleAuthors: [],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/unknown-repo',
    },
    expected: {
      eligible: true,
      reasons: [{ code: 'explicit_review_request' }],
    },
  },
  {
    name: 'active repo, path match only',
    input: {
      explicitRequest: false, activeRepo: true,
      registeredRepoId: 'pba-webapp', changedFiles: ['src/components/Button.tsx'],
      authorLogin: 'alice', eligiblePaths: ['src/**'], eligibleAuthors: [],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: true,
      reasons: [{
        code: 'eligible_path',
        matchedPath: 'src/components/Button.tsx',
        matchedRule: 'src/**',
      }],
    },
  },
  {
    name: 'active repo, author match only',
    input: {
      explicitRequest: false, activeRepo: true,
      registeredRepoId: 'pba-webapp', changedFiles: ['README.md'],
      authorLogin: 'shubh-array', eligiblePaths: ['src/**'], eligibleAuthors: ['shubh-array'],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: true,
      reasons: [{
        code: 'eligible_author',
        normalizedLogin: 'shubh-array',
      }],
    },
  },
  {
    name: 'active repo, path AND author match (both recorded)',
    input: {
      explicitRequest: false, activeRepo: true,
      registeredRepoId: 'pba-webapp', changedFiles: ['src/app.ts'],
      authorLogin: 'shubh-array', eligiblePaths: ['src/**'], eligibleAuthors: ['shubh-array'],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: true,
      reasons: [
        { code: 'eligible_path' },
        { code: 'eligible_author' },
      ],
    },
  },
  {
    name: 'active repo, neither path nor author match',
    input: {
      explicitRequest: false, activeRepo: true,
      registeredRepoId: 'pba-webapp', changedFiles: ['docs/readme.md'],
      authorLogin: 'alice', eligiblePaths: ['src/**'], eligibleAuthors: ['shubh-array'],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: false,
      exclusions: [{ code: 'no_eligible_path_or_author_match' }],
    },
  },
  {
    name: 'inactive repo with path match — still ineligible',
    input: {
      explicitRequest: false, activeRepo: false,
      registeredRepoId: 'pba-webapp', changedFiles: ['src/app.ts'],
      authorLogin: 'alice', eligiblePaths: ['src/**'], eligibleAuthors: [],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: false,
      exclusions: [{ code: 'inactive_repository' }],
    },
  },
  {
    name: 'inactive repo with author match — still ineligible',
    input: {
      explicitRequest: false, activeRepo: false,
      registeredRepoId: 'pba-webapp', changedFiles: [],
      authorLogin: 'shubh-array', eligiblePaths: [], eligibleAuthors: ['shubh-array'],
      operatorLogin: 'shubh-array', githubOwnerRepo: 'Org/pba-webapp',
    },
    expected: {
      eligible: false,
      exclusions: [{ code: 'inactive_repository' }],
    },
  },
];

describe('evaluateEligibility', () => {
  truthTable.forEach(({ name, input, expected }) => {
    it(name, () => {
      const result = evaluateEligibility({
        explicitRequest: input.explicitRequest,
        activeRepository: input.activeRepo,
        repositoryId: input.registeredRepoId,
        githubOwnerRepo: input.githubOwnerRepo,
        changedFiles: input.changedFiles,
        authorLogin: input.authorLogin,
        eligiblePaths: input.eligiblePaths,
        eligibleAuthors: input.eligibleAuthors,
        operatorLogin: input.operatorLogin,
      });

      expect(result.eligible).toBe(expected.eligible);

      if (expected.reasons) {
        expect(result.reasons).toHaveLength(expected.reasons.length);
        for (const exp of expected.reasons) {
          expect(result.reasons).toEqual(
            expect.arrayContaining([expect.objectContaining(exp)]),
          );
        }
      }

      if (expected.exclusions) {
        expect(result.exclusions).toHaveLength(expected.exclusions.length);
        for (const exp of expected.exclusions) {
          expect(result.exclusions).toEqual(
            expect.arrayContaining([expect.objectContaining(exp)]),
          );
        }
      }
    });
  });

  it('records multiple path matches across different rules', () => {
    const result = evaluateEligibility({
      explicitRequest: false,
      activeRepository: true,
      repositoryId: 'pba-webapp',
      githubOwnerRepo: 'Org/pba-webapp',
      changedFiles: ['src/a.ts', 'src/b.ts'],
      authorLogin: 'alice',
      eligiblePaths: ['src/**'],
      eligibleAuthors: [],
      operatorLogin: 'shubh-array',
    });

    expect(result.eligible).toBe(true);
    const pathReasons = result.reasons.filter(r => r.code === 'eligible_path');
    expect(pathReasons).toHaveLength(2);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/policy/eligibility.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Write the eligibility implementation**

```typescript
// src/policy/eligibility.ts
import type {
  EligibilityReason,
  ExclusionReason,
} from './reasons.js';
import { pathMatchesAny } from '../paths/match-patterns.js';

export interface EligibilityInput {
  explicitRequest: boolean;
  activeRepository: boolean;
  repositoryId: string | null;
  githubOwnerRepo: string;
  changedFiles: string[];
  authorLogin: string;
  eligiblePaths: string[];
  eligibleAuthors: string[];
  operatorLogin: string;
}

export interface EligibilityResult {
  eligible: boolean;
  reasons: EligibilityReason[];
  exclusions: ExclusionReason[];
  authorOnly: boolean;
}

export function evaluateEligibility(input: EligibilityInput): EligibilityResult {
  const reasons: EligibilityReason[] = [];
  const exclusions: ExclusionReason[] = [];

  if (input.explicitRequest) {
    reasons.push({
      code: 'explicit_review_request',
      requestedLogin: input.operatorLogin,
    });
    return { eligible: true, reasons, exclusions, authorOnly: false };
  }

  if (!input.activeRepository) {
    const exclusion: ExclusionReason = input.repositoryId
      ? { code: 'inactive_repository', repositoryId: input.repositoryId, githubOwnerRepo: input.githubOwnerRepo }
      : { code: 'inactive_repository', githubOwnerRepo: input.githubOwnerRepo };
    exclusions.push(exclusion);
    return { eligible: false, reasons, exclusions, authorOnly: false };
  }

  const repoId = input.repositoryId!;

  for (const file of input.changedFiles) {
    if (pathMatchesAny(file, input.eligiblePaths)) {
      const matchedRule = input.eligiblePaths.find(p =>
        pathMatchesAny(file, [p]),
      ) ?? input.eligiblePaths[0];

      reasons.push({
        code: 'eligible_path',
        repositoryId: repoId,
        matchedPath: file,
        matchedRule,
      });
    }
  }

  const normalizedAuthor = input.authorLogin.toLowerCase();
  const authorMatch = input.eligibleAuthors.some(
    a => a.toLowerCase() === normalizedAuthor,
  );
  if (authorMatch) {
    reasons.push({
      code: 'eligible_author',
      repositoryId: repoId,
      normalizedLogin: normalizedAuthor,
    });
  }

  if (reasons.length === 0) {
    exclusions.push({
      code: 'no_eligible_path_or_author_match',
      repositoryId: repoId,
    });
    return { eligible: false, reasons, exclusions, authorOnly: false };
  }

  const hasPath = reasons.some(r => r.code === 'eligible_path');
  const hasExplicit = reasons.some(r => r.code === 'explicit_review_request');
  const authorOnly = !hasPath && !hasExplicit && authorMatch;

  return { eligible: true, reasons, exclusions, authorOnly };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/policy/eligibility.test.ts`
Expected: all 10+ tests PASS

- [x] **Step 5: Commit**

```bash
git add src/policy/eligibility.ts tests/policy/eligibility.test.ts
git commit -m "feat(discovery): add eligibility evaluator with truth-table tests"
```

---

### Task 11: Priority Evaluator

**Files:**
- Create: `src/policy/priority.ts`
- Create: `tests/policy/priority.test.ts`

- [x] **Step 1: Write the priority test**

```typescript
// tests/policy/priority.test.ts
import { describe, it, expect } from 'vitest';
import { evaluatePriority } from '../../src/policy/priority.js';
import type { PriorityReason } from '../../src/policy/reasons.js';
import type { PriorityStatus } from '../../src/github/types.js';

describe('evaluatePriority', () => {
  it('defaults to p3 for eligible PR with no matching priority rules', () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ['src/components/Button.tsx'],
      priorityRules: [{ paths: ['src/api-clients/**'], tier: 'p1' }],
    });

    expect(result.status).toBe('p3');
    expect(result.sortOrdinal).toBe(3);
    expect(result.reasons).toEqual([{ code: 'default_priority', tier: 'p3' }]);
  });

  it('selects matched tier from priority rule', () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ['src/api-clients/base.ts'],
      priorityRules: [{ paths: ['src/api-clients/**'], tier: 'p1' }],
    });

    expect(result.status).toBe('p1');
    expect(result.sortOrdinal).toBe(1);
    expect(result.selectedReason).toMatchObject({
      code: 'priority_rule', tier: 'p1', declarationIndex: 0,
    });
  });

  it('picks winning tier with lowest ordinal across multiple rules', () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ['src/critical/main.ts', 'src/api-clients/base.ts'],
      priorityRules: [
        { paths: ['src/api-clients/**'], tier: 'p2' },
        { paths: ['src/critical/**'], tier: 'p0' },
      ],
    });

    expect(result.status).toBe('p0');
    expect(result.sortOrdinal).toBe(0);
    expect(result.selectedReason).toMatchObject({ tier: 'p0' });
  });

  it('picks earliest declaration when same winning tier from multiple rules', () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ['src/api-clients/base.ts', 'src/lib/auth/login.ts'],
      priorityRules: [
        { paths: ['src/api-clients/**'], tier: 'p1' },
        { paths: ['src/lib/auth/**'], tier: 'p1' },
      ],
    });

    expect(result.status).toBe('p1');
    expect(result.selectedReason).toMatchObject({
      declarationIndex: 0,
    });
  });

  it('preserves all matching reasons even for non-winning tiers', () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ['src/critical/main.ts', 'src/api-clients/base.ts'],
      priorityRules: [
        { paths: ['src/api-clients/**'], tier: 'p2' },
        { paths: ['src/critical/**'], tier: 'p0' },
      ],
    });

    expect(result.allMatchingReasons.length).toBeGreaterThanOrEqual(2);
    const tiers = result.allMatchingReasons.map(r =>
      r.code === 'priority_rule' ? r.tier : null,
    ).filter(Boolean);
    expect(tiers).toContain('p0');
    expect(tiers).toContain('p2');
  });

  it('assigns unranked with exclusion codes for ineligible PR', () => {
    const result = evaluatePriority({
      eligible: false,
      exclusionCodes: ['inactive_repository'],
      changedFiles: [],
      priorityRules: [],
    });

    expect(result.status).toBe('unranked');
    expect(result.sortOrdinal).toBe(4);
    expect(result.reasons).toEqual([{
      code: 'unranked_ineligible',
      eligibilityExclusionCodes: ['inactive_repository'],
    }]);
  });

  it('maintains total order: p0 < p1 < p2 < p3 < unranked', () => {
    const ordinals = ['p0', 'p1', 'p2', 'p3', 'unranked'].map(tier => {
      const r = evaluatePriority({
        eligible: tier !== 'unranked',
        exclusionCodes: tier === 'unranked' ? ['no_eligible_path_or_author_match'] : [],
        changedFiles: [],
        priorityRules: [],
      });
      return r.sortOrdinal;
    });

    for (let i = 1; i < ordinals.length; i++) {
      expect(ordinals[i]).toBeGreaterThan(ordinals[i - 1]);
    }
  });

  it('includes matched paths in bytewise ascending order for winning reason', () => {
    const result = evaluatePriority({
      eligible: true,
      exclusionCodes: [],
      changedFiles: ['src/api-clients/z.ts', 'src/api-clients/a.ts'],
      priorityRules: [{ paths: ['src/api-clients/**'], tier: 'p1' }],
    });

    expect(result.selectedReason).toMatchObject({ code: 'priority_rule' });
    const matchedPaths = result.allMatchingReasons
      .filter(r => r.code === 'priority_rule')
      .map(r => (r as { matchedPath: string }).matchedPath);
    const sorted = [...matchedPaths].sort();
    expect(matchedPaths).toEqual(sorted);
  });
});
```

- [x] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/policy/priority.test.ts`
Expected: FAIL — module not found

- [x] **Step 3: Write the priority implementation**

```typescript
// src/policy/priority.ts
import type {
  PriorityReason,
  DefaultPriorityReason,
  PriorityRuleReason,
  UnrankedReason,
} from './reasons.js';
import type { PriorityStatus } from '../github/types.js';
import { PRIORITY_SORT_ORDINALS, PRIORITY_TIERS } from '../github/types.js';
import type { PriorityRule } from '../config/load.js';
import { pathMatchesAny } from '../paths/match-patterns.js';

export interface PriorityInput {
  eligible: boolean;
  exclusionCodes: string[];
  changedFiles: string[];
  priorityRules: PriorityRule[];
}

export interface PriorityResult {
  status: PriorityStatus;
  sortOrdinal: number;
  reasons: PriorityReason[];
  allMatchingReasons: PriorityReason[];
  selectedReason: PriorityReason | null;
}

export function evaluatePriority(input: PriorityInput): PriorityResult {
  if (!input.eligible) {
    const reason: UnrankedReason = {
      code: 'unranked_ineligible',
      eligibilityExclusionCodes: input.exclusionCodes,
    };
    return {
      status: 'unranked',
      sortOrdinal: PRIORITY_SORT_ORDINALS.unranked,
      reasons: [reason],
      allMatchingReasons: [reason],
      selectedReason: null,
    };
  }

  const matchingReasons: PriorityRuleReason[] = [];

  for (let declIdx = 0; declIdx < input.priorityRules.length; declIdx++) {
    const rule = input.priorityRules[declIdx];
    for (const file of input.changedFiles) {
      if (pathMatchesAny(file, rule.paths)) {
        const matchedRule = rule.paths.find(p =>
          pathMatchesAny(file, [p]),
        ) ?? rule.paths[0];

        matchingReasons.push({
          code: 'priority_rule',
          tier: rule.tier,
          declarationIndex: declIdx,
          matchedPath: file,
          matchedRule,
        });
      }
    }
  }

  matchingReasons.sort((a, b) => a.matchedPath.localeCompare(b.matchedPath));

  if (matchingReasons.length === 0) {
    const defaultReason: DefaultPriorityReason = { code: 'default_priority', tier: 'p3' };
    return {
      status: 'p3',
      sortOrdinal: PRIORITY_SORT_ORDINALS.p3,
      reasons: [defaultReason],
      allMatchingReasons: [defaultReason],
      selectedReason: null,
    };
  }

  let winningOrdinal = Infinity;
  let winningTier: PriorityStatus = 'p3';

  for (const r of matchingReasons) {
    const ordinal = PRIORITY_SORT_ORDINALS[r.tier as PriorityStatus];
    if (ordinal !== undefined && ordinal < winningOrdinal) {
      winningOrdinal = ordinal;
      winningTier = r.tier as PriorityStatus;
    }
  }

  const winnersAtTier = matchingReasons.filter(r => r.tier === winningTier);
  winnersAtTier.sort((a, b) => a.declarationIndex - b.declarationIndex);
  const selectedReason = winnersAtTier[0];

  return {
    status: winningTier,
    sortOrdinal: winningOrdinal,
    reasons: [selectedReason, ...matchingReasons.filter(r => r !== selectedReason)],
    allMatchingReasons: matchingReasons,
    selectedReason,
  };
}
```

- [x] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/policy/priority.test.ts`
Expected: all 8 tests PASS

- [x] **Step 5: Commit**

```bash
git add src/policy/priority.ts tests/policy/priority.test.ts
git commit -m "feat(discovery): add priority evaluator with tier selection and unranked"
```

---

### Task 12: Domain Selection

**Files:**
- Create: `src/policy/domains.ts`
- Create: `tests/policy/domains.test.ts`

- [ ] **Step 1: Write the domain selection test**

```typescript
// tests/policy/domains.test.ts
import { describe, it, expect } from 'vitest';
import { selectDomains } from '../../src/policy/domains.js';

describe('selectDomains', () => {
  it('selects a single matching domain', () => {
    const result = selectDomains({
      changedFiles: ['src/components/App.tsx'],
      domainRules: [
        { domain: 'frontend', paths: ['src/**'], priority: 100 },
      ],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].domain).toBe('frontend');
    expect(result.selected[0].selectedPriority).toBe(100);
  });

  it('picks highest numeric priority when multiple rules match same domain', () => {
    const result = selectDomains({
      changedFiles: ['src/app.ts', 'services/api.ts'],
      domainRules: [
        { domain: 'backend', paths: ['services/**'], priority: 50 },
        { domain: 'backend', paths: ['src/**'], priority: 200 },
      ],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].domain).toBe('backend');
    expect(result.selected[0].selectedPriority).toBe(200);
  });

  it('breaks same-priority tie with earliest declaration index', () => {
    const result = selectDomains({
      changedFiles: ['src/app.ts', 'services/api.ts'],
      domainRules: [
        { domain: 'backend', paths: ['services/**'], priority: 100 },
        { domain: 'backend', paths: ['src/**'], priority: 100 },
      ],
    });

    expect(result.selected).toHaveLength(1);
    expect(result.selected[0].selectedDeclarationIndex).toBe(0);
  });

  it('orders selected domains: descending priority, ascending declaration, name', () => {
    const result = selectDomains({
      changedFiles: ['src/app.ts', 'infra/deploy.ts', 'services/api.ts'],
      domainRules: [
        { domain: 'frontend', paths: ['src/**'], priority: 100 },
        { domain: 'infrastructure', paths: ['infra/**'], priority: 50 },
        { domain: 'backend', paths: ['services/**'], priority: 200 },
      ],
    });

    expect(result.selected.map(d => d.domain)).toEqual([
      'backend',
      'frontend',
      'infrastructure',
    ]);
  });

  it('enforces max 3 domains', () => {
    const result = selectDomains({
      changedFiles: ['src/a.ts', 'services/b.ts', 'infra/c.ts', 'packages/d.ts'],
      domainRules: [
        { domain: 'frontend', paths: ['src/**'], priority: 100 },
        { domain: 'backend', paths: ['services/**'], priority: 200 },
        { domain: 'infrastructure', paths: ['infra/**'], priority: 50 },
        { domain: 'packages', paths: ['packages/**'], priority: 10 },
      ],
    });

    expect(result.selected).toHaveLength(3);
    expect(result.selected.map(d => d.domain)).not.toContain('packages');
  });

  it('selects no domains when no files match', () => {
    const result = selectDomains({
      changedFiles: ['docs/readme.md'],
      domainRules: [
        { domain: 'frontend', paths: ['src/**'], priority: 100 },
      ],
    });

    expect(result.selected).toHaveLength(0);
  });

  it('preserves all matching reasons per domain', () => {
    const result = selectDomains({
      changedFiles: ['src/a.ts', 'src/b.ts'],
      domainRules: [
        { domain: 'frontend', paths: ['src/**'], priority: 100 },
      ],
    });

    expect(result.selected[0].allReasons).toHaveLength(2);
  });

  it('includes matched paths in bytewise ascending order', () => {
    const result = selectDomains({
      changedFiles: ['src/z.ts', 'src/a.ts'],
      domainRules: [
        { domain: 'frontend', paths: ['src/**'], priority: 100 },
      ],
    });

    expect(result.selected[0].matchedPaths).toEqual(['src/a.ts', 'src/z.ts']);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/policy/domains.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the domain selection implementation**

```typescript
// src/policy/domains.ts
import type { DomainMatchReason, SelectedDomain } from './reasons.js';
import type { DomainRule } from '../config/load.js';
import { pathMatchesAny } from '../paths/match-patterns.js';

const MAX_DOMAINS = 3;

export interface DomainInput {
  changedFiles: string[];
  domainRules: DomainRule[];
}

export interface DomainResult {
  selected: SelectedDomain[];
  allReasons: DomainMatchReason[];
}

export function selectDomains(input: DomainInput): DomainResult {
  const allReasons: DomainMatchReason[] = [];

  for (let declIdx = 0; declIdx < input.domainRules.length; declIdx++) {
    const rule = input.domainRules[declIdx];
    for (const file of input.changedFiles) {
      if (pathMatchesAny(file, rule.paths)) {
        const matchedRule = rule.paths.find(p =>
          pathMatchesAny(file, [p]),
        ) ?? rule.paths[0];

        allReasons.push({
          code: 'domain_rule',
          domain: rule.domain,
          numericPriority: rule.priority,
          declarationIndex: declIdx,
          matchedPath: file,
          matchedRule,
        });
      }
    }
  }

  if (allReasons.length === 0) {
    return { selected: [], allReasons: [] };
  }

  const domainMap = new Map<string, DomainMatchReason[]>();
  for (const r of allReasons) {
    const existing = domainMap.get(r.domain) ?? [];
    existing.push(r);
    domainMap.set(r.domain, existing);
  }

  const selected: SelectedDomain[] = [];

  for (const [domain, reasons] of domainMap) {
    reasons.sort((a, b) => {
      if (b.numericPriority !== a.numericPriority) return b.numericPriority - a.numericPriority;
      return a.declarationIndex - b.declarationIndex;
    });

    const winner = reasons[0];
    const matchedPaths = reasons
      .filter(r => r.declarationIndex === winner.declarationIndex && r.numericPriority === winner.numericPriority)
      .map(r => r.matchedPath)
      .sort();

    selected.push({
      domain,
      selectedPriority: winner.numericPriority,
      selectedDeclarationIndex: winner.declarationIndex,
      matchedPaths,
      allReasons: reasons,
    });
  }

  selected.sort((a, b) => {
    if (b.selectedPriority !== a.selectedPriority) return b.selectedPriority - a.selectedPriority;
    if (a.selectedDeclarationIndex !== b.selectedDeclarationIndex) return a.selectedDeclarationIndex - b.selectedDeclarationIndex;
    return a.domain.localeCompare(b.domain);
  });

  return {
    selected: selected.slice(0, MAX_DOMAINS),
    allReasons,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/policy/domains.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/domains.ts tests/policy/domains.test.ts
git commit -m "feat(discovery): add deterministic domain selection with max-3 bound"
```

---

### Task 13: Auto-Analysis Evaluator

**Files:**
- Create: `src/policy/auto-analyze.ts`
- Create: `tests/policy/auto-analyze.test.ts`

- [ ] **Step 1: Write the auto-analysis test**

```typescript
// tests/policy/auto-analyze.test.ts
import { describe, it, expect } from 'vitest';
import { evaluateAutoAnalysis } from '../../src/policy/auto-analyze.js';
import type { AnalysisMode } from '../../src/github/types.js';

describe('evaluateAutoAnalysis', () => {
  it('auto-analyzes explicit review request when enabled', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: true,
      authorOnly: false,
      selectedTier: 'p3',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1'],
      },
    });

    expect(result.mode).toBe('auto');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'auto_analyze_explicit_request' }),
      ]),
    );
  });

  it('does NOT auto-analyze explicit request when disabled', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: true,
      authorOnly: false,
      selectedTier: 'p3',
      autoAnalyzeConfig: {
        explicitReviewRequests: false,
        priorityTiers: ['p0', 'p1'],
      },
    });

    expect(result.mode).toBe('on_demand');
    expect(result.reasons).toHaveLength(0);
  });

  it('auto-analyzes when selected tier is in priorityTiers', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: false,
      selectedTier: 'p1',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1'],
      },
    });

    expect(result.mode).toBe('auto');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'auto_analyze_priority_tier', tier: 'p1' }),
      ]),
    );
  });

  it('on-demand when selected tier is NOT in priorityTiers', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: false,
      selectedTier: 'p3',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1'],
      },
    });

    expect(result.mode).toBe('on_demand');
  });

  it('author-only does NOT auto-analyze even if tier would match', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: true,
      selectedTier: 'p3',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1', 'p2', 'p3'],
      },
    });

    expect(result.mode).toBe('on_demand');
  });

  it('author-only CAN auto-analyze when independent priority rule matches', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: false,
      authorOnly: true,
      selectedTier: 'p1',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1'],
      },
      hasIndependentPriorityMatch: true,
    });

    expect(result.mode).toBe('auto');
    expect(result.reasons).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'auto_analyze_priority_tier', tier: 'p1' }),
      ]),
    );
  });

  it('unranked (ineligible) can NEVER auto-analyze', () => {
    const result = evaluateAutoAnalysis({
      eligible: false,
      explicitRequest: false,
      authorOnly: false,
      selectedTier: 'unranked',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1'],
      },
    });

    expect(result.mode).toBe('on_demand');
    expect(result.reasons).toHaveLength(0);
  });

  it('collects multiple auto-analysis reasons when both explicit and tier match', () => {
    const result = evaluateAutoAnalysis({
      eligible: true,
      explicitRequest: true,
      authorOnly: false,
      selectedTier: 'p0',
      autoAnalyzeConfig: {
        explicitReviewRequests: true,
        priorityTiers: ['p0', 'p1'],
      },
    });

    expect(result.mode).toBe('auto');
    expect(result.reasons).toHaveLength(2);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/policy/auto-analyze.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the auto-analysis implementation**

```typescript
// src/policy/auto-analyze.ts
import type { AutoAnalyzeReason } from './reasons.js';
import type { AnalysisMode, PriorityStatus } from '../github/types.js';

export interface AutoAnalyzeConfig {
  explicitReviewRequests: boolean;
  priorityTiers: string[];
}

export interface AutoAnalyzeInput {
  eligible: boolean;
  explicitRequest: boolean;
  authorOnly: boolean;
  selectedTier: PriorityStatus;
  autoAnalyzeConfig: AutoAnalyzeConfig;
  hasIndependentPriorityMatch?: boolean;
}

export interface AutoAnalyzeResult {
  mode: AnalysisMode;
  reasons: AutoAnalyzeReason[];
}

export function evaluateAutoAnalysis(input: AutoAnalyzeInput): AutoAnalyzeResult {
  const reasons: AutoAnalyzeReason[] = [];

  if (!input.eligible) {
    return { mode: 'on_demand', reasons };
  }

  if (input.selectedTier === 'unranked') {
    return { mode: 'on_demand', reasons };
  }

  if (input.explicitRequest && input.autoAnalyzeConfig.explicitReviewRequests) {
    reasons.push({ code: 'auto_analyze_explicit_request' });
  }

  const tierAutoAnalyze = input.autoAnalyzeConfig.priorityTiers.includes(input.selectedTier);

  if (tierAutoAnalyze) {
    if (input.authorOnly && !input.hasIndependentPriorityMatch) {
      // author-only does not auto-analyze unless independent priority rule matches
    } else {
      reasons.push({ code: 'auto_analyze_priority_tier', tier: input.selectedTier });
    }
  }

  return {
    mode: reasons.length > 0 ? 'auto' : 'on_demand',
    reasons,
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/policy/auto-analyze.test.ts`
Expected: all 8 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/auto-analyze.ts tests/policy/auto-analyze.test.ts
git commit -m "feat(discovery): add auto-analysis evaluator with author-only guard"
```

---

### Task 14: Policy Composition

**Files:**
- Create: `src/policy/evaluate.ts`

- [ ] **Step 1: Write the policy composition module**

```typescript
// src/policy/evaluate.ts
import type { DiscoveredPr, PriorityStatus, AnalysisMode } from '../github/types.js';
import type {
  EligibilityReason,
  ExclusionReason,
  PriorityReason,
  AutoAnalyzeReason,
  SelectedDomain,
  DomainMatchReason,
} from './reasons.js';
import type { RepositoryPolicy } from '../config/load.js';
import { evaluateEligibility, type EligibilityResult } from './eligibility.js';
import { evaluatePriority, type PriorityResult } from './priority.js';
import { selectDomains, type DomainResult } from './domains.js';
import { evaluateAutoAnalysis, type AutoAnalyzeResult, type AutoAnalyzeConfig } from './auto-analyze.js';

export interface PolicyInput {
  pr: DiscoveredPr;
  activeRepositoryIds: string[];
  repositoryPolicy: RepositoryPolicy | null;
  autoAnalyzeConfig: AutoAnalyzeConfig;
  operatorLogin: string;
}

export interface PolicyDecision {
  eligible: boolean;
  eligibilityReasons: EligibilityReason[];
  exclusionReasons: ExclusionReason[];
  authorOnly: boolean;
  priorityStatus: PriorityStatus;
  prioritySortOrdinal: number;
  priorityReasons: PriorityReason[];
  allPriorityReasons: PriorityReason[];
  selectedPriorityReason: PriorityReason | null;
  analysisMode: AnalysisMode;
  autoAnalyzeReasons: AutoAnalyzeReason[];
  selectedDomains: SelectedDomain[];
  allDomainReasons: DomainMatchReason[];
}

export function evaluatePolicy(input: PolicyInput): PolicyDecision {
  const isActive = input.activeRepositoryIds.includes(input.pr.repositoryId);
  const repoPolicy = input.repositoryPolicy;

  const eligibility: EligibilityResult = evaluateEligibility({
    explicitRequest: input.pr.explicitRequest,
    activeRepository: isActive,
    repositoryId: input.pr.repositoryId || null,
    githubOwnerRepo: input.pr.githubOwnerRepo,
    changedFiles: input.pr.changedFiles,
    authorLogin: input.pr.authorLogin,
    eligiblePaths: repoPolicy?.eligiblePaths ?? [],
    eligibleAuthors: repoPolicy?.eligibleAuthors ?? [],
    operatorLogin: input.operatorLogin,
  });

  const exclusionCodes = eligibility.exclusions.map(e => e.code);

  const priority: PriorityResult = evaluatePriority({
    eligible: eligibility.eligible,
    exclusionCodes,
    changedFiles: input.pr.changedFiles,
    priorityRules: repoPolicy?.priorityRules ?? [],
  });

  const domains: DomainResult = eligibility.eligible
    ? selectDomains({
        changedFiles: input.pr.changedFiles,
        domainRules: repoPolicy?.domainRules ?? [],
      })
    : { selected: [], allReasons: [] };

  // Author-only eligibility is on-demand unless an independent priorityRules
  // match applies (spec §6.2 / §10.3). authorOnly already implies no
  // explicit_review_request and no eligible_path.
  const hasIndependentPriorityMatch =
    eligibility.authorOnly &&
    priority.allMatchingReasons.some((r) => r.code === 'priority_rule');

  const autoAnalysis: AutoAnalyzeResult = evaluateAutoAnalysis({
    eligible: eligibility.eligible,
    explicitRequest: input.pr.explicitRequest,
    authorOnly: eligibility.authorOnly,
    selectedTier: priority.status,
    autoAnalyzeConfig: input.autoAnalyzeConfig,
    hasIndependentPriorityMatch,
  });

  return {
    eligible: eligibility.eligible,
    eligibilityReasons: eligibility.reasons,
    exclusionReasons: eligibility.exclusions,
    authorOnly: eligibility.authorOnly,
    priorityStatus: priority.status,
    prioritySortOrdinal: priority.sortOrdinal,
    priorityReasons: priority.reasons,
    allPriorityReasons: priority.allMatchingReasons,
    selectedPriorityReason: priority.selectedReason,
    analysisMode: autoAnalysis.mode,
    autoAnalyzeReasons: autoAnalysis.reasons,
    selectedDomains: domains.selected,
    allDomainReasons: domains.allReasons,
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/policy/evaluate.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/policy/evaluate.ts
git commit -m "feat(discovery): add policy composition combining eligibility/priority/domains/auto-analysis"
```

---

### Task 15: Queue Ordering

**Files:**
- Create: `src/policy/queue-order.ts`
- Create: `tests/policy/queue-order.test.ts`

- [ ] **Step 1: Write the queue ordering test**

```typescript
// tests/policy/queue-order.test.ts
import { describe, it, expect } from 'vitest';
import {
  compareQueueOrder,
  computeQueueTimestampSort,
  toQueueTuple,
  type QueueSortInput,
} from '../../src/policy/queue-order.js';

function makeItem(overrides: Partial<QueueSortInput>): QueueSortInput {
  return {
    prNumber: 1,
    normalizedRepositoryIdentity: 'pba-webapp',
    prioritySortOrdinal: 3,
    explicitRequest: false,
    explicitRequestTimestamp: undefined,
    updatedAt: '2026-07-09T10:00:00Z',
    eligible: true,
    ...overrides,
  };
}

describe('compareQueueOrder', () => {
  it('sorts p0 before p1 before p2 before p3 before unranked', () => {
    const items: QueueSortInput[] = [
      makeItem({ prioritySortOrdinal: 4, prNumber: 5, eligible: false }),
      makeItem({ prioritySortOrdinal: 3, prNumber: 4 }),
      makeItem({ prioritySortOrdinal: 1, prNumber: 2 }),
      makeItem({ prioritySortOrdinal: 0, prNumber: 1 }),
      makeItem({ prioritySortOrdinal: 2, prNumber: 3 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted.map(i => i.prioritySortOrdinal)).toEqual([0, 1, 2, 3, 4]);
  });

  it('sorts explicit requests before non-explicit within same priority', () => {
    const items: QueueSortInput[] = [
      makeItem({ explicitRequest: false, prNumber: 2 }),
      makeItem({ explicitRequest: true, prNumber: 1 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0].explicitRequest).toBe(true);
  });

  it('sorts by queue timestamp within same priority and explicit status', () => {
    const items: QueueSortInput[] = [
      makeItem({ updatedAt: '2026-07-09T12:00:00Z', prNumber: 2 }),
      makeItem({ updatedAt: '2026-07-09T08:00:00Z', prNumber: 1 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0].prNumber).toBe(1);
  });

  it('uses explicit request timestamp as queue timestamp when present', () => {
    const items: QueueSortInput[] = [
      makeItem({
        explicitRequest: true,
        explicitRequestTimestamp: '2026-07-09T15:00:00Z',
        updatedAt: '2026-07-09T20:00:00Z',
        prNumber: 2,
      }),
      makeItem({
        explicitRequest: true,
        explicitRequestTimestamp: '2026-07-09T10:00:00Z',
        updatedAt: '2026-07-09T08:00:00Z',
        prNumber: 1,
      }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0].prNumber).toBe(1);
  });

  it('sorts unknown timestamps after all valid instants', () => {
    const items: QueueSortInput[] = [
      makeItem({ updatedAt: 'invalid-date', prNumber: 2 }),
      makeItem({ updatedAt: '2026-07-09T12:00:00Z', prNumber: 1 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted[0].prNumber).toBe(1);
    expect(sorted[1].prNumber).toBe(2);
  });

  it('breaks timestamp ties with repository identity then PR number', () => {
    const items: QueueSortInput[] = [
      makeItem({ normalizedRepositoryIdentity: 'pba-webapp', prNumber: 10 }),
      makeItem({ normalizedRepositoryIdentity: 'pba-agents', prNumber: 5 }),
      makeItem({ normalizedRepositoryIdentity: 'pba-agents', prNumber: 3 }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted.map(i => `${i.normalizedRepositoryIdentity}#${i.prNumber}`)).toEqual([
      'pba-agents#3',
      'pba-agents#5',
      'pba-webapp#10',
    ]);
  });

  it('complete tuple produces stable sort across all tiers', () => {
    const items: QueueSortInput[] = [
      makeItem({ prioritySortOrdinal: 3, explicitRequest: false, updatedAt: '2026-07-09T10:00:00Z', normalizedRepositoryIdentity: 'pba-webapp', prNumber: 42 }),
      makeItem({ prioritySortOrdinal: 0, explicitRequest: true, explicitRequestTimestamp: '2026-07-08T08:00:00Z', updatedAt: '2026-07-09T10:00:00Z', normalizedRepositoryIdentity: 'pba-agents', prNumber: 10 }),
      makeItem({ prioritySortOrdinal: 1, explicitRequest: false, updatedAt: '2026-07-09T09:00:00Z', normalizedRepositoryIdentity: 'pba-webapp', prNumber: 30 }),
      makeItem({ prioritySortOrdinal: 4, explicitRequest: false, updatedAt: '2026-07-09T08:00:00Z', normalizedRepositoryIdentity: 'pba-infra', prNumber: 5, eligible: false }),
    ];

    const sorted = [...items].sort(compareQueueOrder);
    expect(sorted.map(i => i.prNumber)).toEqual([10, 30, 42, 5]);
  });
});

describe('computeQueueTimestampSort', () => {
  it('uses explicitRequestTimestamp when present', () => {
    const ts = computeQueueTimestampSort('2026-07-09T10:00:00Z', '2026-07-09T20:00:00Z');
    expect(ts).toBe('2026-07-09T10:00:00.000Z');
  });

  it('uses updatedAt when no explicit request', () => {
    const ts = computeQueueTimestampSort(undefined, '2026-07-09T12:00:00Z');
    expect(ts).toBe('2026-07-09T12:00:00.000Z');
  });

  it('returns unknown for invalid dates', () => {
    const ts = computeQueueTimestampSort(undefined, 'not-a-date');
    expect(ts).toBe('unknown');
  });
});

describe('toQueueTuple', () => {
  it('maps QueueSortInput to canonical QueueTuple fields', () => {
    const tuple = toQueueTuple(makeItem({
      prioritySortOrdinal: 1,
      explicitRequest: true,
      explicitRequestTimestamp: '2026-07-09T10:00:00Z',
      updatedAt: '2026-07-09T20:00:00Z',
      normalizedRepositoryIdentity: 'pba-agents',
      prNumber: 7,
    }));

    expect(tuple).toEqual({
      prioritySortOrdinal: 1,
      explicitRequestSort: 0,
      queueTimestampSort: '2026-07-09T10:00:00.000Z',
      normalizedRepositoryIdentity: 'pba-agents',
      prNumber: 7,
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/policy/queue-order.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the queue ordering implementation**

```typescript
// src/policy/queue-order.ts

/** Sort input — maps to canonical QueueTuple fields. */
export interface QueueSortInput {
  prNumber: number;
  normalizedRepositoryIdentity: string;
  prioritySortOrdinal: number;
  explicitRequest: boolean;
  explicitRequestTimestamp?: string;
  updatedAt: string;
  eligible: boolean;
}

export interface QueueTuple {
  prioritySortOrdinal: number;
  explicitRequestSort: 0 | 1;
  queueTimestampSort: string; // ISO UTC or "unknown" sentinel after all valid instants
  normalizedRepositoryIdentity: string;
  prNumber: number;
}

const UNKNOWN_TIMESTAMP_SENTINEL = 'unknown';

export function toQueueTuple(item: QueueSortInput): QueueTuple {
  return {
    prioritySortOrdinal: item.prioritySortOrdinal,
    explicitRequestSort: item.explicitRequest ? 0 : 1,
    queueTimestampSort: computeQueueTimestampSort(
      item.explicitRequestTimestamp,
      item.updatedAt,
    ),
    normalizedRepositoryIdentity: item.normalizedRepositoryIdentity,
    prNumber: item.prNumber,
  };
}

export function computeQueueTimestampSort(
  explicitRequestTimestamp: string | undefined,
  updatedAt: string,
): string {
  const raw = explicitRequestTimestamp ?? updatedAt;
  const ms = new Date(raw).getTime();
  if (Number.isNaN(ms)) return UNKNOWN_TIMESTAMP_SENTINEL;
  return new Date(ms).toISOString();
}

export function compareQueueOrder(a: QueueSortInput, b: QueueSortInput): number {
  const ta = toQueueTuple(a);
  const tb = toQueueTuple(b);
  if (ta.prioritySortOrdinal !== tb.prioritySortOrdinal) {
    return ta.prioritySortOrdinal - tb.prioritySortOrdinal;
  }
  if (ta.explicitRequestSort !== tb.explicitRequestSort) {
    return ta.explicitRequestSort - tb.explicitRequestSort;
  }
  if (ta.queueTimestampSort === UNKNOWN_TIMESTAMP_SENTINEL && tb.queueTimestampSort !== UNKNOWN_TIMESTAMP_SENTINEL) {
    return 1;
  }
  if (tb.queueTimestampSort === UNKNOWN_TIMESTAMP_SENTINEL && ta.queueTimestampSort !== UNKNOWN_TIMESTAMP_SENTINEL) {
    return -1;
  }
  if (ta.queueTimestampSort !== tb.queueTimestampSort) {
    return ta.queueTimestampSort < tb.queueTimestampSort ? -1 : 1;
  }
  if (ta.normalizedRepositoryIdentity !== tb.normalizedRepositoryIdentity) {
    return ta.normalizedRepositoryIdentity < tb.normalizedRepositoryIdentity ? -1 : 1;
  }
  return ta.prNumber - tb.prNumber;
}

export function isFocusQueueEligible(item: QueueSortInput): boolean {
  return item.eligible && item.prioritySortOrdinal < 4;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/policy/queue-order.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/policy/queue-order.ts tests/policy/queue-order.test.ts
git commit -m "feat(discovery): add queue ordering with complete All Tracked tuple"
```

---

### Task 16: Ticket Extractors

**Files:**
- Create: `src/tickets/extract.ts`

- [ ] **Step 1: Write the ticket extractor**

```typescript
// src/tickets/extract.ts
import type { TicketExtractor } from '../config/load.js';

export interface ExtractedTicket {
  extractorId: string;
  identifier: string;
  source: string;
}

export function extractTickets(
  extractors: TicketExtractor[],
  pr: { title: string; body?: string; headRef?: string },
): ExtractedTicket[] {
  const results: ExtractedTicket[] = [];
  const seen = new Set<string>();

  for (const extractor of extractors) {
    const regex = new RegExp(extractor.pattern, 'g');

    for (const source of extractor.sources) {
      let text: string | undefined;
      if (source === 'title') text = pr.title;
      else if (source === 'body') text = pr.body;
      else if (source === 'branch') text = pr.headRef;

      if (!text) continue;

      let match: RegExpExecArray | null;
      while ((match = regex.exec(text)) !== null) {
        const key = `${extractor.id}:${match[0]}`;
        if (!seen.has(key)) {
          seen.add(key);
          results.push({
            extractorId: extractor.id,
            identifier: match[0],
            source,
          });
        }
      }
    }
  }

  return results;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/tickets/extract.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/tickets/extract.ts
git commit -m "feat(discovery): add ticket identifier extraction from PR metadata"
```

---

### Task 17: Discovery Checkpoints

**Files:**
- Create: `src/discovery/checkpoints.ts`

> **Prerequisite:** Plan 01 `runMigrations` must have created `discovery_checkpoints` (`id`, `host`, `checkpoint`, `freshness_at`, `healthy`, `updated_at`). This task only reads/upserts — it does **not** CREATE TABLE.

- [ ] **Step 1: Write the checkpoint store**

```typescript
// src/discovery/checkpoints.ts
import type Database from 'better-sqlite3';

export interface Checkpoint {
  id: string;
  host: string;
  checkpoint: string;
  freshnessAt: string | null;
  healthy: boolean;
  updatedAt: string;
}

export class CheckpointStore {
  constructor(private readonly db: Database.Database) {}

  get(id: string): string | null {
    const row = this.db.prepare(
      'SELECT checkpoint FROM discovery_checkpoints WHERE id = ?',
    ).get(id) as { checkpoint: string } | undefined;
    return row?.checkpoint ?? null;
  }

  set(
    id: string,
    host: string,
    checkpoint: string,
    opts?: { freshnessAt?: string | null; healthy?: boolean },
  ): void {
    this.db.prepare(`
      INSERT INTO discovery_checkpoints (
        id, host, checkpoint, freshness_at, healthy, updated_at
      )
      VALUES (?, ?, ?, ?, ?, strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
      ON CONFLICT(id) DO UPDATE SET
        host = excluded.host,
        checkpoint = excluded.checkpoint,
        freshness_at = excluded.freshness_at,
        healthy = excluded.healthy,
        updated_at = excluded.updated_at
    `).run(
      id,
      host,
      checkpoint,
      opts?.freshnessAt ?? null,
      opts?.healthy === false ? 0 : 1,
    );
  }

  getLastPollTime(host: string): string | null {
    return this.get(`poll:${host}:lastCompleted`);
  }

  setLastPollTime(host: string): void {
    const now = new Date().toISOString();
    this.set(`poll:${host}:lastCompleted`, host, now, { freshnessAt: now });
  }

  getPageCursor(host: string, query: string): string | null {
    return this.get(`cursor:${host}:${query}`);
  }

  setPageCursor(host: string, query: string, cursor: string): void {
    this.set(`cursor:${host}:${query}`, host, cursor);
  }

  clearPageCursor(host: string, query: string): void {
    this.db.prepare(
      'DELETE FROM discovery_checkpoints WHERE id = ?',
    ).run(`cursor:${host}:${query}`);
  }
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit src/discovery/checkpoints.ts`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add src/discovery/checkpoints.ts
git commit -m "feat(discovery): add checkpoint store for resumable polling"
```

---

### Task 18: Discovery Poll Loop

**Files:**
- Create: `src/discovery/poll.ts`
- Create: `tests/discovery/poll.test.ts`

- [ ] **Step 1: Write the poll loop test**

```typescript
// tests/discovery/poll.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { DiscoveryPoller, type DiscoveryDeps } from '../../src/discovery/poll.js';
import type { HostHealth, DiscoveredPr } from '../../src/github/types.js';

function healthyHost(): HostHealth {
  return {
    host: 'github.com',
    healthy: true,
    authenticatedLogin: 'shubh-array',
    checkedAt: new Date().toISOString(),
  };
}

function unhealthyHost(): HostHealth {
  return {
    host: 'github.com',
    healthy: false,
    authenticatedLogin: 'wrong-user',
    error: 'Login mismatch',
    checkedAt: new Date().toISOString(),
  };
}

function makeDeps(overrides?: Partial<DiscoveryDeps>): DiscoveryDeps {
  return {
    verifyIdentity: vi.fn().mockResolvedValue(healthyHost()),
    searchReviewRequested: vi.fn().mockResolvedValue([]),
    listRepoPrs: vi.fn().mockResolvedValue([]),
    enrichPr: vi.fn().mockResolvedValue(null),
    normalizePr: vi.fn().mockReturnValue({
      repositoryId: 'test', githubOwnerRepo: 'Org/test',
      prNumber: 1, title: 'Test', url: '', state: 'OPEN',
      isDraft: false, authorLogin: 'alice', headSha: 'abc',
      baseSha: 'def', labels: [], additions: 0, deletions: 0,
      createdAt: '', updatedAt: '', changedFiles: [], unsafeFiles: [],
      reviewRequests: [], checks: [], reviews: [], comments: [],
      explicitRequest: false,
    } satisfies DiscoveredPr),
    upsertPr: vi.fn().mockReturnValue(1),
    evaluatePolicy: vi.fn().mockReturnValue({
      eligible: true, eligibilityReasons: [], exclusionReasons: [],
      authorOnly: false, priorityStatus: 'p3', prioritySortOrdinal: 3,
      priorityReasons: [], allPriorityReasons: [], selectedPriorityReason: null,
      analysisMode: 'on_demand', autoAnalyzeReasons: [],
      selectedDomains: [], allDomainReasons: [],
    }),
    checkpoint: {
      getLastPollTime: vi.fn().mockReturnValue(null),
      setLastPollTime: vi.fn(),
    },
    config: {
      host: 'github.com',
      organizations: ['Powered-By-Array'],
      operatorLogin: 'shubh-array',
      activeRepositoryIds: ['pba-webapp'],
      repositories: [{ id: 'pba-webapp', github: 'Powered-By-Array/pba-webapp' }],
      pollIntervalSeconds: 300,
    },
    ...overrides,
  };
}

describe('DiscoveryPoller', () => {
  it('verifies operator identity before polling', async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.verifyIdentity).toHaveBeenCalledOnce();
  });

  it('skips polling when host is unhealthy', async () => {
    const deps = makeDeps({
      verifyIdentity: vi.fn().mockResolvedValue(unhealthyHost()),
    });
    const poller = new DiscoveryPoller(deps);

    const result = await poller.poll();

    expect(result.skipped).toBe(true);
    expect(result.reason).toMatch(/unhealthy/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
  });

  it('searches for explicit review requests using exact operator login', async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.searchReviewRequested).toHaveBeenCalledWith(
      'shubh-array',
      ['Powered-By-Array'],
    );
  });

  it('lists PRs for each active repository', async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.listRepoPrs).toHaveBeenCalledWith('Powered-By-Array/pba-webapp');
  });

  it('records checkpoint after successful poll', async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.checkpoint.setLastPollTime).toHaveBeenCalledWith('github.com');
  });

  it('on-demand refresh triggers immediate poll', async () => {
    const deps = makeDeps();
    const poller = new DiscoveryPoller(deps);

    await poller.refresh();

    expect(deps.verifyIdentity).toHaveBeenCalledOnce();
    expect(deps.searchReviewRequested).toHaveBeenCalledOnce();
  });

  it('deduplicates PRs seen from both search and list', async () => {
    const prItem = {
      number: 42,
      repository: { nameWithOwner: 'Powered-By-Array/pba-webapp' },
    };
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([prItem]),
      listRepoPrs: vi.fn().mockResolvedValue([{ ...prItem }]),
    });
    const poller = new DiscoveryPoller(deps);

    await poller.poll();

    expect(deps.upsertPr).toHaveBeenCalledOnce();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run tests/discovery/poll.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Write the poll loop implementation**

```typescript
// src/discovery/poll.ts
import type { HostHealth, DiscoveredPr, GhSearchPrItem, GhPrListItem } from '../github/types.js';
import type { PolicyDecision } from '../policy/evaluate.js';

export interface DiscoveryDeps {
  verifyIdentity: () => Promise<HostHealth>;
  searchReviewRequested: (login: string, orgs: string[]) => Promise<GhSearchPrItem[]>;
  listRepoPrs: (ownerRepo: string) => Promise<GhPrListItem[]>;
  enrichPr: (ownerRepo: string, prNumber: number) => Promise<any | null>;
  normalizePr: (raw: any, repositoryId: string, explicitRequest: boolean) => DiscoveredPr;
  upsertPr: (pr: DiscoveredPr) => number;
  evaluatePolicy: (pr: DiscoveredPr) => PolicyDecision;
  checkpoint: {
    getLastPollTime: (host: string) => string | null;
    setLastPollTime: (host: string) => void;
  };
  config: {
    host: string;
    organizations: string[];
    operatorLogin: string;
    activeRepositoryIds: string[];
    repositories: Array<{ id: string; github: string }>;
    pollIntervalSeconds: number;
  };
}

export interface PollResult {
  skipped: boolean;
  reason?: string;
  discoveredCount: number;
  host: HostHealth | null;
  decisions: Array<{ prId: number; decision: PolicyDecision }>;
}

export class DiscoveryPoller {
  private pollTimer: ReturnType<typeof setInterval> | null = null;

  constructor(private readonly deps: DiscoveryDeps) {}

  async poll(): Promise<PollResult> {
    const health = await this.deps.verifyIdentity();

    if (!health.healthy) {
      return {
        skipped: true,
        reason: `Host unhealthy: ${health.error}`,
        discoveredCount: 0,
        host: health,
        decisions: [],
      };
    }

    const seen = new Map<string, { raw: any; repositoryId: string; explicitRequest: boolean }>();

    const explicitResults = await this.deps.searchReviewRequested(
      this.deps.config.operatorLogin,
      this.deps.config.organizations,
    );

    for (const pr of explicitResults) {
      const key = `${pr.repository.nameWithOwner}#${pr.number}`;
      const repoConfig = this.deps.config.repositories.find(
        r => r.github === pr.repository.nameWithOwner,
      );
      const repoId = repoConfig?.id ?? `github:${this.deps.config.host}/${pr.repository.nameWithOwner}`;
      seen.set(key, { raw: pr, repositoryId: repoId, explicitRequest: true });
    }

    for (const repo of this.deps.config.repositories) {
      if (!this.deps.config.activeRepositoryIds.includes(repo.id)) continue;

      const prs = await this.deps.listRepoPrs(repo.github);
      for (const pr of prs) {
        const key = `${repo.github}#${pr.number}`;
        if (!seen.has(key)) {
          seen.set(key, { raw: pr, repositoryId: repo.id, explicitRequest: false });
        }
      }
    }

    const decisions: Array<{ prId: number; decision: PolicyDecision }> = [];

    for (const [, entry] of seen) {
      const discovered = this.deps.normalizePr(
        entry.raw,
        entry.repositoryId,
        entry.explicitRequest,
      );

      const prId = this.deps.upsertPr(discovered);
      const decision = this.deps.evaluatePolicy(discovered);
      decisions.push({ prId, decision });
    }

    this.deps.checkpoint.setLastPollTime(this.deps.config.host);

    return {
      skipped: false,
      discoveredCount: seen.size,
      host: health,
      decisions,
    };
  }

  async refresh(): Promise<PollResult> {
    return this.poll();
  }

  start(): void {
    if (this.pollTimer) return;
    this.pollTimer = setInterval(
      () => { this.poll().catch(() => {}); },
      this.deps.config.pollIntervalSeconds * 1000,
    );
  }

  stop(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer);
      this.pollTimer = null;
    }
  }
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run tests/discovery/poll.test.ts`
Expected: all 7 tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/poll.ts tests/discovery/poll.test.ts
git commit -m "feat(discovery): add discovery poll loop with identity verification and deduplication"
```

---

### Task 19: GitHub Unavailability and Rate-Limit Recovery

**Files:**
- Create: `src/discovery/poll-resilience.ts`
- Create: `tests/discovery/poll-resilience.test.ts`

> **§12 invariants:** On GitHub unavailability or rate-limit, preserve last-known DB rows, surface freshness, back off with jitter, and never claim complete coverage. On operator identity mismatch, mark the host unhealthy, skip search/list, and do not enqueue new jobs until `gh api user` login exactly matches `profile.githubLogin`.

- [ ] **Step 1: Write failing tests with fake gh**

```typescript
// tests/discovery/poll-resilience.test.ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import {
  ResilientPoller,
  scheduleBackoff,
  type PollResult,
  type ResilientPollDeps,
} from '../../src/discovery/poll-resilience.js';
import { RateLimitTracker } from '../../src/github/rate-limit.js';
import type { HostHealth } from '../../src/github/types.js';

function healthyHost(): HostHealth {
  return {
    host: 'github.com',
    healthy: true,
    authenticatedLogin: 'shubh-array',
    checkedAt: '2026-07-10T12:00:00.000Z',
  };
}

function mismatchHost(): HostHealth {
  return {
    host: 'github.com',
    healthy: false,
    authenticatedLogin: 'wrong-user',
    error: 'Login mismatch: expected shubh-array, got wrong-user',
    checkedAt: '2026-07-10T12:00:00.000Z',
  };
}

function makeDeps(overrides?: Partial<ResilientPollDeps>): ResilientPollDeps {
  const rateLimits = new RateLimitTracker();
  return {
    verifyIdentity: vi.fn().mockResolvedValue(healthyHost()),
    searchReviewRequested: vi.fn().mockResolvedValue([
      {
        number: 101,
        repository: { nameWithOwner: 'Powered-By-Array/pba-webapp' },
      },
    ]),
    listRepoPrs: vi.fn().mockResolvedValue([]),
    upsertPr: vi.fn().mockReturnValue(1),
    evaluateAndEnqueue: vi.fn().mockReturnValue(undefined),
    countKnownPrs: vi.fn().mockReturnValue(3),
    getFreshnessAt: vi.fn().mockReturnValue('2026-07-10T11:55:00.000Z'),
    setFreshnessAt: vi.fn(),
    rateLimits,
    scheduleNextPoll: vi.fn(),
    config: {
      host: 'github.com',
      organizations: ['Powered-By-Array'],
      operatorLogin: 'shubh-array',
      activeRepositoryIds: ['pba-webapp'],
      repositories: [{ id: 'pba-webapp', github: 'Powered-By-Array/pba-webapp' }],
      baseBackoffMs: 5_000,
      maxBackoffMs: 300_000,
    },
    random: () => 0.5,
    ...overrides,
  };
}

describe('scheduleBackoff', () => {
  it('applies exponential backoff with jitter within [0.5, 1.5) of base', () => {
    const delays: number[] = [];
    for (let attempt = 0; attempt < 5; attempt++) {
      delays.push(
        scheduleBackoff({
          attempt,
          baseBackoffMs: 1_000,
          maxBackoffMs: 60_000,
          random: () => 0.0,
        }),
      );
    }
    expect(delays[0]).toBe(500);
    expect(delays[1]).toBe(1_000);
    expect(delays[2]).toBe(2_000);
    expect(delays[3]).toBe(4_000);
    expect(delays[4]).toBe(8_000);
  });

  it('caps at maxBackoffMs including jitter upper bound', () => {
    const delay = scheduleBackoff({
      attempt: 20,
      baseBackoffMs: 5_000,
      maxBackoffMs: 30_000,
      random: () => 0.999,
    });
    expect(delay).toBeLessThanOrEqual(30_000 * 1.5);
    expect(delay).toBeGreaterThanOrEqual(30_000 * 0.5);
  });
});

describe('ResilientPoller — network / gh throw', () => {
  it('preserves last-known DB rows and returns coverageComplete:false on gh throw', async () => {
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockRejectedValue(new Error('ENOTFOUND api.github.com')),
    });
    const poller = new ResilientPoller(deps);

    const result: PollResult = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.hostHealthy).toBe(true);
    expect(result.freshnessAt).toBe('2026-07-10T11:55:00.000Z');
    expect(deps.countKnownPrs).toHaveBeenCalled();
    expect(deps.upsertPr).not.toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.setFreshnessAt).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
    const scheduledMs = (deps.scheduleNextPoll as ReturnType<typeof vi.fn>).mock.calls[0][0];
    expect(scheduledMs).toBeGreaterThanOrEqual(deps.config.baseBackoffMs * 0.5);
    expect(scheduledMs).toBeLessThanOrEqual(deps.config.baseBackoffMs * 1.5);
  });

  it('preserves last-known rows on generic network error from listRepoPrs', async () => {
    const deps = makeDeps({
      searchReviewRequested: vi.fn().mockResolvedValue([]),
      listRepoPrs: vi.fn().mockRejectedValue(new Error('ECONNRESET')),
    });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.freshnessAt).toBe('2026-07-10T11:55:00.000Z');
    expect(result.knownPrCount).toBe(3);
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
  });
});

describe('ResilientPoller — rate limit', () => {
  it('returns coverageComplete:false, preserves rows, and uses RateLimitTracker', async () => {
    const rateLimits = new RateLimitTracker();
    // Force search resource exhausted until far-future reset.
    (rateLimits as unknown as { state: { search: { limit: 30; remaining: 0; reset: 4_000_000_000 } } }).state = {
      core: { limit: 5000, remaining: 5000, reset: 4_000_000_000 },
      search: { limit: 30, remaining: 0, reset: 4_000_000_000 },
      graphql: { limit: 5000, remaining: 5000, reset: 4_000_000_000 },
      lastChecked: '2026-07-10T12:00:00.000Z',
    };

    const deps = makeDeps({ rateLimits });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.hostHealthy).toBe(true);
    expect(result.freshnessAt).toBe('2026-07-10T11:55:00.000Z');
    expect(result.reason).toMatch(/rate.?limit/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
    expect(rateLimits.isAvailable('search')).toBe(false);
    expect(rateLimits.resetTime('search')).toBeInstanceOf(Date);
  });

  it('on HTTP 403 rate-limit throw from gh, refreshes tracker and backs off', async () => {
    const rateLimits = new RateLimitTracker();
    const refresh = vi.spyOn(rateLimits, 'refresh').mockResolvedValue({
      core: { limit: 5000, remaining: 0, reset: 4_000_000_000 },
      search: { limit: 30, remaining: 0, reset: 4_000_000_000 },
      graphql: { limit: 5000, remaining: 5000, reset: 4_000_000_000 },
      lastChecked: '2026-07-10T12:00:00.000Z',
    });
    const deps = makeDeps({
      rateLimits,
      searchReviewRequested: vi.fn().mockRejectedValue(
        Object.assign(new Error('API rate limit exceeded'), { status: 403 }),
      ),
      execGhJson: vi.fn(),
    });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(false);
    expect(result.freshnessAt).toBe('2026-07-10T11:55:00.000Z');
    expect(refresh).toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.scheduleNextPoll).toHaveBeenCalledOnce();
  });
});

describe('ResilientPoller — operator identity mismatch', () => {
  it('sets hostHealthy=false, skips search/list, and does not call enqueue', async () => {
    const deps = makeDeps({
      verifyIdentity: vi.fn().mockResolvedValue(mismatchHost()),
    });
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.hostHealthy).toBe(false);
    expect(result.coverageComplete).toBe(false);
    expect(result.freshnessAt).toBe('2026-07-10T11:55:00.000Z');
    expect(result.reason).toMatch(/mismatch|unhealthy/i);
    expect(deps.searchReviewRequested).not.toHaveBeenCalled();
    expect(deps.listRepoPrs).not.toHaveBeenCalled();
    expect(deps.evaluateAndEnqueue).not.toHaveBeenCalled();
    expect(deps.upsertPr).not.toHaveBeenCalled();
    expect(deps.setFreshnessAt).not.toHaveBeenCalled();
  });
});

describe('ResilientPoller — success path', () => {
  it('marks coverageComplete and updates freshness on successful poll', async () => {
    const deps = makeDeps();
    const poller = new ResilientPoller(deps);

    const result = await poller.poll();

    expect(result.coverageComplete).toBe(true);
    expect(result.hostHealthy).toBe(true);
    expect(result.freshnessAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    expect(deps.searchReviewRequested).toHaveBeenCalledWith(
      'shubh-array',
      ['Powered-By-Array'],
    );
    expect(deps.listRepoPrs).toHaveBeenCalledWith('Powered-By-Array/pba-webapp');
    expect(deps.evaluateAndEnqueue).toHaveBeenCalled();
    expect(deps.setFreshnessAt).toHaveBeenCalledWith('github.com', expect.any(String));
    expect(deps.scheduleNextPoll).not.toHaveBeenCalled();
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

Run: `npx vitest run tests/discovery/poll-resilience.test.ts`
Expected: FAIL — module not found

- [ ] **Step 3: Implement poll resilience**

```typescript
// src/discovery/poll-resilience.ts
import type { HostHealth, GhSearchPrItem, GhPrListItem } from '../github/types.js';
import type { RateLimitTracker } from '../github/rate-limit.js';
import type { GhExecOptions } from '../github/gh-process.js';

type ExecGhJsonFn = <T>(args: string[], options: GhExecOptions) => Promise<T>;

export interface PollResult {
  coverageComplete: boolean;
  freshnessAt: string | null;
  hostHealthy: boolean;
  knownPrCount: number;
  reason?: string;
  discoveredCount: number;
}

export interface ResilientPollConfig {
  host: string;
  organizations: string[];
  operatorLogin: string;
  activeRepositoryIds: string[];
  repositories: Array<{ id: string; github: string }>;
  baseBackoffMs: number;
  maxBackoffMs: number;
}

export interface ResilientPollDeps {
  verifyIdentity: () => Promise<HostHealth>;
  searchReviewRequested: (login: string, orgs: string[]) => Promise<GhSearchPrItem[]>;
  listRepoPrs: (ownerRepo: string) => Promise<GhPrListItem[]>;
  upsertPr: (raw: unknown, repositoryId: string, explicitRequest: boolean) => number;
  /** Plan 03 enqueue boundary — must NOT be called on failure / identity mismatch. */
  evaluateAndEnqueue: (prId: number, raw: unknown, explicitRequest: boolean) => void;
  countKnownPrs: () => number;
  getFreshnessAt: (host: string) => string | null;
  setFreshnessAt: (host: string, at: string) => void;
  rateLimits: RateLimitTracker;
  scheduleNextPoll: (delayMs: number) => void;
  config: ResilientPollConfig;
  random: () => number;
  execGhJson?: ExecGhJsonFn;
}

export interface BackoffInput {
  attempt: number;
  baseBackoffMs: number;
  maxBackoffMs: number;
  random: () => number;
}

/** Exponential backoff with jitter in [0.5, 1.5) × capped base. */
export function scheduleBackoff(input: BackoffInput): number {
  const exp = Math.min(
    input.maxBackoffMs,
    input.baseBackoffMs * 2 ** input.attempt,
  );
  const jitter = 0.5 + input.random(); // [0.5, 1.5)
  return Math.min(input.maxBackoffMs * 1.5, Math.floor(exp * jitter));
}

function isRateLimitError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { status?: number; message?: string };
  if (e.status === 403 || e.status === 429) return true;
  return /rate.?limit/i.test(e.message ?? '');
}

export class ResilientPoller {
  private failureAttempt = 0;

  constructor(private readonly deps: ResilientPollDeps) {}

  async poll(): Promise<PollResult> {
    const knownPrCount = this.deps.countKnownPrs();
    const lastFreshness = this.deps.getFreshnessAt(this.deps.config.host);

    const health = await this.deps.verifyIdentity();
    if (!health.healthy) {
      return {
        coverageComplete: false,
        freshnessAt: lastFreshness,
        hostHealthy: false,
        knownPrCount,
        discoveredCount: 0,
        reason: health.error ?? 'Host unhealthy: operator identity mismatch',
      };
    }

    if (
      !this.deps.rateLimits.isAvailable('search') ||
      !this.deps.rateLimits.isAvailable('core')
    ) {
      this.backoffAndSchedule();
      return {
        coverageComplete: false,
        freshnessAt: lastFreshness,
        hostHealthy: true,
        knownPrCount,
        discoveredCount: 0,
        reason: 'GitHub rate limit exhausted — preserving last-known state',
      };
    }

    try {
      const seen = new Map<
        string,
        { raw: unknown; repositoryId: string; explicitRequest: boolean }
      >();

      const explicit = await this.deps.searchReviewRequested(
        this.deps.config.operatorLogin,
        this.deps.config.organizations,
      );
      for (const pr of explicit) {
        const key = `${pr.repository.nameWithOwner}#${pr.number}`;
        const repo = this.deps.config.repositories.find(
          (r) => r.github === pr.repository.nameWithOwner,
        );
        const repositoryId =
          repo?.id ??
          `github:${this.deps.config.host}/${pr.repository.nameWithOwner}`;
        seen.set(key, { raw: pr, repositoryId, explicitRequest: true });
      }

      for (const repo of this.deps.config.repositories) {
        if (!this.deps.config.activeRepositoryIds.includes(repo.id)) continue;
        const prs = await this.deps.listRepoPrs(repo.github);
        for (const pr of prs) {
          const key = `${repo.github}#${pr.number}`;
          if (!seen.has(key)) {
            seen.set(key, {
              raw: pr,
              repositoryId: repo.id,
              explicitRequest: false,
            });
          }
        }
      }

      for (const [, entry] of seen) {
        const prId = this.deps.upsertPr(
          entry.raw,
          entry.repositoryId,
          entry.explicitRequest,
        );
        this.deps.evaluateAndEnqueue(prId, entry.raw, entry.explicitRequest);
      }

      const now = new Date().toISOString();
      this.deps.setFreshnessAt(this.deps.config.host, now);
      this.failureAttempt = 0;

      return {
        coverageComplete: true,
        freshnessAt: now,
        hostHealthy: true,
        knownPrCount: this.deps.countKnownPrs(),
        discoveredCount: seen.size,
      };
    } catch (err) {
      // Preserve last-known DB rows: no deletes, no freshness bump, no enqueue.
      if (isRateLimitError(err) && this.deps.execGhJson) {
        await this.deps.rateLimits.refresh(
          this.deps.config.host,
          this.deps.execGhJson,
        );
      }
      this.backoffAndSchedule();
      return {
        coverageComplete: false,
        freshnessAt: lastFreshness,
        hostHealthy: true,
        knownPrCount,
        discoveredCount: 0,
        reason:
          err instanceof Error
            ? err.message
            : 'GitHub unavailable — preserving last-known state',
      };
    }
  }

  private backoffAndSchedule(): void {
    const delayMs = scheduleBackoff({
      attempt: this.failureAttempt,
      baseBackoffMs: this.deps.config.baseBackoffMs,
      maxBackoffMs: this.deps.config.maxBackoffMs,
      random: this.deps.random,
    });
    this.failureAttempt += 1;
    this.deps.scheduleNextPoll(delayMs);
  }
}
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npx vitest run tests/discovery/poll-resilience.test.ts`
Expected: all tests PASS

- [ ] **Step 5: Commit**

```bash
git add src/discovery/poll-resilience.ts tests/discovery/poll-resilience.test.ts
git commit -m "feat(discovery): §12 GitHub unavailability, rate-limit, and identity-mismatch recovery"
```

---

### Task 20: Final Integration Verification

**Files:** (none new — run all tests)

- [ ] **Step 1: Run full test suite**

Run: `npx vitest run tests/github/ tests/policy/ tests/discovery/`
Expected: ALL tests PASS

- [ ] **Step 2: Verify TypeScript compilation**

Run: `npx tsc --noEmit`
Expected: no errors

- [ ] **Step 3: Commit**

```bash
git add -A
git commit -m "chore(discovery): verify full test suite and compilation"
```

---

## Self-Review Checklist

- [x] **§10.1 GitHub adapter:** Tasks 2–5 — sanitized `GH_HOST` child env, exact `--review-requested=<login>`, never `@me`, per-poll identity recheck, rate-limit handling.
- [x] **§10.1 Streaming diff filter:** Tasks 6–7 — protected bytes discarded before any sink; rename/copy omission; `diff_filter_failed` fail-closed.
- [x] **§10.2 Normalizer:** Tasks 8–9 — canonical paths only; `unsafe_path` diagnostics; normalizer upsert against Plan 01 schema (`repositories`, `prs`, child tables); callers run Plan 01 `runMigrations` first (no `migrateDiscoverySchema`).
- [x] **§10.3 Eligibility:** Task 10 — truth-table for `explicit || (active && (path || author))` with all reason records and exclusion codes.
- [x] **§10.3 Priority / unranked:** Task 11 — `p0>p1>p2>p3>unranked`, default eligible `p3`, unranked never auto-analyzes.
- [x] **§10.3 Domains:** Task 12 — max 3, highest numeric priority then earliest declarationIndex, stable cross-domain order.
- [x] **§10.3 Auto-analysis:** Task 13 — explicit request and priority tiers only; author-only requires independent priorityRules match.
- [x] **§10.3 Queue tuple:** Task 15 — `(prioritySortOrdinal, explicitRequestSort, queueTimestampSort, normalizedRepositoryIdentity, prNumber)`.
- [x] **§11.1 Discover flow:** Tasks 17–18 — poll loop, Plan 01 `discovery_checkpoints` upsert/read (no CREATE TABLE), identity gate before enqueue.
- [x] **§12 GitHub down / identity mismatch:** Task 19 — on `gh` throw / network error / rate-limit: preserve last-known DB rows, `coverageComplete: false`, freshness retained, backoff with jitter via `RateLimitTracker`; on operator identity mismatch: `hostHealthy: false`, skip search/list, never call enqueue.
- [x] **Ticket extractors:** Task 16 — opaque metadata only, no Linear contact.
- [x] **Type consistency:** Flat `PolicyDecision` in `src/policy/evaluate.ts` is the contract consumed by plan 03 (no nested eligibility/priority object).
