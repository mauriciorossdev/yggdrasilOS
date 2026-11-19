import { createControllerRegistry } from "./controllerRegistry.js";

export type DeckSlideInfo = { index: number; layout: string; title: string };

export type DeckWriteMode = "replace" | "append" | "insert_after" | "replace_slide" | "delete_slide";

/** What can be done to an open presentation from outside its editor (an agent's tool call). Markdown in and out. */
export type DeckController = {
  info: () => { slides: number };
  read: () => { slides: DeckSlideInfo[]; markdown: string };
  write: (op: { mode: DeckWriteMode; markdown?: string; index?: number }) => Promise<{ slides: number; saved: boolean; note?: string }>;
};

const registry = createControllerRegistry<DeckController>("presentation");

export const registerDeckController = registry.register;
export const getDeckController = registry.get;
export const failDeckOpen = registry.failOpen;
export const whenDeckReady = registry.whenReady;
export const resetDeckRegistryForTest = registry.reset;
