"use client";

import { useCallback, useEffect, useRef, useState } from "react";

interface AgentInfo {
  id: string;
  name: string;
  description: string;
  tools: string[];
}

interface UIMessage {
  id: string;
  role: "user" | "assistant";
  parts: Array<
    | { type: "text"; text: string }
    | { type: "image"; url: string; assetId: string }
    | { type: "file"; url: string }
  >;
}

interface SessionInfo {
  id: string;
  agentId?: string | null;
  title?: string | null;
}

type ChatEvent =
  | { type: "message_delta"; text: string }
  | { type: "tool_start"; id: string; name: string; args: unknown }
  | { type: "tool_end"; id: string; name: string; details: Record<string, unknown> | null }
  | { type: "finish"; stopReason: string }
  | { type: "error"; message: string };

export default function ChatPage() {
  const [agents, setAgents] = useState<AgentInfo[]>([]);
  const [sessions, setSessions] = useState<SessionInfo[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [messages, setMessages] = useState<UIMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);
  const [agentId, setAgentId] = useState<string>("");
  const scrollRef = useRef<HTMLDivElement>(null);

  const loadSessions = useCallback(async () => {
    const res = await fetch("/api/sessions");
    if (res.ok) {
      const data = (await res.json()) as { sessions: SessionInfo[] };
      setSessions(data.sessions);
      if (!currentId && data.sessions[0]) setCurrentId(data.sessions[0].id);
    }
  }, [currentId]);

  useEffect(() => {
    fetch("/api/agents")
      .then((r) => r.json())
      .then((d: { agents: AgentInfo[] }) => {
        setAgents(d.agents);
        if (d.agents[0]) setAgentId(d.agents[0].id);
      })
      .catch(() => {});
    // eslint-disable-next-line react-hooks/set-state-in-effect
    loadSessions();
  }, [loadSessions]);

  useEffect(() => {
    if (currentId) void selectSession(currentId);
  }, [currentId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [messages]);

  async function selectSession(id: string) {
    setCurrentId(id);
    const res = await fetch(`/api/sessions/${id}`);
    if (res.ok) {
      const data = (await res.json()) as { messages: UIMessage[] };
      setMessages(data.messages);
    }
  }

  async function newChat() {
    const res = await fetch("/api/sessions", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ agentId }),
    });
    if (res.ok) {
      const data = (await res.json()) as SessionInfo;
      setSessions((s) => [data, ...s]);
      setMessages([]);
      setCurrentId(data.id);
    }
  }

  async function send() {
    if (!input.trim() || !currentId || busy) return;
    const text = input.trim();
    setInput("");
    setBusy(true);

    const userMsg: UIMessage = { id: `u${Date.now()}`, role: "user", parts: [{ type: "text", text }] };
    const assistantMsg: UIMessage = { id: `a${Date.now()}`, role: "assistant", parts: [] };
    setMessages((m) => [...m, userMsg, assistantMsg]);

    const appendText = (delta: string) =>
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantMsg.id
            ? { ...msg, parts: [...msg.parts, { type: "text", text: delta }] }
            : msg,
        ),
      );
    const appendImage = (url: string, assetId: string) =>
      setMessages((m) =>
        m.map((msg) =>
          msg.id === assistantMsg.id
            ? { ...msg, parts: [...msg.parts, { type: "image", url, assetId }] }
            : msg,
        ),
      );

    const res = await fetch("/api/chat", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ sessionId: currentId, agentId, message: text }),
    });

    if (!res.body) {
      setBusy(false);
      return;
    }

    const reader = res.body.getReader();
    const decoder = new TextDecoder();
    let buffer = "";

    const handleEvent = (event: ChatEvent) => {
      if (event.type === "message_delta") appendText(event.text);
      else if (event.type === "tool_end" && event.details?.url) {
        appendImage(String(event.details.url), String(event.details.assetId ?? ""));
      } else if (event.type === "error") {
        appendText(`\n[错误] ${event.message}`);
      }
    };

    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      buffer += decoder.decode(value, { stream: true });
      const chunks = buffer.split("\n\n");
      buffer = chunks.pop() ?? "";
      for (const chunk of chunks) {
        const lines = chunk.split("\n");
        let eventType = "";
        let data = "";
        for (const line of lines) {
          if (line.startsWith("event:")) eventType = line.slice(6).trim();
          else if (line.startsWith("data:")) data += line.slice(5).trim();
        }
        if (eventType && data) {
          try {
            handleEvent({ type: eventType, ...JSON.parse(data) } as ChatEvent);
          } catch {
            /* ignore malformed */
          }
        }
      }
    }
    setBusy(false);
  }

  return (
    <div className="flex h-full">
      <aside className="flex w-64 flex-col border-r border-zinc-200 p-3 dark:border-zinc-800">
        <button
          onClick={newChat}
          className="mb-3 rounded-md bg-zinc-900 px-3 py-2 text-sm text-white dark:bg-white dark:text-zinc-900"
        >
          新建会话
        </button>
        <div className="flex-1 space-y-1 overflow-auto">
          {sessions.map((s) => (
            <button
              key={s.id}
              onClick={() => void selectSession(s.id)}
              className={`block w-full truncate rounded px-2 py-1.5 text-left text-sm ${
                s.id === currentId ? "bg-zinc-200 dark:bg-zinc-800" : "hover:bg-zinc-100 dark:hover:bg-zinc-900"
              }`}
            >
              {s.title || "未命名会话"}
            </button>
          ))}
        </div>
        <div className="mt-3 border-t border-zinc-200 pt-3 dark:border-zinc-800">
          <label className="text-xs text-zinc-500">Agent</label>
          <select
            value={agentId}
            onChange={(e) => setAgentId(e.target.value)}
            className="mt-1 w-full rounded border border-zinc-300 bg-white px-2 py-1 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          >
            {agents.map((a) => (
              <option key={a.id} value={a.id}>
                {a.name}
              </option>
            ))}
          </select>
        </div>
      </aside>

      <main className="flex flex-1 flex-col">
        <div ref={scrollRef} className="flex-1 space-y-4 overflow-auto p-4">
          {messages.map((m) => (
            <div key={m.id} className={m.role === "user" ? "text-right" : "text-left"}>
              <div
                className={`inline-block max-w-[80%] whitespace-pre-wrap rounded-lg px-3 py-2 text-sm ${
                  m.role === "user"
                    ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"
                    : "bg-zinc-100 dark:bg-zinc-800"
                }`}
              >
                {m.parts.map((p, i) =>
                  p.type === "text" ? (
                    <span key={i}>{p.text}</span>
                  ) : p.type === "image" ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img key={i} src={p.url} alt="生成结果" className="mt-2 max-h-80 rounded" />
                  ) : (
                    <a key={i} href={p.url} className="underline">
                      文件
                    </a>
                  ),
                )}
              </div>
            </div>
          ))}
          {messages.length === 0 && (
            <p className="text-sm text-zinc-400">新建会话，向“氛围图设计师”描述你想要的商品/场景图。</p>
          )}
        </div>
        <div className="flex gap-2 border-t border-zinc-200 p-3 dark:border-zinc-800">
          <input
            value={input}
            onChange={(e) => setInput(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) void send();
            }}
            placeholder="描述你的图片需求…"
            className="flex-1 rounded border border-zinc-300 bg-white px-3 py-2 text-sm dark:border-zinc-700 dark:bg-zinc-900"
          />
          <button
            onClick={() => void send()}
            disabled={busy}
            className="rounded-md bg-zinc-900 px-4 py-2 text-sm text-white disabled:opacity-50 dark:bg-white dark:text-zinc-900"
          >
            {busy ? "生成中…" : "发送"}
          </button>
        </div>
      </main>
    </div>
  );
}
