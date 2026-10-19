import { getDeviceToolInvoker } from "@yggdrasil/tools-runtime";
import type { NodeExecutor } from "@yggdrasil/workflows";

/**
 * `phone.tool` — one generic node type for every phone_* device tool,
 * instead of a node type per tool name (workflows-design.md §4's catalog
 * lists `phone.<tool>`, but a per-tool static catalog entry doesn't work
 * here: which tools exist is discovered per-device at connect time, not
 * known ahead of time the way http.request's method or agent.ask's provider
 * are — see the design doc note added when this was implemented). `params`:
 * `{deviceId, tool, args?}`. Risk is looked up server-side from the same
 * DEVICE_TOOL_RISK_LEVELS table chat's device tools already use — see
 * nodeTypes.ts's riskLevelForNode, not this file (this executor only runs
 * once a grant already covers it).
 */
export const phoneToolExecutor: NodeExecutor = async ({ params, deviceEvents }) => {
  const deviceId = typeof params.deviceId === "string" ? params.deviceId.trim() : "";
  if (!deviceId) throw new Error("phone.tool node requires a `deviceId` param");
  const tool = typeof params.tool === "string" ? params.tool.trim() : "";
  if (!tool) throw new Error("phone.tool node requires a `tool` param");
  const args = (params.args ?? {}) as Record<string, unknown>;

  const invoke = getDeviceToolInvoker();
  if (!invoke) throw new Error("phone.tool: no device-tool invoker registered on this gateway");

  // The real per-run broadcast bus (see executor.ts's RunWorkflowOptions.
  // deviceEvents doc comment) — required so the invoke request actually
  // reaches the phone's WS connection instead of a dead, registration-time
  // bus nobody forwards from.
  const output = await invoke(deviceEvents, deviceId, tool, args);
  return { handle: "out", output };
};
