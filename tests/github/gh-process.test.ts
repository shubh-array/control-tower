import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({
  spawnMock: vi.fn(),
}));

vi.mock("node:child_process", () => ({
  spawn: spawnMock,
}));

import {
  GhProcessError,
  execGhJson,
  execGhText,
} from "../../src/github/gh-process.js";

interface MockProcess extends EventEmitter {
  stdout: EventEmitter;
  kill: ReturnType<typeof vi.fn>;
}

function createMockProcess(): MockProcess {
  const proc = new EventEmitter() as MockProcess;
  proc.stdout = new EventEmitter();
  proc.kill = vi.fn();
  return proc;
}

describe("gh-process", () => {
  afterEach(() => {
    vi.clearAllMocks();
  });

  it("passes GH_HOST in env and trims stdout for text calls", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = execGhText(["api", "user"], {
      host: "github.example.com",
    });

    proc.stdout.emit("data", Buffer.from("shubh-array\n"));
    proc.emit("close", 0);

    await expect(promise).resolves.toBe("shubh-array");
    expect(spawnMock).toHaveBeenCalledWith(
      "gh",
      ["api", "user"],
      expect.objectContaining({
        env: expect.objectContaining({
          GH_HOST: "github.example.com",
        }),
        stdio: ["ignore", "pipe", "pipe"],
      }),
    );
  });

  it("throws GhProcessError when gh exits non-zero", async () => {
    const proc = createMockProcess();
    spawnMock.mockReturnValue(proc);

    const promise = execGhJson(["api", "rate_limit"], {
      host: "github.com",
    });

    proc.stdout.emit("data", Buffer.from('{"resources":{}}'));
    proc.emit("close", 2);

    await expect(promise).rejects.toBeInstanceOf(GhProcessError);
    await expect(promise).rejects.toMatchObject({
      args: ["api", "rate_limit"],
      exitCode: 2,
      message: "gh exited with code 2",
    });
  });
});
