import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useI18n } from "../i18n/index.js";
import type { Condition, OnError, WfNode } from "./types.js";

type Props = {
  node: WfNode;
  /** Every node in the workflow — only used by `loop`'s resultNodeId picker, to list real candidate body nodes instead of a free-text id field. */
  allNodes: WfNode[];
  onChange: (node: WfNode) => void;
  onDelete: () => void;
  onClose: () => void;
};

const CONDITION_OPS = ["eq", "neq", "contains", "gt", "lt", "exists", "matches"] as const;

function simpleCondition(condition: Condition | undefined): Extract<Condition, { op: unknown }> {
  return condition && "op" in condition ? condition : { op: "eq", left: "", right: "" };
}

type SwitchCase = { case: string; condition: Extract<Condition, { op: unknown }> };

function switchCases(params: Record<string, unknown>): SwitchCase[] {
  return Array.isArray(params.cases) ? (params.cases as SwitchCase[]) : [];
}

function ConditionFields({ condition, onChange }: { condition: Extract<Condition, { op: unknown }>; onChange: (c: Extract<Condition, { op: unknown }>) => void }) {
  const { t } = useI18n();
  return (
    <div className="workflow-condition-row">
      <input value={condition.left} placeholder={t("wf.drawer.leftPlaceholder")} onChange={(e) => onChange({ ...condition, left: e.target.value })} />
      <select value={condition.op} onChange={(e) => onChange({ ...condition, op: e.target.value as Extract<Condition, { op: unknown }>["op"] })}>
        {CONDITION_OPS.map((op) => (
          <option key={op} value={op}>
            {op}
          </option>
        ))}
      </select>
      {condition.op !== "exists" && (
        <input value={String(condition.right ?? "")} placeholder={t("wf.drawer.rightPlaceholder")} onChange={(e) => onChange({ ...condition, right: e.target.value })} />
      )}
    </div>
  );
}

/**
 * Slide-in panel for one node's params — same shape as
 * agentFlow/NodeConfigDrawer.tsx (per-type hand-written fields, one big
 * `onChange` callback up to the parent), scoped to the node types this build
 * actually has executors for (if/set/delay/switch/http.request/agent.ask/
 * loop/phone.tool — see extensions/service-workflows/src/nodeTypes.ts). A node's `type` is
 * fixed at creation (WorkflowsView's "+ Add Node" picker); this only edits
 * params. `loop`'s resultNodeId picker doesn't restrict its options to the
 * loop's actual subgraph (the renderer doesn't compute reachability) — a
 * wrong pick surfaces as a real error from workflows.save's validateWorkflow.
 */
export function NodeConfigDrawer({ node, allNodes, onChange, onDelete, onClose }: Props) {
  const { t } = useI18n();
  const setParams = (params: Record<string, unknown>) => onChange({ ...node, params });
  const [newCaseLabel, setNewCaseLabel] = useState("");

  return (
    <div className="agent-flow-sidebar workflow-drawer">
      <div className="mcp-server-header">
        <h3>{node.type}</h3>
        <button type="button" className="icon-btn" onClick={onClose} title={t("wf.drawer.close")}>
          ×
        </button>
      </div>

      <label>
        {t("wf.drawer.name")}
        <input value={node.name} onChange={(e) => onChange({ ...node, name: e.target.value })} />
      </label>

      {node.type === "if" && (
        <>
          <p className="muted">{t("wf.drawer.ifHint")}</p>
          <ConditionFields condition={simpleCondition(node.params.condition as Condition | undefined)} onChange={(condition) => setParams({ condition })} />
        </>
      )}

      {node.type === "switch" && (
        <>
          <p className="muted">{t("wf.drawer.switchHint")}</p>
          {switchCases(node.params).map((c, i) => (
            <div key={i} className="workflow-drawer">
              <div className="mcp-server-header">
                <strong>case:{c.case}</strong>
                <button
                  type="button"
                  className="icon-btn"
                  title={t("wf.drawer.removeCase")}
                  onClick={() => {
                    const cases = switchCases(node.params).filter((_, idx) => idx !== i);
                    setParams({ ...node.params, cases });
                  }}
                >
                  <XMarkIcon className="hero-icon" />
                </button>
              </div>
              <ConditionFields
                condition={c.condition}
                onChange={(condition) => {
                  const cases = switchCases(node.params).map((existing, idx) => (idx === i ? { ...existing, condition } : existing));
                  setParams({ ...node.params, cases });
                }}
              />
            </div>
          ))}
          <div className="workflow-condition-row">
            <input value={newCaseLabel} placeholder={t("wf.drawer.newCasePlaceholder")} onChange={(e) => setNewCaseLabel(e.target.value)} />
            <button
              type="button"
              disabled={!newCaseLabel.trim()}
              onClick={() => {
                const cases = [...switchCases(node.params), { case: newCaseLabel.trim(), condition: { op: "eq" as const, left: "", right: "" } }];
                setParams({ ...node.params, cases });
                setNewCaseLabel("");
              }}
            >
              {t("wf.drawer.addCase")}
            </button>
          </div>
        </>
      )}

      {node.type === "set" && (
        <>
          <label>
            {t("wf.drawer.varName")}
            <input value={String(node.params.name ?? "")} onChange={(e) => setParams({ ...node.params, name: e.target.value })} />
          </label>
          <label>
            {t("wf.drawer.value")}
            <input value={String(node.params.value ?? "")} onChange={(e) => setParams({ ...node.params, value: e.target.value })} />
          </label>
          <p className="muted">{t("wf.drawer.setHint", { expr: "{{ vars.<name> }}" })}</p>
        </>
      )}

      {node.type === "http.request" && (
        <>
          <label>
            URL
            <input value={String(node.params.url ?? "")} onChange={(e) => setParams({ ...node.params, url: e.target.value })} />
          </label>
          <label>
            {t("wf.drawer.method")}
            <select value={String(node.params.method ?? "GET")} onChange={(e) => setParams({ ...node.params, method: e.target.value })}>
              {["GET", "POST", "PUT", "PATCH", "DELETE"].map((m) => (
                <option key={m} value={m}>
                  {m}
                </option>
              ))}
            </select>
          </label>
          <p className="muted">{t("wf.drawer.httpHint")}</p>
          <label>
            {t("wf.drawer.headers")}
            <textarea
              rows={3}
              value={node.params.headers ? JSON.stringify(node.params.headers) : ""}
              placeholder='{"Authorization": "Bearer ..."}'
              onChange={(e) => {
                try {
                  setParams({ ...node.params, headers: e.target.value.trim() ? JSON.parse(e.target.value) : undefined });
                } catch {
                  // Leave params untouched while the JSON is mid-edit/invalid — next valid keystroke applies it.
                }
              }}
            />
          </label>
          <label>
            {t("wf.drawer.body")}
            <textarea
              rows={3}
              value={typeof node.params.body === "string" ? node.params.body : node.params.body !== undefined ? JSON.stringify(node.params.body) : ""}
              onChange={(e) => {
                try {
                  setParams({ ...node.params, body: e.target.value.trim() ? JSON.parse(e.target.value) : undefined });
                } catch {
                  setParams({ ...node.params, body: e.target.value });
                }
              }}
            />
          </label>
        </>
      )}

      {node.type === "agent.ask" && (
        <>
          <label>
            {t("wf.drawer.prompt")}
            <textarea rows={4} value={String(node.params.prompt ?? "")} onChange={(e) => setParams({ ...node.params, prompt: e.target.value })} />
          </label>
          <label>
            {t("wf.drawer.provider")}
            <select value={String(node.params.provider ?? "claude")} onChange={(e) => setParams({ ...node.params, provider: e.target.value })}>
              <option value="claude">claude</option>
              <option value="agy">agy</option>
            </select>
          </label>
          <div className="workflow-condition-row">
            <label>
              {t("wf.drawer.modelOptional")}
              <input value={String(node.params.model ?? "")} onChange={(e) => setParams({ ...node.params, model: e.target.value || undefined })} />
            </label>
            <label>
              {t("wf.drawer.effortOptional")}
              <input value={String(node.params.effort ?? "")} onChange={(e) => setParams({ ...node.params, effort: e.target.value || undefined })} />
            </label>
          </div>
          <label>
            {t("wf.drawer.outputFormat")}
            <select value={String(node.params.outputFormat ?? "text")} onChange={(e) => setParams({ ...node.params, outputFormat: e.target.value })}>
              <option value="text">text</option>
              <option value="json">json</option>
            </select>
          </label>
          <p className="muted">{t("wf.drawer.askHint")}</p>
        </>
      )}

      {node.type === "loop" && (
        <>
          <label>
            {t("wf.drawer.items", { expr: "{{ }}" })}
            <textarea
              rows={2}
              value={typeof node.params.items === "string" ? node.params.items : node.params.items !== undefined ? JSON.stringify(node.params.items) : ""}
              placeholder='[1, 2, 3] or {{ nodes.a.output.list }}'
              onChange={(e) => {
                const raw = e.target.value;
                try {
                  setParams({ ...node.params, items: raw.trim() ? JSON.parse(raw) : undefined });
                } catch {
                  setParams({ ...node.params, items: raw });
                }
              }}
            />
          </label>
          <p className="muted">{t("wf.drawer.loopHint")}</p>
          <label>
            {t("wf.drawer.resultNode")}
            <select value={String(node.params.resultNodeId ?? "")} onChange={(e) => setParams({ ...node.params, resultNodeId: e.target.value || undefined })}>
              <option value="">{t("wf.drawer.selectBody")}</option>
              {allNodes
                .filter((n) => n.id !== node.id)
                .map((n) => (
                  <option key={n.id} value={n.id}>
                    {n.name || n.id} ({n.type})
                  </option>
                ))}
            </select>
          </label>
        </>
      )}

      {node.type === "phone.tool" && (
        <>
          <label>
            {t("wf.drawer.deviceId")}
            <input value={String(node.params.deviceId ?? "")} onChange={(e) => setParams({ ...node.params, deviceId: e.target.value })} placeholder={t("wf.drawer.deviceIdPlaceholder")} />
          </label>
          <label>
            {t("wf.drawer.toolName")}
            <input value={String(node.params.tool ?? "")} onChange={(e) => setParams({ ...node.params, tool: e.target.value })} placeholder="e.g. phone_open_app" />
          </label>
          <label>
            {t("wf.drawer.args")}
            <textarea
              rows={3}
              value={node.params.args ? JSON.stringify(node.params.args) : ""}
              placeholder='{"app": "Calculator"}'
              onChange={(e) => {
                try {
                  setParams({ ...node.params, args: e.target.value.trim() ? JSON.parse(e.target.value) : undefined });
                } catch {
                  // Leave params untouched while the JSON is mid-edit/invalid.
                }
              }}
            />
          </label>
          <p className="muted">{t("wf.drawer.phoneHint")}</p>
        </>
      )}

      {node.type === "delay" && (
        <label>
          {t("wf.drawer.delayMs")}
          <input
            type="number"
            min={0}
            value={Number(node.params.ms ?? 0)}
            onChange={(e) => setParams({ ms: Number(e.target.value) })}
          />
        </label>
      )}

      <h4>{t("wf.drawer.onError")}</h4>
      <select value={node.onError ?? "fail"} onChange={(e) => onChange({ ...node, onError: e.target.value as OnError })}>
        <option value="fail">{t("wf.drawer.onErrorFail")}</option>
        <option value="continue">{t("wf.drawer.onErrorContinue")}</option>
        <option value="errorBranch">{t("wf.drawer.onErrorBranch")}</option>
      </select>

      <h4>{t("wf.drawer.retry")}</h4>
      <div className="workflow-condition-row">
        <label>
          {t("wf.drawer.maxAttempts")}
          <input
            type="number"
            min={0}
            value={node.retry?.max ?? 0}
            onChange={(e) => {
              const max = Number(e.target.value);
              onChange({ ...node, retry: max > 0 ? { max, backoffMs: node.retry?.backoffMs ?? 1000 } : undefined });
            }}
          />
        </label>
        {node.retry && (
          <label>
            {t("wf.drawer.backoff")}
            <input
              type="number"
              min={0}
              value={node.retry.backoffMs}
              onChange={(e) => onChange({ ...node, retry: { ...node.retry!, backoffMs: Number(e.target.value) } })}
            />
          </label>
        )}
      </div>

      <h4>{t("wf.drawer.timeout")}</h4>
      <input
        type="number"
        min={0}
        placeholder={t("wf.drawer.timeoutPlaceholder")}
        value={node.timeoutMs ?? ""}
        onChange={(e) => onChange({ ...node, timeoutMs: e.target.value ? Number(e.target.value) : undefined })}
      />

      <div className="agent-form-actions">
        <button type="button" className="danger" onClick={onDelete}>
          {t("wf.drawer.delete")}
        </button>
      </div>
    </div>
  );
}
