import { useEffect, useRef, useState } from "react";
import { useGateway } from "@yggdrasil/client-web";

type Message = { role: "user" | "assistant"; text: string; streaming?: boolean };

const SESSION_KEY = "web:default:user";

export function ChatPage() {
  const { callWithEvents, onEvent, connected } = useGateway();
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [sending, setSending] = useState(false);
  const streamRef = useRef("");

  useEffect(() => {
    return onEvent((ev) => {
      if (ev.event === "chat.delta") {
        const p = ev.payload as { sessionKey?: string; text?: string };
        if (p.sessionKey && p.sessionKey !== SESSION_KEY) return;
        streamRef.current += p.text ?? "";
        setMessages((prev) => {
          const next = [...prev];
          const last = next[next.length - 1];
          if (last?.role === "assistant" && last.streaming) {
            next[next.length - 1] = { role: "assistant", text: streamRef.current, streaming: true };
          } else {
            next.push({ role: "assistant", text: streamRef.current, streaming: true });
          }
          return next;
        });
      }
      if (ev.event === "chat.final") {
        const p = ev.payload as { sessionKey?: string; text?: string };
        if (p.sessionKey && p.sessionKey !== SESSION_KEY) return;
        const text = p.text ?? streamRef.current;
        streamRef.current = "";
        setMessages((prev) => {
          const withoutPartial = prev.filter((m) => !(m.role === "assistant" && m.streaming));
          return [...withoutPartial, { role: "assistant", text }];
        });
      }
    });
  }, [onEvent, connected]);

  const send = async () => {
    const text = input.trim();
    if (!text || sending) return;
    setInput("");
    setSending(true);
    streamRef.current = "";
    setMessages((prev) => [...prev, { role: "user", text }]);

    try {
      const { result } = await callWithEvents<{ reply?: string }>("chat.send", {
        message: text,
        channelId: "web",
        accountId: "default",
        senderId: "user",
        sessionKey: SESSION_KEY,
      });
      if (result.reply) {
        setMessages((prev) => {
          const hasFinal = prev.some((m) => m.role === "assistant" && !m.streaming);
          if (hasFinal) return prev;
          return [...prev.filter((m) => !(m.role === "assistant" && m.streaming)), { role: "assistant", text: result.reply! }];
        });
      }
    } catch (err) {
      setMessages((prev) => [
        ...prev,
        { role: "assistant", text: `Error: ${err instanceof Error ? err.message : String(err)}` },
      ]);
    } finally {
      setSending(false);
      streamRef.current = "";
    }
  };

  return (
    <div className="page chat-page">
      <h1>Chat</h1>
      <p className="muted">sessionKey: {SESSION_KEY}</p>
      <div className="chat-log">
        {messages.map((m, i) => (
          <div key={i} className={`bubble ${m.role}`}>
            {m.text}
            {m.streaming && <span className="cursor">▌</span>}
          </div>
        ))}
      </div>
      <form
        className="chat-input"
        onSubmit={(e) => {
          e.preventDefault();
          void send();
        }}
      >
        <input
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder="Escribe un mensaje…"
          disabled={sending}
        />
        <button type="submit" disabled={sending || !input.trim()}>
          Enviar
        </button>
      </form>
    </div>
  );
}
