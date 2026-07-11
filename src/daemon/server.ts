import { createServer, type Server } from "node:http";

export interface DaemonOptions {
  port: number;
  host?: string;
}

export function createDaemon(opts: DaemonOptions): Server {
  void opts;
  const server = createServer((req, res) => {
    if (req.url === "/health" && req.method === "GET") {
      res.writeHead(200, { "Content-Type": "application/json" });
      res.end(JSON.stringify({ status: "ok", uptime: process.uptime() }));
      return;
    }

    res.writeHead(404, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ error: "not found" }));
  });

  return server;
}

export function startDaemon(
  server: Server,
  opts: DaemonOptions,
): Promise<{ port: number; url: string }> {
  return new Promise((resolve, reject) => {
    const host = opts.host ?? "127.0.0.1";
    server.listen(opts.port, host, () => {
      const addr = server.address();
      if (!addr || typeof addr === "string") {
        reject(new Error("Unexpected server address format"));
        return;
      }
      const url = `http://${host}:${addr.port}`;
      resolve({ port: addr.port, url });
    });
    server.on("error", reject);
  });
}

export function stopDaemon(server: Server): Promise<void> {
  return new Promise((resolve, reject) => {
    server.close((err) => {
      if (err) reject(err);
      else resolve();
    });
  });
}
