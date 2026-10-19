# Plantilla E2E (iter 5+)

Copia este bloque en `test/e2e/iterN-feature.test.ts`:

```typescript
import { describe, it, expect, afterEach } from "vitest";
import { createTestPlatform, GatewayWsClient, postInbound } from "../helpers/index.js";

describe("iterN-feature", () => {
  let platform: Awaited<ReturnType<typeof createTestPlatform>>;

  afterEach(async () => {
    await platform?.close();
  });

  it("scenario via WebSocket", async () => {
    platform = await createTestPlatform({ startServer: true });
    const client = new GatewayWsClient();
    await client.connect(`ws://127.0.0.1:${platform.gatewayPort}`);
    const { result } = await client.call("health");
    expect(result).toBeTruthy();
    client.close();
  });
});
```

Live Ollama: ver `test/e2e/live/ollama-chat.test.ts` y `liveDescribe` en `test/helpers/ollama-live.ts`.
