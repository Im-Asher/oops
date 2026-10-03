"use client";

import { Button } from "@/components/ui/button";
import { DownloadIcon } from "lucide-react";

/** 会话级本地保存状态（workspace-storage 写入驱动；idle 时不展示，避免假装已同步）。 */
export type SaveStatus = "idle" | "saving" | "saved";

const SAVE_STATUS_LABELS: Record<Exclude<SaveStatus, "idle">, string> = {
  saving: "保存中…",
  saved: "已保存（本机）",
};

interface TopBarProps {
  sessionTitle: string;
  saveStatus: SaveStatus;
  exportEnabled: boolean;
  exporting: boolean;
  onExport: () => void;
}

/** 顶部工具栏：会话名、真实保存状态与导出入口（聊天显隐仅保留在左侧工具条）。 */
export function TopBar({
  sessionTitle,
  saveStatus,
  exportEnabled,
  exporting,
  onExport,
}: TopBarProps) {
  return (
    <header className="flex h-12 shrink-0 items-center gap-2 border-b border-zinc-800/80 bg-[#141416] px-3">
      <h1 className="min-w-0 flex-1 truncate text-sm font-medium text-zinc-100">
        {sessionTitle}
      </h1>
      <span aria-live="polite" className="text-xs text-zinc-500">
        {saveStatus === "idle" ? null : SAVE_STATUS_LABELS[saveStatus]}
      </span>
      <Button
        className="h-8 gap-1.5 bg-violet-500/90 px-3 text-xs text-white hover:bg-violet-500"
        disabled={!exportEnabled || exporting}
        onClick={onExport}
        size="sm"
      >
        <DownloadIcon />
        {exporting ? "导出中…" : "导出"}
      </Button>
    </header>
  );
}
