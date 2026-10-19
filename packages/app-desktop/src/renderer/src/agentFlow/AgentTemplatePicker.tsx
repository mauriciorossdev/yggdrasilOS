import { useEffect, useState } from "react";
import { AGENT_TEMPLATES, GAME_DEV_TEMPLATES } from "./agentTemplates.js";
import type { CustomFlowTemplate } from "../types.js";

type Props = {
  value: string;
  onChange: (next: string) => void;
  /** Selecting a role also drops a connected node for it onto the canvas (AgentFlowView.tsx) — omit to keep this picker text-only (block insertion into `value` alone). */
  onCreateRoleNode?: (role: { label: string; prompt: string }) => void;
};

function markerFor(label: string): string {
  return `--- Role: ${label} ---`;
}

function blockFor(label: string, prompt: string): string {
  return `\n\n${markerFor(label)}\n${prompt}\n`;
}

/**
 * Row of selectable role-template chips rendered below a node's Initial
 * Prompt textarea (NodeConfigDrawer.tsx). "Selected" isn't its own stored
 * field — it's derived by scanning `value` for each template's marker, so
 * a chip's active state always reflects what's actually still in the text,
 * including after the user hand-edits or removes a pasted block themselves.
 *
 * Three sections: General (AGENT_TEMPLATES), Game Dev (GAME_DEV_TEMPLATES),
 * and Custom (user-saved via "+ Custom role", persisted globally across
 * projects — see main/flowTemplates.ts).
 *
 * Selecting a role for the first time (not un-toggling) also asks the
 * canvas to drop a connected node for it via `onCreateRoleNode`, if given —
 * the picked role becomes visible on the flow, not just text buried in this
 * node's own prompt. Un-toggling only removes the text block; it never
 * deletes that node (it may have been renamed/edited/extended since).
 */
export function AgentTemplatePicker({ value, onChange, onCreateRoleNode }: Props) {
  const [customTemplates, setCustomTemplates] = useState<CustomFlowTemplate[]>([]);
  const [savingCustom, setSavingCustom] = useState(false);
  const [newCustomLabel, setNewCustomLabel] = useState("");

  useEffect(() => {
    void window.yggdrasil.flowTemplates.listCustom().then(setCustomTemplates);
  }, []);

  type PickableTemplate = { id: string; label: string; summary?: string; prompt: string };
  const allTemplates: PickableTemplate[] = [...AGENT_TEMPLATES, ...GAME_DEV_TEMPLATES, ...customTemplates];

  const toggle = (id: string) => {
    const template = allTemplates.find((t) => t.id === id);
    if (!template) return;
    const marker = markerFor(template.label);
    const markerIndex = value.indexOf(marker);
    if (markerIndex === -1) {
      onChange(value + blockFor(template.label, template.prompt));
      onCreateRoleNode?.({ label: template.label, prompt: template.prompt });
      return;
    }
    const block = blockFor(template.label, template.prompt);
    const blockIndex = value.indexOf(block);
    if (blockIndex !== -1) {
      onChange(value.slice(0, blockIndex) + value.slice(blockIndex + block.length));
    }
    // Marker present but block doesn't match verbatim (user edited it) —
    // leave their edit alone rather than guessing what to remove.
  };

  const confirmSaveCustom = async () => {
    const label = newCustomLabel.trim();
    if (!label || !value.trim()) return;
    const updated = await window.yggdrasil.flowTemplates.saveCustom({ label, prompt: value });
    setCustomTemplates(updated);
    setSavingCustom(false);
    setNewCustomLabel("");
  };

  const renderChipRow = (label: string, templates: PickableTemplate[]) => {
    if (templates.length === 0) return null;
    return (
      <div className="agent-template-picker" key={label}>
        <span className="agent-template-picker-label">{label}</span>
        <div className="agent-template-chip-row">
          {templates.map((t) => {
            const active = value.includes(markerFor(t.label));
            return (
              <button
                key={t.id}
                type="button"
                className={`agent-template-chip${active ? " active" : ""}`}
                onClick={() => toggle(t.id)}
                title={t.summary}
              >
                {t.label}
              </button>
            );
          })}
        </div>
      </div>
    );
  };

  return (
    <div className="agent-template-picker-groups">
      {renderChipRow("General", AGENT_TEMPLATES)}
      {renderChipRow("Game Dev", GAME_DEV_TEMPLATES)}
      {renderChipRow("Custom", customTemplates)}

      {!savingCustom ? (
        <button
          type="button"
          className="agent-template-chip agent-template-chip-add"
          disabled={!value.trim()}
          onClick={() => setSavingCustom(true)}
          title="Save the current Initial Prompt as a reusable custom role"
        >
          + Custom role
        </button>
      ) : (
        <div className="agent-template-custom-input-row">
          <input
            className="context-menu-input"
            value={newCustomLabel}
            onChange={(e) => setNewCustomLabel(e.target.value)}
            placeholder="Role name, e.g. Combat Designer"
            autoFocus
            onKeyDown={(e) => {
              if (e.key === "Enter") {
                e.preventDefault();
                void confirmSaveCustom();
              } else if (e.key === "Escape") {
                e.preventDefault();
                setSavingCustom(false);
                setNewCustomLabel("");
              }
            }}
          />
          <button type="button" onClick={() => void confirmSaveCustom()} disabled={!newCustomLabel.trim()}>
            Save
          </button>
          <button
            type="button"
            onClick={() => {
              setSavingCustom(false);
              setNewCustomLabel("");
            }}
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}
