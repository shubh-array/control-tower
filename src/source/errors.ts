// src/source/errors.ts

export class SourceFetchError extends Error {
  readonly code = 'fetch_failed' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SourceFetchError';
  }
}

export class SourceMaterializeError extends Error {
  readonly code = 'materialize_failed' as const;

  constructor(message: string) {
    super(message);
    this.name = 'SourceMaterializeError';
  }
}

export function classifySourceFailure(
  error: unknown,
): 'fetch_failed' | 'materialize_failed' {
  if (error instanceof SourceMaterializeError) {
    return 'materialize_failed';
  }
  return 'fetch_failed';
}
