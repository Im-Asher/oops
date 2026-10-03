"use client";

import { SessionSidebar } from "@/components/chat/session-sidebar";
import type { AgentInfo, SessionInfo } from "@/types/chat";
import { useEffect } from "react";

interface SessionDrawerProps {
  open: boolean;
  onClose: () => void;
  agents: AgentInfo[];
  sessions: SessionInfo[];
  currentId: string | null;
  errorMessage?: string | null;
  query: string;
  onQueryChange: (value: string) => void;
  onSelectSession: (id: string) => void;
  onNewChat: () => void;
  onRenameSession: (id: string, title: string) => void;
  onDeleteSession: (id: string) => void;
}

/**
 * 会话抽屉：默认关闭，覆盖打开、不挤压画布，关闭后画布视角保持不变。
 * 列表行为（新建/搜索/切换/重命名/删除）复用 SessionSidebar。
 */
export function SessionDrawer({
  open,
  onClose,
  agents,
  sessions,
  currentId,
  errorMessage,
  query,
  onQueryChange,
  onSelectSession,
  onNewChat,
  onRenameSession,
  onDeleteSession,
}: SessionDrawerProps) {
  useEffect(() => {
    if (!open) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [open, onClose]);

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-50">
      <button
        aria-label="关闭会话抽屉"
        className="absolute inset-0 bg-black/60"
        onClick={onClose}
      />
      <div className="absolute inset-y-0 left-0 flex w-[280px] shadow-lg shadow-black/40">
        <SessionSidebar
          agents={agents}
          currentId={currentId}
          errorMessage={errorMessage}
          onDeleteSession={onDeleteSession}
          onCollapse={onClose}
          onNewChat={onNewChat}
          onQueryChange={onQueryChange}
          onRenameSession={onRenameSession}
          onSelectSession={(id) => {
            onSelectSession(id);
            onClose();
          }}
          query={query}
          sessions={sessions}
        />
      </div>
    </div>
  );
}
