export const PRIMARY_NAV = [
  { id: "inbox", label: "Inbox" },
] as const;

export type PrimaryPage = (typeof PRIMARY_NAV)[number]["id"];

export const DEFAULT_PAGE: PrimaryPage = "inbox";
