import { requestTab } from "../chat/mainTabsBridge.js";
import { openWorkspaceTab } from "./workspaceStore.js";
import { whenSheetReady } from "./sheetRegistry.js";
import { whenDocReady, type DocWriteMode } from "./docRegistry.js";
import { whenDeckReady, type DeckWriteMode } from "./deckRegistry.js";
import { emptyDeck } from "@yggdrasil/tool-office/browser";
import type { CellInput } from "./sheetOps.js";

export type EditorRequest = { callId: string; kind: string; op: string; params: Record<string, unknown> };

function str(params: Record<string, unknown>, key: string, required = true): string | undefined {
  const v = params[key];
  if (typeof v === "string" && v.trim()) return v.trim();
  if (required) throw new Error(`${key} is required`);
  return undefined;
}

function projectPath(params: Record<string, unknown>, extension: "xlsx" | "docx" | "pptx", noun: string): string {
  const path = str(params, "path")!;
  if (!new RegExp(`\\.${extension}$`, "i").test(path)) throw new Error(`path must be a .${extension} ${noun} inside the project`);
  if (path.startsWith("/") || path.split("/").includes("..")) throw new Error("path must be relative to the project");
  return path;
}

/** Opens `path` in the workspace beside the chat (switching to the chat tab so the user sees it) and waits until the editor is usable. */
async function ensureSheetOpen(path: string) {
  openWorkspaceTab("sheet", path);
  requestTab("chat");
  return whenSheetReady(path);
}

async function ensureDocOpen(path: string) {
  openWorkspaceTab("doc", path);
  requestTab("chat");
  return whenDocReady(path);
}

async function ensureDeckOpen(path: string) {
  openWorkspaceTab("deck", path);
  requestTab("chat");
  return whenDeckReady(path);
}

async function handleDeckRequest(op: string, params: Record<string, unknown>): Promise<unknown> {
  const path = projectPath(params, "pptx", "PowerPoint presentation");
  switch (op) {
    case "create": {
      const markdown = typeof params.markdown === "string" ? params.markdown : "";
      await window.yggdrasil.office.deckCreate(path, emptyDeck());
      const controller = await ensureDeckOpen(path);
      // Written into the open editor so the user watches the slides appear — and saved like any edit.
      if (markdown.trim()) await controller.write({ mode: "replace", markdown });
      return { path, created: true, ...controller.info() };
    }
    case "open": {
      const controller = await ensureDeckOpen(path);
      return { path, ...controller.info() };
    }
    case "read": {
      const controller = await ensureDeckOpen(path);
      return { path, ...controller.info(), ...controller.read() };
    }
    case "write": {
      const controller = await ensureDeckOpen(path);
      const result = await controller.write({ mode: params.mode as DeckWriteMode, markdown: typeof params.markdown === "string" ? params.markdown : undefined, index: typeof params.index === "number" ? params.index : undefined });
      return { path, ...result };
    }
    default:
      throw new Error(`Unknown operation "${op}"`);
  }
}

async function handleDocRequest(op: string, params: Record<string, unknown>): Promise<unknown> {
  const path = projectPath(params, "docx", "Word document");
  switch (op) {
    case "create": {
      await window.yggdrasil.office.docCreate(path, { blocks: [] });
      const controller = await ensureDocOpen(path);
      // The text is written into the open editor, so the user watches it appear — and it is saved like any edit.
      if (typeof params.markdown === "string" && params.markdown.trim()) await controller.write({ mode: "replace", markdown: params.markdown });
      return { path, created: true, ...controller.info() };
    }
    case "open": {
      const controller = await ensureDocOpen(path);
      return { path, ...controller.info() };
    }
    case "read": {
      const controller = await ensureDocOpen(path);
      return { path, ...controller.info(), ...controller.read() };
    }
    case "write": {
      const controller = await ensureDocOpen(path);
      const result = await controller.write({ mode: params.mode as DocWriteMode, markdown: typeof params.markdown === "string" ? params.markdown : undefined, index: typeof params.index === "number" ? params.index : undefined });
      return { path, ...result };
    }
    case "find_replace": {
      const controller = await ensureDocOpen(path);
      return { path, ...controller.findReplace(str(params, "find")!, typeof params.replace === "string" ? params.replace : "", params.all !== false) };
    }
    default:
      throw new Error(`Unknown operation "${op}"`);
  }
}

/** Runs one office-tool operation on an editor in this window. Throws a message meant for the model to read. */
export async function handleEditorRequest({ kind, op, params }: Pick<EditorRequest, "kind" | "op" | "params">): Promise<unknown> {
  if (kind === "doc") return handleDocRequest(op, params);
  if (kind === "deck") return handleDeckRequest(op, params);
  if (kind !== "sheet") throw new Error(`Unknown editor "${kind}"`);
  const path = projectPath(params, "xlsx", "spreadsheet");

  switch (op) {
    case "create": {
      const rows = Array.isArray(params.rows) ? (params.rows as CellInput[][]) : [];
      await window.yggdrasil.office.sheetCreate(path, rows);
      const controller = await ensureSheetOpen(path);
      return { path, created: true, ...controller.info() };
    }
    case "open": {
      const controller = await ensureSheetOpen(path);
      return { path, ...controller.info() };
    }
    case "read": {
      const controller = await ensureSheetOpen(path);
      return { path, ...controller.readRange(str(params, "range")!, str(params, "sheet", false)) };
    }
    case "write": {
      const values = params.values as CellInput[][];
      const controller = await ensureSheetOpen(path);
      return { path, ...(await controller.writeRange(str(params, "range")!, values, str(params, "sheet", false))) };
    }
    default:
      throw new Error(`Unknown operation "${op}"`);
  }
}
