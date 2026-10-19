import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { createVoiceServer } from "./server.js";
import { YggdrasilGatewayClient } from "./gateway-client.js";

export type LaunchVoiceOptions = {
  gatewayUrl: string;
  gatewayApiKey?: string;
  port: number;
  uiRoot?: string;
  loadBalancerUrl?: string;
  serperApiKey?: string;
};

export type VoiceApp = {
  port: number;
  close: () => Promise<void>;
};

/** Resolves the bundled frontend directory (index.html/main.js/ws/ui), next
 * to the compiled dist/ output — override with YGGDRASIL_VOICE_UI_DIR. */
export function resolveUiRoot(): string {
  const fromEnv = process.env.YGGDRASIL_VOICE_UI_DIR?.trim();
  if (fromEnv) return fromEnv;
  const here = dirname(fileURLToPath(import.meta.url));
  return join(here, "../ui");
}

export async function launchVoice(options: LaunchVoiceOptions): Promise<VoiceApp> {
  const gatewayClient = new YggdrasilGatewayClient(options.gatewayUrl, options.gatewayApiKey ?? "");
  gatewayClient.start();

  const server = createVoiceServer({
    uiRoot: options.uiRoot ?? resolveUiRoot(),
    loadBalancerUrl: options.loadBalancerUrl ?? "",
    serperApiKey: options.serperApiKey ?? "",
    gatewayClient,
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(options.port, () => resolve());
  });

  return {
    port: options.port,
    close: () => new Promise<void>((resolve) => server.close(() => resolve())),
  };
}
