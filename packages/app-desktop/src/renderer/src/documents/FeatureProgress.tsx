import { useMemo } from "react";
import { parseStatus, parseTasks } from "./featureDoc.js";

type Props = { content: string };

const STATUS_LABEL = {
  working: "Working",
  checking: "Checking",
  ready: "Ready",
  "needs-decision": "Needs your decision",
} as const;

/**
 * Read-only progress strip for a feature doc (see featureDoc.ts): task count,
 * Status badge and the task list. Fed the tab's live content, so it follows
 * both the user's edits and an agent ticking boxes (DocumentsView reloads a
 * clean tab when the file changes on disk). Renders nothing for a note with
 * no checkbox tasks under `## Tasks`.
 */
export function FeatureProgress({ content }: Props) {
  const { tasks, status } = useMemo(() => ({ tasks: parseTasks(content), status: parseStatus(content) }), [content]);
  if (tasks.total === 0) return null;
  const pct = Math.round((tasks.done / tasks.total) * 100);
  return (
    <details className="feature-progress">
      <summary>
        <span className="feature-progress-count">
          {tasks.done}/{tasks.total}
        </span>
        <span className="feature-progress-bar" aria-hidden>
          <span className="feature-progress-fill" style={{ width: `${pct}%` }} />
        </span>
        {status && <span className={`feature-progress-status status-${status}`}>{STATUS_LABEL[status]}</span>}
      </summary>
      <ul className="feature-progress-tasks">
        {tasks.items.map((task, i) => (
          <li key={i} className={task.done ? "done" : undefined}>
            <span aria-hidden>{task.done ? "☑" : "☐"}</span> {task.text}
          </li>
        ))}
      </ul>
    </details>
  );
}
