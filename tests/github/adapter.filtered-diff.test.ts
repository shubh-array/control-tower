import { readFileSync } from "node:fs";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import { GitHubAdapter } from "../../src/github/adapter.js";

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  stderr: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.stderr = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

function loadDiff(name: string): string {
  return readFileSync(
    new URL(`../fixtures/diffs/${name}`, import.meta.url),
    "utf-8",
  );
}

const stubCanonicalize = (rawPath: string): string | null => {
  const stripped = rawPath.replace(/^[ab]\//, "");
  if (stripped === "" || stripped.includes("..") || stripped.startsWith("/")) {
    return null;
  }
  return stripped;
};

const stubIsProtected = (path: string): boolean => {
  const basename = path.split("/").pop() ?? "";
  if (basename === ".env") return true;
  if (basename.startsWith(".env.")) return true;
  return false;
};

describe("GitHubAdapter.getFilteredPrDiff", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("streams diff through filter and omits protected paths without patch bodies", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const adapter = new GitHubAdapter("github.com", vi.fn());
    const diff = loadDiff("mixed.diff");

    const promise = adapter.getFilteredPrDiff(
      "Org/repo",
      42,
      stubCanonicalize,
      stubIsProtected,
    );

    for (const line of diff.split("\n")) {
      proc.stdout.emit("data", Buffer.from(`${line}\n`));
    }
    proc.emit("close", 0);

    const result = await promise;

    expect(result.failed).toBe(false);
    expect(result.omitted).toHaveLength(1);
    expect(result.omitted[0]?.path).toBe(".env.local");
    expect(result.omitted[0]?.reason).toBe("protected_path_content");
    expect(result.files.map((file) => file.path)).toEqual([
      "src/app.ts",
      "src/middleware.ts",
    ]);
    for (const file of result.files) {
      expect(file.patch).not.toContain("SECRET_KEY");
    }
  });

  it("getPrDiff throws directing callers to getFilteredPrDiff", async () => {
    const adapter = new GitHubAdapter("github.com", vi.fn());

    await expect(adapter.getPrDiff("Org/repo", 1)).rejects.toThrow(
      /getFilteredPrDiff/i,
    );
  });
});
