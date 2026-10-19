#!/usr/bin/env node
import { createConnection } from "node:net";
import http from "node:http";
import { watch } from "node:fs";
import { join } from "node:path";
import { createHash } from "node:crypto";
import { mergeConfig, type YggdrasilConfig } from "@yggdrasil/config";
import { createTuiApprovalPrompt } from "@yggdrasil/channel-tui";
import { startGatewayServer } from "@yggdrasil/gateway";
import type { ToolApprovalHandler } from "@yggdrasil/sdk";
import { registerBuiltinHarnesses } from "@yggdrasil/harness-runtime";
import { bootstrapKernel, disposeKernel, hotLoadPlugin, hotUnloadPlugin, startKernel, stopKernel } from "@yggdrasil/kernel";
import { initSessionStore, resetSessionStoreForTest } from "@yggdrasil/sessions";
import { readConfigFile } from "./config-io.js";
import {
  createPluginProject,
  parseCreatePluginArgs,
  scaffoldPlugin,
  type PluginKind,
} from "./create-plugin.js";
import { cmdInit, cmdPlugin } from "./plugin-commands.js";
import { cmdSkill } from "./skill-commands.js";
import { resolveWorkspaceRoot } from "./workspace.js";

async function loadConfig(): Promise<YggdrasilConfig> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const { config } = await readConfigFile(workspaceRoot);
  return config;
}

function printHelp(): void {
  console.log(`Yggdrasil — plug-and-play agent platform

Usage:
  yggdrasil init                           Create yggdrasil.config.json in cwd
  yggdrasil run                            Start gateway + all enabled channels
  yggdrasil tui                            Start gateway with TUI channel only (new isolated session, auto-connects if gateway already running)
    --continue                             Resume most recent TUI session for this path
    --connect <ws-url>                      Connect as client to an existing gateway
    --agent <id>                            Start pinned to a specific agent id
  yggdrasil voice                          Start gateway + realtime voice app (auto-connects if gateway already running)
    --port <n>                             Voice app HTTP port (default: 7860)
    --connect <ws-url>                      Connect as client to an existing gateway
  yggdrasil gateway                        Start gateway headless (no channels)
  yggdrasil plugin list                    List installed plugins
  yggdrasil plugin install <package>       npm/pnpm add + enable in config
  yggdrasil plugin enable <id>             Enable plugin by id
  yggdrasil plugin disable <id>            Disable plugin by id
  yggdrasil plugin create <name> [--kind]  Scaffold plugin in extensions/
  yggdrasil create-plugin <name>           Alias for plugin create
    --kind channel|tool|harness|provider|skill  Plugin kind (default: tool)
  yggdrasil skill install <spec>           Install skill from npm or GitHub
  yggdrasil skill list                     List installed skills
  yggdrasil help                           Show this help
`);
}

async function bootstrap(options?: {
  channelConfig?: YggdrasilConfig["channels"];
  hotReload?: boolean;
}): Promise<YggdrasilConfig> {
  registerBuiltinHarnesses();
  const workspaceRoot = await resolveWorkspaceRoot();
  const base = await loadConfig();
  // Lets a parent process (e.g. app-desktop, running one gateway per open
  // project) pin the port without needing a config file edit — same
  // env-var-overrides-config-file convention YGGDRASIL_WORKSPACE already
  // uses for workspaceRoot. YGGDRASIL_GATEWAY_HOST follows the same
  // convention — app-desktop sets it to "0.0.0.0" so the gateway subprocess
  // binds every interface (loopback + LAN + Tailscale) instead of editing
  // every project's yggdrasil.config.json (remote-access-analysis.md §7.4).
  const envPort = process.env.YGGDRASIL_GATEWAY_PORT?.trim();
  const envHost = process.env.YGGDRASIL_GATEWAY_HOST?.trim();
  const gatewayOverride =
    envPort || envHost
      ? { ...(envPort ? { port: Number(envPort) } : {}), ...(envHost ? { host: envHost } : {}) }
      : undefined;
  const config = mergeConfig(base, { channels: options?.channelConfig, gateway: gatewayOverride });
  initSessionStore(config);
  await bootstrapKernel({
    config,
    workspaceRoot,
  });
  await startKernel();

  if (options?.hotReload !== false) {
    try {
      watchPlugins(workspaceRoot, config.plugins?.installed ?? []);
    } catch {
      // non-fatal: hot-reload disabled if config file doesn't exist yet
    }
  }

  return config;
}

function watchPlugins(workspaceRoot: string, initialInstalled: string[]): void {
  const configPath = join(workspaceRoot, "yggdrasil.config.json");
  let prev = new Set(initialInstalled);
  let debounce: ReturnType<typeof setTimeout> | null = null;

  watch(configPath, { persistent: false }, () => {
    if (debounce) clearTimeout(debounce);
    debounce = setTimeout(() => {
      void (async () => {
        try {
          const { config: newConfig } = await readConfigFile(workspaceRoot);
          const next = new Set(newConfig.plugins?.installed ?? []);

          for (const id of next) {
            if (!prev.has(id)) {
              const result = await hotLoadPlugin(id);
              if (!result.success) {
                console.warn(`[yggdrasil] hot-reload failed for "${id}": ${result.error ?? "unknown"}`);
              }
            }
          }

          for (const id of prev) {
            if (!next.has(id)) {
              await hotUnloadPlugin(id);
            }
          }

          prev = next;
        } catch {
          // config read failed — skip this cycle
        }
      })();
    }, 200);
  });
}

function isPortInUse(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const socket = createConnection({ host, port });
    socket.once("connect", () => { socket.destroy(); resolve(true); });
    socket.once("error", () => resolve(false));
  });
}

function isYggdrasilGateway(host: string, port: number): Promise<boolean> {
  return new Promise((resolve) => {
    const req = http.get(`http://${host}:${port}/`, { timeout: 2000 }, (res) => {
      let body = "";
      res.on("data", (chunk: Buffer) => { body += String(chunk); });
      res.on("end", () => {
        try {
          const json = JSON.parse(body) as { service?: string };
          resolve(json.service === "yggdrasil-gateway");
        } catch {
          resolve(false);
        }
      });
    });
    req.on("error", () => resolve(false));
    req.on("timeout", () => { req.destroy(); resolve(false); });
  });
}

async function startServer(
  config: YggdrasilConfig,
  options: { startChannels: boolean; approveTool?: ToolApprovalHandler },
): Promise<Awaited<ReturnType<typeof startGatewayServer>>> {
  const workspaceRoot = await resolveWorkspaceRoot();
  const server = await startGatewayServer({
    config,
    workspaceRoot,
    startChannels: options.startChannels,
    approveTool: options.approveTool,
  });
  const host = config.gateway?.host ?? "127.0.0.1";
  console.log(`Console: http://${host}:${server.port}/ui`);
  return server;
}

function buildApprovalHandler(config: YggdrasilConfig, hasTui: boolean): ToolApprovalHandler | undefined {
  const policy = config.harness?.toolApproval ?? "destructive-only";
  if (policy === "never") return undefined;
  if (hasTui) {
    const prompt = createTuiApprovalPrompt();
    return async (req) => {
      if (policy === "destructive-only" && req.riskLevel !== "destructive") return true;
      return prompt(req.toolName, req.args);
    };
  }
  return undefined;
}

async function cmdRun(): Promise<void> {
  const config = await bootstrap({
    channelConfig: {
      tui: { enabled: true },
      http: { enabled: true, accounts: { default: { port: 18790 } } },
    },
  });

  const server = await startServer(config, {
    startChannels: true,
    approveTool: buildApprovalHandler(config, true),
  });
  console.log(`Gateway listening on http://${config.gateway?.host}:${server.port}`);
  console.log(`HTTP channel on http://127.0.0.1:18790/inbound`);

  const shutdown = async () => {
    await server.close();
    await stopKernel();
    await disposeKernel();
    resetSessionStoreForTest();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function cmdTuiLegacy(): Promise<void> {
  const config = await bootstrap({
    channelConfig: {
      tui: { enabled: true },
      http: { enabled: false },
    },
  });

  const server = await startServer(config, {
    startChannels: true,
    approveTool: buildApprovalHandler(config, true),
  });
  console.log(`TUI channel active (gateway :${server.port})`);

  const shutdown = async () => {
    await server.close();
    await stopKernel();
    await disposeKernel();
    resetSessionStoreForTest();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function cmdVoice(args: string[]): Promise<void> {
  const portIdx = args.indexOf("--port");
  const voicePort = portIdx >= 0 ? Number(args[portIdx + 1]) : 7860;

  const connectIdx = args.indexOf("--connect");
  const explicitConnectUrl = connectIdx >= 0 ? args[connectIdx + 1] : undefined;

  // Same env vars the original Python prototype used — no config-file schema
  // for these, they're deploy-time secrets/URLs, not persisted settings.
  const loadBalancerUrl = process.env.LOAD_BALANCER_URL?.trim() ?? "";
  const serperApiKey = process.env.SERPER_API_KEY?.trim() ?? "";
  const gatewayApiKey = process.env.YGGDRASIL_API_KEY?.trim() ?? "";

  const workspaceRoot = await resolveWorkspaceRoot();

  const connectUrl = explicitConnectUrl ?? (await (async () => {
    const existing = await loadConfig();
    const host = existing.gateway?.host ?? "127.0.0.1";
    const port = existing.gateway?.port ?? 18789;
    const alive = await probeGateway(host, port);
    return alive ? `ws://${host}:${port}` : undefined;
  })());

  if (connectUrl) {
    const { launchVoice } = await import("@yggdrasil/app-voice");
    const app = await launchVoice({ gatewayUrl: connectUrl, gatewayApiKey, port: voicePort, loadBalancerUrl, serperApiKey });
    console.log(`Voice app: http://127.0.0.1:${app.port}/`);
    console.log(`Connected to existing gateway at ${connectUrl}`);
    return;
  }

  // If gateway already running on configured port, attach without starting a new one
  const { config: rawConfig } = await readConfigFile(workspaceRoot);
  const host = rawConfig.gateway?.host ?? "127.0.0.1";
  const port = rawConfig.gateway?.port ?? 18789;

  if (await isPortInUse(host, port)) {
    if (await isYggdrasilGateway(host, port)) {
      const { launchVoice } = await import("@yggdrasil/app-voice");
      const app = await launchVoice({
        gatewayUrl: `ws://${host}:${port}`,
        gatewayApiKey,
        port: voicePort,
        loadBalancerUrl,
        serperApiKey,
      });
      console.log(`Voice app: http://127.0.0.1:${app.port}/`);
      console.log(`Connected to existing gateway at ws://${host}:${port}`);
      return;
    }
    // Port in use but not our gateway — fall through to start fresh (EADDRINUSE → clear error)
  }

  // Start own gateway
  const config = await bootstrap({
    channelConfig: {
      tui: { enabled: false },
      http: { enabled: false },
    },
  });

  const server = await startServer(config, { startChannels: true });
  const gatewayUrl = `ws://${host}:${server.port}`;

  const { launchVoice } = await import("@yggdrasil/app-voice");
  const app = await launchVoice({ gatewayUrl, gatewayApiKey, port: voicePort, loadBalancerUrl, serperApiKey });
  console.log(`Gateway listening on ${gatewayUrl}`);
  console.log(`Voice app: http://127.0.0.1:${app.port}/`);

  const shutdown = async () => {
    await app.close();
    await server.close();
    await stopKernel();
    await disposeKernel();
    resetSessionStoreForTest();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

function workspaceSenderPrefix(workspaceRoot: string): string {
  return createHash("sha256").update(workspaceRoot).digest("hex").slice(0, 8);
}

async function probeGateway(host: string, port: number): Promise<boolean> {
  try {
    const response = await fetch(`http://${host}:${port}/`, { signal: AbortSignal.timeout(800) });
    if (!response.ok) return false;
    const body = (await response.json()) as { service?: string };
    return body.service === "yggdrasil-gateway";
  } catch {
    return false;
  }
}

async function cmdTui(args: string[]): Promise<void> {
  if (args.includes("--legacy")) {
    return cmdTuiLegacy();
  }

  const continueSession = args.includes("--continue");
  const connectIdx = args.indexOf("--connect");
  const explicitConnectUrl = connectIdx >= 0 ? args[connectIdx + 1] : undefined;
  const agentIdx = args.indexOf("--agent");
  const agentId = agentIdx >= 0 ? args[agentIdx + 1] : undefined;
  const sessionIdx = args.indexOf("--session");
  const sessionKey = sessionIdx >= 0 ? args[sessionIdx + 1] : undefined;
  const readOnly = args.includes("--readonly");

  const workspaceRoot = await resolveWorkspaceRoot();
  const senderIdPrefix = workspaceSenderPrefix(workspaceRoot);

  const connectUrl = explicitConnectUrl ?? (await (async () => {
    const existing = await loadConfig();
    const host = existing.gateway?.host ?? "127.0.0.1";
    const port = existing.gateway?.port ?? 18789;
    const alive = await probeGateway(host, port);
    return alive ? `ws://${host}:${port}` : undefined;
  })());

  if (connectUrl) {
    const { launchTui } = await import("@yggdrasil/app-tui");
    await launchTui({ gatewayUrl: connectUrl, senderIdPrefix, continueSession, agentId, sessionKey, readOnly });
    return;
  }

  // If gateway already running on configured port, attach without starting a new one
  const { config: rawConfig } = await readConfigFile(workspaceRoot);
  const host = rawConfig.gateway?.host ?? "127.0.0.1";
  const port = rawConfig.gateway?.port ?? 18789;

  if (await isPortInUse(host, port)) {
    if (await isYggdrasilGateway(host, port)) {
      const { launchTui } = await import("@yggdrasil/app-tui");
      await launchTui({ gatewayUrl: `ws://${host}:${port}`, senderIdPrefix, continueSession, agentId, sessionKey, readOnly });
      return;
    }
    // Port in use but not our gateway — fall through to start fresh (EADDRINUSE → clear error)
  }

  // Start own gateway
  const config = await bootstrap({
    channelConfig: {
      tui: { enabled: false },
      http: { enabled: false },
    },
  });

  const server = await startServer(config, { startChannels: true });
  const gatewayUrl = `ws://${host}:${server.port}`;

  const { launchTui } = await import("@yggdrasil/app-tui");
  const cleanup = await launchTui({ gatewayUrl, senderIdPrefix, continueSession, agentId, sessionKey, readOnly });

  const shutdown = async () => {
    if (cleanup) cleanup();
    await server.close();
    await stopKernel();
    await disposeKernel();
    resetSessionStoreForTest();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function cmdGateway(): Promise<void> {
  const config = await bootstrap();
  const server = await startServer(config, { startChannels: false });
  console.log(`Gateway (headless) on http://${config.gateway?.host}:${server.port}`);

  const shutdown = async () => {
    await server.close();
    await stopKernel();
    await disposeKernel();
    resetSessionStoreForTest();
    process.exit(0);
  };

  process.on("SIGINT", shutdown);
  process.on("SIGTERM", shutdown);
}

async function cmdCreatePlugin(argv: string[]): Promise<void> {
  const { name, kind } = parseCreatePluginArgs(argv);
  if (!name) {
    console.error("Plugin name required. Example: yggdrasil create-plugin my-tool --kind tool");
    process.exit(1);
  }

  const validKinds: PluginKind[] = ["channel", "tool", "harness", "provider"];
  if (!validKinds.includes(kind)) {
    console.error(`Invalid --kind ${kind}. Use: ${validKinds.join(", ")}`);
    process.exit(1);
  }

  const workspaceRoot = await resolveWorkspaceRoot();
  const dir = await scaffoldPlugin(workspaceRoot, name, kind);
  console.log(`Created ${kind} plugin at ${dir}`);
  console.log(`Next: cd ${dir} && pnpm install && pnpm build`);
}

async function main(): Promise<void> {
  const [command, sub, ...rest] = process.argv.slice(2);

  switch (command) {
    case "init":
      await cmdInit();
      break;
    case "run":
      await cmdRun();
      break;
    case "tui":
      await cmdTui([sub, ...rest].filter(Boolean) as string[]);
      break;
    case "voice":
      await cmdVoice([sub, ...rest].filter(Boolean) as string[]);
      break;
    case "gateway":
      await cmdGateway();
      break;
    case "plugin":
      await cmdPlugin([sub, ...rest].filter(Boolean) as string[]);
      break;
    case "skill":
      await cmdSkill([sub, ...rest].filter(Boolean) as string[]);
      break;
    case "create-plugin":
      await cmdCreatePlugin([sub, ...rest].filter((a) => a !== undefined));
      break;
    case "help":
    case "--help":
    case "-h":
    case undefined:
      printHelp();
      break;
    default:
      console.error(`Unknown command: ${command}`);
      printHelp();
      process.exit(1);
  }
}

main().catch((err: unknown) => {
  const code = (err as NodeJS.ErrnoException).code;
  if (code === "EADDRINUSE") {
    console.error(`Error: port already in use. Kill the existing process or change gateway.port in yggdrasil.config.json.`);
  } else {
    console.error(err);
  }
  process.exit(1);
});

export { createPluginProject, scaffoldPlugin };
