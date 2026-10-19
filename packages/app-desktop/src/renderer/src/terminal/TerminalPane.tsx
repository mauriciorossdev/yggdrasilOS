import { useEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import {
  ArrowRightIcon,
  ArrowsPointingInIcon,
  ArrowsPointingOutIcon,
  MicrophoneIcon,
  MinusIcon,
  PlayIcon,
  SpeakerWaveIcon,
  StopIcon,
  ViewColumnsIcon,
  XMarkIcon,
} from "@heroicons/react/20/solid";
import { Terminal } from "@xterm/xterm";
import { FitAddon } from "@xterm/addon-fit";
import { WebLinksAddon } from "@xterm/addon-web-links";
import "@xterm/xterm/css/xterm.css";
import { useGateway } from "@yggdrasil/client-web";
import type { LeafPane, PaneAction } from "./paneTree.js";
import type { TerminalRegistry } from "./terminalRegistry.js";
import { getFlowLink } from "./flowLinks.js";
import { captureVisibleText } from "./captureBuffer.js";
import { formatElapsed, useDictation } from "./useDictation.js";
import { useSpeakLastResponse } from "./useSpeakLastResponse.js";
import { SpeakModeMenu } from "./SpeakModeMenu.js";
import { PathLinkProvider } from "./pathLinkProvider.js";
import type { SessionRecord } from "../types.js";
import { FILE_DRAG_MIME, type FileDragPayload } from "../files/dragMimeType.js";
import { requestOpenDocument } from "../chat/documentsBridge.js";
import { requestTab } from "../chat/mainTabsBridge.js";
import { usePaneSpec } from "./usePaneSpec.js";

// Strips a trailing "claude code"-style ":line" or ":line:col" locator —
// TextEditor has no jump-to-line yet, so only the path itself is used.
function stripLocator(path: string): string {
  return path.replace(/:\d+(?::\d+)?$/, "");
}

// Project-relative path for DocumentsView's fs.read/fs.write, or null when
// the clicked text is an absolute path outside this project (nothing
// sensible to open in-app — e.g. a system binary's path in a command echo).
function toProjectRelativePath(raw: string, projectPath: string | null): string | null {
  const path = stripLocator(raw);
  if (!path.startsWith("/")) return path.replace(/^\.\//, "");
  if (projectPath && (path === projectPath || path.startsWith(`${projectPath}/`))) {
    return path.slice(projectPath.length + 1) || ".";
  }
  return null;
}

// Same convention as a real terminal's drag-and-drop-a-file behavior
// (iTerm2, Terminal.app): wrap in single quotes so spaces/special
// characters in the path paste safely, escaping any embedded quote.
function shellQuote(path: string): string {
  return `'${path.replace(/'/g, "'\\''")}'`;
}

type Props = {
  leaf: LeafPane;
  registry: TerminalRegistry;
  projectPath: string | null;
  active: boolean;
  onFocus: () => void;
  onRename: (title: string) => void;
  onSplit: (direction: "row" | "column") => void;
  onClose: () => void;
  onMinimize: () => void;
  onDelegated?: (targetLeafId: string) => void;
  dispatch: React.Dispatch<PaneAction>;
  /** A phone is currently viewing/controlling this pane (main/terminals.ts's expandTerminalForMobile) — see the "Focus on mobile" overlay below. */
  mobileFocused?: boolean;
  /**
   * Rendered inside a TerminalCanvasView node (react-flow) rather than the
   * grid's flex tree — react-flow applies an inline pan/zoom `transform` to
   * its viewport element every frame, which makes `position: fixed`
   * (used by the expand overlay and the Delegate modal below) contained by
   * that transformed ancestor instead of the real window (CSS containment
   * rule), so both overlays are portaled to document.body when this is
   * true. Also disables the header's native-HTML5 pane-swap drag: in
   * Canvas mode "moving a pane" already means dragging its node, and a
   * second, competing pointer-vs-native-DnD protocol on the same header
   * isn't meaningful there.
   */
  canvasMode?: boolean;
};

export function TerminalPane({
  leaf,
  registry,
  projectPath,
  active,
  onFocus,
  onRename,
  onSplit,
  onClose,
  onMinimize,
  onDelegated,
  dispatch,
  mobileFocused,
  canvasMode,
}: Props) {
  const { call } = useGateway();
  const { specPath, badge: specBadge } = usePaneSpec(leaf.id);
  const containerRef = useRef<HTMLDivElement>(null);
  const [exited, setExited] = useState(false);
  const [taskSent, setTaskSent] = useState(false);
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState(leaf.title);
  const [delegateTargetId, setDelegateTargetId] = useState("");
  const [delegateOpen, setDelegateOpen] = useState(false);
  const [delegateDraft, setDelegateDraft] = useState("");
  const [delegateError, setDelegateError] = useState<string | null>(null);
  const [isExpanded, setIsExpanded] = useState(false);
  const [isClosingExpanded, setIsClosingExpanded] = useState(false);
  const [speakMenu, setSpeakMenu] = useState<{ x: number; y: number } | null>(null);
  // Set once the user edits the draft, so the async sessions.get upgrade
  // (openDelegate below) never clobbers an in-progress hand edit.
  const delegateDraftTouchedRef = useRef(false);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    let cancelled = false;

    let entry = registry.get(leaf.id);
    if (!entry) {
      const term = new Terminal({
        fontFamily: 'ui-monospace, "SF Mono", Consolas, monospace',
        fontSize: 13,
        theme: { background: "#000000", foreground: "#e6e6e6" },
        // Without this, ConPTY's line-wrap padding makes xterm.js misplace or
        // drop characters (spaces included) when a redrawing TUI like the
        // `claude` CLI repaints a line — see preload's windowsBuildNumber.
        windowsPty:
          window.yggdrasil.platform === "win32"
            ? { backend: "conpty", buildNumber: window.yggdrasil.windowsBuildNumber ?? 0 }
            : undefined,
      });
      const fitAddon = new FitAddon();
      term.loadAddon(fitAddon);

      // URLs open in the OS browser; file paths open in the Documents panel
      // (fs.read is sandboxed to this project's root — see
      // toProjectRelativePath — so there's nowhere else sensible to put an
      // in-app file viewer for them). Default WebLinksAddon behavior
      // (`window.open()` with no args, then set `.location.href`) opens
      // "about:blank" in the OS browser under Electron's own
      // setWindowOpenHandler instead of the real URL — passing the uri to
      // `window.open` directly up front sidesteps that.
      term.loadAddon(new WebLinksAddon((_event, uri) => window.open(uri, "_blank", "noopener")));
      term.registerLinkProvider(
        new PathLinkProvider(term, (_event, path) => {
          const relativePath = toProjectRelativePath(path, projectPath);
          if (relativePath == null) return;
          requestOpenDocument(relativePath);
          requestTab("documents");
        }),
      );

      entry = { term, fitAddon, opened: false, exited: false, exitCode: null, taskSent: false };
      registry.set(leaf.id, entry);

      const spawn = () =>
        void window.yggdrasil.terminals.create({
          id: leaf.id,
          cwd: leaf.cwd,
          cols: 80,
          rows: 24,
          command: leaf.command,
          args: leaf.args,
          env: leaf.env,
          yggdrasilAgentId: leaf.yggdrasilAgentId,
          sessionKey: leaf.sessionKey,
          readOnly: leaf.readOnly,
          flowNodeId: leaf.flowNodeId,
          initialPrompt: leaf.initialPrompt,
          initialPromptFlag: leaf.initialPromptFlag,
        });

      if (leaf.attach) {
        // A create_pane MCP call already spawned this pty in the main
        // process — attach to it instead of respawning (which would kill
        // whatever the agent has running). The only exception is a restored
        // leaf whose pty didn't survive an app restart: terminals.read
        // resolves undefined for an unknown id, same fallback as a plain pane.
        void window.yggdrasil.terminals.read(leaf.id).then((backlog) => {
          if (cancelled) return;
          if (backlog === undefined) spawn();
          else if (backlog) term.write(backlog);
        });
      } else {
        spawn();
      }

      term.onData((data) => void window.yggdrasil.terminals.write(leaf.id, data));

      entry.unsubData = window.yggdrasil.terminals.onData((id, chunk) => {
        if (id === leaf.id) term.write(chunk);
      });
      entry.unsubExit = window.yggdrasil.terminals.onExit((id, exitCode) => {
        if (id !== leaf.id) return;
        const e = registry.get(leaf.id);
        if (!e) return;
        e.exited = true;
        e.exitCode = exitCode;
        term.write(`\r\n\x1b[90m[process exited${exitCode != null ? ` (code ${exitCode})` : ""}]\x1b[0m\r\n`);
        e.onExitedChange?.();
      });
    }

    // Re-parent the persistent xterm DOM into *this* mount's container — a
    // split/close elsewhere in the pane tree changes this leaf's own
    // position in the JSX tree (see TerminalContainer's module comment),
    // which forces React to unmount+remount whatever renders here even
    // though the leaf itself never went away. `term`/the live pty survive
    // in `registry`, keyed by leaf.id, untouched by that churn — only the
    // DOM attachment point moves.
    if (!entry.opened) {
      entry.term.open(container);
      entry.opened = true;
    } else {
      container.appendChild(entry.term.element!);
    }
    entry.fitAddon.fit();
    setExited(entry.exited);
    setTaskSent(entry.taskSent);
    entry.onExitedChange = () => setExited(entry!.exited);

    const resizeObserver = new ResizeObserver(() => {
      entry!.fitAddon.fit();
      void window.yggdrasil.terminals.resize(leaf.id, entry!.term.cols, entry!.term.rows);
    });
    resizeObserver.observe(container);

    return () => {
      cancelled = true;
      resizeObserver.disconnect();
      entry!.onExitedChange = undefined;
      // Deliberately no term.dispose()/terminals.dispose() here — this
      // cleanup fires on every remount the tree causes, not just a real
      // close. Actual teardown happens in TerminalContainer's prune effect,
      // once the leaf is genuinely gone from the pane tree.
    };
    // isExpanded is a dep too: toggling it swaps this whole pane between
    // rendering inline and rendering through a document.body portal (see
    // the return statement below) — a different container DOM node either
    // way, same "leaf moved position in the tree" case this effect already
    // exists to handle, so re-running it re-parents entry.term.element into
    // whichever container is current instead of leaving it attached to a
    // now-detached one.
  }, [leaf.id, registry, isExpanded]);

  const restart = () => {
    const entry = registry.get(leaf.id);
    if (!entry) return;
    entry.term.clear();
    entry.exited = false;
    setExited(false);
    void window.yggdrasil.terminals.create({
      id: leaf.id,
      cwd: leaf.cwd,
      cols: entry.term.cols,
      rows: entry.term.rows,
      command: leaf.command,
      args: leaf.args,
      env: leaf.env,
      yggdrasilAgentId: leaf.yggdrasilAgentId,
      sessionKey: leaf.sessionKey,
      readOnly: leaf.readOnly,
      flowNodeId: leaf.flowNodeId,
      initialPrompt: leaf.initialPrompt,
      initialPromptFlag: leaf.initialPromptFlag,
    });
  };

  const commitTitle = () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (trimmed && trimmed !== leaf.title) onRename(trimmed);
    else setTitleDraft(leaf.title);
  };

  const flowLink = getFlowLink(leaf.id);

  const dictation = useDictation((text) => {
    const entry = registry.get(leaf.id);
    if (!entry) return;
    entry.term.paste(text);
    entry.term.focus();
  });

  const speakLastResponse = useSpeakLastResponse(leaf.id);

  const openDelegate = () => {
    const own = registry.get(leaf.id);
    // Instant fallback so the modal is never empty/stuck — for a yggdrasil
    // pane with a known session, this gets replaced below by the real,
    // untruncated, un-markdown'd last reply as soon as sessions.get answers
    // (screen-scraping app-tui's own rendering can never fully recover
    // that: long replies get viewport-truncated, and assistant text is
    // markdown-rendered — backticks/bold/headings stripped — before it's
    // ever painted to the terminal).
    setDelegateDraft(own ? captureVisibleText(own.term) : "");
    setDelegateTargetId(flowLink?.targets[0]?.leafId ?? "");
    setDelegateError(null);
    delegateDraftTouchedRef.current = false;
    setDelegateOpen(true);

    if (leaf.yggdrasilAgentId && leaf.sessionKey) {
      const sessionKey = leaf.sessionKey;
      void call<{ session: SessionRecord | null }>("sessions.get", { sessionKey })
        .then((res) => {
          if (delegateDraftTouchedRef.current) return;
          const lastAssistant = [...(res.session?.messages ?? [])].reverse().find((m) => m.role === "assistant");
          if (lastAssistant?.content) setDelegateDraft(lastAssistant.content);
        })
        .catch(() => {
          // Keep the screen-scrape draft already showing — never worse than
          // today's behavior.
        });
    }
  };

  // The stored task (leaf.initialPrompt) is never auto-submitted on spawn —
  // instantiating a pane must never trigger work by itself (see
  // main/terminals.ts). This is the explicit human action that actually
  // delivers it: same write+delayed-Enter mechanism as write_pane
  // (paneControlServer.ts) and the delegate flow below, so a burst of
  // multi-line text reads as a genuine submit, not a paste.
  const sendInitialTask = () => {
    const entry = registry.get(leaf.id);
    if (!leaf.initialPrompt || !entry) return;
    void window.yggdrasil.terminals.write(leaf.id, leaf.initialPrompt);
    setTimeout(() => void window.yggdrasil.terminals.write(leaf.id, "\r"), 80);
    entry.taskSent = true;
    setTaskSent(true);
  };

  const sendDelegate = () => {
    const target = registry.get(delegateTargetId);
    if (!target) {
      setDelegateError("Target pane is no longer open.");
      return;
    }
    target.term.paste(delegateDraft);
    void window.yggdrasil.terminals.write(delegateTargetId, "\r");
    onDelegated?.(delegateTargetId);
    setDelegateOpen(false);
  };

  // Plays the shrink-back-down animation before actually leaving fixed/expanded
  // positioning — the pane stays mounted with the `expanded` class throughout so
  // it keeps its fixed-viewport box while `.closing` runs the reverse keyframe.
  const collapseExpanded = () => setIsClosingExpanded(true);

  // Both this pane's expand overlay and its Delegate modal below use
  // `position: fixed` to cover the real window — but react-flow applies an
  // inline pan/zoom `transform` to its viewport ancestor every frame when
  // this pane is rendered inside a TerminalCanvasView node (canvasMode),
  // and per CSS containment rules a `transform` on an ancestor makes
  // `position: fixed` relative to THAT ancestor instead of the viewport.
  // Portaling to document.body sidesteps that entirely — harmless in grid
  // mode too, since there's no transformed ancestor there to begin with.
  const paneContent = (
    <>
      {isExpanded && (
        <div
          className={`terminal-pane-expand-backdrop${isClosingExpanded ? " closing" : ""}`}
          onClick={collapseExpanded}
        />
      )}
      <div
        className={`terminal-pane${active ? " active" : ""}${isExpanded ? " expanded" : ""}${
          isClosingExpanded ? " closing" : ""
        }`}
        onAnimationEnd={(e) => {
          if (e.animationName === "terminal-pane-collapse") {
            setIsExpanded(false);
            setIsClosingExpanded(false);
          }
        }}
        onMouseDown={onFocus}
        onDragOver={(e) => {
          e.preventDefault();
        }}
        onDrop={(e) => {
          e.preventDefault();

          if (e.dataTransfer.types.includes(FILE_DRAG_MIME)) {
            const raw = e.dataTransfer.getData(FILE_DRAG_MIME);
            if (!raw || !projectPath) return;
            const payload = JSON.parse(raw) as FileDragPayload;
            const absolutePath = `${projectPath}/${payload.relativePath}`;
            registry.get(leaf.id)?.term.paste(shellQuote(absolutePath));
            return;
          }

          // Grid-mode-only: in Canvas mode "moving a pane" already means
          // dragging its node (react-flow's own pointer-based drag, scoped
          // to this same header via dragHandle) — a second, competing
          // native-HTML5-drag protocol on the same element isn't meaningful
          // there, and the header's `draggable` attribute below is already
          // off in that mode so this data never arrives anyway.
          const sourceId = canvasMode ? "" : e.dataTransfer.getData("application/x-yggdrasil-pane");
          if (sourceId && sourceId !== leaf.id) {
            // Don't mutate the pane tree from inside the drop handler itself —
            // SWAP_PANES changes this leaf's position in the JSX tree, which
            // forces React to unmount+remount the very <div draggable> that's
            // still mid native-HTML5-drag at this point (a setTimeout(0) here
            // isn't enough of a delay). Chromium then fails to deliver its
            // drag-teardown IPC (blink.mojom.LocalFrameHost) to the
            // now-destroyed node and kills the renderer — see the white-screen
            // bug this fixed. `dragend` is the one event guaranteed to fire
            // only after the browser has fully finished the drag session, so
            // deferring the dispatch until then is safe.
            const target1 = sourceId;
            const target2 = leaf.id;
            const onDragEnd = () => {
              window.removeEventListener("dragend", onDragEnd);
              dispatch({ type: "SWAP_PANES", id1: target1, id2: target2 });
            };
            window.addEventListener("dragend", onDragEnd);
          }
        }}
      >
        <div
          className="terminal-pane-header"
          draggable={!canvasMode}
          onDragStart={(e) => {
            // Drag handle lives on the header, not the whole pane — the pane
            // body wraps xterm.js's live, focused hidden <textarea>,
            // and starting a native HTML5 drag on a container with a
            // focused text input inside it is a known Chromium/Electron
            // crash: it corrupts the renderer's StartDragging IPC
            // (blink.mojom.LocalFrameHost) and kills the render process
            // (white screen). Keeping the draggable subtree free of any
            // interactive/focused control avoids that.
            e.dataTransfer.setData("application/x-yggdrasil-pane", leaf.id);
          }}
        >
          {editingTitle ? (
            <input
              autoFocus
              value={titleDraft}
              onChange={(e) => setTitleDraft(e.target.value)}
              onBlur={commitTitle}
              onKeyDown={(e) => e.key === "Enter" && commitTitle()}
            />
          ) : (
            <span onDoubleClick={() => setEditingTitle(true)}>{leaf.title}</span>
          )}
          {specPath && specBadge && (
            <button
              type="button"
              className={`pane-spec-badge status-${specBadge.status}`}
              title={`${specPath} — click to open`}
              onClick={() => {
                requestOpenDocument(specPath);
                requestTab("documents");
              }}
            >
              {specBadge.label}
              {specBadge.total > 0 ? ` ${specBadge.done}/${specBadge.total}` : ""}
            </button>
          )}
          <div className="terminal-pane-actions">
            {leaf.initialPrompt && !taskSent && (
              <button
                type="button"
                className="send-task-btn"
                title={leaf.initialPrompt}
                onClick={sendInitialTask}
              >
                Start task <PlayIcon className="hero-icon" />
              </button>
            )}
            {flowLink && flowLink.targets.length > 0 && (
              <button type="button" className="delegate-btn" title="Delegate to another pane" onClick={openDelegate}>
                Delegate <ArrowRightIcon className="hero-icon" />
              </button>
            )}
            <button
              type="button"
              className={`terminal-mic-button${dictation.phase === "recording" ? " recording" : ""}`}
              title={dictation.phase === "recording" ? "Parar dictado" : "Dictar en esta terminal"}
              disabled={exited || dictation.phase === "transcribing"}
              onClick={dictation.toggle}
            >
              <MicrophoneIcon className="hero-icon" />
            </button>
            <button
              type="button"
              className={`terminal-speak-button${speakLastResponse.phase !== "idle" ? " loading" : ""}`}
              title="Hablar última respuesta"
              disabled={exited || speakLastResponse.phase !== "idle"}
              onClick={(e) => {
                const rect = e.currentTarget.getBoundingClientRect();
                setSpeakMenu({ x: rect.left, y: rect.bottom + 4 });
              }}
            >
              <SpeakerWaveIcon className="hero-icon" />
            </button>
            <button
              type="button"
              title={isExpanded ? "Collapse" : "Expand"}
              onClick={() => {
                if (isExpanded) collapseExpanded();
                else setIsExpanded(true);
                onFocus();
              }}
            >
              {isExpanded ? (
                <ArrowsPointingInIcon className="hero-icon" />
              ) : (
                <ArrowsPointingOutIcon className="hero-icon" />
              )}
            </button>
            <button
              type="button"
              title="Split horizontally"
              onClick={() => {
                setIsExpanded(false);
                onSplit("row");
              }}
            >
              <ViewColumnsIcon className="hero-icon" />
            </button>
            <button
              type="button"
              title="Split vertically"
              onClick={() => {
                setIsExpanded(false);
                onSplit("column");
              }}
            >
              <ViewColumnsIcon className="hero-icon terminal-pane-split-vertical" />
            </button>
            <button
              type="button"
              title="Minimize"
              onClick={() => {
                setIsExpanded(false);
                onMinimize();
              }}
            >
              <MinusIcon className="hero-icon" />
            </button>
            {!isExpanded && (
              <button type="button" title="Close" onClick={onClose}>
                <XMarkIcon className="hero-icon" />
              </button>
            )}
          </div>
        </div>
        <div className="terminal-pane-body-wrapper">
          <div className={`terminal-pane-body${exited ? " terminal-pane-exited" : ""}`} ref={containerRef} />
          {dictation.phase !== "idle" && (
            <div className="terminal-voice-bar">
              <span className={`terminal-voice-dot${dictation.phase === "recording" ? "" : " idle"}`} />
              <span>{dictation.phase === "recording" ? "Escuchando" : "Transcribiendo…"}</span>
              {dictation.phase === "recording" && (
                <>
                  <span className="terminal-voice-time">{formatElapsed(dictation.elapsedMs)}</span>
                  <button type="button" className="terminal-voice-stop" onClick={dictation.toggle}>
                    <StopIcon className="hero-icon" />
                    Parar
                  </button>
                </>
              )}
            </div>
          )}
          {dictation.error && (
            <div className="terminal-voice-bar error">
              <span>{dictation.error}</span>
              <button type="button" className="terminal-voice-stop" onClick={dictation.dismissError}>
                Cerrar
              </button>
            </div>
          )}
          {speakLastResponse.error && (
            <div className="terminal-voice-bar error">
              <span>{speakLastResponse.error}</span>
              <button type="button" className="terminal-voice-stop" onClick={speakLastResponse.dismissError}>
                Cerrar
              </button>
            </div>
          )}
          {mobileFocused && (
            <div className="terminal-pane-mobile-focus-overlay">
              <span>Focus on mobile</span>
            </div>
          )}
        </div>
        {exited && (
          <button type="button" className="terminal-pane-restart" onClick={restart}>
            Restart
          </button>
        )}
      </div>
    </>
  );

  return (
    <>
      {isExpanded ? createPortal(paneContent, document.body) : paneContent}
      {speakMenu &&
        createPortal(
          <SpeakModeMenu
            x={speakMenu.x}
            y={speakMenu.y}
            onClose={() => setSpeakMenu(null)}
            onPick={(mode) => void speakLastResponse.speak(mode)}
          />,
          document.body,
        )}
      {delegateOpen &&
        flowLink &&
        createPortal(
          <div className="modal-overlay" onClick={() => setDelegateOpen(false)}>
            <div className="modal delegate-modal" onClick={(e) => e.stopPropagation()}>
              <div className="modal-header">
                <h2>Delegate from {leaf.title}</h2>
                <button type="button" className="icon-btn" onClick={() => setDelegateOpen(false)}>
                  <XMarkIcon className="hero-icon" />
                </button>
              </div>
              {flowLink.targets.length > 1 && (
                <label>
                  Send to
                  <select value={delegateTargetId} onChange={(e) => setDelegateTargetId(e.target.value)}>
                    {flowLink.targets.map((t) => (
                      <option key={t.leafId} value={t.leafId}>
                        {t.name}
                      </option>
                    ))}
                  </select>
                </label>
              )}
              {flowLink.targets.length === 1 && <p className="muted">Send to {flowLink.targets[0]!.name}</p>}
              <textarea
                className="delegate-textarea"
                value={delegateDraft}
                onChange={(e) => {
                  delegateDraftTouchedRef.current = true;
                  setDelegateDraft(e.target.value);
                }}
                rows={10}
                autoFocus
              />
              {delegateError && <p className="error">{delegateError}</p>}
              <div className="agent-form-actions">
                <button type="button" onClick={() => setDelegateOpen(false)}>
                  Cancel
                </button>
                <button type="button" onClick={sendDelegate} disabled={!delegateDraft.trim() || !delegateTargetId}>
                  Send
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  );
}
