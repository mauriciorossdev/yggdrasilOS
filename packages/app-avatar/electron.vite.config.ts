import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // Spawned standalone by the gateway's mcpServers config — see desktopControlMcpShim.ts.
          desktopControlMcpShim: resolve(__dirname, "src/main/desktopControlMcpShim.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: resolve(__dirname, "src/preload/index.ts"),
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
