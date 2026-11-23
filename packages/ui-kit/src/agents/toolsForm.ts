import type { AgentInfo } from "../types.js";

/** Form-side view of AgentConfig.tools: omitted = every tool, `{ allow: [] }` = no tools at all. */
export type ToolsFormState = { toolsRestricted: boolean; toolsAllow: string };

export const EMPTY_TOOLS_FORM: ToolsFormState = { toolsRestricted: false, toolsAllow: "" };

export function toolsToForm(tools: AgentInfo["tools"]): ToolsFormState {
  if (!tools?.allow) return EMPTY_TOOLS_FORM;
  return { toolsRestricted: true, toolsAllow: tools.allow.join(", ") };
}

export function parseToolsAllow(text: string): string[] {
  return text
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);
}

/**
 * What to send as `tools`. An update always sends it, so unticking the restriction sends `{}`
 * (clears it); a create omits it when unrestricted instead of storing an empty object.
 */
export function toolsPayload(form: ToolsFormState, isUpdate: boolean): { tools?: { allow?: string[] } } {
  if (form.toolsRestricted) return { tools: { allow: parseToolsAllow(form.toolsAllow) } };
  return isUpdate ? { tools: {} } : {};
}
