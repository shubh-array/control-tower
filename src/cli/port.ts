import { createServer as createNetServer } from "node:net";

export function probePortAvailable(port: number): Promise<boolean> {
  return new Promise<boolean>((resolve) => {
    const srv = createNetServer();
    const done = (ok: boolean) => {
      try {
        srv.close(() => resolve(ok));
      } catch {
        resolve(ok);
      }
    };

    srv.once("error", () => resolve(false));
    srv.listen(port, "127.0.0.1", () => done(true));
  });
}
