import * as monaco from "monaco-editor";
import type {
  CodeAction,
  Command,
  CompletionItem,
  CompletionList,
  Definition,
  Diagnostic,
  DocumentHighlight,
  DocumentSymbol,
  Hover,
  Location,
  LocationLink,
  MarkupContent,
  ServerCapabilities,
  SignatureHelp,
  SymbolInformation,
  TextEdit,
  WorkspaceEdit,
} from "vscode-languageserver-protocol";
import type { LspConnection } from "./connection.js";
import { completionKindName, diagnosticKey, symbolKindName, toLspRange, toMonacoRange } from "./convert.js";

const IDENTITY = { dispose: () => {} };

export type ProviderHost = {
  connection: LspConnection;
  capabilities: ServerCapabilities;
  /** Loads a file a result points at, so Monaco can show it. */
  ensureModel: (uri: string) => Promise<void>;
  applyWorkspaceEdit: (edit: WorkspaceEdit) => Promise<{ applied: boolean; failureReason?: string }>;
  /** The diagnostic behind a marker, by diagnosticKey. */
  diagnosticFor: (modelUri: string, key: string) => Diagnostic | undefined;
};

export const RUN_CODE_ACTION = "ygg.lsp.runCodeAction";
export const EXECUTE_COMMAND = "ygg.lsp.executeCommand";

function docParams(model: monaco.editor.ITextModel, position: monaco.Position) {
  return {
    textDocument: { uri: model.uri.toString() },
    position: { line: position.lineNumber - 1, character: position.column - 1 },
  };
}

function markup(value: string | MarkupContent | undefined): monaco.IMarkdownString | string | undefined {
  if (value === undefined) return undefined;
  if (typeof value === "string") return value;
  return value.kind === "markdown" ? { value: value.value } : value.value;
}

function toEdits(edits: TextEdit[] | null): monaco.languages.TextEdit[] {
  return (edits ?? []).map((edit) => ({ range: toMonacoRange(edit.range), text: edit.newText }));
}

function hoverContents(contents: Hover["contents"]): monaco.IMarkdownString[] {
  const one = (c: unknown): monaco.IMarkdownString => {
    if (typeof c === "string") return { value: c };
    const { value, language, kind } = c as { value: string; language?: string; kind?: string };
    if (language) return { value: "```" + language + "\n" + value + "\n```" };
    return { value: kind === "plaintext" ? value.replace(/[\\`*_{}[\]()#+\-.!]/g, "\\$&") : value };
  };
  return (Array.isArray(contents) ? contents : [contents]).map(one);
}

async function toLocations(host: ProviderHost, result: Definition | LocationLink[] | Location[] | null): Promise<monaco.languages.Location[]> {
  if (!result) return [];
  const items = (Array.isArray(result) ? result : [result]) as Array<Location | LocationLink>;
  const locations = items.map((item) =>
    "targetUri" in item ? { uri: item.targetUri, range: item.targetSelectionRange } : { uri: item.uri, range: item.range },
  );
  await Promise.all([...new Set(locations.map((l) => l.uri))].map((uri) => host.ensureModel(uri).catch(() => {})));
  return locations.map((l) => ({ uri: monaco.Uri.parse(l.uri), range: toMonacoRange(l.range) }));
}

function toSymbols(items: Array<DocumentSymbol | SymbolInformation>): monaco.languages.DocumentSymbol[] {
  const kind = (k: number) => monaco.languages.SymbolKind[symbolKindName(k)];
  return items.map((item) => {
    if ("location" in item) {
      const range = toMonacoRange(item.location.range);
      return { name: item.name, detail: "", kind: kind(item.kind), tags: [], range, selectionRange: range };
    }
    return {
      name: item.name,
      detail: item.detail ?? "",
      kind: kind(item.kind),
      tags: [],
      range: toMonacoRange(item.range),
      selectionRange: toMonacoRange(item.selectionRange),
      children: item.children ? toSymbols(item.children) : undefined,
    };
  });
}

/** Keeps the LSP item on the Monaco one, since resolving needs the original back. */
type LspCompletion = monaco.languages.CompletionItem & { lsp: CompletionItem };

function toCompletion(item: CompletionItem, defaultRange: monaco.IRange, sessionCommand: string): LspCompletion {
  const edit = item.textEdit;
  const range = edit && "range" in edit ? toMonacoRange(edit.range) : edit && "insert" in edit ? toMonacoRange(edit.insert) : defaultRange;
  const snippet = item.insertTextFormat === 2;
  return {
    lsp: item,
    label: item.labelDetails ? { label: item.label, detail: item.labelDetails.detail, description: item.labelDetails.description } : item.label,
    kind: monaco.languages.CompletionItemKind[completionKindName(item.kind)],
    detail: item.detail,
    documentation: markup(item.documentation),
    sortText: item.sortText,
    filterText: item.filterText,
    preselect: item.preselect,
    insertText: edit?.newText ?? item.insertText ?? item.label,
    insertTextRules: snippet ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet : undefined,
    range,
    commitCharacters: item.commitCharacters,
    additionalTextEdits: item.additionalTextEdits?.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })),
    command: item.command ? { id: EXECUTE_COMMAND, title: item.command.title, arguments: [sessionCommand, item.command] } : undefined,
  };
}

/** Registers a server's features with Monaco for these languages. Only real files: not diffs, not markdown. */
export function registerProviders(host: ProviderHost, languages: string[], sessionId: string): monaco.IDisposable {
  const { connection, capabilities: caps } = host;
  const selector = languages.map((language) => ({ language, scheme: "file" }));
  const subs: monaco.IDisposable[] = [];

  if (caps.completionProvider) {
    const canResolve = caps.completionProvider.resolveProvider === true;
    subs.push(
      monaco.languages.registerCompletionItemProvider(selector, {
        triggerCharacters: caps.completionProvider.triggerCharacters,
        provideCompletionItems: async (model, position, context, token) => {
          const result = await connection.request<CompletionItem[] | CompletionList | null>(
            "textDocument/completion",
            {
              ...docParams(model, position),
              context: { triggerKind: context.triggerKind + 1, triggerCharacter: context.triggerCharacter },
            },
            token,
          );
          const word = model.getWordUntilPosition(position);
          const range = { startLineNumber: position.lineNumber, endLineNumber: position.lineNumber, startColumn: word.startColumn, endColumn: word.endColumn };
          const items = Array.isArray(result) ? result : (result?.items ?? []);
          return {
            incomplete: !Array.isArray(result) && result?.isIncomplete === true,
            suggestions: items.map((item) => toCompletion(item, range, sessionId)),
          };
        },
        resolveCompletionItem: canResolve
          ? async (item, token) => {
              const lspItem = (item as LspCompletion).lsp;
              const resolved = await connection.request<CompletionItem>("completionItem/resolve", lspItem, token);
              return {
                ...item,
                detail: resolved.detail ?? item.detail,
                documentation: markup(resolved.documentation) ?? item.documentation,
                additionalTextEdits: resolved.additionalTextEdits?.map((e) => ({ range: toMonacoRange(e.range), text: e.newText })) ?? item.additionalTextEdits,
              };
            }
          : undefined,
      }),
    );
  }

  if (caps.hoverProvider) {
    subs.push(
      monaco.languages.registerHoverProvider(selector, {
        provideHover: async (model, position, token) => {
          const hover = await connection.request<Hover | null>("textDocument/hover", docParams(model, position), token);
          if (!hover) return null;
          return { contents: hoverContents(hover.contents), range: hover.range ? toMonacoRange(hover.range) : undefined };
        },
      }),
    );
  }

  if (caps.signatureHelpProvider) {
    subs.push(
      monaco.languages.registerSignatureHelpProvider(selector, {
        signatureHelpTriggerCharacters: caps.signatureHelpProvider.triggerCharacters,
        signatureHelpRetriggerCharacters: caps.signatureHelpProvider.retriggerCharacters,
        provideSignatureHelp: async (model, position, token) => {
          const help = await connection.request<SignatureHelp | null>("textDocument/signatureHelp", docParams(model, position), token);
          if (!help) return null;
          return {
            value: {
              activeSignature: help.activeSignature ?? 0,
              activeParameter: help.activeParameter ?? 0,
              signatures: help.signatures.map((signature) => ({
                label: signature.label,
                documentation: markup(signature.documentation),
                parameters: (signature.parameters ?? []).map((p) => ({ label: p.label, documentation: markup(p.documentation) })),
                activeParameter: signature.activeParameter ?? undefined,
              })),
            },
            dispose: () => {},
          };
        },
      }),
    );
  }

  if (caps.definitionProvider) {
    subs.push(
      monaco.languages.registerDefinitionProvider(selector, {
        provideDefinition: async (model, position, token) =>
          toLocations(host, await connection.request<Definition | LocationLink[] | null>("textDocument/definition", docParams(model, position), token)),
      }),
    );
  }

  if (caps.typeDefinitionProvider) {
    subs.push(
      monaco.languages.registerTypeDefinitionProvider(selector, {
        provideTypeDefinition: async (model, position, token) =>
          toLocations(host, await connection.request<Definition | LocationLink[] | null>("textDocument/typeDefinition", docParams(model, position), token)),
      }),
    );
  }

  if (caps.referencesProvider) {
    subs.push(
      monaco.languages.registerReferenceProvider(selector, {
        provideReferences: async (model, position, context, token) =>
          toLocations(
            host,
            await connection.request<Location[] | null>("textDocument/references", { ...docParams(model, position), context: { includeDeclaration: context.includeDeclaration } }, token),
          ),
      }),
    );
  }

  if (caps.documentHighlightProvider) {
    subs.push(
      monaco.languages.registerDocumentHighlightProvider(selector, {
        provideDocumentHighlights: async (model, position, token) => {
          const items = await connection.request<DocumentHighlight[] | null>("textDocument/documentHighlight", docParams(model, position), token);
          return (items ?? []).map((item) => ({ range: toMonacoRange(item.range), kind: ((item.kind ?? 1) - 1) as monaco.languages.DocumentHighlightKind }));
        },
      }),
    );
  }

  if (caps.documentSymbolProvider) {
    subs.push(
      monaco.languages.registerDocumentSymbolProvider(selector, {
        provideDocumentSymbols: async (model, token) => {
          const items = await connection.request<Array<DocumentSymbol | SymbolInformation> | null>("textDocument/documentSymbol", { textDocument: { uri: model.uri.toString() } }, token);
          return toSymbols(items ?? []);
        },
      }),
    );
  }

  if (caps.renameProvider) {
    subs.push(
      monaco.languages.registerRenameProvider(selector, {
        // A rename can reach files with no editor, so it's applied here instead of by Monaco.
        provideRenameEdits: async (model, position, newName, token) => {
          const edit = await connection.request<WorkspaceEdit | null>("textDocument/rename", { ...docParams(model, position), newName }, token);
          if (!edit) return { edits: [] };
          const result = await host.applyWorkspaceEdit(edit);
          return result.applied ? { edits: [] } : { edits: [], rejectReason: result.failureReason };
        },
      }),
    );
  }

  if (caps.codeActionProvider) {
    const canResolve = typeof caps.codeActionProvider === "object" && caps.codeActionProvider.resolveProvider === true;
    subs.push(
      monaco.languages.registerCodeActionProvider(selector, {
        provideCodeActions: async (model, range, context, token) => {
          const uri = model.uri.toString();
          const diagnostics = context.markers
            .map((marker) => host.diagnosticFor(uri, diagnosticKey(marker, marker.message)))
            .filter((d): d is Diagnostic => d !== undefined);
          const items = await connection.request<Array<CodeAction | Command> | null>(
            "textDocument/codeAction",
            { textDocument: { uri }, range: toLspRange(range), context: { diagnostics, only: context.only ? [context.only] : undefined } },
            token,
          );
          return {
            actions: (items ?? []).map((item) => {
              const isCommand = typeof (item as Command).command === "string";
              const action = item as CodeAction;
              return {
                title: item.title,
                kind: isCommand ? undefined : action.kind,
                isPreferred: isCommand ? undefined : action.isPreferred,
                disabled: isCommand ? undefined : action.disabled?.reason,
                command: { id: RUN_CODE_ACTION, title: item.title, arguments: [sessionId, item, canResolve] },
              };
            }),
            dispose: () => {},
          };
        },
      }),
    );
  }

  const formatOptions = (options: monaco.languages.FormattingOptions) => ({ tabSize: options.tabSize, insertSpaces: options.insertSpaces });
  if (caps.documentFormattingProvider) {
    subs.push(
      monaco.languages.registerDocumentFormattingEditProvider(selector, {
        provideDocumentFormattingEdits: async (model, options, token) =>
          toEdits(await connection.request<TextEdit[] | null>("textDocument/formatting", { textDocument: { uri: model.uri.toString() }, options: formatOptions(options) }, token)),
      }),
    );
  }
  if (caps.documentRangeFormattingProvider) {
    subs.push(
      monaco.languages.registerDocumentRangeFormattingEditProvider(selector, {
        provideDocumentRangeFormattingEdits: async (model, range, options, token) =>
          toEdits(await connection.request<TextEdit[] | null>("textDocument/rangeFormatting", { textDocument: { uri: model.uri.toString() }, range: toLspRange(range), options: formatOptions(options) }, token)),
      }),
    );
  }

  return { dispose: () => [...subs, IDENTITY].forEach((sub) => sub.dispose()) };
}
