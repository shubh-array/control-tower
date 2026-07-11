import { promises as fs } from 'node:fs';
import { join } from 'node:path';

export interface TerminalRecord {
  runId: string;
  jobId: string;
  outcome: 'succeeded' | 'failed' | 'cancelled' | 'superseded';
  sealedAt: string;
  failureReason?: string;
  durationMs?: number;
}

export async function sealRun(
  runDir: string,
  record: TerminalRecord,
): Promise<void> {
  const terminalPath = join(runDir, 'terminal.json');
  const content = JSON.stringify(record, null, 2);

  const fd = await fs.open(terminalPath, 'wx');
  try {
    await fd.writeFile(content);
    await fd.datasync();
  } finally {
    await fd.close();
  }

  await makeReadOnly(runDir);
}

async function makeReadOnly(dir: string): Promise<void> {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      await makeReadOnly(fullPath);
      await fs.chmod(fullPath, 0o555);
    } else {
      await fs.chmod(fullPath, 0o444);
    }
  }
}

export async function isSealed(runDir: string): Promise<boolean> {
  try {
    await fs.access(join(runDir, 'terminal.json'));
    return true;
  } catch {
    return false;
  }
}
