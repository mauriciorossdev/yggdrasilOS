/**
 * The startup progress a project window shows while its gateway boots
 * (renderer/src/boot/BootScreen.tsx). The window now opens at once and boots
 * inside, so main keeps one snapshot per booting window and pushes the whole
 * thing on every change (`boot:update`); `boot:get` answers with the current
 * one, so a renderer that loads after a stage finished (or reloads later)
 * still gets it. Pure: no Electron here, so it's unit-testable.
 */

/** Stage ids; the renderer owns their labels (i18n). "connect" is finished by the renderer itself. */
export type BootStageId = "settings" | "plugins" | "folder" | "gateway" | "agents" | "connect";
export type BootStageState = "pending" | "active" | "done" | "failed";
export type BootStage = { id: BootStageId; state: BootStageState; ms?: number; startedAt?: number };
export type BootKind = "launch" | "project";

export type BootSnapshot = {
  kind: BootKind;
  stages: BootStage[];
  /** Set once the gateway is up: the renderer connects to `url`. */
  gateway: { url: string; lanUrl: string } | null;
  error: { message: string; detail?: string } | null;
};

const PROJECT_STAGES: BootStageId[] = ["folder", "gateway", "agents", "connect"];
/** At launch the window opens first, then the app's own startup runs as its first stages. */
const LAUNCH_STAGES: BootStageId[] = ["settings", "plugins"];

export function initialBoot(kind: BootKind): BootSnapshot {
  return {
    kind,
    stages: [...(kind === "launch" ? LAUNCH_STAGES : []), ...PROJECT_STAGES].map((id) => ({ id, state: "pending" as const })),
    gateway: null,
    error: null,
  };
}

function patchStage(s: BootSnapshot, id: BootStageId, f: (st: BootStage) => BootStage): BootSnapshot {
  return { ...s, stages: s.stages.map((st) => (st.id === id ? f(st) : st)) };
}

export function startStage(s: BootSnapshot, id: BootStageId, now: number): BootSnapshot {
  return patchStage(s, id, (st) => ({ id: st.id, state: "active", startedAt: now }));
}

export function finishStage(s: BootSnapshot, id: BootStageId, now: number): BootSnapshot {
  return patchStage(s, id, (st) => ({
    id: st.id,
    state: "done",
    ms: st.startedAt !== undefined ? Math.max(0, Math.round(now - st.startedAt)) : st.ms,
  }));
}

/** Finishes whichever stage is running and starts `to`. */
export function advance(s: BootSnapshot, to: BootStageId, now: number): BootSnapshot {
  const active = s.stages.find((st) => st.state === "active");
  return startStage(active ? finishStage(s, active.id, now) : s, to, now);
}

/** The stage that was running fails; later ones stay pending. */
export function failBoot(s: BootSnapshot, error: { message: string; detail?: string }): BootSnapshot {
  const active = s.stages.find((st) => st.state === "active");
  const failed = active ? patchStage(s, active.id, (st) => ({ id: st.id, state: "failed", startedAt: st.startedAt })) : s;
  return { ...failed, error };
}

/** Main's part is done: the renderer can connect, so "connect" becomes the running stage. */
export function bootReady(s: BootSnapshot, gateway: { url: string; lanUrl: string }, now: number): BootSnapshot {
  const next = startStage(s, "connect", now);
  return { ...next, gateway, error: null };
}

/** For a window that's already open (a reload): everything done, connect straight away. */
export function openedSnapshot(gateway: { url: string; lanUrl: string }): BootSnapshot {
  return {
    kind: "project",
    stages: PROJECT_STAGES.map((id) => ({ id, state: id === "connect" ? "active" : "done" })),
    gateway,
    error: null,
  };
}

/** Retry: every stage that didn't finish goes back to pending (finished ones, like the launch stages, stay). */
export function resetForRetry(s: BootSnapshot): BootSnapshot {
  return {
    ...s,
    stages: s.stages.map((st) => (st.state === "done" ? st : { id: st.id, state: "pending" as const })),
    gateway: null,
    error: null,
  };
}

/** Wire form: startedAt is main's own clock, of no use to the renderer. */
export function toWire(s: BootSnapshot): BootSnapshot {
  return { ...s, stages: s.stages.map(({ startedAt: _t, ...st }) => st) };
}
