import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface CleanupConfig {
  dataDirectory: string;
  maxMaterialized: number;
  maxStorageBytes: number;
}

export interface CleanupResult {
  removedPairs: string[];
  removedMirrors: string[];
}

export async function removeRunSourcePair(
  dataDirectory: string,
  jobId: string,
): Promise<void> {
  const adminPath = join(dataDirectory, 'worktrees', jobId, 'admin');
  const sourcePath = join(dataDirectory, 'worktrees', jobId, 'source');

  await fs.rm(sourcePath, { recursive: true, force: true });
  await fs.rm(adminPath, { recursive: true, force: true });

  const jobWorktreeDir = join(dataDirectory, 'worktrees', jobId);
  try {
    const remaining = await fs.readdir(jobWorktreeDir);
    if (remaining.length === 0) {
      await fs.rmdir(jobWorktreeDir);
    }
  } catch {
    // directory already gone
  }
}

export async function cleanupAbandonedPairs(
  dataDirectory: string,
  activeJobIds: Set<string>,
): Promise<CleanupResult> {
  const result: CleanupResult = { removedPairs: [], removedMirrors: [] };
  const worktreesDir = join(dataDirectory, 'worktrees');

  try {
    const entries = await fs.readdir(worktreesDir);
    for (const entry of entries) {
      if (!activeJobIds.has(entry)) {
        await fs.rm(join(worktreesDir, entry), { recursive: true, force: true });
        result.removedPairs.push(entry);
      }
    }
  } catch {
    // worktrees directory may not exist yet
  }

  return result;
}
