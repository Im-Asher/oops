"use client";

/**
 * 设计页壳（spec design-editor「设计页布局」）：独立全屏、无应用侧栏。
 * 文档初始化：URL 携带 w/h = 从首页弹窗新建（清旧草稿）；无参 = 恢复本机
 * 草稿，再回落 800×800 空白。doc 变化经 500ms debounce 落 localStorage。
 */
import { ArrowLeftIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useRef, useState } from "react";
import { DesignCanvas } from "@/components/design/design-canvas";
import { DesignLeftRail, type DesignRailPanel } from "@/components/design/design-left-rail";
import { DesignTemplatePanel } from "@/components/design/design-template-panel";
import { DesignTextPanel } from "@/components/design/design-text-panel";
import { clearDraft, loadDraft, saveDraft } from "@/lib/design/draft-storage";
import { createEmptyDoc, newElementId, type DesignDoc, type DesignElement } from "@/lib/design/doc";
import { createDesignState, designReducer, type DesignState } from "@/lib/design/design-reducer";
import { centerFragmentAt, scaleTemplateElements, viewportCenterToCanvas } from "@/lib/design/insert";
import { ensureFontLoaded, type DesignFont } from "@/lib/design/fonts";
import type { DesignTemplate } from "@/lib/design/templates";
import { fontSampleElement, textPresetElement, type TextPreset } from "@/lib/design/text-presets";

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
  const tText = useTranslations("design.textPanel");
  const params = useSearchParams();
  const [state, dispatch] = useReducer(designReducer, params, initState);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  // 左栏面板展开态（UI 态不入历史）；默认展开模版面板。
  const [activePanel, setActivePanel] = useState<DesignRailPanel | null>("templates");
  const docRef = useRef(state.doc);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 画布容器：视口中心插入的取矩形基准（与 DesignCanvas 视口同一区域）。 */
  const canvasAreaRef = useRef<HTMLDivElement>(null);

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

  /** 点击模版：等比缩放到画布宽度 + 重新生成 id（目录数据复用加载不冲突），整包替换进历史。 */
  const handleSelectTemplate = (template: DesignTemplate) => {
    dispatch({
      type: "loadTemplate",
      elements: scaleTemplateElements(template.doc.elements, template.baseWidth, state.doc.width).map(
        (el) => ({ ...el, id: newElementId() }),
      ),
    });
  };

  /** 视口中心插入单元素：包围盒中心对齐视口中心，插入后选中（一次撤销粒度）。 */
  const insertAtViewportCenter = (element: DesignElement) => {
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    const viewport = { width: rect?.width ?? 0, height: rect?.height ?? 0 };
    const center = viewportCenterToCanvas(viewport, state.view);
    const [placed] = centerFragmentAt([element], center);
    if (!placed) return;
    dispatch({ type: "addElements", elements: [placed], select: true });
  };

  const handleSelectTextPreset = (preset: TextPreset) => {
    insertAtViewportCenter(textPresetElement(preset, tText(`presets.${preset.id}.sample`)));
  };

  // 插入前预热字重（失败静默：font-display swap 兜底），就绪后落画布立即正确渲染。
  const handleSelectFont = (font: DesignFont) => {
    void ensureFontLoaded(font).then(() => {
      insertAtViewportCenter(fontSampleElement(font, tText("fontSample")));
    });
  };

  return (
    <main className="fixed inset-0 flex flex-col bg-background text-foreground">
      {/* 顶栏：返回 / 撤销重做 / 画布尺寸 / 草稿状态（下载由 6.1 接入） */}
      <header className="flex h-12 shrink-0 items-center gap-3 border-b border-border px-3">
        <Link
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          data-testid="design-back"
          href="/home"
        >
          <ArrowLeftIcon className="size-4" />
          {t("back")}
        </Link>
        {/* 撤销/重做：可用性直接由历史栈驱动（past/future 空即禁用）。 */}
        <div className="flex items-center">
          <button
            aria-label={t("undo")}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            data-testid="design-undo"
            disabled={state.past.length === 0}
            onClick={() => dispatch({ type: "undo" })}
            title={t("undo")}
            type="button"
          >
            <Undo2Icon className="size-4" />
          </button>
          <button
            aria-label={t("redo")}
            className="rounded-lg p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            data-testid="design-redo"
            disabled={state.future.length === 0}
            onClick={() => dispatch({ type: "redo" })}
            title={t("redo")}
            type="button"
          >
            <Redo2Icon className="size-4" />
          </button>
        </div>
        <span className="text-sm text-muted-foreground" data-testid="design-canvas-size">
          {t("canvasSize", { width: state.doc.width, height: state.doc.height })}
        </span>
        <span className="ml-auto text-xs text-muted-foreground" data-testid="design-save-status">
          {saveStatus === "saving" ? t("draftSaving") : saveStatus === "saved" ? t("draftSaved") : ""}
        </span>
      </header>

      {/* 左栏 rail + 面板 + 中央画布（右侧属性面板由 5.5 接入） */}
      <div className="flex min-h-0 flex-1">
        <DesignLeftRail active={activePanel} onSelect={setActivePanel} />
        {activePanel !== null && (
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-border p-3" data-testid="design-panel">
            {activePanel === "templates" && <DesignTemplatePanel onSelect={handleSelectTemplate} />}
            {activePanel === "text" && (
              <DesignTextPanel onSelectFont={handleSelectFont} onSelectPreset={handleSelectTextPreset} />
            )}
          </aside>
        )}
        <div className="relative min-h-0 flex-1" ref={canvasAreaRef}>
          <DesignCanvas dispatch={dispatch} state={state} />
        </div>
      </div>
    </main>
  );
}
