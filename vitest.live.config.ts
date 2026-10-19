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
};

export default defineConfig({
  test: {
    include: ["test/e2e/live/**/*.test.ts"],
    environment: "node",
    testTimeout: 60_000,
    retry: 1,
    pool: "forks",
    poolOptions: { forks: { singleFork: true } },
  },
  resolve: { alias },
});
