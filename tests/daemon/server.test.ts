import { describe, it, expect } from "vitest";
import { createDaemon, startDaemon, stopDaemon } from "../../src/daemon/server.js";

describe("daemon server", () => {
  it("serves /health and stops cleanly", async () => {
    const server = createDaemon({ port: 0 });

    const { url, port } = await startDaemon(server, { port: 0 });
    expect(port).toBeGreaterThan(0);

    const response = await fetch(`${url}/health`);
    expect(response.status).toBe(200);

    const body = await response.json() as { status: string; uptime: number };
    expect(body.status).toBe("ok");
    expect(typeof body.uptime).toBe("number");

    await stopDaemon(server);
    expect(server.listening).toBe(false);
  });
});
