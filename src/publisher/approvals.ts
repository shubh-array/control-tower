const APPROVAL_TTL_MS = 10 * 60_000;

interface ApprovalEntry {
  operationHash: string;
  createdAt: number;
  consumed: boolean;
}

export class ApprovalStore {
  private approvals = new Map<string, ApprovalEntry>();

  create(operationHash: string): void {
    this.approvals.set(operationHash, {
      operationHash,
      createdAt: Date.now(),
      consumed: false,
    });
  }

  consume(operationHash: string): boolean {
    const entry = this.approvals.get(operationHash);
    if (!entry) return false;
    if (entry.consumed) return false;
    if (Date.now() - entry.createdAt > APPROVAL_TTL_MS) {
      this.approvals.delete(operationHash);
      return false;
    }
    entry.consumed = true;
    return true;
  }

  get(operationHash: string): ApprovalEntry | undefined {
    return this.approvals.get(operationHash);
  }

  invalidateAll(): void {
    this.approvals.clear();
  }
}
