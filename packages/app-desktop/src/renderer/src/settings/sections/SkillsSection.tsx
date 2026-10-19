import { useCallback, useEffect, useMemo, useState } from "react";
import type { SkillInfo } from "../../types.js";

/**
 * Registry of the skills Claude Code would see in this project: the
 * project's own (.claude/skills), the user's (~/.claude/skills) and those
 * from installed plugins (read-only — they're owned by the plugin). Read
 * from disk by main/skills.ts each time the section mounts or refreshes.
 */
export function SkillsSection() {
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [query, setQuery] = useState("");
  const [creating, setCreating] = useState(false);
  const [newName, setNewName] = useState("");
  const [newDescription, setNewDescription] = useState("");
  const [message, setMessage] = useState<string | null>(null);

  const reload = useCallback(async () => {
    try {
      setSkills(await window.yggdrasil.skills.list());
      setError(null);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  }, []);

  useEffect(() => {
    void reload();
  }, [reload]);

  const groups = useMemo(() => {
    const q = query.trim().toLowerCase();
    const visible = (skills ?? []).filter(
      (s) => !q || s.name.toLowerCase().includes(q) || s.description.toLowerCase().includes(q),
    );
    const byTitle = new Map<string, SkillInfo[]>();
    for (const skill of visible) {
      const title =
        skill.scope === "project" ? "This project" : skill.scope === "user" ? "Your skills" : `Plugin · ${skill.plugin}`;
      byTitle.set(title, [...(byTitle.get(title) ?? []), skill]);
    }
    return [...byTitle.entries()];
  }, [skills, query]);

  const open = async (skill: SkillInfo, reveal: boolean) => {
    const res = await window.yggdrasil.skills.open(skill.path, reveal);
    setMessage(res.opened ? null : (res.error ?? "Could not open the skill."));
  };

  const create = async () => {
    const res = await window.yggdrasil.skills.create(newName, newDescription);
    if (!res.ok) {
      setMessage(res.error);
      return;
    }
    setMessage(null);
    setCreating(false);
    setNewName("");
    setNewDescription("");
    await reload();
    void window.yggdrasil.skills.open(res.path, false);
  };

  return (
    <section className="settings-section">
      <h3>Skills</h3>
      <p className="muted">
        Skills Claude Code can use in this project. Plugin skills are read-only; create your own below, or add folders
        to <code>~/.claude/skills</code>.
      </p>

      <div className="input-with-button">
        <input type="text" value={query} onChange={(e) => setQuery(e.target.value)} placeholder="Filter skills…" />
        <button type="button" onClick={() => void reload()}>
          Refresh
        </button>
        <button type="button" onClick={() => setCreating((c) => !c)}>
          New skill
        </button>
      </div>

      {creating && (
        <div className="skill-new">
          <label>
            Name
            <input
              type="text"
              autoFocus
              value={newName}
              onChange={(e) => setNewName(e.target.value)}
              placeholder="code-review"
            />
          </label>
          <label>
            Description
            <input
              type="text"
              value={newDescription}
              onChange={(e) => setNewDescription(e.target.value)}
              placeholder="What it does and when Claude should use it"
            />
          </label>
          <button type="button" onClick={() => void create()} disabled={!newName.trim()}>
            Create in .claude/skills
          </button>
        </div>
      )}

      {message && <p className="error">{message}</p>}
      {error && <p className="error">{error}</p>}
      {skills === null && !error && <p className="muted">Reading skills…</p>}
      {skills !== null && groups.length === 0 && <p className="muted">No skills match.</p>}

      {groups.map(([title, items]) => (
        <div key={title} className="skill-group">
          <h4>{title}</h4>
          {items.map((skill) => (
            <div key={skill.path} className="skill-row">
              <div className="skill-row-main">
                <strong>{skill.name}</strong>
                <span className="muted skill-row-desc">{skill.description || "No description."}</span>
                <span className="muted skill-row-path" title={skill.path}>
                  {skill.path}
                </span>
              </div>
              <div className="skill-row-actions">
                <button type="button" onClick={() => void open(skill, false)}>
                  Open
                </button>
                <button type="button" onClick={() => void open(skill, true)}>
                  Reveal
                </button>
              </div>
            </div>
          ))}
        </div>
      ))}
    </section>
  );
}
