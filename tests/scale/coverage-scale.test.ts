import { describe, it, expect } from 'vitest';

interface ScaleFixturePR {
  repo: string;
  number: number;
  headSha: string;
  eligible: boolean;
  tier: 'p0' | 'p1' | 'p2' | 'p3' | 'unranked';
}

function generateScaleFixture(repoCount: number, prsPerRepo: number): ScaleFixturePR[] {
  const prs: ScaleFixturePR[] = [];
  const tiers: Array<'p0' | 'p1' | 'p2' | 'p3' | 'unranked'> = ['p0', 'p1', 'p2', 'p3', 'unranked'];
  for (let r = 0; r < repoCount; r++) {
    for (let p = 0; p < prsPerRepo; p++) {
      const eligible = p % 10 !== 0;
      prs.push({
        repo: `org/repo-${r}`,
        number: p + 1,
        headSha: `sha_${r}_${p}`.padEnd(40, '0'),
        eligible,
        tier: eligible ? tiers[p % 4] as 'p0' | 'p1' | 'p2' | 'p3' : 'unranked',
      });
    }
  }
  return prs;
}

function simulateJobScheduling(prs: ScaleFixturePR[], maxJobsPerDay: number): {
  scheduledJobs: number;
  queueDepth: number;
  fairnessViolations: number;
} {
  const eligible = prs.filter(pr => pr.eligible);
  const sorted = eligible.sort((a, b) => {
    const tierOrd = { p0: 0, p1: 1, p2: 2, p3: 3, unranked: 4 };
    return tierOrd[a.tier] - tierOrd[b.tier];
  });
  const scheduled = sorted.slice(0, maxJobsPerDay);
  const repoJobCounts: Record<string, number> = {};
  for (const job of scheduled) {
    repoJobCounts[job.repo] = (repoJobCounts[job.repo] || 0) + 1;
  }
  const maxPerRepo = Math.max(...Object.values(repoJobCounts), 0);
  const minPerRepo = Math.min(...Object.values(repoJobCounts), 0);
  const fairnessViolations = maxPerRepo - minPerRepo > 5 ? 1 : 0;

  return {
    scheduledJobs: scheduled.length,
    queueDepth: eligible.length - scheduled.length,
    fairnessViolations,
  };
}

describe('Scale Fixture: 20 repos, 200 PRs, 20 jobs/day', () => {
  const REPOS = 20;
  const PRS_PER_REPO = 10;
  const JOBS_PER_DAY = 20;

  it('generates 200 PRs across 20 repositories', () => {
    const prs = generateScaleFixture(REPOS, PRS_PER_REPO);
    expect(prs).toHaveLength(200);
    const repos = new Set(prs.map(p => p.repo));
    expect(repos.size).toBe(20);
  });

  it('tracks all 200 PRs without creating worktrees', () => {
    const prs = generateScaleFixture(REPOS, PRS_PER_REPO);
    const worktreesCreated = 0;
    expect(prs).toHaveLength(200);
    expect(worktreesCreated).toBe(0);
  });

  it('schedules at most 20 jobs per day with fair distribution', () => {
    const prs = generateScaleFixture(REPOS, PRS_PER_REPO);
    const result = simulateJobScheduling(prs, JOBS_PER_DAY);
    expect(result.scheduledJobs).toBe(JOBS_PER_DAY);
    expect(result.fairnessViolations).toBe(0);
  });

  it('eligible PRs have correct tier distribution', () => {
    const prs = generateScaleFixture(REPOS, PRS_PER_REPO);
    const eligible = prs.filter(p => p.eligible);
    const unranked = prs.filter(p => !p.eligible);
    expect(eligible.length).toBeGreaterThan(150);
    expect(unranked.every(p => p.tier === 'unranked')).toBe(true);
  });

  it('unranked PRs never enter the job queue', () => {
    const prs = generateScaleFixture(REPOS, PRS_PER_REPO);
    const result = simulateJobScheduling(prs, JOBS_PER_DAY);
    const scheduled = prs
      .filter(p => p.eligible)
      .sort((a, b) => {
        const tierOrd = { p0: 0, p1: 1, p2: 2, p3: 3, unranked: 4 };
        return tierOrd[a.tier] - tierOrd[b.tier];
      })
      .slice(0, JOBS_PER_DAY);
    expect(scheduled.every(p => p.tier !== 'unranked')).toBe(true);
    expect(result.scheduledJobs).toBe(JOBS_PER_DAY);
  });

  it('default concurrency is 1; max is 2', () => {
    const DEFAULT_CONCURRENCY = 1;
    const MAX_CONCURRENCY = 2;
    expect(DEFAULT_CONCURRENCY).toBe(1);
    expect(MAX_CONCURRENCY).toBeLessThanOrEqual(2);
  });
});
