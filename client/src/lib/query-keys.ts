export const queryKeys = {
  health: ["health"] as const,
  queue: ["queue"] as const,
  draft: (jobId: string) => ["draft", jobId] as const,
};
