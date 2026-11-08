/**
 * Safety nets for the tool loop. Small local models fail in a few recurring ways that a plain
 * "call, run tools, repeat" loop turns into a dead end; each guard below nudges the model back on track
 * once or twice instead of ending the turn. The nudges are ephemeral: they steer the model during this
 * turn but are not saved to the session (see runToolLoop).
 */

export type LoopGuards = {
  /** Retry (up to MAX_EMPTY_RETRIES times) when the model answers with nothing at all. */
  retryEmpty: boolean;
  /** Push (up to twice) when the model says it will act but ends its turn without calling a tool. */
  nudgeUnannounced: boolean;
  /** At the iteration limit or when stuck, ask for a summary instead of returning a bare error. */
  summarizeOnLimit: boolean;
  /** Consecutive identical tool calls allowed before the next one is refused. 0 disables. */
  repeatLimit: number;
};

export const DEFAULT_GUARDS: LoopGuards = {
  retryEmpty: true,
  nudgeUnannounced: true,
  summarizeOnLimit: true,
  repeatLimit: 3,
};

export function resolveGuards(input: boolean | Partial<LoopGuards> | undefined): LoopGuards {
  if (input === false) return { retryEmpty: false, nudgeUnannounced: false, summarizeOnLimit: false, repeatLimit: 0 };
  if (input === true || input === undefined) return { ...DEFAULT_GUARDS };
  return { ...DEFAULT_GUARDS, ...input };
}

/** Empty replies are cheap to retry (nothing ran), so this is generous; Claude Code also allows 10 retries per request. */
export const MAX_EMPTY_RETRIES = 10;
export const MAX_ACTION_NUDGES = 2;
/** After this many refused repeats the loop stops trying and summarizes. */
export const MAX_REFUSED_REPEATS = 2;

export const NUDGES = {
  empty: "Your last reply was empty. Continue the task: call a tool if there is more to do, or give your final answer.",
  unannounced:
    "You said you would take an action but ended your turn without calling a tool. If the task needs that action, call the tool now. " +
    "If the task is already complete, just state the final result.",
  limit:
    "You have reached the limit of tool calls for this turn. Without calling any more tools, summarize what you did, " +
    "the current state of the work, and what is still left to do.",
  stuck:
    "You keep repeating the same tool call without making progress. Without calling any more tools, explain what you were trying to do, " +
    "what is blocking you, and what you would try next.",
} as const;

export function repeatRefusal(name: string, count: number): string {
  return (
    `Error: you have already called ${name} with exactly these arguments ${count} times in a row. ` +
    `Repeating it will not change the result. Try a different approach (different arguments, a different tool), or give your final answer.`
  );
}

// "I will / voy a / let me …": the model describing what it is about to do.
const ANNOUNCES_ACTION =
  /\b(i(?:'ll| will| am going to| need to)|let me|let's|first,? i(?:'ll| will)|voy a|vamos a|procedo a|procederé a|ahora voy|a continuación|ejecutaré|usaré|utilizaré|crearé|borraré|eliminaré|revisaré|leeré|escribiré|corregiré|instalaré)\b/i;

// "done / listo / he creado …": the model reporting something finished.
const REPORTS_DONE =
  /\b(done|completed?|finished|successfully|all set|listo|hecho|completad[oa]|terminad[oa]|finalizad[oa]|he (?:creado|ejecutado|corregido|actualizado|borrado|eliminado|escrito|instalado|encontrado)|ha sido (?:creado|ejecutado|corregido|actualizado)|ya (?:est[aá]|qued[oó]))\b/i;

/**
 * True when a reply with no tool call reads like an unfinished intention rather than an answer:
 * it announces an action in its closing stretch and either trails off ("…:") or shows the command
 * in a code block. Deliberately conservative — a wrong nudge costs an extra model call, but a plain
 * answer that happens to say "voy a explicarte" must never be pushed to act.
 */
export function looksUnfinished(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return false;
  const closing = trimmed.slice(-400);
  if (!ANNOUNCES_ACTION.test(closing)) return false;
  if (REPORTS_DONE.test(closing)) return false;
  const trailsOff = /[:…]$|\.\.\.$/.test(trimmed);
  const showsCommand = /```/.test(closing);
  return trailsOff || showsCommand;
}

export function callSignature(name: string, rawArguments: string): string {
  let args: unknown = rawArguments;
  try {
    const parsed = JSON.parse(rawArguments) as Record<string, unknown>;
    args = Object.keys(parsed).sort().map((k) => [k, parsed[k]]);
  } catch {
    // keep the raw string
  }
  return `${name}:${JSON.stringify(args)}`;
}

/** How many of the most recent calls (counting this one) are identical to `signature`. */
export function trailingRepeats(history: string[], signature: string): number {
  let n = 1;
  for (let i = history.length - 1; i >= 0 && history[i] === signature; i--) n++;
  return n;
}
