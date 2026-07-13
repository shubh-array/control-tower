import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";

const DAEMON_PORT = process.env.CT_DAEMON_PORT ?? "9120";

export default defineConfig({
  plugins: [react(), tailwindcss()],
  root: ".",
  server: {
    proxy: {
      "/api": {
        target: `http://127.0.0.1:${DAEMON_PORT}`,
        changeOrigin: false,
      },
    },
  },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
});
