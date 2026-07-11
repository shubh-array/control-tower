
export interface CursorArgvInput {
  binary: string;
  runDirectory: string;
  modelId: string;
  prompt: string;
  sourceViewPath?: string; // only for registered-source primaryReview
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

  if (input.sourceViewPath) {
    args.push('--add-dir', input.sourceViewPath);
  }

  args.push(input.prompt);

  return args;
}

export function buildCursorEnvironment(homePath: string): Record<string, string> {
  const env: Record<string, string> = {};
  if (process.env.PATH) env.PATH = process.env.PATH;
  env.HOME = homePath;
  if (process.env.TMPDIR) env.TMPDIR = process.env.TMPDIR;
  if (process.env.LANG) env.LANG = process.env.LANG;
  if (process.env.USER) env.USER = process.env.USER;
  return env;
}
