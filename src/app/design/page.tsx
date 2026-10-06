"use client";

/**
 * 设计页壳（spec design-editor「设计页布局」）：独立全屏、无应用侧栏。
 * 文档初始化：URL 携带 w/h = 从首页弹窗新建（清旧草稿）；无参 = 恢复本机
 * 草稿，再回落 800×800 空白。doc 变化经 500ms debounce 落 localStorage。
 */
import { ArrowLeftIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useRef, useState } from "react";
import { clearDraft, loadDraft, saveDraft } from "@/lib/design/draft-storage";
import { createEmptyDoc, type DesignDoc } from "@/lib/design/doc";
import { createDesignState, designReducer, type DesignState } from "@/lib/design/design-reducer";

const MAX_SIZE = 10000;
const DEFAULT_SIZE = 800;
const SAVE_DEBOUNCE_MS = 500;

function parseSizeParam(raw: string | null): number | null {
  const value = Number.parseInt(raw ?? "", 10);
  return Number.isFinite(value) && value > 0 && value <= MAX_SIZE ? value : null;
}

/** 新建（w/h 参数）清旧草稿；否则恢复草稿；再回落默认空白。 */
function initialDoc(params: URLSearchParams): DesignDoc {
  const width = parseSizeParam(params.get("w"));
  const height = parseSizeParam(params.get("h"));
  if (width !== null && height !== null) {
    clearDraft();
    return createEmptyDoc(width, height);
  }
  return loadDraft() ?? createEmptyDoc(DEFAULT_SIZE, DEFAULT_SIZE);
}

function initState(params: URLSearchParams): DesignState {
  return createDesignState(initialDoc(params));
}

/** useSearchParams 需要客户端回退边界（同 /canvas 约定）。 */
export default function DesignPage() {
  return (
    <Suspense fallback={null}>
      <DesignPageInner />
    </Suspense>
  );
}

function DesignPageInner() {
  const t = useTranslations("design.page");
  const params = useSearchParams();
  const [state, dispatch] = useReducer(designReducer, params, initState);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  const docRef = useRef(state.doc);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 草稿自动保存：doc 引用变化才排程（首渲染不保存），debounce 合并连续编辑。
  useEffect(() => {
    if (docRef.current === state.doc) return;
    docRef.current = state.doc;
    setSaveStatus("saving");
    if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
    saveTimerRef.current = setTimeout(() => {
      saveDraft(state.doc);
      setSaveStatus("saved");
    }, SAVE_DEBOUNCE_MS);
  }, [state.doc]);

  // 卸载兜底 flush： debounce 期间离开不丢最后一段编辑。
  useEffect(
    () => () => {
      if (saveTimerRef.current) clearTimeout(saveTimerRef.current);
      saveDraft(docRef.current);
    },
    [],
  );

  return (
    <main className="fixed inset-0 flex flex-col bg-background text-foreground">
      {/* 顶栏：返回 / 画布尺寸 / 草稿状态（撤销重做与下载由 4.5/6.1 接入） */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          data-testid="design-back"
          href="/home"
        >
          <ArrowLeftIcon className="size-4" />
          {t("back")}
        </Link>
        <span className="text-sm text-muted-foreground" data-testid="design-canvas-size">
          {t("canvasSize", { width: state.doc.width, height: state.doc.height })}
        </span>
        <span className="ml-auto text-xs text-muted-foreground" data-testid="design-save-status">
          {saveStatus === "saving" ? t("draftSaving") : saveStatus === "saved" ? t("draftSaved") : ""}
        </span>
      </header>

      {/* 画布视口占位：缩放编辑区由 4.2 design-canvas 接入 */}
      <div className="flex min-h-0 flex-1 items-center justify-center overflow-hidden">
        <div
          className="border border-border bg-card shadow-sm"
          data-testid="design-canvas-placeholder"
          style={{ width: state.doc.width, height: state.doc.height }}
        />
      </div>
    </main>
  );
}
