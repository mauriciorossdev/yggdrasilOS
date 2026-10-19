import { useEffect, useRef } from "react";
import type { ChatMessage } from "./chatReducer.js";

type Props = {
  messages: ChatMessage[];
  streamingText: string;
  isStreaming: boolean;
  runningTools: string[];
};

function ToolMessage({ message }: { message: ChatMessage }) {
  const ok = message.toolStatus === "ok";
  return (
    <div className={`message message-tool ${ok ? "tool-ok" : "tool-error"}`}>
      <span className="message-role">
        {ok ? "✓" : "✗"} {message.toolName}
      </span>
      {message.toolArgs && <pre className="tool-args">{JSON.stringify(message.toolArgs)}</pre>}
      {message.text && <pre className="tool-result">{message.text}</pre>}
    </div>
  );
}

export function MessageList({ messages, streamingText, isStreaming, runningTools }: Props) {
  const endRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: "smooth" });
  }, [messages, streamingText, runningTools]);

  return (
    <div className="message-list">
      {messages.map((m) =>
        m.role === "tool" ? (
          <ToolMessage key={m.id} message={m} />
        ) : (
          <div key={m.id} className={`message message-${m.role}`}>
            <span className="message-role">{m.role}</span>
            <p>{m.text}</p>
          </div>
        ),
      )}
      {isStreaming && (
        <div className="message message-assistant">
          <span className="message-role">assistant</span>
          <p>{streamingText || "…"}</p>
        </div>
      )}
      {runningTools.map((name) => (
        <div key={name} className="message message-tool tool-running">
          <span className="message-role">
            <span className="spinner" /> {name}…
          </span>
        </div>
      ))}
      <div ref={endRef} />
    </div>
  );
}
