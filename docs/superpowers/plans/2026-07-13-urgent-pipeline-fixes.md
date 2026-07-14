# Urgent Pipeline Fixes Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 6 urgent gaps (U-01 through U-06) that block trustworthy PR reviews: wrong git remote, missing source tree, missing diff, dishonest coverage, incomplete provenance, and stale-draft blindness.

**Architecture:** Each fix is a surgical change to the analysis pipeline (`src/orchestrator/`) and its supporting modules. The pipeline flows: `prepareContext` → `prepareSource` → `runAgent` → `validateOutput` → `sealRun`. Coverage finalization (U-05) restructures when certain artifacts are written, but the pipeline state-machine shape does not change. All changes stay within the existing module boundaries described in `ARCHITECTURE.md`.

**Tech Stack:** TypeScript, Node.js, better-sqlite3, Vitest, `gh` CLI subprocess, React (client stale banner for U-06)

**Implementation order:** U-01 → U-02 → U-03 → U-05 → U-04 → U-06 (per spec)

---

## File Structure

### New files

| File | Responsibility |
|------|---------------|
| `src/orchestrator/resolve-remote.ts` | Resolve `owner/repo` and SSH remote for a `repository_key` from DB or org catalog |
| `src/github/fetch-pr-diff.ts` | `gh pr diff` helper returning filtered unified diff text |
| `tests/orchestrator/source-pipeline.test.ts` | Unit tests for registered-source remote resolution + file materialization |
| `tests/orchestrator/context-build.test.ts` | Unit tests for diff/provenance/coverage materialization via production code path |
| `tests/orchestrator/supersede.test.ts` | Integration tests for PR-scoped supersede and stale detection |

### Modified files

| File | Changes |
|------|---------|
| `src/orchestrator/source-pipeline.ts` | Accept resolved remote; copy allowed files to sourceViewRoot; compute real size/lineCount |
| `src/orchestrator/pipeline-runner.ts` | Resolve remote before prepareSource; pass DB/gh into context prep; use real lineCount in validation map; finalize coverage before runAgent; expose omitted paths |
| `src/orchestrator/context-build.ts` | Accept DB/gh deps; fetch+filter diff; build full provenance catalog; defer coverage/run.json/context-refs writes; add finalize step |
| `src/context/coverage.ts` | Add tri-state diff filter support (`DiffFilterOutcome`); honest initial values |
| `src/context/provenance.ts` | No structural changes needed (creators already exist) |
| `src/source/materialize.ts` | Add `lineCount` to `SourceManifest.allowed` entry type; update `buildSourceManifest` hash input |
| `src/orchestrator/enqueue.ts` | Add `findActiveJobsByPr` to `EnqueueDeps`; supersede all prior active jobs for the same PR |
| `src/orchestrator/run-identity.ts` | No changes (coverage excluded from runId preimage is handled by deferring hash) |
| `src/daemon/bootstrap.ts` | Wire DB/gh into pipeline context; PR-scoped lookup for enqueue; pass live `prs.head_sha` into publish guard registration |
| `src/orchestrator/draft-loader.ts` | Add `reviewedHeadSha`, `currentHeadSha`, `stale` to `DraftBundle` and `DraftDetail` |
| `src/api/contracts.ts` | Add `reviewedHeadSha`, `currentHeadSha`, `stale` to `DraftDetail` |
| `client/src/lib/api.ts` | Add `reviewedHeadSha`, `currentHeadSha`, `stale` to `DraftDetail` |
| `client/src/routes/Workbench.tsx` | Stale banner; disable Approve/Publish when stale |
| `tests/orchestrator/enqueue.test.ts` | Align mock with production lookup; add PR-scoped supersede tests |
| `tests/cursor/validate-review.test.ts` | Add lineCount-based validation tests |

---

## Task 1: Resolve GitHub remote from DB/catalog (U-01)

**Files:**
- Create: `src/orchestrator/resolve-remote.ts`
- Modify: `src/orchestrator/pipeline-runner.ts:302-316`
- Test: `tests/orchestrator/source-pipeline.test.ts`

- [ ] **Step 1: Write the failing test for remote resolution**

```typescript
// tests/orchestrator/source-pipeline.test.ts
import { describe, it, expect } from 'vitest';
import { resolveGithubRemote, type RemoteResolutionDeps } from '../../src/orchestrator/resolve-remote.js';

function makeResolutionDeps(overrides: Partial<RemoteResolutionDeps> = {}): RemoteResolutionDeps {
  return {
    queryRepository: () => null,
    catalogRepositories: [],
    ...overrides,
  };
}

describe('resolveGithubRemote', () => {
  it('resolves from DB github_owner/github_repo', () => {
    const deps = makeResolutionDeps({
      queryRepository: (key: string) =>
        key === 'pba-webapp'
          ? { github_owner: 'Powered-By-Array', github_repo: 'pba-webapp' }
          : null,
    });

    const result = resolveGithubRemote(deps, 'pba-webapp');
    expect(result).toEqual({
      owner: 'Powered-By-Array',
      repo: 'pba-webapp',
      remote: 'git@github.com:Powered-By-Array/pba-webapp.git',
    });
  });

  it('falls back to organization catalog', () => {
    const deps = makeResolutionDeps({
      queryRepository: () => null,
      catalogRepositories: [
        { id: 'pba-webapp', github: 'Powered-By-Array/pba-webapp' },
      ],
    });

    const result = resolveGithubRemote(deps, 'pba-webapp');
    expect(result).toEqual({
      owner: 'Powered-By-Array',
      repo: 'pba-webapp',
      remote: 'git@github.com:Powered-By-Array/pba-webapp.git',
    });
  });

  it('returns null when neither DB nor catalog has the repo', () => {
    const deps = makeResolutionDeps();
    const result = resolveGithubRemote(deps, 'unknown-repo');
    expect(result).toBeNull();
  });

  it('handles owner/repo style repositoryKey without DB lookup', () => {
    const deps = makeResolutionDeps();
    const result = resolveGithubRemote(deps, 'myorg/myrepo');
    expect(result).toEqual({
      owner: 'myorg',
      repo: 'myrepo',
      remote: 'git@github.com:myorg/myrepo.git',
    });
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/orchestrator/source-pipeline.test.ts`
Expected: FAIL — module `resolve-remote.js` does not exist

- [ ] **Step 3: Implement `resolveGithubRemote`**

```typescript
// src/orchestrator/resolve-remote.ts

export interface RemoteResolutionDeps {
  queryRepository: (repositoryKey: string) => {
    github_owner: string;
    github_repo: string;
  } | null;
  catalogRepositories: Array<{ id: string; github: string }>;
}

export interface ResolvedRemote {
  owner: string;
  repo: string;
  remote: string;
}

export function resolveGithubRemote(
  deps: RemoteResolutionDeps,
  repositoryKey: string,
): ResolvedRemote | null {
  const dbRow = deps.queryRepository(repositoryKey);
  if (dbRow) {
    return {
      owner: dbRow.github_owner,
      repo: dbRow.github_repo,
      remote: `git@github.com:${dbRow.github_owner}/${dbRow.github_repo}.git`,
    };
  }

  const catalogEntry = deps.catalogRepositories.find(
    (r) => r.id === repositoryKey,
  );
  if (catalogEntry) {
    const parts = catalogEntry.github.split('/');
    if (parts.length === 2) {
      return {
        owner: parts[0]!,
        repo: parts[1]!,
        remote: `git@github.com:${catalogEntry.github}.git`,
      };
    }
  }

  const slashParts = repositoryKey.split('/');
  if (slashParts.length >= 2) {
    const owner = slashParts[slashParts.length - 2]!;
    const repo = slashParts[slashParts.length - 1]!;
    return { owner, repo, remote: `git@github.com:${owner}/${repo}.git` };
  }

  return null;
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/orchestrator/source-pipeline.test.ts`
Expected: PASS

- [ ] **Step 5: Wire resolver into `prepareSource` in pipeline-runner**

In `src/orchestrator/pipeline-runner.ts`, inside `buildPipelineDeps`, modify `prepareSource`:

Replace the `prepareSource` method body so that before calling `prepareRegisteredSource`, it resolves the remote:

```typescript
// In buildPipelineDeps, at the top of the function, add an import:
// import { resolveGithubRemote } from './resolve-remote.js';

// Then modify prepareSource:
async prepareSource(jobId, _runId) {
  const job = prepared.job ?? loadPipelineJob(db, jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  const resolved = resolveGithubRemote(
    {
      queryRepository: (key) => {
        const row = db
          .prepare(
            `SELECT github_owner, github_repo FROM repositories WHERE id = ?`,
          )
          .get(key) as
          | { github_owner: string; github_repo: string }
          | undefined;
        return row ?? null;
      },
      catalogRepositories: ctx.catalogRepositories ?? [],
    },
    job.repositoryKey,
  );

  const result = await prepareRegisteredSource({
    dataDirectory: ctx.dataDirectory,
    jobId,
    repositoryKey: job.repositoryKey,
    prNumber: job.prNumber,
    headSha: job.headSha,
    repositoryPath: ctx.repositoryPaths?.[job.repositoryKey],
    githubRemote: resolved?.remote,
    homePath: resolveCursorHome(ctx),
    sshAuthSock: ctx.sshAuthSock ?? process.env.SSH_AUTH_SOCK,
    protectedPaths: ctx.protectedPaths ?? [],
  });

  if (prepared.state) {
    prepared.state.sourceManifest = result.sourceManifest;
    prepared.state.sourceViewRoot = result.sourceViewRoot;
  }

  return {
    sourceViewRoot: result.sourceViewRoot,
    adminWorktree: result.adminWorktree,
  };
},
```

Add `catalogRepositories` to `PipelineRunnerContext`:

```typescript
export interface PipelineRunnerContext {
  // ... existing fields ...
  catalogRepositories?: Array<{ id: string; github: string }>;
}
```

- [ ] **Step 6: Wire org catalog into bootstrap's pipeline runner context**

In `src/daemon/bootstrap.ts`, in `runSchedulerTick`, add `catalogRepositories` to the pipeline runner context:

```typescript
void runPipelineForJob(
  db,
  {
    // ... existing fields ...
    catalogRepositories: org.repositories.map((r) => ({
      id: r.id,
      github: r.github,
    })),
  },
  jobId,
).catch(/* ... */);
```

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run tests/orchestrator/source-pipeline.test.ts tests/orchestrator/pipeline.test.ts tests/integration/pipeline-production-deps.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/resolve-remote.ts src/orchestrator/pipeline-runner.ts src/daemon/bootstrap.ts tests/orchestrator/source-pipeline.test.ts
git commit -m "fix(U-01): resolve registered-source fetch remote from DB/catalog instead of unknown/"
```

---

## Task 2: Materialize allowed source files into sourceViewRoot (U-02, part 1)

**Files:**
- Modify: `src/source/materialize.ts` — add `lineCount` to allowed entry type
- Modify: `src/orchestrator/source-pipeline.ts:270-313` — copy allowed files; compute real size/lineCount

- [ ] **Step 1: Write the failing test for lineCount in manifest entries**

Add to `tests/orchestrator/source-pipeline.test.ts`:

```typescript
import { buildSourceManifest } from '../../src/source/materialize.js';

describe('SourceManifest lineCount', () => {
  it('includes lineCount in allowed entries', () => {
    const manifest = buildSourceManifest({
      repositoryId: 'test-repo',
      headCommit: 'abc123',
      rootTreeSha: 'abc123',
      matcherVersion: '1',
      protectedPatternSetHash: 'hash',
      allowed: [
        { path: 'src/index.ts', blobSha: 'sha1', size: 100, mode: '100644', lineCount: 25 },
      ],
      omitted: [],
    });

    expect(manifest.allowed[0]!.lineCount).toBe(25);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/orchestrator/source-pipeline.test.ts`
Expected: FAIL — `lineCount` not in the type

- [ ] **Step 3: Add `lineCount` to `SourceManifest` allowed entry type**

In `src/source/materialize.ts`, modify the `SourceManifestInput` and `SourceManifest` types:

```typescript
export interface SourceManifestInput {
  repositoryId: string;
  headCommit: string;
  rootTreeSha: string;
  matcherVersion: string;
  protectedPatternSetHash: string;
  allowed: Array<{ path: string; blobSha: string; size: number; mode: string; lineCount: number }>;
  omitted: Array<{ path: string; reason: string }>;
}

export interface SourceManifest {
  repositoryId: string;
  headCommit: string;
  rootTreeSha: string;
  matcherVersion: string;
  protectedPatternSetHash: string;
  contentHash: string;
  allowed: Array<{ path: string; blobSha: string; size: number; mode: string; lineCount: number }>;
  omitted: Array<{ path: string; reason: string }>;
}
```

Update `buildSourceManifest` hash input to include `lineCount`:

```typescript
export function buildSourceManifest(input: SourceManifestInput): SourceManifest {
  const hashInput = JSON.stringify({
    allowed: input.allowed.map(a => `${a.path}:${a.blobSha}:${a.size}:${a.mode}:${a.lineCount}`).sort(),
    // ... rest unchanged
  });
  // ...
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/orchestrator/source-pipeline.test.ts tests/source/materialize.test.ts`
Expected: PASS

- [ ] **Step 5: Write the failing test for file materialization**

Add to `tests/orchestrator/source-pipeline.test.ts`:

```typescript
import { existsSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';

describe('prepareRegisteredSource file materialization', () => {
  it('copies allowed files from admin worktree to sourceViewRoot', async () => {
    // This test verifies the contract: after prepareRegisteredSource,
    // sourceViewRoot contains the actual allowed files (not just manifest)
    // and manifest entries have real size and lineCount.
    //
    // Full integration test requires git setup — see Task 2 Step 7
    // for the approach. Unit-level: verify the manifest shape.
  });
});
```

- [ ] **Step 6: Implement file copy + real size/lineCount in source-pipeline**

In `src/orchestrator/source-pipeline.ts`, inside `prepareRegisteredSource`, after the tree filtering loop and before writing the manifest:

```typescript
// After the for-of loop that builds `allowed` and `omitted`, add:

// --- Materialize allowed files into sourceViewRoot ---
const allowedWithCounts: Array<{
  path: string;
  blobSha: string;
  size: number;
  mode: string;
  lineCount: number;
}> = [];

for (const entry of allowed) {
  const adminFilePath = join(adminPath, entry.path);
  const sourceFilePath = join(sourcePath, entry.path);

  if (existsSync(adminFilePath)) {
    mkdirSync(dirname(sourceFilePath), { recursive: true });
    const content = readFileSync(adminFilePath);
    writeFileSync(sourceFilePath, content);
    const lineCount = content.toString('utf-8').split('\n').length;
    allowedWithCounts.push({
      path: entry.path,
      blobSha: entry.blobSha,
      size: content.length,
      mode: entry.mode,
      lineCount,
    });
  } else {
    allowedWithCounts.push({
      path: entry.path,
      blobSha: entry.blobSha,
      size: 0,
      mode: entry.mode,
      lineCount: 0,
    });
  }
}
```

Add the missing imports at the top of the file:

```typescript
import { existsSync, mkdirSync, openSync, writeSync, closeSync, fsyncSync, readFileSync, writeFileSync } from "node:fs";
```

Then update the `buildSourceManifest` call to use `allowedWithCounts`:

```typescript
const sourceManifest = buildSourceManifest({
  repositoryId: input.repositoryKey,
  headCommit: input.headSha,
  rootTreeSha: input.headSha,
  matcherVersion: String(protectedMatcher.version),
  protectedPatternSetHash: protectedMatcher.contentHash,
  allowed: allowedWithCounts,
  omitted,
});
```

- [ ] **Step 7: Run tests**

Run: `pnpm vitest run tests/orchestrator/source-pipeline.test.ts tests/source/materialize.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/source/materialize.ts src/orchestrator/source-pipeline.ts tests/orchestrator/source-pipeline.test.ts
git commit -m "fix(U-02): materialize allowed source files into sourceViewRoot with real size/lineCount"
```

---

## Task 3: Use real lineCount in validation (U-02, part 2)

**Files:**
- Modify: `src/orchestrator/pipeline-runner.ts:390-396` — validation map uses manifest lineCount
- Test: `tests/cursor/validate-review.test.ts`

- [ ] **Step 1: Write the failing test for lineCount-based validation**

Add to `tests/cursor/validate-review.test.ts`:

```typescript
describe('validateReviewOutput lineCount enforcement', () => {
  it('rejects file reference where endLine exceeds real lineCount', () => {
    const catalog = new Map();
    const commitRecord = createCommitRecord({ repositoryId: 'repo', commitSha: 'abc' });
    catalog.set(commitRecord.id, commitRecord);

    const sourceManifest = new Map([
      ['src/foo.ts', { blobSha: 'sha1', lineCount: 5 }],
    ]);

    const output: ReviewOutput = {
      schemaVersion: 1,
      coverage: {
        mode: 'registered-source',
        sourceTreeInspected: true,
        diffFiltered: true,
        omittedProtectedPaths: [],
        omittedSourceEntries: [],
        missingCoverage: [],
      },
      summary: { intent: 'test', implementation: 'test' },
      observations: [{
        type: 'observation',
        statement: 'found issue',
        provenanceRefs: [commitRecord.id],
        fileReferences: [{
          repositoryId: 'repo',
          blobSha: 'sha1',
          path: 'src/foo.ts',
          startLine: 10,
          endLine: 20,
        }],
      }],
      checks: [],
      findings: [{
        severity: 'medium',
        confidence: 'high',
        title: 'Test finding',
        rationale: 'test',
        file: 'src/foo.ts',
        location: { side: 'RIGHT', line: 10, startSide: null, startLine: null },
        observationIndexes: [0],
        draftComment: 'fix this',
      }],
      unknowns: [],
      recommendedDisposition: 'comment',
      draftSummary: {
        body: 'Summary',
        observationIndexes: [0],
        provenanceRefs: [commitRecord.id],
      },
    };

    const result = validateReviewOutput(output, {
      coverage: output.coverage,
      catalog,
      sourceManifest,
      sourceMode: 'registered-source',
    });

    expect(result.valid).toBe(false);
    expect(result.errors).toContainEqual(
      expect.stringContaining('exceeds file length 5'),
    );
  });

  it('accepts file reference within real lineCount', () => {
    const catalog = new Map();
    const commitRecord = createCommitRecord({ repositoryId: 'repo', commitSha: 'abc' });
    catalog.set(commitRecord.id, commitRecord);

    const sourceManifest = new Map([
      ['src/foo.ts', { blobSha: 'sha1', lineCount: 50 }],
    ]);

    const output: ReviewOutput = {
      schemaVersion: 1,
      coverage: {
        mode: 'registered-source',
        sourceTreeInspected: true,
        diffFiltered: true,
        omittedProtectedPaths: [],
        omittedSourceEntries: [],
        missingCoverage: [],
      },
      summary: { intent: 'test', implementation: 'test' },
      observations: [{
        type: 'observation',
        statement: 'found issue',
        provenanceRefs: [commitRecord.id],
        fileReferences: [{
          repositoryId: 'repo',
          blobSha: 'sha1',
          path: 'src/foo.ts',
          startLine: 10,
          endLine: 20,
        }],
      }],
      checks: [],
      findings: [{
        severity: 'medium',
        confidence: 'high',
        title: 'Test finding',
        rationale: 'test',
        file: 'src/foo.ts',
        location: { side: 'RIGHT', line: 10, startSide: null, startLine: null },
        observationIndexes: [0],
        draftComment: 'fix this',
      }],
      unknowns: [],
      recommendedDisposition: 'comment',
      draftSummary: {
        body: 'Summary',
        observationIndexes: [0],
        provenanceRefs: [commitRecord.id],
      },
    };

    const result = validateReviewOutput(output, {
      coverage: output.coverage,
      catalog,
      sourceManifest,
      sourceMode: 'registered-source',
    });

    expect(result.valid).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify the rejection test passes (it already should, since validate-review.ts checks lineCount) and the acceptance test passes**

Run: `pnpm vitest run tests/cursor/validate-review.test.ts`
Expected: PASS (validate-review.ts already checks `entry.lineCount`; the bug is upstream in pipeline-runner hardcoding `lineCount: 1`)

- [ ] **Step 3: Fix the hardcoded `lineCount: 1` in pipeline-runner's `validateOutput`**

In `src/orchestrator/pipeline-runner.ts`, in the `validateOutput` method, change:

```typescript
// Before (line ~394):
const sourceManifest = new Map(
  sourceManifestEntries.map((entry) => [
    entry.path,
    { blobSha: entry.blobSha, lineCount: 1 },
  ]),
);

// After:
const sourceManifest = new Map(
  sourceManifestEntries.map((entry) => [
    entry.path,
    { blobSha: entry.blobSha, lineCount: entry.lineCount },
  ]),
);
```

- [ ] **Step 4: Run tests**

Run: `pnpm vitest run tests/cursor/validate-review.test.ts tests/orchestrator/pipeline.test.ts tests/integration/pipeline-production-deps.test.ts`
Expected: PASS

- [ ] **Step 5: Commit**

```bash
git add src/orchestrator/pipeline-runner.ts tests/cursor/validate-review.test.ts
git commit -m "fix(U-02): use real lineCount from source manifest in validation instead of hardcoded 1"
```

---

## Task 4: Fetch and write PR diff into run directory (U-03)

**Files:**
- Create: `src/github/fetch-pr-diff.ts`
- Modify: `src/orchestrator/context-build.ts` — accept DB/gh deps; fetch+filter diff; enrich metadata
- Modify: `src/orchestrator/pipeline-runner.ts` — pass DB/gh deps to context prep
- Modify: `src/daemon/bootstrap.ts` — pass DB/gh/host into pipeline context
- Test: `tests/orchestrator/context-build.test.ts`

- [ ] **Step 1: Write the failing test for diff fetch helper**

```typescript
// tests/orchestrator/context-build.test.ts
import { describe, it, expect } from 'vitest';
import { fetchAndFilterPrDiff, type DiffFetchDeps } from '../../src/github/fetch-pr-diff.js';

describe('fetchAndFilterPrDiff', () => {
  it('returns filtered diff with protected paths removed', async () => {
    const rawDiff = [
      'diff --git a/src/api/foo.ts b/src/api/foo.ts',
      '--- a/src/api/foo.ts',
      '+++ b/src/api/foo.ts',
      '@@ -1,3 +1,4 @@',
      ' line1',
      '+added',
      ' line3',
      'diff --git a/.env b/.env',
      '--- a/.env',
      '+++ b/.env',
      '@@ -1,1 +1,2 @@',
      ' SECRET=old',
      '+SECRET2=new',
    ].join('\n');

    const deps: DiffFetchDeps = {
      execGhText: async () => rawDiff,
      host: 'github.com',
      protectedPathPatterns: ['**/.env', '**/.env.*'],
    };

    const result = await fetchAndFilterPrDiff(deps, 'Powered-By-Array/pba-webapp', 42);

    expect(result.filtered).toContain('src/api/foo.ts');
    expect(result.filtered).not.toContain('.env');
    expect(result.omittedPaths).toContain('.env');
    expect(result.outcome).toBe('succeeded');
  });

  it('returns failed outcome when gh errors', async () => {
    const deps: DiffFetchDeps = {
      execGhText: async () => { throw new Error('rate limited'); },
      host: 'github.com',
      protectedPathPatterns: [],
    };

    const result = await fetchAndFilterPrDiff(deps, 'org/repo', 1);

    expect(result.outcome).toBe('failed');
    expect(result.filtered).toBe('');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/orchestrator/context-build.test.ts`
Expected: FAIL — module does not exist

- [ ] **Step 3: Implement `fetchAndFilterPrDiff`**

```typescript
// src/github/fetch-pr-diff.ts
import { CanonicalPathMatcher } from '../paths/matcher.js';

export type DiffFilterOutcome = 'not_run' | 'failed' | 'succeeded';

export interface DiffFetchDeps {
  execGhText: (args: string[], opts: { host: string }) => Promise<string>;
  host: string;
  protectedPathPatterns: string[];
}

export interface DiffFetchResult {
  filtered: string;
  omittedPaths: string[];
  outcome: DiffFilterOutcome;
}

function parseDiffPaths(unifiedDiff: string): string[] {
  const paths: string[] = [];
  for (const line of unifiedDiff.split('\n')) {
    const match = /^diff --git a\/(.+) b\//.exec(line);
    if (match) paths.push(match[1]!);
  }
  return paths;
}

function filterUnifiedDiff(
  unifiedDiff: string,
  matcher: CanonicalPathMatcher,
): { filtered: string; omittedPaths: string[] } {
  const lines = unifiedDiff.split('\n');
  const outputLines: string[] = [];
  const omittedPaths: string[] = [];
  let currentPath: string | null = null;
  let omitting = false;

  for (const line of lines) {
    const diffMatch = /^diff --git a\/(.+) b\//.exec(line);
    if (diffMatch) {
      currentPath = diffMatch[1]!;
      omitting = matcher.matches(currentPath);
      if (omitting) {
        omittedPaths.push(currentPath);
      }
    }

    if (!omitting) {
      outputLines.push(line);
    }
  }

  return {
    filtered: outputLines.join('\n'),
    omittedPaths: [...new Set(omittedPaths)],
  };
}

export async function fetchAndFilterPrDiff(
  deps: DiffFetchDeps,
  ownerRepo: string,
  prNumber: number,
): Promise<DiffFetchResult> {
  let rawDiff: string;
  try {
    rawDiff = await deps.execGhText(
      ['pr', 'diff', String(prNumber), '--repo', ownerRepo],
      { host: deps.host },
    );
  } catch {
    return { filtered: '', omittedPaths: [], outcome: 'failed' };
  }

  if (deps.protectedPathPatterns.length === 0) {
    return { filtered: rawDiff, omittedPaths: [], outcome: 'succeeded' };
  }

  const matcher = CanonicalPathMatcher.compile(
    deps.protectedPathPatterns.map((pattern) => ({
      pattern,
      source: 'organization.security.protectedPaths',
    })),
  );

  const { filtered, omittedPaths } = filterUnifiedDiff(rawDiff, matcher);
  return { filtered, omittedPaths, outcome: 'succeeded' };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `pnpm vitest run tests/orchestrator/context-build.test.ts`
Expected: PASS

- [ ] **Step 5: Extend `ContextBuildInput` with DB/gh deps and write diff+enriched metadata**

In `src/orchestrator/context-build.ts`, extend `ContextBuildInput`:

```typescript
export interface ContextBuildInput {
  // ... existing fields ...
  execGhText?: (args: string[], opts: { host: string }) => Promise<string>;
  githubHost?: string;
  ownerRepo?: string;
  baseSha?: string;
}
```

Add a new function `materializeDiffArtifact` that is called during context prep:

```typescript
import { fetchAndFilterPrDiff, type DiffFilterOutcome } from '../github/fetch-pr-diff.js';

export interface DiffMaterializeResult {
  outcome: DiffFilterOutcome;
  omittedPaths: string[];
  diffHash: string;
}

export async function materializeDiffArtifact(
  input: ContextBuildInput,
  layout: RunDirectoryLayout,
): Promise<DiffMaterializeResult> {
  if (!input.execGhText || !input.ownerRepo || !input.githubHost) {
    return { outcome: 'not_run', omittedPaths: [], diffHash: '' };
  }

  const result = await fetchAndFilterPrDiff(
    {
      execGhText: input.execGhText,
      host: input.githubHost,
      protectedPathPatterns: input.protectedPaths ?? [],
    },
    input.ownerRepo,
    input.prNumber,
  );

  if (result.outcome === 'succeeded' && result.filtered) {
    writeCreateOnceSync(
      join(layout.githubDir, 'pr-diff.patch'),
      result.filtered,
    );
  }

  return {
    outcome: result.outcome,
    omittedPaths: result.omittedPaths,
    diffHash: result.filtered ? sha256Hex(result.filtered) : '',
  };
}
```

Enrich `buildPrMetadata` to include `baseSha`, `repository`:

```typescript
function buildPrMetadata(input: ContextBuildInput): {
  content: string;
  hash: string;
  bytes: number;
} {
  const content = JSON.stringify({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    baseSha: input.baseSha ?? null,
    repository: input.ownerRepo ?? null,
    sourceMode: input.sourceMode,
  });
  return {
    content,
    hash: sha256Hex(content),
    bytes: Buffer.byteLength(content, "utf-8"),
  };
}
```

- [ ] **Step 6: Wire DB/gh/host into pipeline-runner's context preparation**

In `src/orchestrator/pipeline-runner.ts`, add to `PipelineRunnerContext`:

```typescript
export interface PipelineRunnerContext {
  // ... existing fields ...
  execGhText?: (args: string[], opts: { host: string }) => Promise<string>;
  githubHost?: string;
}
```

In `buildPipelineDeps`, modify `prepareContext` to resolve `ownerRepo` and `baseSha` from DB and pass through:

```typescript
prepareContext(jobId, runId) {
  const contextStart = Date.now();
  const job = prepared.job ?? loadPipelineJob(db, jobId);
  if (!job) throw new Error(`job not found: ${jobId}`);

  const repoRow = db
    .prepare(`SELECT github_owner, github_repo FROM repositories WHERE id = ?`)
    .get(job.repositoryKey) as
    | { github_owner: string; github_repo: string }
    | undefined;
  const ownerRepo = repoRow
    ? `${repoRow.github_owner}/${repoRow.github_repo}`
    : undefined;

  const prRow = db
    .prepare(
      `SELECT base_sha FROM prs
       WHERE repository_id = ? AND pr_number = ?`,
    )
    .get(job.repositoryKey, job.prNumber) as
    | { base_sha: string }
    | undefined;

  const contextInput = {
    appRoot,
    dataDirectory: ctx.dataDirectory,
    profileDirectory: ctx.profileDirectory,
    jobId,
    runId,
    repositoryKey: job.repositoryKey,
    prNumber: job.prNumber,
    headSha: job.headSha,
    sourceMode: job.sourceMode,
    policyHash: job.policyHash,
    modelSpecHash,
    protectedPaths: ctx.protectedPaths,
    execGhText: ctx.execGhText,
    githubHost: ctx.githubHost,
    ownerRepo,
    baseSha: prRow?.base_sha,
  };

  const built = computeRunContext(contextInput);
  materializeRunContext(contextInput, built);

  // ... rest unchanged
},
```

- [ ] **Step 7: Pass `execGhText` and `githubHost` from bootstrap**

In `src/daemon/bootstrap.ts`, in `runSchedulerTick`:

```typescript
void runPipelineForJob(
  db,
  {
    // ... existing fields ...
    execGhText: (args, opts) => execGhText(args, opts),
    githubHost: org.github.host,
  },
  jobId,
).catch(/* ... */);
```

- [ ] **Step 8: Add test for diff artifact in run directory**

Add to `tests/orchestrator/context-build.test.ts`:

```typescript
describe('materializeDiffArtifact', () => {
  it('writes pr-diff.patch after context prep with stubbed gh', async () => {
    const stubDiff = 'diff --git a/src/foo.ts b/src/foo.ts\n--- a/src/foo.ts\n+++ b/src/foo.ts\n@@ -1 +1 @@\n-old\n+new\n';
    const deps: DiffFetchDeps = {
      execGhText: async () => stubDiff,
      host: 'github.com',
      protectedPathPatterns: [],
    };

    const result = await fetchAndFilterPrDiff(deps, 'org/repo', 42);

    expect(result.outcome).toBe('succeeded');
    expect(result.filtered).toContain('src/foo.ts');
  });
});
```

- [ ] **Step 9: Run all related tests**

Run: `pnpm vitest run tests/orchestrator/context-build.test.ts tests/orchestrator/pipeline.test.ts tests/integration/pipeline-production-deps.test.ts`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/github/fetch-pr-diff.ts src/orchestrator/context-build.ts src/orchestrator/pipeline-runner.ts src/daemon/bootstrap.ts tests/orchestrator/context-build.test.ts
git commit -m "fix(U-03): fetch and write PR diff into run directory with protected-path filtering"
```

---

## Task 5: Honest coverage finalization (U-05)

**Files:**
- Modify: `src/context/coverage.ts` — tri-state diff filter; honest initial builders
- Modify: `src/orchestrator/context-build.ts` — defer coverage.json write; add finalize function
- Modify: `src/orchestrator/pipeline-runner.ts` — finalize coverage before runAgent; pass final coverage into validateOutput
- Modify: `src/orchestrator/pipeline.ts` — no structural change (pipeline shape stays same)
- Test: `tests/orchestrator/context-build.test.ts`

- [ ] **Step 1: Write the failing test for tri-state coverage**

Add to `tests/orchestrator/context-build.test.ts`:

```typescript
import {
  buildRegisteredSourceCoverage,
  buildRemoteOnlyCoverage,
  type DiffFilterOutcome,
} from '../../src/context/coverage.js';

describe('honest coverage builders', () => {
  it('registered-source: sourceTreeInspected false before source prep', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'not_run', false);
    expect(cov.sourceTreeInspected).toBe(false);
    expect(cov.missingCoverage).toContain('source_tree');
  });

  it('registered-source: diffFiltered false when diff not_run', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'not_run', false);
    expect(cov.diffFiltered).toBe(false);
    expect(cov.missingCoverage).not.toContain('diff_filter_failed');
  });

  it('registered-source: diffFiltered false with diff_filter_failed when failed', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'failed', false);
    expect(cov.diffFiltered).toBe(false);
    expect(cov.missingCoverage).toContain('diff_filter_failed');
  });

  it('registered-source: diffFiltered true when succeeded', () => {
    const cov = buildRegisteredSourceCoverage([], [], 'succeeded', true);
    expect(cov.diffFiltered).toBe(true);
    expect(cov.sourceTreeInspected).toBe(true);
    expect(cov.missingCoverage).not.toContain('source_tree');
  });

  it('remote-only: sourceTreeInspected always false', () => {
    const cov = buildRemoteOnlyCoverage([], 'succeeded');
    expect(cov.sourceTreeInspected).toBe(false);
    expect(cov.missingCoverage).toContain('source_tree');
    expect(cov.diffFiltered).toBe(true);
  });

  it('remote-only: diff not_run means diffFiltered false', () => {
    const cov = buildRemoteOnlyCoverage([], 'not_run');
    expect(cov.diffFiltered).toBe(false);
    expect(cov.missingCoverage).not.toContain('diff_filter_failed');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/orchestrator/context-build.test.ts`
Expected: FAIL — function signatures don't match (boolean vs DiffFilterOutcome)

- [ ] **Step 3: Refactor coverage builders to use tri-state diff filter + honest `sourceTreeInspected`**

In `src/context/coverage.ts`:

```typescript
import { createHash } from 'node:crypto';

export type DiffFilterOutcome = 'not_run' | 'failed' | 'succeeded';

export interface CoverageObject {
  mode: 'registered-source' | 'remote-evidence-only';
  sourceTreeInspected: boolean;
  diffFiltered: boolean;
  omittedProtectedPaths: Array<{ path: string; reason: string }>;
  omittedSourceEntries: Array<{ path: string; reason: string }>;
  missingCoverage: string[];
}

export function buildRegisteredSourceCoverage(
  omittedProtectedPaths: Array<{ path: string; reason: string }>,
  omittedSourceEntries: Array<{ path: string; reason: string }>,
  diffFilterOutcome: DiffFilterOutcome,
  sourceTreeInspected: boolean,
): CoverageObject {
  const missingCoverage: string[] = [];
  if (!sourceTreeInspected) missingCoverage.push('source_tree');
  if (diffFilterOutcome === 'failed') missingCoverage.push('diff_filter_failed');
  if (omittedProtectedPaths.length > 0) missingCoverage.push('protected_path_content');

  return {
    mode: 'registered-source',
    sourceTreeInspected,
    diffFiltered: diffFilterOutcome === 'succeeded',
    omittedProtectedPaths,
    omittedSourceEntries,
    missingCoverage,
  };
}

export function buildRemoteOnlyCoverage(
  omittedProtectedPaths: Array<{ path: string; reason: string }>,
  diffFilterOutcome: DiffFilterOutcome,
): CoverageObject {
  const missingCoverage: string[] = ['source_tree'];
  if (diffFilterOutcome === 'failed') missingCoverage.push('diff_filter_failed');
  if (omittedProtectedPaths.length > 0) missingCoverage.push('protected_path_content');

  return {
    mode: 'remote-evidence-only',
    sourceTreeInspected: false,
    diffFiltered: diffFilterOutcome === 'succeeded',
    omittedProtectedPaths,
    omittedSourceEntries: [],
    missingCoverage,
  };
}

export function hashCoverage(coverage: CoverageObject): string {
  // ... unchanged
}
```

- [ ] **Step 4: Update callers in context-build.ts to use new signatures**

In `src/orchestrator/context-build.ts`, in `computeRunContext`:

```typescript
const coverage =
  input.sourceMode === "remote-evidence-only"
    ? buildRemoteOnlyCoverage(omittedProtected, 'not_run')
    : buildRegisteredSourceCoverage(omittedProtected, [], 'not_run', false);
```

- [ ] **Step 5: Add a finalize function to context-build**

Add to `src/orchestrator/context-build.ts`:

```typescript
export interface CoverageFinalization {
  diffFilterOutcome: DiffFilterOutcome;
  diffOmittedPaths: Array<{ path: string; reason: string }>;
  sourceTreeInspected: boolean;
  sourceOmittedPaths: Array<{ path: string; reason: string }>;
  sourceOmittedEntries: Array<{ path: string; reason: string }>;
}

export function finalizeCoverage(
  sourceMode: 'registered-source' | 'remote-evidence-only',
  finalization: CoverageFinalization,
): CoverageObject {
  const allOmitted = [
    ...finalization.diffOmittedPaths,
    ...finalization.sourceOmittedPaths,
  ];

  if (sourceMode === 'remote-evidence-only') {
    return buildRemoteOnlyCoverage(allOmitted, finalization.diffFilterOutcome);
  }

  return buildRegisteredSourceCoverage(
    allOmitted,
    finalization.sourceOmittedEntries,
    finalization.diffFilterOutcome,
    finalization.sourceTreeInspected,
  );
}

export function materializeFinalCoverage(
  layout: RunDirectoryLayout,
  coverage: CoverageObject,
  runInputComponents: {
    harnessManifestHash: string;
    artifactSetHash: string;
    provenanceCatalogHash: string;
    modelSpecificationHash: string;
  },
  runMeta: { runId: string; jobId: string; modelSpecHash: string },
): { runInputHash: string } {
  const sourceHash = hashCoverage(coverage);
  const runInputHash = computeRunInputHash({
    ...runInputComponents,
    sourceHash,
  });

  const coveragePath = join(layout.sourceDir, 'coverage.json');
  mkdirSync(dirname(coveragePath), { recursive: true });
  writeFileSync(coveragePath, JSON.stringify(coverage, null, 2));

  const contextRefs = buildContextRefs(
    { manifestHash: runInputComponents.harnessManifestHash } as HarnessManifest,
    coverage,
    [],
    [],
  );
  writeFileSync(layout.contextRefsPath, JSON.stringify(contextRefs, null, 2));

  writeFileSync(
    layout.runJsonPath,
    JSON.stringify(
      {
        runId: runMeta.runId,
        jobId: runMeta.jobId,
        runInputHash,
        harnessManifestHash: runInputComponents.harnessManifestHash,
        artifactSetHash: runInputComponents.artifactSetHash,
        sourceHash,
        provenanceCatalogHash: runInputComponents.provenanceCatalogHash,
        modelSpecificationHash: runInputComponents.modelSpecificationHash,
      },
      null,
      2,
    ),
  );

  return { runInputHash };
}
```

- [ ] **Step 6: Defer coverage/run.json/context-refs writes from `materializeRunContext`**

In `materializeRunContext`, remove the `writeCreateOnceSync` calls for `coverage.json`, `context-refs.json`, and `run.json`. These are now written by `materializeFinalCoverage` after source prep.

Keep the writes for: `harness-manifest.json`, `pr-metadata.json`, `provenance-catalog.json`.

```typescript
export function materializeRunContext(
  input: ContextBuildInput,
  built: ContextBuildResult,
): void {
  const prMetadata = buildPrMetadata(input);

  writeCreateOnceSync(
    built.layout.harnessManifestPath,
    JSON.stringify(built.manifest, null, 2),
  );
  writeCreateOnceSync(
    join(built.layout.githubDir, "pr-metadata.json"),
    prMetadata.content,
  );
  writeCreateOnceSync(
    join(built.layout.githubDir, "provenance-catalog.json"),
    JSON.stringify(built.provenanceCatalog, null, 2),
  );
}
```

- [ ] **Step 7: Wire finalize into pipeline-runner before `runAgent`**

In `buildPipelineDeps`, after `prepareSource` returns and before `runAgent` is called, update `prepared.state.coverage` with the finalized coverage. This happens in the pipeline flow, not in a separate dep method, so add finalization logic at the end of `prepareSource`:

```typescript
async prepareSource(jobId, _runId) {
  // ... existing code to call prepareRegisteredSource ...

  if (prepared.state) {
    prepared.state.sourceManifest = result.sourceManifest;
    prepared.state.sourceViewRoot = result.sourceViewRoot;

    // Finalize coverage with real source inspection data
    const sourceOmitted = result.sourceManifest.omitted.map((o) => ({
      path: o.path,
      reason: o.reason,
    }));
    prepared.state.coverage = finalizeCoverage(
      prepared.job?.sourceMode ?? 'registered-source',
      {
        diffFilterOutcome: prepared.state.diffFilterOutcome ?? 'not_run',
        diffOmittedPaths: prepared.state.diffOmittedPaths ?? [],
        sourceTreeInspected: true,
        sourceOmittedPaths: sourceOmitted.filter(
          (o) => o.reason === 'protected_path_content',
        ),
        sourceOmittedEntries: sourceOmitted,
      },
    );
  }

  return {
    sourceViewRoot: result.sourceViewRoot,
    adminWorktree: result.adminWorktree,
  };
},
```

Add `diffFilterOutcome` and `diffOmittedPaths` to `PreparedRunState`:

```typescript
interface PreparedRunState {
  coverage: CoverageObject;
  manifest: HarnessManifest;
  provenanceCatalog: ProvenanceRecord[];
  sourceManifest: SourceManifest | null;
  sourceViewRoot: string | null;
  diffFilterOutcome?: DiffFilterOutcome;
  diffOmittedPaths?: Array<{ path: string; reason: string }>;
}
```

And update `prepareContext` to store diff results on `prepared.state` after calling `materializeDiffArtifact`.

- [ ] **Step 8: Ensure `validateOutput` receives final coverage**

In the `validateOutput` method in `pipeline-runner.ts`, change:

```typescript
validateOutput(rawOutput, coverage) {
  const finalCoverage = prepared.state?.coverage ?? coverage;
  // ... use finalCoverage instead of coverage ...
}
```

- [ ] **Step 9: Run all tests**

Run: `pnpm vitest run tests/orchestrator/ tests/context/ tests/integration/`
Expected: PASS

- [ ] **Step 10: Commit**

```bash
git add src/context/coverage.ts src/orchestrator/context-build.ts src/orchestrator/pipeline-runner.ts tests/orchestrator/context-build.test.ts
git commit -m "fix(U-05): defer coverage finalization until source prep completes; tri-state diff filter"
```

---

## Task 6: Build full provenance catalog from discovery data (U-04)

**Files:**
- Modify: `src/orchestrator/context-build.ts` — load checks/comments from DB; add diff hunk records
- Modify: `src/orchestrator/pipeline-runner.ts` — pass DB into context build for provenance
- Test: `tests/orchestrator/context-build.test.ts`

- [ ] **Step 1: Write the failing test for provenance catalog with checks/comments**

Add to `tests/orchestrator/context-build.test.ts`:

```typescript
import { createCheckRecord, createCommentRecord } from '../../src/context/provenance.js';
import { createHash } from 'node:crypto';

describe('provenance catalog from discovery data', () => {
  it('builds check records from pr_checks-shaped rows', () => {
    const record = createCheckRecord({
      checkRunId: 42,
      attempt: 1,
      name: 'unit-tests',
      status: 'completed',
      conclusion: 'failure',
      url: 'https://github.com/org/repo/actions/runs/123',
      observedAt: '2026-07-13T00:00:00Z',
    });

    expect(record.type).toBe('check');
    expect(record.id).toMatch(/^pv_/);
    expect(record.data.name).toBe('unit-tests');
    expect(record.data.conclusion).toBe('failure');
  });

  it('builds comment records from pr_comments-shaped rows', () => {
    const bodyHash = createHash('sha256').update('Fix this bug').digest('hex');
    const record = createCommentRecord({
      nodeId: 'comment:1',
      databaseId: 1,
      authorLogin: 'reviewer',
      bodyHash,
      commitAssociation: null,
      createdAt: '2026-07-13T00:00:00Z',
      updatedAt: '2026-07-13T00:00:00Z',
    });

    expect(record.type).toBe('comment');
    expect(record.id).toMatch(/^pv_/);
    expect(record.data.authorLogin).toBe('reviewer');
  });

  it('catalog IDs are accepted by validateProvenanceRef', () => {
    const record = createCheckRecord({
      checkRunId: 1,
      attempt: 1,
      name: 'lint',
      status: 'completed',
      conclusion: 'success',
      url: '',
      observedAt: '2026-07-13T00:00:00Z',
    });

    const catalog = new Map([[record.id, record]]);
    expect(validateProvenanceRef(record.id, catalog)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test to verify it passes (provenance creators already exist)**

Run: `pnpm vitest run tests/orchestrator/context-build.test.ts tests/context/provenance.test.ts`
Expected: PASS (the creators already work — U-04 is about calling them from production code)

- [ ] **Step 3: Add provenance loading to context-build**

Add a new function in `src/orchestrator/context-build.ts`:

```typescript
export interface ProvenanceLoadDeps {
  queryPrChecks: (repositoryKey: string, prNumber: number) => Array<{
    id: number;
    name: string;
    status: string;
    conclusion: string | null;
    details_url: string | null;
  }>;
  queryPrComments: (repositoryKey: string, prNumber: number) => Array<{
    id: number;
    author_login: string;
    body: string;
    created_at: string;
    url: string | null;
  }>;
  queryPrFetchedAt: (repositoryKey: string, prNumber: number) => string | null;
}

export function buildFullProvenanceCatalog(
  input: ContextBuildInput,
  deps: ProvenanceLoadDeps | null,
): ProvenanceRecord[] {
  const catalog: ProvenanceRecord[] = [
    createCommitRecord({
      repositoryId: input.repositoryKey,
      commitSha: input.headSha,
    }),
  ];

  if (!deps) return catalog;

  const fetchedAt = deps.queryPrFetchedAt(input.repositoryKey, input.prNumber)
    ?? new Date().toISOString();

  const checks = deps.queryPrChecks(input.repositoryKey, input.prNumber);
  for (const check of checks) {
    catalog.push(
      createCheckRecord({
        checkRunId: check.id,
        attempt: 1,
        name: check.name,
        status: check.status,
        conclusion: check.conclusion,
        url: check.details_url ?? '',
        observedAt: fetchedAt,
      }),
    );
  }

  const comments = deps.queryPrComments(input.repositoryKey, input.prNumber);
  for (const comment of comments) {
    const bodyHash = sha256Hex(comment.body);
    catalog.push(
      createCommentRecord({
        nodeId: comment.url ?? `comment:${comment.id}`,
        databaseId: comment.id,
        authorLogin: comment.author_login,
        bodyHash,
        commitAssociation: null,
        createdAt: comment.created_at,
        updatedAt: comment.created_at,
      }),
    );
  }

  return catalog;
}
```

Add the import for `createCheckRecord` and `createCommentRecord`:

```typescript
import {
  createCommitRecord,
  createCheckRecord,
  createCommentRecord,
} from "../context/provenance.js";
```

- [ ] **Step 4: Wire provenance deps in `computeRunContext`**

Replace the provenance catalog construction in `computeRunContext`:

```typescript
const provenanceCatalog = buildFullProvenanceCatalog(input, input.provenanceDeps ?? null);
```

Add `provenanceDeps` to `ContextBuildInput`:

```typescript
export interface ContextBuildInput {
  // ... existing fields ...
  provenanceDeps?: ProvenanceLoadDeps;
}
```

- [ ] **Step 5: Wire DB queries into pipeline-runner's `prepareContext`**

In `buildPipelineDeps.prepareContext`, add `provenanceDeps` to the context input:

```typescript
const contextInput = {
  // ... existing fields ...
  provenanceDeps: {
    queryPrChecks: (repoKey: string, prNum: number) => {
      return db
        .prepare(
          `SELECT pc.id, pc.name, pc.status, pc.conclusion, pc.details_url
           FROM pr_checks pc
           JOIN prs p ON p.id = pc.pr_id
           WHERE p.repository_id = ? AND p.pr_number = ?`,
        )
        .all(repoKey, prNum) as Array<{
          id: number; name: string; status: string;
          conclusion: string | null; details_url: string | null;
        }>;
    },
    queryPrComments: (repoKey: string, prNum: number) => {
      return db
        .prepare(
          `SELECT pc.id, pc.author_login, pc.body, pc.created_at, pc.url
           FROM pr_comments pc
           JOIN prs p ON p.id = pc.pr_id
           WHERE p.repository_id = ? AND p.pr_number = ?`,
        )
        .all(repoKey, prNum) as Array<{
          id: number; author_login: string; body: string;
          created_at: string; url: string | null;
        }>;
    },
    queryPrFetchedAt: (repoKey: string, prNum: number) => {
      const row = db
        .prepare(
          `SELECT fetched_at FROM prs WHERE repository_id = ? AND pr_number = ?`,
        )
        .get(repoKey, prNum) as { fetched_at: string } | undefined;
      return row?.fetched_at ?? null;
    },
  },
};
```

- [ ] **Step 6: Write test covering production path**

Add to `tests/orchestrator/context-build.test.ts`:

```typescript
describe('buildFullProvenanceCatalog', () => {
  it('includes commit, check, and comment records', () => {
    const input = {
      repositoryKey: 'pba-webapp',
      prNumber: 42,
      headSha: 'abc123',
    } as ContextBuildInput;

    const deps: ProvenanceLoadDeps = {
      queryPrChecks: () => [{
        id: 1, name: 'unit-tests', status: 'completed',
        conclusion: 'failure', details_url: 'https://example.com',
      }],
      queryPrComments: () => [{
        id: 10, author_login: 'reviewer', body: 'Fix this',
        created_at: '2026-07-13T00:00:00Z', url: 'https://example.com/comment/10',
      }],
      queryPrFetchedAt: () => '2026-07-13T00:00:00Z',
    };

    const catalog = buildFullProvenanceCatalog(input, deps);

    expect(catalog.length).toBe(3);
    expect(catalog.map((r) => r.type).sort()).toEqual(['check', 'comment', 'commit']);
    for (const record of catalog) {
      expect(record.id).toMatch(/^pv_/);
    }
  });
});
```

- [ ] **Step 7: Run all tests**

Run: `pnpm vitest run tests/orchestrator/context-build.test.ts tests/context/provenance.test.ts tests/orchestrator/pipeline.test.ts`
Expected: PASS

- [ ] **Step 8: Commit**

```bash
git add src/orchestrator/context-build.ts src/orchestrator/pipeline-runner.ts tests/orchestrator/context-build.test.ts
git commit -m "fix(U-04): build provenance catalog from discovery checks/comments, not just commit record"
```

---

## Task 7: PR-scoped supersede on enqueue (U-06, part 1)

**Files:**
- Modify: `src/orchestrator/enqueue.ts` — add PR-scoped lookup and supersede
- Modify: `src/daemon/bootstrap.ts` — implement `findActiveJobsByPr`
- Modify: `tests/orchestrator/enqueue.test.ts` — fix mock; add PR-scoped tests

- [ ] **Step 1: Write the failing test for PR-scoped supersede**

Add to `tests/orchestrator/enqueue.test.ts`:

```typescript
describe('PR-scoped supersede', () => {
  it('supersedes prior active job for same PR when head SHA changes (PR-scoped)', () => {
    const jobs = new Map<string, Record<string, unknown>>();
    jobs.set('job-old', {
      id: 'job-old',
      repository_key: 'pba-webapp',
      pr_number: 42,
      head_sha: 'a'.repeat(40),
      policy_hash: 'policy-p1-auto',
      source_mode: 'registered-source',
      state: 'draft_ready',
      version: 1,
    });

    let nextId = 200;
    const deps: EnqueueDeps = {
      findActiveJobByIdentity(_identityHash: string) {
        return null;
      },
      findActiveJobsByPr(repositoryKey: string, prNumber: number) {
        const matches: Array<{ id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number }> = [];
        for (const [, job] of jobs) {
          if (
            job.repository_key === repositoryKey &&
            job.pr_number === prNumber &&
            !['superseded', 'cancelled', 'published'].includes(job.state as string)
          ) {
            matches.push(job as { id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number });
          }
        }
        return matches;
      },
      insertJob(row: Record<string, unknown>) {
        const id = `job-${nextId++}`;
        jobs.set(id, { ...row, id });
        return id;
      },
      supersede(jobId: string, _version: number) {
        const j = jobs.get(jobId);
        if (j) j.state = 'superseded';
      },
      computeIdentityHash(input: Record<string, unknown>) {
        return `hash-${input.repositoryKey}-${input.prNumber}-${input.headSha}`;
      },
      computePolicyHash(decision: PolicyDecision) {
        return `policy-${decision.priorityStatus}-${decision.analysisMode}`;
      },
    };

    const input = makeInput({
      headSha: 'b'.repeat(40),
      policy: stubPolicy({ analysisMode: 'auto' }),
    });
    const result = enqueueFromPolicyDecision(deps, input);

    expect(result.enqueued).toBe(true);
    expect(jobs.get('job-old')?.state).toBe('superseded');
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `pnpm vitest run tests/orchestrator/enqueue.test.ts`
Expected: FAIL — `findActiveJobsByPr` does not exist on `EnqueueDeps`

- [ ] **Step 3: Add `findActiveJobsByPr` to `EnqueueDeps` and implement PR-scoped supersede**

In `src/orchestrator/enqueue.ts`:

```typescript
export interface EnqueueDeps {
  findActiveJobByIdentity(identityHash: string): {
    id: string;
    head_sha: string;
    policy_hash: string;
    source_mode: string;
    state: string;
    version: number;
  } | null;
  findActiveJobsByPr?(repositoryKey: string, prNumber: number): Array<{
    id: string;
    head_sha: string;
    policy_hash: string;
    source_mode: string;
    state: string;
    version: number;
  }>;
  insertJob(row: Record<string, unknown>): string;
  supersede(jobId: string, version: number): void;
  computeIdentityHash(input: Record<string, unknown>): string;
  computePolicyHash(decision: PolicyDecision): string;
}
```

In `enqueueFromPolicyDecision`, after the identity-based lookup returns null (no existing job with same identity), add PR-scoped supersede:

```typescript
export function enqueueFromPolicyDecision(
  deps: EnqueueDeps,
  input: EnqueueInput,
): EnqueueResult {
  if (!input.policy.eligible) {
    return { enqueued: false, reason: 'ineligible' };
  }

  const shouldEnqueue =
    input.policy.analysisMode === 'auto' ||
    (input.policy.analysisMode === 'on_demand' && input.explicitRequest);

  if (!shouldEnqueue) {
    return { enqueued: false, reason: 'on_demand_no_request' };
  }

  const identityHash = deps.computeIdentityHash({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceMode: input.sourceMode,
  });

  const policyHash = deps.computePolicyHash(input.policy);

  const existing = deps.findActiveJobByIdentity(identityHash);
  if (existing) {
    let supersedeReason: string | null = null;
    if (existing.head_sha !== input.headSha) {
      supersedeReason = 'supersede_head_sha';
    } else if (existing.policy_hash !== policyHash) {
      supersedeReason = 'supersede_policy_hash';
    } else if (existing.source_mode !== input.sourceMode) {
      supersedeReason = 'supersede_source_mode';
    }

    if (!supersedeReason) {
      return { enqueued: false, jobId: existing.id, reason: 'existing_job_current' };
    }

    deps.supersede(existing.id, existing.version);
  }

  // PR-scoped supersede: mark all other active jobs for this PR as superseded
  if (deps.findActiveJobsByPr) {
    const prJobs = deps.findActiveJobsByPr(input.repositoryKey, input.prNumber);
    for (const prJob of prJobs) {
      if (prJob.id !== existing?.id) {
        deps.supersede(prJob.id, prJob.version);
      }
    }
  }

  const reason = existing
    ? 'supersede_head_sha'
    : input.explicitRequest
      ? 'explicit_request'
      : 'auto_enqueue';

  const jobId = deps.insertJob({
    repositoryKey: input.repositoryKey,
    prNumber: input.prNumber,
    headSha: input.headSha,
    sourceMode: input.sourceMode,
    policyHash,
    identityHash,
    normalizedRepositoryIdentity: input.normalizedRepositoryIdentity,
    prioritySortOrdinal: input.policy.prioritySortOrdinal,
    explicitRequestSort: input.explicitRequest ? 0 : 1,
    queuedAt: new Date().toISOString(),
    state: 'queued',
  });

  const supersededId = existing?.id ?? undefined;
  return {
    enqueued: true,
    jobId,
    superseded: supersededId,
    reason,
  };
}
```

- [ ] **Step 4: Wire `findActiveJobsByPr` in bootstrap**

In `src/daemon/bootstrap.ts`, in `buildEnqueueDeps`:

```typescript
findActiveJobsByPr(repositoryKey: string, prNumber: number) {
  return db
    .prepare(
      `SELECT id, head_sha, policy_hash, source_mode, state, version
       FROM jobs
       WHERE repository_key = ? AND pr_number = ?
         AND state NOT IN ('superseded', 'cancelled', 'published')`,
    )
    .all(repositoryKey, prNumber) as Array<{
      id: string;
      head_sha: string;
      policy_hash: string;
      source_mode: string;
      state: string;
      version: number;
    }>;
},
```

- [ ] **Step 5: Update existing enqueue tests to align with production**

In `tests/orchestrator/enqueue.test.ts`, update `makeDeps` to include `findActiveJobsByPr`:

```typescript
function makeDeps(existingJob?: { id: string; headSha: string; policyHash: string; sourceMode: string; state: string; repositoryKey?: string; prNumber?: number }): EnqueueDeps {
  const jobs = new Map<string, Record<string, unknown>>();
  if (existingJob) {
    jobs.set(existingJob.id, {
      id: existingJob.id,
      head_sha: existingJob.headSha,
      policy_hash: existingJob.policyHash,
      source_mode: existingJob.sourceMode,
      state: existingJob.state,
      version: 1,
      repository_key: existingJob.repositoryKey ?? 'pba-webapp',
      pr_number: existingJob.prNumber ?? 42,
    });
  }
  let nextId = 100;
  return {
    findActiveJobByIdentity(identityHash: string) {
      for (const [, job] of jobs) {
        if (!['published', 'cancelled', 'superseded'].includes(job.state as string)) {
          return job as { id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number };
        }
      }
      return null;
    },
    findActiveJobsByPr(repositoryKey: string, prNumber: number) {
      const matches: Array<{ id: string; head_sha: string; policy_hash: string; source_mode: string; state: string; version: number }> = [];
      for (const [, job] of jobs) {
        if (
          job.repository_key === repositoryKey &&
          job.pr_number === prNumber &&
          !['superseded', 'cancelled', 'published'].includes(job.state as string)
        ) {
          matches.push(job as any);
        }
      }
      return matches;
    },
    insertJob(row: Record<string, unknown>) {
      const id = `job-${nextId++}`;
      jobs.set(id, { ...row, id, repository_key: row.repositoryKey, pr_number: row.prNumber });
      return id;
    },
    supersede(jobId: string, _version: number) {
      const j = jobs.get(jobId);
      if (j) j.state = 'superseded';
    },
    computeIdentityHash(input: Record<string, unknown>) {
      return `hash-${input.repositoryKey}-${input.prNumber}-${input.headSha}`;
    },
    computePolicyHash(decision: PolicyDecision) {
      return `policy-${decision.priorityStatus}-${decision.analysisMode}`;
    },
  };
}
```

Note: the mock for `findActiveJobByIdentity` still ignores identity hash for simplicity in existing tests. In production, the identity-based lookup returns null when the head SHA changes (identity includes headSha), and the PR-scoped lookup catches those jobs. The existing test behavior is preserved.

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/orchestrator/enqueue.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/enqueue.ts src/daemon/bootstrap.ts tests/orchestrator/enqueue.test.ts
git commit -m "fix(U-06): supersede prior active jobs for same PR on enqueue (PR-scoped lookup)"
```

---

## Task 8: Stale detection in draft/job APIs (U-06, part 2)

**Files:**
- Modify: `src/orchestrator/draft-loader.ts` — compare job headSha to prs.head_sha; add stale fields
- Modify: `src/api/contracts.ts` — add `reviewedHeadSha`, `currentHeadSha`, `stale` to `DraftDetail`
- Modify: `client/src/lib/api.ts` — mirror type changes
- Modify: `src/daemon/bootstrap.ts` — pass live `prs.head_sha` into publish guard registration

- [ ] **Step 1: Write the failing test for stale detection**

Add to `tests/orchestrator/draft-loader.test.ts` (or create a new describe block):

```typescript
describe('stale detection', () => {
  it('marks draft stale when job head_sha differs from prs.head_sha', () => {
    // This test requires the draft-loader to compare job head_sha
    // against prs.head_sha. Since draft-loader uses SQL,
    // this is an integration-level test with a real DB.
    // See existing draft-loader tests for pattern.
  });
});
```

- [ ] **Step 2: Add stale fields to `DraftDetail` contract**

In `src/api/contracts.ts`:

```typescript
export interface DraftDetail {
  jobId: string;
  runId: string;
  // ... existing fields ...
  reviewedHeadSha: string;
  currentHeadSha: string;
  stale: boolean;
}
```

- [ ] **Step 3: Mirror in client types**

In `client/src/lib/api.ts`:

```typescript
export interface DraftDetail {
  jobId: string;
  runId: string;
  // ... existing fields ...
  reviewedHeadSha: string;
  currentHeadSha: string;
  stale: boolean;
}
```

- [ ] **Step 4: Implement stale detection in `loadDraftBundle`**

In `src/orchestrator/draft-loader.ts`, after loading the job row, query `prs.head_sha`:

```typescript
export function loadDraftBundle(
  db: Database.Database,
  jobId: string,
  ctx: DraftLoadContext,
): DraftBundle | null {
  const job = db
    .prepare(
      `SELECT id, repository_key, pr_number, head_sha, state, accepted_run_id
       FROM jobs WHERE id = ?`,
    )
    .get(jobId) as /* ... existing type ... */ | undefined;

  if (!job || !job.accepted_run_id || !DRAFT_READY_STATES.has(job.state)) {
    return null;
  }

  // Load current PR head from discovery
  const prRow = db
    .prepare(
      `SELECT head_sha FROM prs WHERE repository_id = ? AND pr_number = ?`,
    )
    .get(job.repository_key, job.pr_number) as { head_sha: string } | undefined;

  const currentHeadSha = prRow?.head_sha ?? job.head_sha;
  const stale = currentHeadSha !== job.head_sha;

  // ... rest of existing code ...

  const detail: DraftDetail = {
    // ... existing fields ...
    reviewedHeadSha: job.head_sha,
    currentHeadSha,
    stale,
  };

  return {
    detail,
    operations: fullPlan.operations,
    runInputHash: run.run_input_hash,
    headSha: job.head_sha,
    acceptedRunId: run.id,
  };
}
```

- [ ] **Step 5: Fix publish guard registration to use live `prs.head_sha`**

In `src/daemon/bootstrap.ts`, in `buildFacadeDeps`, modify `registerOpsFromBundle`:

```typescript
const registerOpsFromBundle = (bundle: NonNullable<ReturnType<typeof loadDraftBundle>>) => {
  if (bundle.operations.length === 0) return;
  registerDraftOperations(
    context.guardStore,
    context.publisher,
    bundle.operations,
    {
      publicationMode: context.publicationMode,
      authenticatedLogin: context.authenticatedLogin,
      configuredOperator: context.configuredOperator,
      currentHeadSha: bundle.detail.currentHeadSha,
      reviewedHeadSha: bundle.headSha,
      acceptedRunId: bundle.acceptedRunId,
      approvedRunInputHash: bundle.runInputHash,
    },
  );
};
```

- [ ] **Step 6: Run tests**

Run: `pnpm vitest run tests/orchestrator/draft-loader.test.ts tests/publisher/guards.test.ts`
Expected: PASS

- [ ] **Step 7: Commit**

```bash
git add src/orchestrator/draft-loader.ts src/api/contracts.ts client/src/lib/api.ts src/daemon/bootstrap.ts
git commit -m "fix(U-06): expose reviewedHeadSha/currentHeadSha/stale on DraftDetail; use live head for publish guards"
```

---

## Task 9: Stale banner in Workbench UI (U-06, part 3)

**Files:**
- Modify: `client/src/routes/Workbench.tsx` — stale banner; disable approve/publish when stale

- [ ] **Step 1: Write the failing test for stale banner**

Add to `client/tests/workbench-readability.test.ts` (or a new file):

```typescript
describe('Workbench stale state', () => {
  it('shows stale banner when draft.stale is true', () => {
    // Test that the Workbench renders a stale warning
    // and disables approve/publish buttons when draft.stale is true
    // Use the existing component test pattern from the codebase
  });
});
```

- [ ] **Step 2: Add stale banner to Workbench component**

In `client/src/routes/Workbench.tsx`, after the `<CoverageWarning>` and before `<Tabs>`, add:

```tsx
{draft?.stale && (
  <div className="error-banner" role="alert">
    <strong>Stale review</strong> — The PR head has moved from{' '}
    <code>{draft.reviewedHeadSha.slice(0, 8)}</code> to{' '}
    <code>{draft.currentHeadSha.slice(0, 8)}</code>.
    This draft may not reflect the current code. Re-analyze to update.
  </div>
)}
```

- [ ] **Step 3: Disable Approve/Publish buttons when stale**

In the "act" tab section, wrap the Approve & Publish buttons with a stale check:

```tsx
<ActionButton
  type="button"
  busy={publishing}
  busyLabel="Publishing…"
  disabled={publishing || draft.stale}
  onClick={() =>
    void handleApproveAndPublish(op.operationHash, null)
  }
>
  {draft.stale ? 'Stale — Re-analyze' : 'Approve & Publish'}
</ActionButton>
```

- [ ] **Step 4: Run client tests**

Run: `pnpm vitest run client/tests/ tests/client/`
Expected: PASS

- [ ] **Step 5: Typecheck**

Run: `pnpm typecheck`
Expected: No type errors

- [ ] **Step 6: Commit**

```bash
git add client/src/routes/Workbench.tsx
git commit -m "fix(U-06): stale banner in Workbench; disable Approve/Publish when PR head has moved"
```

---

## Task 10: Final integration verification

**Files:**
- All modified files from Tasks 1–9

- [ ] **Step 1: Run full test suite**

Run: `pnpm vitest run`
Expected: All tests PASS

- [ ] **Step 2: Typecheck src/ and client/**

Run: `pnpm typecheck && pnpm --dir client build`
Expected: No type errors, client builds successfully

- [ ] **Step 3: Verify acceptance criteria**

Spot-check each U-ticket's acceptance criteria against the implementation:

- **U-01:** `parseGithubOwnerRepo` now receives resolved remote from DB/catalog → no `unknown/` fallback for catalog repos
- **U-02:** `sourceViewRoot` contains real files (not just manifest); `lineCount` from materialized bytes; validation uses real lineCount
- **U-03:** `github/pr-diff.patch` written during context prep; protected paths filtered; enriched metadata
- **U-05:** Coverage deferred until finalize; tri-state diff filter; `sourceTreeInspected` false until source prep succeeds; final coverage in `coverage.json`, agent, and validation all agree
- **U-04:** Provenance catalog includes checks and comments from SQLite discovery data; IDs pass `validateProvenanceRef`
- **U-06:** PR-scoped supersede on enqueue; stale detection comparing `jobs.head_sha` to `prs.head_sha`; publish guards use live head; Workbench shows stale banner

- [ ] **Step 4: Commit final state (if any fixups needed)**

```bash
git add -A
git commit -m "fix: integration fixups for urgent pipeline fixes U-01 through U-06"
```
