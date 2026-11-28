// Lets the Dashboard send someone to the Studio's "new complement" form with a widget ready to describe.
import { useSyncExternalStore } from "react";
import { setActiveTab } from "../ui/mainTabsStore.js";

let requests = 0;
const listeners = new Set<() => void>();

export function requestNewWidget(): void {
  requests++;
  setActiveTab("studio");
  for (const listener of listeners) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

/** How many times it was asked for; 0 = never. Each new value is a new request. */
export function useNewWidgetRequests(): number {
  return useSyncExternalStore(subscribe, () => requests);
}
