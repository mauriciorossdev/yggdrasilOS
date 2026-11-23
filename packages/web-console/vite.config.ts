import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";

export default defineConfig({
  plugins: [react()],
  base: "/ui/",
  // @yggdrasil/ui-kit is source-only and imports react itself: keep one copy (hooks break with two).
  resolve: { dedupe: ["react", "react-dom"] },
  build: {
    outDir: "dist",
    emptyOutDir: true,
  },
  server: {
    port: 5173,
    proxy: {
      "/ws": {
        target: "ws://127.0.0.1:18789",
        ws: true,
        rewrite: () => "/",
      },
    },
  },
});
