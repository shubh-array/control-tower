import { buildCursorEnv } from '../security/child-env.js';

export interface CursorArgvInput {
  binary: string;
  runDirectory: string;
  modelId: string;
  prompt: string;
  sourceViewPath?: string; // only for registered-source primaryReview
  pluginDir?: string; // Control Tower feature plugin (e.g. control-tower-pr-review)
}

export function buildCursorArgv(input: CursorArgvInput): string[] {
  const args: string[] = [
    input.binary,
    'agent',
    '--print',
    '--mode=ask',
    '--sandbox', 'enabled',
    '--trust',
    '--workspace', input.runDirectory,
    '--model', input.modelId,
    '--output-format', 'stream-json',
  ];

  if (input.pluginDir) {
    args.push('--plugin-dir', input.pluginDir);
  }

  if (input.sourceViewPath) {
    args.push('--add-dir', input.sourceViewPath);
  }

  args.push(input.prompt);

  return args;
}

export function buildCursorEnvironment(homePath: string): Record<string, string> {
  return buildCursorEnv({
    ...process.env,
    HOME: homePath,
  });
}
