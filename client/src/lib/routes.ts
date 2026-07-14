export const ROUTES = {
  inbox: "/inbox",
  review: (jobId: string) => `/review/${encodeURIComponent(jobId)}`,
} as const;

export type AppRoutePath =
  | typeof ROUTES.inbox
  | `/review/${string}`;
