import { computeOperationHash, type ExternalOperation } from "./operation-hash.js";
import { executeOperation, type PublishContext } from "./publish.js";

export class PublisherService {
  private readonly operations = new Map<string, ExternalOperation>();

  constructor(private readonly ctx: PublishContext) {}

  register(op: ExternalOperation): void {
    this.operations.set(computeOperationHash(op), op);
  }

  async executeOperation(
    operationHash: string,
    body: string | null,
  ): Promise<{ status: "completed" | "failed"; error?: string }> {
    const op = this.operations.get(operationHash);
    if (!op) {
      return { status: "failed", error: "Unknown operation" };
    }
    const result = await executeOperation(this.ctx, op, body);
    return { status: result.status, error: result.error };
  }
}
