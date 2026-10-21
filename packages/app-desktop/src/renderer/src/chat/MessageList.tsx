import { useEffect, useRef } from "react";
import { CheckIcon, XMarkIcon } from "@heroicons/react/20/solid";
import type { ChatMessage } from "./chatReducer.js";
import { Markdown } from "./Markdown.js";

type Props = {
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  isTurnActive: boolean;
  runningTools: string[];
};

function ToolBubble({ message }: { message: ChatMessage }) {
  const ok = message.toolStatus === "ok";
  return (
    <div className={`bubble tool ${ok ? "tool-ok" : "tool-error"}`}>
      <div className="tool-header">
        <span className="tool-icon">{ok ? <CheckIcon className="hero-icon" /> : <XMarkIcon className="hero-icon" />}</span>
        <span className="tool-name">{message.toolName}</span>
        {message.toolArgs && (
          <span className="tool-args">{JSON.stringify(message.toolArgs)}</span>
        )}
      </div>
      {message.text && <pre className="tool-result">{message.text}</pre>}
      {message.toolImage && (
        <details className="tool-image">
          <summary>{message.toolImage.path ? message.toolImage.path : "Ver imagen"}</summary>
          <img
            src={`data:${message.toolImage.mimeType};base64,${message.toolImage.base64}`}
            alt={message.toolName ? `Resultado de ${message.toolName}` : "Captura"}
          />
        </details>
      )}
    </div>
  );
}

const BOTTOM_THRESHOLD_PX = 48;

export function MessageList({ messages, streamingText, isStreaming, isTurnActive, runningTools }: Props) {
  const endRef = useRef<HTMLDivElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  // Whether the user is pinned to the bottom — only then do we auto-scroll
  // on new content. Scrolling up mid-stream (to reread something while a
  // long response keeps arriving) unpins it so we stop yanking them back down.
  const pinnedToBottomRef = useRef(true);
  // A turn can sit silent for a while before its first delta or tool call
  // shows up (cold local-model load, planning before acting, ...) — without
  // this, sending a message looked like nothing was happening at all.
  const isThinking = isTurnActive && !isStreaming && runningTools.length === 0;

  useEffect(() => {
    if (pinnedToBottomRef.current) {
      endRef.current?.scrollIntoView({ block: "end" });
    }
  }, [messages.length, streamingText, isThinking]);

  // New user turn always resets the pin, so the next reply scrolls into view
  // even if the user was reading scrollback during the previous one.
  useEffect(() => {
    pinnedToBottomRef.current = true;
  }, [messages.length]);

  const handleScroll = () => {
    const el = containerRef.current;
    if (!el) return;
    const distanceFromBottom = el.scrollHeight - el.scrollTop - el.clientHeight;
    pinnedToBottomRef.current = distanceFromBottom <= BOTTOM_THRESHOLD_PX;
  };

  const isEmpty = messages.length === 0 && !isStreaming && !isThinking && runningTools.length === 0;

  return (
    <div className="message-list" ref={containerRef} onScroll={handleScroll}>
      {isEmpty && (
        <div className="message-list-empty">
          <div>
            <p className="message-list-empty-title">What should we work on?</p>
            <p>No conversation yet. Type below, or mention a file with @.</p>
          </div>
        </div>
      )}
      {messages.map((m) =>
        m.role === "tool" ? (
          <ToolBubble key={m.id} message={m} />
        ) : m.role === "assistant" ? (
          <div key={m.id} className="bubble assistant">
            <Markdown text={m.text} />
          </div>
        ) : (
          <div key={m.id} className={`bubble ${m.role}`}>
            {m.text}
          </div>
        ),
      )}
      {isStreaming && (
        <div className="bubble assistant">
          <Markdown text={streamingText} />
          <span className="cursor">▌</span>
        </div>
      )}
      {isThinking && (
        <div className="bubble assistant thinking">
          <span className="thinking-dot" />
          <span className="thinking-dot" />
          <span className="thinking-dot" />
        </div>
      )}
      {runningTools.map((name) => (
        <div key={name} className="tool-running">
          <span className="spinner" />
          {name}
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
