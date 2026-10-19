import { defineConfig } from "vitest/config";
import { resolve } from "node:path";

const alias = {
  "@yggdrasil/sdk": resolve(__dirname, "packages/sdk/src/index.ts"),
  "@yggdrasil/config": resolve(__dirname, "packages/config/src/index.ts"),
  "@yggdrasil/kernel": resolve(__dirname, "packages/kernel/src/index.ts"),
  "@yggdrasil/harness-runtime": resolve(__dirname, "packages/harness-runtime/src/index.ts"),
  "@yggdrasil/harness-llm": resolve(__dirname, "packages/harness-llm/src/index.ts"),
  "@yggdrasil/pipeline": resolve(__dirname, "packages/pipeline/src/index.ts"),
  "@yggdrasil/gateway": resolve(__dirname, "packages/gateway/src/index.ts"),
  "@yggdrasil/sessions": resolve(__dirname, "packages/sessions/src/index.ts"),
  "@yggdrasil/channel-tui": resolve(__dirname, "packages/channel-tui/src/index.ts"),
  "@yggdrasil/channel-http": resolve(__dirname, "packages/channel-http/src/index.ts"),
  "@yggdrasil/provider-openai-compat": resolve(
    __dirname,
    "packages/provider-openai-compat/src/index.ts",
  ),
  "@yggdrasil/tools-sdk": resolve(__dirname, "packages/tools-sdk/src/index.ts"),
  "@yggdrasil/tools-runtime": resolve(__dirname, "packages/tools-runtime/src/index.ts"),
  "@yggdrasil/tool-builtin": resolve(__dirname, "packages/tool-builtin/src/index.ts"),
  "@yggdrasil/app-tui": resolve(__dirname, "packages/app-tui/src/index.ts"),
  "@yggdrasil/context-sdk": resolve(__dirname, "packages/context-sdk/src/index.ts"),
  "@yggdrasil/context-runtime": resolve(__dirname, "packages/context-runtime/src/index.ts"),
  "@yggdrasil/context-prompt-files": resolve(__dirname, "packages/context-prompt-files/src/index.ts"),
  "@yggdrasil/context-memory-local": resolve(__dirname, "packages/context-memory-local/src/index.ts"),
  "@yggdrasil/context-memory-db": resolve(__dirname, "packages/context-memory-db/src/index.ts"),
  "@yggdrasil/context-project": resolve(__dirname, "packages/context-project/src/index.ts"),
};

export default defineConfig({
  test: {
    include: [
      "packages/**/*.test.ts",
      "extensions/**/*.test.ts",
      "test/**/*.test.ts",
      "test/integration/**/*.test.ts",
      "test/e2e/**/*.test.ts",
    ],
    exclude: ["**/node_modules/**", "**/dist/**"],
    environment: "node",
    testTimeout: 15_000,
    coverage: {
      provider: "v8",
      reporter: ["text", "html"],
      include: ["packages/*/src/**/*.ts", "extensions/**/*.ts"],
      exclude: ["**/*.test.ts", "**/dist/**", "**/node_modules/**"],
    },
  },
  resolve: { alias },
});
