import { chmodSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

export function forceRemoveDir(path: string): void {
  try {
    const stat = statSync(path);
    if (stat.isDirectory()) {
      chmodSync(path, 0o777);
      for (const entry of readdirSync(path)) {
        forceRemoveDir(join(path, entry));
      }
    } else {
      chmodSync(path, 0o666);
    }
  } catch {
    // path may already be gone
  }

  rmSync(path, { recursive: true, force: true });
}
