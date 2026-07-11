const LOGIN_PATTERN = /^[A-Za-z0-9](?:[A-Za-z0-9-]*[A-Za-z0-9])?(?:\[bot\])?$/;
const MAX_LENGTH = 100;

export function validateLoginFormat(login: string): boolean {
  if (login.length === 0 || login.length > MAX_LENGTH) return false;
  return LOGIN_PATTERN.test(login);
}

export function normalizeLogin(raw: string): string {
  const trimmed = raw.trim().toLowerCase();
  if (!validateLoginFormat(trimmed)) {
    throw new Error(
      `Invalid GitHub login "${trimmed}": must be 1-${MAX_LENGTH} ASCII alphanumeric/hyphen characters matching ${LOGIN_PATTERN.source}`,
    );
  }
  return trimmed;
}

export function validateNoDuplicateLogins(logins: string[]): void {
  const normalized = logins.map(normalizeLogin);
  const seen = new Set<string>();
  for (const login of normalized) {
    if (seen.has(login)) {
      throw new Error(`Duplicate normalized login: "${login}"`);
    }
    seen.add(login);
  }
}
