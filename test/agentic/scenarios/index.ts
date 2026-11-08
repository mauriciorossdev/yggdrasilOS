import { debugFromStackTrace, implementFromSpec, multiTurnCli } from "./buildCode.js";
import { fixFailingTest, fixTypeErrors } from "./fixCode.js";
import { helloFile, readAndAnswer, recoverFromToolError } from "./basics.js";
import { reactViteApp } from "./react.js";
import { continueAfterDenial, stayInWorkspace } from "./safety.js";
import type { Scenario } from "../lib/types.js";

/** In rough order of difficulty. */
export const SCENARIOS: Scenario[] = [
  helloFile,
  readAndAnswer,
  recoverFromToolError,
  stayInWorkspace,
  continueAfterDenial,
  fixFailingTest,
  fixTypeErrors,
  implementFromSpec,
  debugFromStackTrace,
  multiTurnCli,
  reactViteApp,
];

/** "hello-file,fix-" style filter: ids or id prefixes, or tags (`tag:slow`). Empty = all. `-x` excludes. */
export function selectScenarios(all: Scenario[], filter: string | undefined): Scenario[] {
  const terms = (filter ?? "").split(",").map((s) => s.trim()).filter(Boolean);
  if (terms.length === 0) return all;
  const include = terms.filter((t) => !t.startsWith("-"));
  const exclude = terms.filter((t) => t.startsWith("-")).map((t) => t.slice(1));
  const matches = (s: Scenario, t: string) => (t.startsWith("tag:") ? s.tags.includes(t.slice(4)) : t.startsWith("level:") ? String(s.level) === t.slice(6) : s.id === t || s.id.startsWith(t));
  return all.filter((s) => (include.length === 0 || include.some((t) => matches(s, t))) && !exclude.some((t) => matches(s, t)));
}
