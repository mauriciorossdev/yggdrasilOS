import * as monaco from "monaco-editor";
import type {
  CodeAction,
  Command,
  ConfigurationParams,
  Diagnostic,
  InitializeResult,
  PublishDiagnosticsParams,
  ServerCapabilities,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver-protocol";
import { t } from "../../i18n/index.js";
import { requestOpenFile } from "../openFileBus.js";
import { languageFromPath } from "../languageFromPath.js";
import { LspConnection } from "./connection.js";
import { applyTextEdits, diagnosticKey, diagnosticMessage, lspLanguageId, relativeIfInside, toMarker, toMonacoRange } from "./convert.js";
import { EXECUTE_COMMAND, registerProviders, RUN_CODE_ACTION } from "./providers.js";

type GatewayCall = <T>(method: string, params?: Record<string, unknown>) => Promise<T>;
type SessionInfo = { sessionId: string; serverId: string; languages: string[]; rootUri: string; initializationOptions?: unknown; settings?: unknown };

type DocumentDiagnosticResult = { kind: "full"; items: Diagnostic[] } | { kind: "unchanged" };

type Client = {
  info: SessionInfo;
  languages: Set<string>;
  connection: LspConnection;
  capabilities: ServerCapabilities;
  syncKind: number;
  documents: Map<monaco.editor.ITextModel, monaco.IDisposable>;
  providers: monaco.IDisposable | null;
  /** Diagnostics per canonical URI, for files without a model too. */
  diagnostics: Map<string, Diagnostic[]>;
  startedAt: number;
};

const MAX_RESTARTS = 3;
/** Pause in typing before asking a pull-diagnostics server (ESLint) to check the file again. */
const PULL_DIAGNOSTICS_DELAY_MS = 400;
/** A server that ran this long earned its restart budget back. */
const HEALTHY_AFTER_MS = 60_000;

const clients = new Map<string, Client>();
const languagesRequested = new Set<string>();
const restarts = new Map<string, number>();
const pendingReveals = new Map<string, monaco.IPosition>();
const diagnosticListeners = new Set<() => void>();
let gatewayCall: GatewayCall | null = null;
let installed = false;

const canonical = (uri: string) => monaco.Uri.parse(uri).toString();
const root = () => window.yggdrasil.projectPath || null;

/**
 * The URI a file's Monaco model gets. Servers need the real absolute path. Markdown keeps its
 * project-relative path: no server handles it, and its image hover resolves addresses from it.
 */
export function modelPathFor(path: string): string {
  const base = root();
  if (!base || languageFromPath(path) === "markdown") return path;
  return monaco.Uri.file(`${base.replace(/[\\/]+$/, "")}/${path}`).toString();
}

function projectPathOf(uri: monaco.Uri): string | null {
  const base = root();
  return base && uri.scheme === "file" ? relativeIfInside(uri.fsPath, base) : null;
}

function serves(client: Client, model: monaco.editor.ITextModel): boolean {
  return model.uri.scheme === "file" && client.languages.has(model.getLanguageId());
}

function storeDiagnostics(client: Client, uri: string, diagnostics: Diagnostic[]): void {
  if (diagnostics.length === 0) client.diagnostics.delete(uri);
  else client.diagnostics.set(uri, diagnostics);
  applyDiagnostics(client, uri);
  notifyDiagnostics();
}

/** For servers that wait to be asked for a file's problems, rather than publishing them. */
function pullDiagnostics(client: Client, model: monaco.editor.ITextModel): void {
  if (!client.capabilities.diagnosticProvider || model.isDisposed()) return;
  const uri = model.uri.toString();
  const version = model.getVersionId();
  void client.connection
    .request<DocumentDiagnosticResult>("textDocument/diagnostic", { textDocument: { uri } })
    .then((result) => {
      if (result.kind === "full" && !model.isDisposed() && model.getVersionId() === version) storeDiagnostics(client, uri, result.items);
    })
    .catch(() => {
      // Superseded or the server went away; the next change asks again.
    });
}

function openDocument(client: Client, model: monaco.editor.ITextModel): void {
  if (client.documents.has(model) || !serves(client, model) || client.syncKind === 0) return;
  const uri = model.uri.toString();
  client.connection.notify("textDocument/didOpen", {
    textDocument: { uri, languageId: lspLanguageId(model.uri.path, model.getLanguageId()), version: model.getVersionId(), text: model.getValue() },
  });
  let pullTimer: ReturnType<typeof setTimeout> | undefined;
  const onChange = model.onDidChangeContent((event) => {
    clearTimeout(pullTimer);
    pullTimer = setTimeout(() => pullDiagnostics(client, model), PULL_DIAGNOSTICS_DELAY_MS);
    client.connection.notify("textDocument/didChange", {
      textDocument: { uri, version: model.getVersionId() },
      contentChanges:
        client.syncKind === 2
          ? event.changes.map((c) => ({
              range: { start: { line: c.range.startLineNumber - 1, character: c.range.startColumn - 1 }, end: { line: c.range.endLineNumber - 1, character: c.range.endColumn - 1 } },
              rangeLength: c.rangeLength,
              text: c.text,
            }))
          : [{ text: model.getValue() }],
    });
  });
  client.documents.set(model, { dispose: () => (clearTimeout(pullTimer), onChange.dispose()) });
  applyDiagnostics(client, uri);
  pullDiagnostics(client, model);
}

function closeDocument(client: Client, model: monaco.editor.ITextModel): void {
  const subscription = client.documents.get(model);
  if (!subscription) return;
  subscription.dispose();
  client.documents.delete(model);
  client.connection.notify("textDocument/didClose", { textDocument: { uri: model.uri.toString() } });
}

function applyDiagnostics(client: Client, uri: string): void {
  const model = monaco.editor.getModel(monaco.Uri.parse(uri));
  if (model) monaco.editor.setModelMarkers(model, `lsp:${client.info.serverId}`, (client.diagnostics.get(uri) ?? []).map(toMarker));
}

function notifyDiagnostics(): void {
  for (const listener of diagnosticListeners) listener();
}

async function ensureModel(uri: string): Promise<void> {
  const parsed = monaco.Uri.parse(uri);
  if (monaco.editor.getModel(parsed)) return;
  const text = await window.yggdrasil.lsp.readExternal(uri);
  if (text === null || monaco.editor.getModel(parsed)) return;
  monaco.editor.createModel(text, languageFromPath(parsed.path), parsed);
}

function editsOf(edit: WorkspaceEdit): { edits: Map<string, TextEdit[]>; unsupported: boolean } {
  const edits = new Map<string, TextEdit[]>();
  let unsupported = false;
  for (const [uri, list] of Object.entries(edit.changes ?? {})) edits.set(canonical(uri), [...list]);
  for (const change of edit.documentChanges ?? []) {
    if ("kind" in change) {
      unsupported = true;
      continue;
    }
    const key = canonical(change.textDocument.uri);
    edits.set(key, [...(edits.get(key) ?? []), ...(change.edits as TextEdit[])]);
  }
  return { edits, unsupported };
}

/**
 * Applies a multi-file edit. Files showing in an editor change there, so they stay undoable and their tab
 * state follows. Others are written to disk, and the file watcher reloads them if they're open in a tab.
 * A file with unsaved changes that isn't showing can't be edited safely, so that refuses the whole edit.
 */
async function applyWorkspaceEdit(edit: WorkspaceEdit): Promise<{ applied: boolean; failureReason?: string }> {
  const { edits, unsupported } = editsOf(edit);
  if (unsupported) return { applied: false, failureReason: t("doc.lsp.editUnsupported") };
  const shown = new Map(monaco.editor.getEditors().flatMap((e) => (e.getModel() ? [[e.getModel()!.uri.toString(), e] as const] : [])));
  const writes: Array<{ relativePath: string; content: string }> = [];
  for (const [uri, list] of edits) {
    if (shown.has(uri)) continue;
    const parsed = monaco.Uri.parse(uri);
    const relativePath = projectPathOf(parsed);
    if (!relativePath || !gatewayCall) return { applied: false, failureReason: t("doc.lsp.editOutside", { path: parsed.fsPath }) };
    const disk = await gatewayCall<{ content: string; truncated?: boolean }>("fs.read", { relativePath });
    if (disk.truncated) return { applied: false, failureReason: t("doc.lsp.editTooLarge", { path: relativePath }) };
    const model = monaco.editor.getModel(parsed);
    if (model && model.getValue() !== disk.content) return { applied: false, failureReason: t("doc.lsp.editUnsaved", { path: relativePath }) };
    writes.push({ relativePath, content: applyTextEdits(disk.content, list) });
  }
  for (const [uri, list] of edits) {
    const editor = shown.get(uri);
    if (!editor) continue;
    editor.pushUndoStop();
    editor.executeEdits("lsp", list.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })));
    editor.pushUndoStop();
  }
  for (const write of writes) await gatewayCall!("fs.write", write);
  return { applied: true };
}

function clientCapabilities() {
  const formats = ["markdown", "plaintext"];
  return {
    textDocument: {
      synchronization: {},
      completion: {
        completionItem: { snippetSupport: true, documentationFormat: formats, labelDetailsSupport: true, resolveSupport: { properties: ["documentation", "detail", "additionalTextEdits"] } },
        contextSupport: true,
      },
      hover: { contentFormat: formats },
      signatureHelp: { signatureInformation: { documentationFormat: formats, parameterInformation: { labelOffsetSupport: true }, activeParameterSupport: true }, contextSupport: false },
      definition: { linkSupport: true },
      typeDefinition: { linkSupport: true },
      references: {},
      documentHighlight: {},
      documentSymbol: { hierarchicalDocumentSymbolSupport: true },
      rename: {},
      codeAction: {
        codeActionLiteralSupport: { codeActionKind: { valueSet: ["", "quickfix", "refactor", "refactor.extract", "refactor.inline", "refactor.rewrite", "source", "source.organizeImports", "source.fixAll"] } },
        isPreferredSupport: true,
        disabledSupport: true,
        dataSupport: true,
        resolveSupport: { properties: ["edit"] },
      },
      formatting: {},
      rangeFormatting: {},
      publishDiagnostics: { tagSupport: { valueSet: [1, 2] }, codeDescriptionSupport: true, dataSupport: true },
      diagnostic: { relatedDocumentSupport: false },
    },
    workspace: {
      applyEdit: true,
      configuration: true,
      workspaceFolders: true,
      didChangeWatchedFiles: {},
      workspaceEdit: { documentChanges: true },
      executeCommand: {},
      diagnostics: { refreshSupport: true },
    },
  };
}

async function connect(info: SessionInfo): Promise<void> {
  if (clients.has(info.sessionId)) return;
  const connection = new LspConnection((message) => window.yggdrasil.lsp.send(info.sessionId, message));
  const client: Client = {
    info,
    languages: new Set(info.languages),
    connection,
    capabilities: {},
    syncKind: 0,
    documents: new Map(),
    providers: null,
    diagnostics: new Map(),
    startedAt: Date.now(),
  };
  clients.set(info.sessionId, client);

  const folder = { uri: info.rootUri, name: window.yggdrasil.projectName ?? "project" };
  connection.onRequest("workspace/configuration", (params) =>
    // ESLint asks for its settings per file and wants its folder in them.
    (params as ConfigurationParams).items.map(() => (info.settings ? { ...(info.settings as object), workspaceFolder: folder } : null)),
  );
  connection.onRequest("workspace/workspaceFolders", () => [folder]);
  connection.onRequest("client/registerCapability", () => null);
  connection.onRequest("client/unregisterCapability", () => null);
  connection.onRequest("window/workDoneProgress/create", () => null);
  connection.onRequest("window/showMessageRequest", () => null);
  connection.onRequest("workspace/applyEdit", async (params) => applyWorkspaceEdit((params as { edit: WorkspaceEdit }).edit));
  connection.onNotification("textDocument/publishDiagnostics", (params) => {
    const { uri, diagnostics } = params as PublishDiagnosticsParams;
    storeDiagnostics(client, canonical(uri), diagnostics);
  });
  connection.onRequest("workspace/diagnostic/refresh", () => {
    for (const model of client.documents.keys()) pullDiagnostics(client, model);
    return null;
  });

  const result = await connection.request<InitializeResult>("initialize", {
    processId: null,
    clientInfo: { name: "Yggdrasil" },
    rootUri: info.rootUri,
    workspaceFolders: [folder],
    capabilities: clientCapabilities(),
    initializationOptions: info.initializationOptions,
  });
  connection.notify("initialized", {});
  if (info.settings) connection.notify("workspace/didChangeConfiguration", { settings: info.settings });
  client.capabilities = result.capabilities;
  const sync = result.capabilities.textDocumentSync;
  client.syncKind = typeof sync === "object" ? (sync?.change ?? 0) : (sync ?? 0);

  notifyDiagnostics();
  client.providers = registerProviders(
    {
      connection,
      capabilities: result.capabilities,
      ensureModel,
      applyWorkspaceEdit,
      diagnosticFor: (uri, key) => client.diagnostics.get(uri)?.find((d) => diagnosticKey(toMonacoRange(d.range), diagnosticMessage(d)) === key),
    },
    [...client.languages],
    info.sessionId,
  );
  for (const model of monaco.editor.getModels()) openDocument(client, model);
}

function disposeClient(client: Client): void {
  client.connection.close();
  client.providers?.dispose();
  for (const subscription of client.documents.values()) subscription.dispose();
  for (const model of monaco.editor.getModels()) monaco.editor.setModelMarkers(model, `lsp:${client.info.serverId}`, []);
  clients.delete(client.info.sessionId);
  notifyDiagnostics();
}

async function ensureLanguage(language: string): Promise<void> {
  if (languagesRequested.has(language)) return;
  languagesRequested.add(language);
  try {
    const sessions = (await window.yggdrasil.lsp.start(language)) as SessionInfo[];
    await Promise.all(
      sessions.map((info) =>
        connect(info).catch((err) => console.warn(`[lsp] ${info.serverId} failed to start:`, err)),
      ),
    );
  } catch (err) {
    languagesRequested.delete(language);
    console.error("[lsp] start failed:", err);
  }
}

function onModel(model: monaco.editor.ITextModel): void {
  if (model.uri.scheme !== "file" || !projectAwareLanguage(model)) return;
  void ensureLanguage(model.getLanguageId());
  for (const client of clients.values()) openDocument(client, model);
}

function projectAwareLanguage(model: monaco.editor.ITextModel): boolean {
  return model.getLanguageId() !== "markdown" && model.getLanguageId() !== "plaintext";
}

function restartAfterTrustChange(): void {
  for (const client of [...clients.values()]) disposeClient(client);
  languagesRequested.clear();
  restarts.clear();
  for (const model of monaco.editor.getModels()) onModel(model);
}

function installOnce(): void {
  if (installed || !window.yggdrasil.projectPath) return;
  installed = true;

  window.yggdrasil.lsp.onMessage((payload) => {
    const { sessionId, message } = payload as { sessionId: string; message: unknown };
    clients.get(sessionId)?.connection.receive(message);
  });
  window.yggdrasil.lsp.onClosed((payload) => {
    const { sessionId, reason } = payload as { sessionId: string; reason: string | null };
    const client = clients.get(sessionId);
    if (!client) return;
    const { serverId } = client.info;
    console.warn(`[lsp] ${serverId} stopped:`, reason ?? "no reason given");
    const languages = [...client.languages];
    const healthy = Date.now() - client.startedAt > HEALTHY_AFTER_MS;
    disposeClient(client);
    const count = healthy ? 0 : (restarts.get(serverId) ?? 0);
    for (const language of languages) languagesRequested.delete(language);
    if (count >= MAX_RESTARTS) return;
    restarts.set(serverId, count + 1);
    setTimeout(() => {
      for (const language of languages) void ensureLanguage(language);
    }, 1000);
  });
  window.yggdrasil.lsp.onTrustChanged(restartAfterTrustChange);

  monaco.editor.onDidCreateModel((model) => {
    onModel(model);
    model.onDidChangeLanguage(() => onModel(model));
    model.onWillDispose(() => {
      for (const client of clients.values()) closeDocument(client, model);
    });
  });
  for (const model of monaco.editor.getModels()) {
    onModel(model);
    model.onWillDispose(() => {
      for (const client of clients.values()) closeDocument(client, model);
    });
  }

  monaco.editor.registerCommand(RUN_CODE_ACTION, (_accessor, sessionId: string, item: CodeAction | Command, canResolve: boolean) => {
    void runCodeAction(sessionId, item, canResolve);
  });
  monaco.editor.registerCommand(EXECUTE_COMMAND, (_accessor, sessionId: string, command: Command) => {
    void clients.get(sessionId)?.connection.request("workspace/executeCommand", { command: command.command, arguments: command.arguments }).catch((err) => console.error("[lsp] command failed:", err));
  });

  // Go to definition: another project file opens where the asking editor lives, at that spot. A file
  // outside the project (a library's types) has no tab to open in, so it shows in a read-only peek.
  monaco.editor.registerEditorOpener({
    openCodeEditor(source, resource, selectionOrPosition) {
      if (source.getModel()?.uri.toString() === resource.toString()) return false;
      const relativePath = projectPathOf(resource);
      const container = source.getContainerDomNode();
      if (relativePath && requestOpenFile(container, relativePath)) {
        const position = selectionOrPosition && "startLineNumber" in selectionOrPosition
          ? { lineNumber: selectionOrPosition.startLineNumber, column: selectionOrPosition.startColumn }
          : selectionOrPosition;
        if (position) pendingReveals.set(resource.toString(), position);
        return true;
      }
      source.trigger("lsp", "editor.action.peekDefinition", {});
      return true;
    },
  });
}

async function runCodeAction(sessionId: string, item: CodeAction | Command, canResolve: boolean): Promise<void> {
  const client = clients.get(sessionId);
  if (!client) return;
  try {
    if (typeof (item as Command).command === "string") {
      const command = item as Command;
      await client.connection.request("workspace/executeCommand", { command: command.command, arguments: command.arguments });
      return;
    }
    let action = item as CodeAction;
    if (!action.edit && canResolve) action = await client.connection.request<CodeAction>("codeAction/resolve", action);
    if (action.edit) {
      const result = await applyWorkspaceEdit(action.edit);
      if (!result.applied) throw new Error(result.failureReason);
    }
    if (action.command) await client.connection.request("workspace/executeCommand", { command: action.command.command, arguments: action.command.arguments });
  } catch (err) {
    console.error("[lsp] code action failed:", err);
  }
}

/** Connects the service to this window's gateway, for multi-file edits and for telling servers about changed files. */
export function attachLspGateway(
  call: GatewayCall,
  onEvent: (handler: (event: { event: string; payload: unknown }) => void) => () => void,
): () => void {
  installOnce();
  gatewayCall = call;
  return onEvent((event) => {
    if (event.event !== "fs.contentChanged" || !root()) return;
    const paths = (event.payload as { paths?: unknown } | null)?.paths;
    if (!Array.isArray(paths) || clients.size === 0) return;
    const changes = paths.filter((p): p is string => typeof p === "string").map((p) => ({ uri: monaco.Uri.file(`${root()}/${p}`).toString(), type: 2 }));
    for (const client of clients.values()) client.connection.notify("workspace/didChangeWatchedFiles", { changes });
  });
}

/** Drops a closed tab's model so servers stop treating that file as open. */
export function releaseModel(path: string): void {
  const uri = monaco.Uri.parse(modelPathFor(path));
  // After the editor has moved on to another model.
  setTimeout(() => {
    const model = monaco.editor.getModel(uri);
    if (model && !monaco.editor.getEditors().some((e) => e.getModel() === model)) model.dispose();
  }, 0);
}

export function isServerConnected(serverId: string): boolean {
  return [...clients.values()].some((c) => c.info.serverId === serverId && c.providers !== null);
}

/** Tries a language's servers again, for one that lives outside the app and has been opened since. */
export function retryLanguage(language: string): void {
  languagesRequested.delete(language);
  restarts.clear();
  void ensureLanguage(language);
}

/** Goes to where a "go to definition" was headed, once the file it opened is showing. */
export function revealPending(editor: monaco.editor.ICodeEditor): void {
  const uri = editor.getModel()?.uri.toString();
  const position = uri ? pendingReveals.get(uri) : undefined;
  if (!uri || !position) return;
  pendingReveals.delete(uri);
  editor.setPosition(position);
  editor.revealPositionInCenter(position);
  editor.focus();
}

/** Applies ESLint's safe fixes to a file, for the fix-on-save preference. */
export async function fixAllOnSave(model: monaco.editor.ITextModel): Promise<void> {
  const client = [...clients.values()].find((c) => c.info.serverId === "eslint" && c.documents.has(model));
  if (!client) return;
  const end = model.getFullModelRange();
  const actions = await client.connection.request<CodeAction[] | null>("textDocument/codeAction", {
    textDocument: { uri: model.uri.toString() },
    range: { start: { line: 0, character: 0 }, end: { line: end.endLineNumber - 1, character: end.endColumn - 1 } },
    context: { diagnostics: [], only: ["source.fixAll.eslint"] },
  });
  for (const found of actions ?? []) {
    const action = found.edit ? found : await client.connection.request<CodeAction>("codeAction/resolve", found);
    if (action.edit) await applyWorkspaceEdit(action.edit);
  }
}

export type ProjectProblem = { uri: string; path: string; severity: number; message: string; source?: string; startLineNumber: number; startColumn: number };

/** Every problem servers have reported, except the given file's, for the problems list. */
export function otherFilesProblems(currentUri: string | undefined): ProjectProblem[] {
  const problems: ProjectProblem[] = [];
  for (const client of clients.values()) {
    for (const [uri, diagnostics] of client.diagnostics) {
      if (uri === currentUri) continue;
      const path = projectPathOf(monaco.Uri.parse(uri));
      if (!path) continue;
      for (const diagnostic of diagnostics) {
        const marker = toMarker(diagnostic);
        problems.push({ uri, path, severity: marker.severity, message: marker.message, source: marker.source, startLineNumber: marker.startLineNumber, startColumn: marker.startColumn });
      }
    }
  }
  return problems;
}

export function onDiagnosticsChanged(listener: () => void): () => void {
  diagnosticListeners.add(listener);
  return () => diagnosticListeners.delete(listener);
}

/** Opens another file's problem from the problems list. */
export function openProblem(from: Element, problem: ProjectProblem): void {
  pendingReveals.set(problem.uri, { lineNumber: problem.startLineNumber, column: problem.startColumn });
  requestOpenFile(from, problem.path);
}

export type LspStatus = {
  trusted: boolean;
  servers: Array<{ id: string; languages: string[]; status: "available" | "missing" | "needsTrust" | "notApplicable" | "running"; installHint?: string; error?: string }>;
};

export function fetchLspStatus(): Promise<LspStatus> {
  return window.yggdrasil.lsp.status() as Promise<LspStatus>;
}
