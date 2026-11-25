import { useSyncExternalStore } from "react";
import type { BootSnapshot } from "../types.js";

/**
 * Window-first boot (main/bootState.ts): this window's startup progress, fed by
 * main. Main's snapshot covers everything up to the gateway being up; the
 * renderer itself finishes the last stage ("connect") once the WebSocket is
 * authenticated, or fails it if the connection can't be made.
 */
type State = {
  snapshot: BootSnapshot | null;
  /** The gateway WebSocket is connected and authenticated: the app can take over. */
  connected: boolean;
  /** The renderer couldn't connect to a gateway main reported as up (Retry reloads the window). */
  connectError: string | null;
};

let state: State = { snapshot: null, connected: false, connectError: null };
const listeners = new Set<() => void>();
let started = false;

function emit(next: Partial<State>): void {
  state = { ...state, ...next };
  listeners.forEach((fn) => fn());
}

/** Keeps the first gateway main handed over: GatewayProvider's URL must not change under the app. */
function accept(snapshot: BootSnapshot | null): void {
  if (!snapshot) return;
  const gateway = state.snapshot?.gateway ?? snapshot.gateway;
  emit({ snapshot: { ...snapshot, gateway } });
}

/** Subscribes before asking, so a stage that finishes while the renderer loads isn't lost. */
export function startBoot(): void {
  if (started) return;
  started = true;
  window.yggdrasil.boot.onUpdate(accept);
  void window.yggdrasil.boot.get().then(accept).catch(() => {});
}

export function markConnected(): void {
  if (!state.connected) emit({ connected: true });
}

export function failConnect(message: string): void {
  emit({ connectError: message });
}

function subscribe(fn: () => void): () => void {
  listeners.add(fn);
  return () => listeners.delete(fn);
}

export function useBoot(): State {
  return useSyncExternalStore(subscribe, () => state);
}

/** This window's gateway with the machine's LAN address (what a phone would type); null until it's up. */
export function useGatewayLanUrl(): string | null {
  return useBoot().snapshot?.gateway?.lanUrl ?? null;
}
