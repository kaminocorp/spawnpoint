"use client";

import { useEffect, useRef, useState } from "react";
import { Code, ConnectError } from "@connectrpc/connect";

import { Button } from "@/components/ui/button";
import { createApiClient } from "@/lib/api/client";

type Message = { role: "user" | "agent"; content: string };

type ChatState =
  | { kind: "idle" }
  | { kind: "sending" }
  | { kind: "error"; code?: Code; message: string };

/**
 * `<ChatPanel>` — single-turn chat UI backed by the `ChatWithAgent` RPC
 * (plan decision 11). Rendered on `/fleet/[id]` for chat-enabled agents.
 *
 * `session_id` is a UUID stored in `sessionStorage` keyed by instance id.
 * Per plan Q4: each tab gets its own conversation; clearing the tab
 * closes the session. Multi-turn history is threaded server-side via
 * the sidecar's per-session SQLite.
 */
export function ChatPanel({ instanceId }: { instanceId: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [chatState, setChatState] = useState<ChatState>({ kind: "idle" });
  const bottomRef = useRef<HTMLDivElement>(null);
  // Synchronous in-flight guard. `chatState` is captured per render,
  // so two Enter presses within one render frame would both observe
  // `idle` and fire two RPCs before the `sending` state propagates.
  // The ref flips immediately and de-duplicates.
  const inFlightRef = useRef(false);

  // Stable session id for this tab + instance. Generated once and
  // persisted in sessionStorage (cleared on tab close, per plan Q4).
  const sessionId = useSessionId(instanceId);

  // Scroll to latest message after each update. requestAnimationFrame
  // defers the scroll to the next paint, avoiding the one-frame race
  // where useEffect runs before the new message bubble has laid out.
  useEffect(() => {
    const id = requestAnimationFrame(() => {
      bottomRef.current?.scrollIntoView({ behavior: "smooth" });
    });
    return () => cancelAnimationFrame(id);
  }, [messages]);

  async function handleSend() {
    if (inFlightRef.current) return;
    const text = input.trim();
    if (!text) return;

    inFlightRef.current = true;
    setInput("");
    setMessages((prev) => [...prev, { role: "user", content: text }]);
    setChatState({ kind: "sending" });

    try {
      const api = createApiClient();
      const res = await api.agents.chatWithAgent({
        instanceId,
        sessionId,
        message: text,
      });
      setMessages((prev) => [
        ...prev,
        { role: "agent", content: res.content },
      ]);
      setChatState({ kind: "idle" });
    } catch (e) {
      const err = ConnectError.from(e);
      setChatState({ kind: "error", code: err.code, message: err.message });
    } finally {
      inFlightRef.current = false;
    }
  }

  function handleKeyDown(e: React.KeyboardEvent<HTMLTextAreaElement>) {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      void handleSend();
    }
  }

  return (
    <div
      className="flex h-full flex-col border border-border bg-black/40"
      role="region"
      aria-label="Chat conversation"
    >
      {/* Header */}
      <div className="flex items-center gap-2 border-b border-border px-4 py-2">
        <span className="font-display text-[11px] uppercase tracking-widest text-muted-foreground">
          [ CHAT // HERMES ]
        </span>
        <span
          className="ml-auto font-mono text-[10px] text-muted-foreground/60"
          title="Per-tab session. Closing this tab ends the conversation; reopening starts a fresh one."
        >
          session · {sessionId.slice(0, 8)}
        </span>
      </div>

      {/* Message list */}
      <div
        className="flex-1 overflow-y-auto px-4 py-3 space-y-3 min-h-0"
        role="log"
        aria-live="polite"
        aria-relevant="additions"
        aria-busy={chatState.kind === "sending"}
      >
        {messages.length === 0 && (
          <p className="font-mono text-xs text-muted-foreground/50">
            No messages yet. Send one below.
          </p>
        )}
        {messages.map((msg, i) => (
          <div
            key={i}
            className={
              msg.role === "user"
                ? "flex justify-end"
                : "flex justify-start"
            }
          >
            <div
              className={
                msg.role === "user"
                  ? "max-w-[75%] rounded border border-primary/40 bg-primary/10 px-3 py-2 font-mono text-xs text-foreground"
                  : "max-w-[75%] rounded border border-border bg-black/60 px-3 py-2 font-mono text-xs text-foreground"
              }
            >
              {msg.content}
            </div>
          </div>
        ))}
        {chatState.kind === "sending" && (
          <div className="flex justify-start" aria-label="Agent is typing">
            <div className="rounded border border-border bg-black/60 px-3 py-2 font-mono text-xs text-muted-foreground animate-pulse">
              …
            </div>
          </div>
        )}
        {chatState.kind === "error" && (
          <div className="space-y-1 font-mono text-xs" role="alert">
            <p className="text-destructive">Error: {chatState.message}</p>
            {chatHint(chatState.code) && (
              <p className="text-muted-foreground">
                {chatHint(chatState.code)}
              </p>
            )}
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {/* Input */}
      <div className="border-t border-border p-3 flex gap-2">
        <textarea
          className="flex-1 resize-none rounded border border-input bg-background px-3 py-2 font-mono text-xs text-foreground placeholder:text-muted-foreground/50 focus:outline-none focus:ring-1 focus:ring-ring"
          rows={2}
          placeholder="Type a message… (Enter to send, Shift+Enter for newline)"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={handleKeyDown}
          disabled={chatState.kind === "sending"}
          aria-label="Chat message"
        />
        <Button
          size="sm"
          onClick={() => void handleSend()}
          disabled={!input.trim() || chatState.kind === "sending"}
          className="self-end"
          aria-label="Send message"
        >
          › SEND
        </Button>
      </div>
    </div>
  );
}

/** Maps a Connect error code to an actionable remediation hint. */
function chatHint(code: Code | undefined): string | null {
  switch (code) {
    case Code.FailedPrecondition:
      return "Chat is disabled on this agent. Destroy and respawn with the Enable chat checkbox to use chat.";
    case Code.Unavailable:
      return "The agent's chat sidecar isn't reachable. Check that the machine is running and try again in a moment.";
    case Code.Internal:
      return "Server-side configuration drift. The agent may need to be respawned to refresh its sidecar token.";
    default:
      return null;
  }
}

/** Returns a stable session UUID for this tab+instance combo. */
function useSessionId(instanceId: string): string {
  const key = `corellia:chat-session:${instanceId}`;
  const [id] = useState<string>(() => {
    if (typeof window === "undefined") return crypto.randomUUID();
    const stored = sessionStorage.getItem(key);
    if (stored) return stored;
    const fresh = crypto.randomUUID();
    sessionStorage.setItem(key, fresh);
    return fresh;
  });
  return id;
}
