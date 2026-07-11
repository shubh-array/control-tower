import { createServer as createNetServer } from "node:net";
import { describe, it, expect } from "vitest";
import { probePortAvailable } from "../../src/cli/port.js";

async function listenEphemeral(server: ReturnType<typeof createNetServer>): Promise<number> {
  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === "string") {
    throw new Error("Expected TCP server address");
  }
  return address.port;
}

async function closeServer(server: ReturnType<typeof createNetServer>): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}

describe("probePortAvailable", () => {
  it("returns false for a bound port and true for a free port", async () => {
    const busyServer = createNetServer();
    const freeServer = createNetServer();

    try {
      const busyPort = await listenEphemeral(busyServer);
      const freePort = await listenEphemeral(freeServer);
      await closeServer(freeServer);

      await expect(probePortAvailable(busyPort)).resolves.toBe(false);
      await expect(probePortAvailable(freePort)).resolves.toBe(true);
    } finally {
      await closeServer(busyServer);
    }
  });
});
