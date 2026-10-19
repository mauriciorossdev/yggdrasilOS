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
          // Spawned standalone (`node dist/main/paneControlMcpShim.js`) by a
          // claude CLI session's .mcp.json — see paneControlMcpShim.ts.
          paneControlMcpShim: resolve(__dirname, "src/main/paneControlMcpShim.ts"),
          // Same standalone-spawn pattern, see documentsControlMcpShim.ts.
          documentsControlMcpShim: resolve(__dirname, "src/main/documentsControlMcpShim.ts"),
          // Same standalone-spawn pattern, see pluginsControlMcpShim.ts.
          pluginsControlMcpShim: resolve(__dirname, "src/main/pluginsControlMcpShim.ts"),
          // Same standalone-spawn pattern, see memoryControlMcpShim.ts — spawned
          // via process.execPath/ELECTRON_RUN_AS_NODE instead of plain "node"
          // (writeMemoryMcpConfig), not just "node dist/main/....js" like the
          // three shims above.
          memoryControlMcpShim: resolve(__dirname, "src/main/memoryControlMcpShim.ts"),
          // Same standalone-spawn pattern, see workflowsMcpShim.ts — a WS
          // client of this project's own gateway subprocess, not a proxy
          // into paneControlServer.ts like the pane/plugins shims above.
          workflowsMcpShim: resolve(__dirname, "src/main/workflowsMcpShim.ts"),
          // Same standalone-spawn pattern, invoked by Claude Code itself
          // (as this project's `statusLine` command) rather than by the
          // `claude` CLI's MCP client — see statuslineBridge.ts.
          statuslineBridge: resolve(__dirname, "src/main/statuslineBridge.ts"),
        },
      },
    },
  },
  preload: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/preload",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/preload/index.ts"),
          // Runs inside the Browser tab's own WebContentsView — a
          // *sandboxed* preload (main/browserTabView.ts), unlike the main
          // app window's own preload above, since this one loads arbitrary
          // remote pages. See browserTabPickerPreload.ts.
          browserTabPicker: resolve(__dirname, "src/preload/browserTabPickerPreload.ts"),
        },
        output: {
          // Electron's *sandboxed* preload bootstrap ("sandbox_bundle")
          // only understands CommonJS — it throws "Cannot use import
          // statement outside a module" on a real ESM preload, even one
          // named ".mjs" — so this can't be left at electron-vite's default
          // output format. That default is ESM (this package.json has
          // "type": "module", so a plain ".js" would be ESM too) — force
          // CJS with an explicit ".cjs" extension so it's unambiguous
          // regardless of the nearest package.json. Applies to both preload
          // entries; harmless for the non-sandboxed main-window preload
          // too, since CJS has always been the universally-supported format
          // there.
          format: "cjs",
          entryFileNames: "[name].cjs",
        },
      },
    },
  },
  renderer: {
    root: "src/renderer",
    plugins: [react()],
    // Monaco's editor.worker is pulled in via a `?worker` import
    // (monacoSetup.ts) — Vite needs ES module workers for that to bundle
    // cleanly rather than falling back to a classic-script worker.
    worker: {
      format: "es",
    },
    build: {
      outDir: "dist/renderer",
      rollupOptions: {
        input: resolve(__dirname, "src/renderer/index.html"),
      },
    },
  },
});
