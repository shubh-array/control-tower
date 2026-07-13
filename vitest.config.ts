import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

const rootDir = path.dirname(fileURLToPath(import.meta.url));

export default defineConfig({
  resolve: {
    alias: [
      {
        find: "react-dom/server",
        replacement: path.join(
          rootDir,
          "client/node_modules/react-dom/server.node.js",
        ),
      },
      {
        find: "react/jsx-dev-runtime",
        replacement: path.join(
          rootDir,
          "client/node_modules/react/jsx-dev-runtime.js",
        ),
      },
      {
        find: "react/jsx-runtime",
        replacement: path.join(
          rootDir,
          "client/node_modules/react/jsx-runtime.js",
        ),
      },
      {
        find: "react",
        replacement: path.join(rootDir, "client/node_modules/react/index.js"),
      },
      {
        find: "react-dom",
        replacement: path.join(
          rootDir,
          "client/node_modules/react-dom/index.js",
        ),
      },
    ],
  },
  test: {
    globals: false,
    include: ["tests/**/*.test.ts", "client/tests/**/*.test.ts"],
    testTimeout: 10_000,
    passWithNoTests: true,
  },
});
