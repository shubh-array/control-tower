import { promises as fs } from 'node:fs';
import { join } from 'node:path';

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
