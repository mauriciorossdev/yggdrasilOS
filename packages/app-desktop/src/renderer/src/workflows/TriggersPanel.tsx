import { useState } from "react";
import { XMarkIcon } from "@heroicons/react/20/solid";
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

function summarize(trigger: Trigger): string {
  switch (trigger.type) {
    case "manual":
      return "Manual — run button only";
    case "schedule":
      return `Schedule — "${trigger.cron}"${trigger.timezone ? ` (${trigger.timezone})` : ""}`;
    case "event":
      return `Event — ${trigger.event}${trigger.filter ? " (filtered)" : ""}`;
    case "webhook":
      return `Webhook — ${trigger.method} /hooks/workflows/<id>, secret env var "${trigger.secretRef}"`;
    case "mobile":
      return `Mobile${trigger.deviceId ? ` — device ${trigger.deviceId}` : " — any paired device"}`;
  }
}

/**
 * List-based editor for Workflow.triggers — same pattern as
 * agentFlow/ConnectionsPanel.tsx. No graphical trigger nodes on the canvas
 * (triggers aren't WfNodes); a workflow always keeps at least the implicit
 * "Run" button regardless of what's configured here.
 */
export function TriggersPanel({ triggers, onChange, allowRemoteTrigger }: Props) {
  const [newType, setNewType] = useState<NewTriggerType>("schedule");

  const update = (id: string, patch: Partial<Trigger>) =>
    onChange(triggers.map((t) => (t.id === id ? ({ ...t, ...patch } as Trigger) : t)));
  const remove = (id: string) => onChange(triggers.filter((t) => t.id !== id));
  const add = () => onChange([...triggers, defaultTrigger(newType)]);

  return (
    <div className="agent-flow-sidebar workflow-drawer">
      <h3>Triggers</h3>
      {!allowRemoteTrigger && (
        <p className="muted">Webhook and mobile triggers need "Allow remote trigger" on in Settings below to actually fire.</p>
      )}

      <ul className="flow-connections-list">
        {triggers.map((trigger) => (
          <li key={trigger.id} className="workflow-trigger-row">
            <div>
              <div>{summarize(trigger)}</div>
              {trigger.type === "schedule" && (
                <div className="workflow-condition-row">
                  <input value={trigger.cron} onChange={(e) => update(trigger.id, { cron: e.target.value })} placeholder="sec min hour dom month dow" />
                  <input
                    value={trigger.timezone ?? ""}
                    onChange={(e) => update(trigger.id, { timezone: e.target.value || undefined })}
                    placeholder="timezone (optional)"
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
                  <input value={trigger.secretRef} onChange={(e) => update(trigger.id, { secretRef: e.target.value })} placeholder="env var name" />
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
                  placeholder="deviceId (optional — blank = any paired device)"
                />
              )}
            </div>
            <button type="button" className="icon-btn" onClick={() => remove(trigger.id)} title="Remove trigger">
              <XMarkIcon className="hero-icon" />
            </button>
          </li>
        ))}
        {triggers.length === 0 && <li className="muted">No triggers — this workflow only runs from the Run button.</li>}
      </ul>

      <div className="flow-connection-form">
        <select value={newType} onChange={(e) => setNewType(e.target.value as NewTriggerType)}>
          <option value="schedule">Schedule</option>
          <option value="event">Event</option>
          <option value="webhook">Webhook</option>
          <option value="mobile">Mobile</option>
          <option value="manual">Manual</option>
        </select>
        <button type="button" onClick={add}>
          + Add trigger
        </button>
      </div>
    </div>
  );
}
