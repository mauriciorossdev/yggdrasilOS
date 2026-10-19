import { logicNodeExecutors, type NodeExecutor } from "@yggdrasil/workflows";
import { deviceToolRiskLevel } from "@yggdrasil/gateway";
import { httpRequestExecutor } from "./nodes/http.js";
import { agentAskExecutor } from "./nodes/agentAsk.js";
import { phoneToolExecutor } from "./nodes/phoneTool.js";

export type NodeTypeInfo = {
  type: string;
  description: string;
  target: "gateway";
  riskLevel: "safe" | "moderate" | "destructive";
  paramsSchema: { type: "object"; properties: Record<string, unknown>; required?: string[] };
};

const CONDITION_SCHEMA = {
  type: "object",
  description: "A structured condition — see notes/automation/workflows-design.md §3. Not a boolean expression string.",
};

/**
 * Logic (if/set/delay/switch/loop), http.request, agent.ask, and
 * phone.tool — only `desktop.*` node types remain for a later phase.
 * `loop`'s own executor lives in @yggdrasil/workflows (logicNodeExecutors),
 * not here — see packages/workflows/src/nodes/loop.ts and loopGraph.ts.
 */
export const NODE_TYPES: NodeTypeInfo[] = [
  {
    type: "if",
    description: "Evaluates a condition and routes to \"true\" or \"false\".",
    target: "gateway",
    riskLevel: "safe",
    paramsSchema: { type: "object", properties: { condition: CONDITION_SCHEMA }, required: ["condition"] },
  },
  {
    type: "set",
    description: "Assigns a value into the run's vars, readable downstream as {{ vars.<name> }}.",
    target: "gateway",
    riskLevel: "safe",
    paramsSchema: {
      type: "object",
      properties: { name: { type: "string" }, value: {} },
      required: ["name", "value"],
    },
  },
  {
    type: "delay",
    description: "Waits before continuing. Capped at 1 hour.",
    target: "gateway",
    riskLevel: "safe",
    paramsSchema: { type: "object", properties: { ms: { type: "number", minimum: 0 } }, required: ["ms"] },
  },
  {
    type: "switch",
    description: "Evaluates an ordered list of {case, condition} pairs and routes to the first match's \"case:<value>\", or \"default\" if none match.",
    target: "gateway",
    riskLevel: "safe",
    paramsSchema: {
      type: "object",
      properties: { cases: { type: "array", items: { type: "object", properties: { case: { type: "string" }, condition: CONDITION_SCHEMA } } } },
      required: ["cases"],
    },
  },
  {
    type: "http.request",
    description: "Makes an HTTP request (30s timeout, 5MB response cap). GET is safe; every other method needs a grant.",
    target: "gateway",
    // The catalog-level value is the conservative default shown before a
    // method is chosen — the real, param-aware check a grant is checked
    // against is riskLevelForNode() below, not this field.
    riskLevel: "moderate",
    paramsSchema: {
      type: "object",
      properties: {
        url: { type: "string" },
        method: { type: "string", enum: ["GET", "POST", "PUT", "PATCH", "DELETE"] },
        headers: { type: "object" },
        body: {},
      },
      required: ["url"],
    },
  },
  {
    type: "agent.ask",
    description: "One-shot completion from a local CLI coding agent (claude by default) — prompt in, text out. No tools allowlist (the CLI has its own full local access) and no image attachments (workflows-design.md §6.3's tools param is intentionally unsupported — see nodeTypes/agentAsk.ts).",
    target: "gateway",
    riskLevel: "moderate",
    paramsSchema: {
      type: "object",
      properties: {
        prompt: { type: "string" },
        provider: { type: "string", enum: ["claude", "agy"], description: "Default \"claude\"." },
        model: { type: "string" },
        effort: { type: "string" },
        outputFormat: { type: "string", enum: ["text", "json"] },
        timeoutMs: { type: "number", minimum: 0, description: "Default 5 minutes." },
      },
      required: ["prompt"],
    },
  },
  {
    type: "loop",
    description: "Iterates `items` (an array), running the subgraph attached to its \"each\" edge once per item, in sequence (cap 100). Fires \"done\" with { results } once all iterations finish — results[i] is the body node named by `resultNodeId`'s output for that iteration.",
    target: "gateway",
    riskLevel: "safe",
    paramsSchema: {
      type: "object",
      properties: {
        items: { type: "array" },
        resultNodeId: { type: "string", description: "Id of the body node whose output becomes each iteration's result." },
      },
      required: ["items", "resultNodeId"],
    },
  },
  {
    type: "phone.tool",
    description: "Invokes a phone_* device tool on a specific connected phone, by its stable deviceId (not a sessionKey — a workflow run has none). Which tools exist is discovered per-device at connect time, not known statically — riskLevel is looked up per `tool` from the same table chat's device tools use (workflows-design.md §4's \"según DEVICE_TOOL_RISK_LEVELS\").",
    target: "gateway",
    // Same posture as http.request: the catalog value is the conservative
    // default before `tool` is known — riskLevelForNode() below does the
    // real, param-aware lookup the grant preflight checks against.
    riskLevel: "destructive",
    paramsSchema: {
      type: "object",
      properties: {
        deviceId: { type: "string" },
        tool: { type: "string", description: "e.g. \"phone_open_app\", \"phone_set_alarm\"." },
        args: { type: "object" },
      },
      required: ["deviceId", "tool"],
    },
  },
];

export const KNOWN_NODE_TYPES: ReadonlySet<string> = new Set(NODE_TYPES.map((n) => n.type));

export const NODE_EXECUTORS: Record<string, NodeExecutor> = {
  ...logicNodeExecutors,
  "http.request": httpRequestExecutor,
  "agent.ask": agentAskExecutor,
  "phone.tool": phoneToolExecutor,
};

const NODE_TYPES_BY_TYPE = new Map(NODE_TYPES.map((n) => [n.type, n]));

/**
 * A node type this build doesn't know about counts as `destructive`
 * (workflows-design.md §2.1 "Un tool desconocido cuenta como destructive") —
 * fails closed for the grant preflight (run.ts) rather than assuming safe.
 */
export function riskLevelForNodeType(type: string): "safe" | "moderate" | "destructive" {
  return NODE_TYPES_BY_TYPE.get(type)?.riskLevel ?? "destructive";
}

/**
 * Param-aware risk, for node types whose actual risk depends on their
 * config rather than just their type — today only `http.request`
 * (workflows-design.md §4: "GET safe / otros moderate"). This is what the
 * grant preflight (run.ts's computeRiskyNodes) actually checks against;
 * `riskLevelForNodeType` stays the simple type-only lookup other callers
 * (the nodeTypes catalog itself) still want.
 */
export function riskLevelForNode(node: { type: string; params: Record<string, unknown> }): "safe" | "moderate" | "destructive" {
  if (node.type === "http.request") {
    const method = typeof node.params.method === "string" ? node.params.method.toUpperCase() : "GET";
    return method === "GET" ? "safe" : "moderate";
  }
  if (node.type === "phone.tool") {
    const tool = typeof node.params.tool === "string" ? node.params.tool : "";
    return tool ? deviceToolRiskLevel(tool) : "destructive";
  }
  return riskLevelForNodeType(node.type);
}
