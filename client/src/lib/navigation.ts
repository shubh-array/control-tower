export const PRIMARY_NAV = [
  { id: "inbox", label: "Inbox" },
  { id: "coverage", label: "Coverage" },
  { id: "propose", label: "Propose" },
] as const;

export type PrimaryPage = (typeof PRIMARY_NAV)[number]["id"];

export const DEFAULT_PAGE: PrimaryPage = "inbox";
