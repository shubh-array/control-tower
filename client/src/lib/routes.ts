export const ROUTES = {
  inbox: "/inbox",
  coverage: "/coverage",
  propose: "/propose",
  review: (jobId: string) => `/review/${encodeURIComponent(jobId)}`,
} as const;

export type AppRoutePath =
  | typeof ROUTES.inbox
  | typeof ROUTES.coverage
  | typeof ROUTES.propose
  | `/review/${string}`;
