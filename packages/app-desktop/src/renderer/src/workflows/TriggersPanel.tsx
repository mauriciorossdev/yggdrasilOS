import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
import { useI18n, type MessageKey } from "../i18n/index.js";
import type { Trigger } from "./types.js";

type Props = {
  triggers: Trigger[];
  onChange: (triggers: Trigger[]) => void;
  allowRemoteTrigger: boolean;
};

type NewTriggerType = Trigger["type"];

function defaultTrigger(type: NewTriggerType): Trigger {
  switch (type) {
    case "manual":
      return { id: crypto.randomUUID(), type: "manual" };
    case "schedule":
      return { id: crypto.randomUUID(), type: "schedule", cron: "0 0 9 * * *", timezone: Intl.DateTimeFormat().resolvedOptions().timeZone };
    case "event":
      return { id: crypto.randomUUID(), type: "event", event: "fs.changed" };
    case "webhook":
      return { id: crypto.randomUUID(), type: "webhook", secretRef: "YGG_WEBHOOK_SECRET", method: "POST" };
    case "mobile":
      return { id: crypto.randomUUID(), type: "mobile" };
  }
}

type Translate = (key: MessageKey, vars?: Record<string, string | number>) => string;

function summarize(trigger: Trigger, tr: Translate): string {
  switch (trigger.type) {
    case "manual":
      return tr("wf.triggers.summary.manual");
    case "schedule":
      return trigger.timezone
        ? tr("wf.triggers.summary.scheduleTz", { cron: trigger.cron, timezone: trigger.timezone })
        : tr("wf.triggers.summary.schedule", { cron: trigger.cron });
    case "event":
      return tr(trigger.filter ? "wf.triggers.summary.eventFiltered" : "wf.triggers.summary.event", { event: trigger.event });
    case "webhook":
      return tr("wf.triggers.summary.webhook", { method: trigger.method, secretRef: trigger.secretRef });
    case "mobile":
      return trigger.deviceId
        ? tr("wf.triggers.summary.mobileDevice", { deviceId: trigger.deviceId })
        : tr("wf.triggers.summary.mobileAny");
  }
}

/**
 * List-based editor for Workflow.triggers — same pattern as
 * agentFlow/ConnectionsPanel.tsx. No graphical trigger nodes on the canvas
 * (triggers aren't WfNodes); a workflow always keeps at least the implicit
 * "Run" button regardless of what's configured here.
 */
export function TriggersPanel({ triggers, onChange, allowRemoteTrigger }: Props) {
  const { t: tr } = useI18n();
  const [newType, setNewType] = useState<NewTriggerType>("schedule");

  const update = (id: string, patch: Partial<Trigger>) =>
    onChange(triggers.map((t) => (t.id === id ? ({ ...t, ...patch } as Trigger) : t)));
  const remove = (id: string) => onChange(triggers.filter((t) => t.id !== id));
  const add = () => onChange([...triggers, defaultTrigger(newType)]);

  return (
    <div className="agent-flow-sidebar workflow-drawer">
      <h3>{tr("wf.triggers.title")}</h3>
      {!allowRemoteTrigger && (
        <p className="muted">{tr("wf.triggers.remoteHint")}</p>
      )}

      <ul className="flow-connections-list">
        {triggers.map((trigger) => (
          <li key={trigger.id} className="workflow-trigger-row">
            <div>
              <div>{summarize(trigger, tr)}</div>
              {trigger.type === "schedule" && (
                <div className="workflow-condition-row">
                  <input value={trigger.cron} onChange={(e) => update(trigger.id, { cron: e.target.value })} placeholder={tr("wf.triggers.cronPlaceholder")} />
                  <input
                    value={trigger.timezone ?? ""}
                    onChange={(e) => update(trigger.id, { timezone: e.target.value || undefined })}
                    placeholder={tr("wf.triggers.timezonePlaceholder")}
                  />
                </div>
              )}
              {trigger.type === "event" && (
                <select value={trigger.event} onChange={(e) => update(trigger.id, { event: e.target.value as Extract<Trigger, { type: "event" }>["event"] })}>
                  <option value="fs.changed">fs.changed</option>
                  <option value="workflow.run.finished">workflow.run.finished</option>
                  <option value="turn.completed">turn.completed</option>
                </select>
              )}
              {trigger.type === "webhook" && (
                <div className="workflow-condition-row">
                  <input value={trigger.secretRef} onChange={(e) => update(trigger.id, { secretRef: e.target.value })} placeholder={tr("wf.triggers.envVarPlaceholder")} />
                  <select value={trigger.method} onChange={(e) => update(trigger.id, { method: e.target.value as "POST" | "GET" })}>
                    <option value="POST">POST</option>
                    <option value="GET">GET</option>
                  </select>
                </div>
              )}
              {trigger.type === "mobile" && (
                <input
                  value={trigger.deviceId ?? ""}
                  onChange={(e) => update(trigger.id, { deviceId: e.target.value || undefined })}
                  placeholder={tr("wf.triggers.deviceIdPlaceholder")}
                />
              )}
            </div>
            <button type="button" className="icon-btn" onClick={() => remove(trigger.id)} title={tr("wf.triggers.remove")}>
              <XMarkIcon className="hero-icon" />
            </button>
          </li>
        ))}
        {triggers.length === 0 && <li className="muted">{tr("wf.triggers.none")}</li>}
      </ul>

      <div className="flow-connection-form">
        <select value={newType} onChange={(e) => setNewType(e.target.value as NewTriggerType)}>
          <option value="schedule">{tr("wf.triggers.type.schedule")}</option>
          <option value="event">{tr("wf.triggers.type.event")}</option>
          <option value="webhook">{tr("wf.triggers.type.webhook")}</option>
          <option value="mobile">{tr("wf.triggers.type.mobile")}</option>
          <option value="manual">{tr("wf.triggers.type.manual")}</option>
        </select>
        <button type="button" onClick={add}>
          {tr("wf.triggers.add")}
        </button>
      </div>
    </div>
  );
}
