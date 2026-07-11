import { promises as fs } from 'node:fs';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import type { HarnessManifest } from './harness-manifest.js';
import type { CoverageObject } from './coverage.js';
import type { ProvenanceRecord } from './provenance.js';

export interface RunDirectoryLayout {
  runDir: string;
  jobJsonPath: string;
  runJsonPath: string;
  contextRefsPath: string;
  harnessManifestPath: string;
  harnessDir: string;
  githubDir: string;
  sourceDir: string;
  cursorDir: string;
  transcriptPath: string;
  stderrPath: string;
  outputPath: string;
  validationPath: string;
  validatedProvenancePath: string;
  terminalPath: string;
}

export function computeRunDirectoryLayout(dataDir: string, jobId: string, runId: string): RunDirectoryLayout {
  const jobDir = join(dataDir, 'jobs', jobId);
  const runDir = join(jobDir, 'runs', runId);

  return {
    runDir,
    jobJsonPath: join(jobDir, 'job.json'),
    runJsonPath: join(runDir, 'run.json'),
    contextRefsPath: join(runDir, 'context-refs.json'),
    harnessManifestPath: join(runDir, 'harness-manifest.json'),
    harnessDir: join(runDir, 'harness'),
    githubDir: join(runDir, 'github'),
    sourceDir: join(runDir, 'source'),
    cursorDir: join(runDir, '.cursor'),
    transcriptPath: join(runDir, 'transcript.ndjson'),
    stderrPath: join(runDir, 'stderr.log'),
    outputPath: join(runDir, 'output.json'),
    validationPath: join(runDir, 'validation.json'),
    validatedProvenancePath: join(runDir, 'validated-provenance.json'),
    terminalPath: join(runDir, 'terminal.json'),
  };
}

export interface ContextRef {
  logicalPath: string;
  contentHash: string;
  identityDescription: string;
}

export async function writeCreateOnce(filePath: string, content: string): Promise<void> {
  await fs.mkdir(join(filePath, '..'), { recursive: true });
  const fd = await fs.open(filePath, 'wx');
  try {
    await fd.writeFile(content);
    await fd.datasync();
  } finally {
    await fd.close();
  }
}

export function buildContextRefs(
  manifest: HarnessManifest,
  coverage: CoverageObject,
  provenanceCatalog: ProvenanceRecord[],
  additionalRefs: ContextRef[],
): ContextRef[] {
  const refs: ContextRef[] = [];

  refs.push({
    logicalPath: 'harness-manifest.json',
    contentHash: manifest.manifestHash,
    identityDescription: 'complete ordered harness manifest',
  });

  for (const entry of manifest.entries) {
    refs.push({
      logicalPath: entry.logicalPath,
      contentHash: entry.contentHash,
      identityDescription: `${entry.layerName} layer ${entry.layerOrdinal}`,
    });
  }

  const coverageHash = createHash('sha256')
    .update(JSON.stringify(coverage))
    .digest('hex');
  refs.push({
    logicalPath: 'source/coverage.json',
    contentHash: coverageHash,
    identityDescription: `coverage ${coverage.mode}`,
  });

  if (provenanceCatalog.length > 0) {
    const provHash = createHash('sha256')
      .update(JSON.stringify(provenanceCatalog.map(r => r.id).sort()))
      .digest('hex');
    refs.push({
      logicalPath: 'github/provenance-catalog.json',
      contentHash: provHash,
      identityDescription: 'application-created provenance catalog',
    });
  }

  refs.push(...additionalRefs);

  return refs;
}
