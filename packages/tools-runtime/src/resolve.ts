import { builtinTools } from "@yggdrasil/tool-builtin";
import type { AgentTool, ToolFactory } from "@yggdrasil/sdk";
import type { AgentToolDefinition, ToolContext } from "@yggdrasil/tools-sdk";
import { getRegistry } from "@yggdrasil/kernel";
import { clearToolRegistry, registerToolDefinition, listTools } from "./registry.js";

function isToolDefinition(reg: unknown): reg is AgentToolDefinition {
  return (
    typeof reg === "object" &&
    reg !== null &&
    "name" in reg &&
    "execute" in reg &&
    "parameters" in reg
  );
}

function legacyToolToDefinition(tool: AgentTool): AgentToolDefinition {
  return {
    name: tool.name,
    description: tool.description,
    parameters: { type: "object", properties: {} },
    execute: tool.execute,
  };
}

// Lets a host (the gateway) inject session-scoped tools it owns — currently
// device-tools registered by a connected phone — into the same registry the
// LLM tool loop reads from, without tools-runtime knowing anything about WS
// connections. Set once at gateway startup; resolveTools() re-queries it on
// every turn (right after the clear below) so device tools stay in sync with
// whatever's currently registered for that sessionKey.
export type DeviceToolProvider = (sessionKey: string) => AgentToolDefinition[];
let deviceToolProvider: DeviceToolProvider | null = null;
export function setDeviceToolProvider(provider: DeviceToolProvider | null): void {
  deviceToolProvider = provider;
}

/**
 * Same "host injects a hook, tools-runtime stays WS-agnostic" shape as
 * DeviceToolProvider above, for the opposite direction: a `phone.tool`
 * workflow node (extensions/service-workflows) invoking a device tool by
 * `deviceId` directly, outside any chat session/sessionKey. Set once at
 * gateway startup by service-workflows itself (the only current caller) —
 * see packages/gateway/src/methods.ts's invokeDeviceToolByDeviceId.
 *
 * `events` is passed in at CALL time, not bound once via closure at
 * registration time: the plugin-registration-time `api.events` (what
 * `register(api)` receives) is a separate, non-broadcast EventBus instance
 * from the real per-gateway-connection bus that packages/gateway/src/
 * server.ts actually listens on for forwarding to WS clients (see
 * packages/kernel/src/plugin-loader.ts's `loadPlugins`, which mints its own
 * bus). Binding the invoker to `api.events` at register() time silently
 * dead-letters every device-tool-invoke-requested event — nothing is ever
 * forwarded to the phone, and the call times out. The caller (phoneTool.ts)
 * must instead pass the real per-run events bus it received via
 * NodeExecutionContext.deviceEvents.
 */
export type DeviceToolInvoker = (events: unknown, deviceId: string, toolName: string, args: Record<string, unknown>) => Promise<unknown>;
let deviceToolInvoker: DeviceToolInvoker | null = null;
export function setDeviceToolInvoker(invoker: DeviceToolInvoker | null): void {
  deviceToolInvoker = invoker;
}
export function getDeviceToolInvoker(): DeviceToolInvoker | null {
  return deviceToolInvoker;
}

export async function resolveTools(ctx: ToolContext): Promise<AgentToolDefinition[]> {
  clearToolRegistry();

  for (const tool of builtinTools) {
    registerToolDefinition(tool);
  }

  const registry = getRegistry();
  for (const reg of registry.tools) {
    if (isToolDefinition(reg)) {
      registerToolDefinition(reg);
    } else {
      const factory = reg as ToolFactory;
      const legacy = await factory({ config: ctx.config });
      for (const tool of legacy) {
        registerToolDefinition(legacyToolToDefinition(tool));
      }
    }
  }

  if (deviceToolProvider) {
    for (const tool of deviceToolProvider(ctx.sessionKey)) {
      registerToolDefinition(tool);
    }
  }

  return listTools();
}
