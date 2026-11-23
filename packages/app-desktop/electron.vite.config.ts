import { resolve } from "node:path";
import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import react from "@vitejs/plugin-react";
import { readFileSync } from "node:fs";

const { version } = JSON.parse(readFileSync(resolve(__dirname, "package.json"), "utf8")) as { version: string };

export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      outDir: "dist/main",
      rollupOptions: {
        input: {
          index: resolve(__dirname, "src/main/index.ts"),
          // The one MCP server a claude CLI session's .mcp.json spawns (via
          // process.execPath + ELECTRON_RUN_AS_NODE) — serves the panes,
          // documents, plugins, memory and workflows tools from a single
          // process; see yggdrasilMcpShim.ts.
          yggdrasilMcpShim: resolve(__dirname, "src/main/yggdrasilMcpShim.ts"),
          // Same standalone-spawn pattern, invoked by Claude Code itself
          // (as this project's `statusLine` command) rather than by the
          // `claude` CLI's MCP client — see statuslineBridge.ts.
          statuslineBridge: resolve(__dirname, "src/main/statuslineBridge.ts"),
          // Run by the attention hooks of every claude pane — see attentionBridge.ts.
          attentionBridge: resolve(__dirname, "src/main/attentionBridge.ts"),
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
    // The link server wizard hands out the gateway image tagged with this version.
    define: {
      __APP_VERSION__: JSON.stringify(version),
    },
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
