"use client";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import type { AgentInfo, SessionInfo } from "@/types/chat";
import {
  CheckIcon,
  PencilIcon,
  PlusIcon,
  SearchIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useRef, useState } from "react";

interface SessionSidebarProps {
  agents: AgentInfo[];
  sessions: SessionInfo[];
  currentId: string | null;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
  /** 关闭（抽屉模式下为关闭抽屉）。 */
  onCollapse: () => void;
  /** 按标题搜索（客户端过滤已加载列表）。 */
  query: string;
  onQueryChange: (value: string) => void;
  /** 重命名/删除等操作的失败提示（页内联展示，无 toast 依赖）。 */
  errorMessage?: string | null;
}

/** 按 updatedAt 分组：今天 / 近 7 天 / 更早（纯展示分组，列表本身已按时间倒序）。 */
function groupSessions(sessions: SessionInfo[]): Array<{ label: string; items: SessionInfo[] }> {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const todayMs = startOfToday.getTime();
  const weekMs = todayMs - 6 * 24 * 60 * 60 * 1000;
  const groups = [
    { label: "今天", items: [] as SessionInfo[] },
    { label: "近 7 天", items: [] as SessionInfo[] },
    { label: "更早", items: [] as SessionInfo[] },
  ];
  for (const s of sessions) {
    const t = s.updatedAt ? new Date(s.updatedAt).getTime() : 0;
    if (t >= todayMs) groups[0].items.push(s);
    else if (t >= weekMs) groups[1].items.push(s);
    else groups[2].items.push(s);
  }
  return groups.filter((g) => g.items.length > 0);
}

interface SessionItemProps {
  session: SessionInfo;
  agentIcon?: string;
  active: boolean;
  onSelect: () => void;
  onRename: (title: string) => void;
  onDelete: () => void;
}

/** 单个会话项：hover 出重命名/删除；行内编辑与轻量二次确认（无弹窗依赖）。 */
function SessionItem({ session, agentIcon, active, onSelect, onRename, onDelete }: SessionItemProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState("");
  const [confirming, setConfirming] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const label = session.title || "未命名会话";

  useEffect(() => {
    if (editing) inputRef.current?.select();
  }, [editing]);

  const commit = () => {
    const title = draft.trim();
    if (title) onRename(title);
    setEditing(false);
  };

  if (editing) {
    return (
      <div className="flex items-center gap-1 rounded-md bg-zinc-800/60 px-1.5 py-1">
        <Input
          aria-label="会话标题"
          className="h-7 border-zinc-700 bg-zinc-900 px-2 text-sm text-zinc-50"
          onBlur={commit}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            else if (e.key === "Escape") setEditing(false);
          }}
          ref={inputRef}
          value={draft}
        />
        <Button
          aria-label="确认重命名"
          className="size-6 shrink-0 text-zinc-50 hover:bg-zinc-700"
          onClick={commit}
          onMouseDown={(e) => e.preventDefault()}
          size="icon-sm"
          variant="ghost"
        >
          <CheckIcon />
        </Button>
        <Button
          aria-label="取消重命名"
          className="size-6 shrink-0 text-zinc-50 hover:bg-zinc-700"
          onClick={() => setEditing(false)}
          onMouseDown={(e) => e.preventDefault()}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>
    );
  }

  if (confirming) {
    return (
      <div className="flex items-center justify-between gap-2 rounded-md bg-zinc-800/60 px-2 py-1">
        <span className="truncate text-xs text-zinc-300">删除「{label}」？</span>
        <div className="flex shrink-0 gap-1">
          <Button
            aria-label="确认删除会话"
            className="h-6 px-2 text-xs"
            onClick={onDelete}
            size="sm"
            variant="destructive"
          >
            删除
          </Button>
          <Button
            aria-label="取消删除"
            className="h-6 px-2 text-xs text-zinc-300 hover:bg-zinc-700"
            onClick={() => setConfirming(false)}
            size="sm"
            variant="ghost"
          >
            取消
          </Button>
        </div>
      </div>
    );
  }

  return (
    <div
      className={`group flex items-center rounded-md ${
        active ? "bg-zinc-800" : "hover:bg-zinc-800/60"
      }`}
    >
      <button
        aria-current={active ? "true" : undefined}
        className="flex min-w-0 flex-1 items-center gap-2 px-2 py-1.5 text-left"
        onClick={onSelect}
      >
        <span aria-hidden className="shrink-0 text-xs">
          {agentIcon ?? "🤖"}
        </span>
        <span className={`truncate text-sm ${active ? "text-zinc-50" : "text-zinc-300"}`}>
          {label}
        </span>
      </button>
      <div
        className={`shrink-0 gap-0.5 pr-1 ${active ? "flex" : "hidden group-focus-within:flex group-hover:flex"}`}
      >
        <Button
          aria-label={`重命名 ${label}`}
          className="size-6 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-50"
          onClick={() => {
            setDraft(session.title ?? "");
            setEditing(true);
          }}
          size="icon-sm"
          variant="ghost"
        >
          <PencilIcon />
        </Button>
        <Button
          aria-label={`删除 ${label}`}
          className="size-6 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-50"
          onClick={() => setConfirming(true)}
          size="icon-sm"
          variant="ghost"
        >
          <Trash2Icon />
        </Button>
      </div>
    </div>
  );
}

/**
 * 会话侧栏：新会话入口 + 时间分组的会话列表（含 Agent 徽标、行内重命名、删除确认）。
 * 可折叠；折叠/展开由页面编排（折叠后画布与聊天列扩展）。
 */
export function SessionSidebar({
  agents,
  sessions,
  currentId,
  onSelectSession,
  onNewChat,
  onRenameSession,
  onDeleteSession,
  onCollapse,
  query,
  onQueryChange,
  errorMessage,
}: SessionSidebarProps) {
  const keyword = query.trim().toLowerCase();
  const visible =
    keyword.length > 0
      ? sessions.filter((s) => (s.title ?? "").toLowerCase().includes(keyword))
      : sessions;

  return (
    <aside className="flex h-full w-full shrink-0 flex-col border-r border-zinc-800 bg-zinc-950">
      <div className="flex items-center gap-1 p-2">
        <Button
          className="flex-1 justify-start gap-2 bg-zinc-900 text-zinc-50 hover:bg-zinc-800"
          onClick={onNewChat}
          variant="secondary"
        >
          <PlusIcon />
          新会话
        </Button>
        <Button
          aria-label="关闭会话抽屉"
          className="min-h-11 min-w-11 text-zinc-50 hover:bg-zinc-800"
          onClick={onCollapse}
          size="icon-sm"
          variant="ghost"
        >
          <XIcon />
        </Button>
      </div>

      <div className="relative px-2 pb-2">
        <SearchIcon
          aria-hidden
          className="absolute left-4 top-1/2 size-3.5 -translate-y-1/2 text-zinc-500"
        />
        <Input
          aria-label="搜索会话"
          className="h-8 border-zinc-800 bg-zinc-900 pl-7 text-sm text-zinc-50 placeholder:text-zinc-500"
          onChange={(e) => onQueryChange(e.target.value)}
          placeholder="搜索会话…"
          value={query}
        />
      </div>

      <nav aria-label="会话列表" className="flex-1 space-y-3 overflow-y-auto px-2 pb-2">
        {groupSessions(visible).map((group) => (
          <div key={group.label}>
            <p className="px-2 pb-1 text-[11px] uppercase tracking-wide text-zinc-500">
              {group.label}
            </p>
            <div className="space-y-0.5">
              {group.items.map((s) => (
                <SessionItem
                  active={s.id === currentId}
                  agentIcon={agents.find((a) => a.id === s.agentId)?.icon}
                  key={s.id}
                  onDelete={() => onDeleteSession(s.id)}
                  onSelect={() => onSelectSession(s.id)}
                  onRename={(title) => onRenameSession(s.id, title)}
                  session={s}
                />
              ))}
            </div>
          </div>
        ))}
        {sessions.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-zinc-500">
            还没有会话，点击「新会话」开始。
          </p>
        )}
        {sessions.length > 0 && visible.length === 0 && (
          <p className="px-2 py-6 text-center text-sm text-zinc-500">没有匹配的会话。</p>
        )}
      </nav>

      {errorMessage && (
        <p className="border-t border-zinc-800 px-3 py-2 text-xs text-red-400" role="alert">
          {errorMessage}
        </p>
      )}
    </aside>
  );
}
