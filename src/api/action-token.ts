import { randomBytes } from "node:crypto";

const TOKEN_TTL_MS = 60_000;

interface StoredToken {
  createdAt: number;
  consumed: boolean;
}

export class ActionTokenStore {
  private tokens = new Map<string, StoredToken>();

  create(): string {
    const token = randomBytes(32).toString("hex");
    this.tokens.set(token, { createdAt: Date.now(), consumed: false });
    return token;
  }

  consume(token: string): boolean {
    const entry = this.tokens.get(token);
    if (!entry) return false;
    if (entry.consumed) return false;
    if (Date.now() - entry.createdAt > TOKEN_TTL_MS) {
      this.tokens.delete(token);
      return false;
    }
    entry.consumed = true;
    return true;
  }

  cleanup(): void {
    const now = Date.now();
    for (const [key, entry] of this.tokens) {
      if (now - entry.createdAt > TOKEN_TTL_MS) {
        this.tokens.delete(key);
      }
    }
  }
}
