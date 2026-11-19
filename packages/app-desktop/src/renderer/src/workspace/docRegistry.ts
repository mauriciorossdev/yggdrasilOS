import { createControllerRegistry } from "./controllerRegistry.js";

export type DocBlockInfo = { index: number; type: string; text: string };

export type DocWriteMode = "replace" | "append" | "prepend" | "insert_after" | "replace_block" | "delete_block";

/** What can be done to an open document from outside its editor (an agent's tool call). Markdown in and out. */
export type DocController = {
  info: () => { blocks: number; words: number };
  /** The blocks (numbered from 0) with a short text each, and the whole document as Markdown. */
  read: () => { blocks: DocBlockInfo[]; markdown: string };
  write: (op: { mode: DocWriteMode; markdown?: string; index?: number }) => Promise<{ blocks: number; saved: boolean; note?: string }>;
  findReplace: (find: string, replace: string, all: boolean) => { replaced: number };
};

const registry = createControllerRegistry<DocController>("document");

export const registerDocController = registry.register;
export const getDocController = registry.get;
export const failDocOpen = registry.failOpen;
export const whenDocReady = registry.whenReady;
export const resetDocRegistryForTest = registry.reset;
