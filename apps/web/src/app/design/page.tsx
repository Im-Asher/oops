"use client";

/**
 * 设计页壳（spec design-editor「设计页布局」）：独立全屏、无应用侧栏。
 * 文档初始化：URL 携带 w/h = 从首页弹窗新建（清旧草稿）；无参 = 恢复本机
 * 草稿，再回落 800×800 空白。doc 变化经 500ms debounce 落 localStorage。
 */
import { ArrowLeftIcon, DownloadIcon, Redo2Icon, Undo2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { Suspense, useEffect, useReducer, useRef, useState } from "react";
import { DesignCanvas } from "@/components/design/design-canvas";
import { DesignLeftRail, type DesignRailPanel } from "@/components/design/design-left-rail";
import { DesignMaterialsPanel } from "@/components/design/design-materials-panel";
import { DesignTemplatePanel } from "@/components/design/design-template-panel";
import { DesignRightPanel } from "@/components/design/design-right-panel";
import { DesignTextPanel } from "@/components/design/design-text-panel";
import { clearDraft, loadDraft, saveDraft } from "@/lib/design/draft-storage";
import { useAssetHandoff } from "@/lib/design/asset-handoff";
import { uploadDesignToPortfolio } from "@/lib/design/portfolio-upload";
import { downloadBlob, exportDesignToBlob } from "@/lib/design/export-design";
import { createEmptyDoc, newElementId, type DesignDoc, type DesignElement } from "@/lib/design/doc";
import { createDesignState, designReducer, type DesignState } from "@/lib/design/design-reducer";
import { centerFragmentAt, scaleTemplateElements, viewportCenterToCanvas } from "@/lib/design/insert";
import { ensureFontLoaded, type DesignFont } from "@/lib/design/fonts";
import { materialElement, type DesignMaterial } from "@/lib/design/materials";
import type { FancyTextPreset } from "@/lib/design/fancy-text";
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
  const tFancy = useTranslations("design.fancy");
  const params = useSearchParams();
  const [state, dispatch] = useReducer(designReducer, params, initState);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved">("idle");
  // 左栏面板展开态（UI 态不入历史）；默认展开模版面板。
  const [activePanel, setActivePanel] = useState<DesignRailPanel | null>("templates");
  const docRef = useRef(state.doc);
  const saveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** 画布容器：视口中心插入的取矩形基准（与 DesignCanvas 视口同一区域）。 */
  const canvasAreaRef = useRef<HTMLDivElement>(null);
  /** 画布 surface：导出截图目标（布局尺寸 = doc 尺寸，视口缩放不影响输出）。 */
  const surfaceRef = useRef<HTMLDivElement>(null);
  const [exportError, setExportError] = useState(false);
  /** 转交资产不可用（已删或非本人）：内联提示，设计稿不受影响。 */
  const [handoffError, setHandoffError] = useState(false);
  /** 导出时勾选「同时存入作品集」。 */
  const [saveToPortfolio, setSaveToPortfolio] = useState(false);
  /** 入库失败（下载已完成）：提示用户图片没进作品集。 */
  const [saveError, setSaveError] = useState(false);

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

  // 导出：清选中排除手柄后再截图（一次撤销语义不受影响），失败就地提示。
  // 勾选「同时存入作品集」时额外走一次上传；上传失败只提示，下载照常完成
  // ——下载是用户首要意图，入库是附加动作，绝不能因入库失败而拿不到图。
  const handleDownload = async () => {
    const node = surfaceRef.current;
    if (!node) return;
    setExportError(false);
    setSaveError(false);
    dispatch({ type: "clearSelection" });
    try {
      const blob = await exportDesignToBlob(node, { width: state.doc.width, height: state.doc.height });
      downloadBlob(blob, `design-${state.doc.width}x${state.doc.height}.png`);
      if (saveToPortfolio) {
        try {
          await uploadDesignToPortfolio(blob, state.doc.width, state.doc.height);
        } catch {
          setSaveError(true);
        }
      }
    } catch {
      setExportError(true);
    }
  };

  /** 点击模版：等比缩放到画布宽度 + 重新生成 id（目录数据复用加载不冲突），整包替换进历史。 */
  const handleSelectTemplate = (template: DesignTemplate) => {
    dispatch({
      type: "loadTemplate",
      elements: scaleTemplateElements(template.doc.elements, template.baseWidth, state.doc.width).map(
        (el) => ({ ...el, id: newElementId() }),
      ),
    });
  };

  /** 视口中心插入元素组：整组包围盒中心对齐视口中心，插入后全部选中（一次撤销粒度）。 */
  const insertAtViewportCenter = (elements: DesignElement[]) => {
    const rect = canvasAreaRef.current?.getBoundingClientRect();
    const viewport = { width: rect?.width ?? 0, height: rect?.height ?? 0 };
    const center = viewportCenterToCanvas(viewport, state.view);
    const placed = centerFragmentAt(elements, center);
    if (placed.length > 0) dispatch({ type: "addElements", elements: placed, select: true });
  };

  /**
   * 画布/作品集转交：?assetId= 命中则以新增图层落地，既有元素不动、可撤销。
   * 视口中心在插入瞬间才量取（canvasAreaRef 在首帧后才有尺寸），不能放在渲染期算。
   */
  const handoffAssetId = params.get("assetId");
  useAssetHandoff({
    assetId: handoffAssetId,
    canvasSize: { width: state.doc.width, height: state.doc.height },
    getViewportCenter: () => {
      const rect = canvasAreaRef.current?.getBoundingClientRect();
      return viewportCenterToCanvas(
        { width: rect?.width ?? 0, height: rect?.height ?? 0 },
        state.view,
      );
    },
    onInsert: (element) => dispatch({ type: "addElements", elements: [element], select: true }),
    onMissing: () => setHandoffError(true),
  });

  const handleSelectTextPreset = (preset: TextPreset) => {
    insertAtViewportCenter([textPresetElement(preset, tText(`presets.${preset.id}.sample`))]);
  };

  // 插入前预热字重（失败静默：font-display swap 兜底），就绪后落画布立即正确渲染。
  const handleSelectFont = (font: DesignFont) => {
    void ensureFontLoaded(font).then(() => {
      insertAtViewportCenter([fontSampleElement(font, tText("fontSample"))]);
    });
  };

  const handleSelectMaterial = (material: DesignMaterial) => {
    insertAtViewportCenter([materialElement(material, state.doc.width)]);
  };

  // 花字松散插入：文案按词典解析后整组入画布，select 多选整组（可整体拖动、单元素可再选）。
  const handleSelectFancy = (preset: FancyTextPreset) => {
    const contents = preset.contentKeys.map((key) => tFancy(key));
    insertAtViewportCenter(preset.build(contents));
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
        {exportError && (
          <span className="text-xs text-destructive" data-testid="design-export-error">
            {t("downloadError")}
          </span>
        )}
        <button
          aria-label={t("download")}
          className="flex items-center gap-1.5 rounded-lg px-2 py-1.5 text-sm text-muted-foreground hover:bg-accent/60 hover:text-foreground"
          data-testid="design-download"
          onClick={handleDownload}
          title={t("download")}
          type="button"
        >
          <DownloadIcon className="size-4" />
          {t("download")}
        </button>
        {/* 入库是附加动作：勾选后导出同时把成果存进作品集 */}
        <label className="flex cursor-pointer items-center gap-1.5 text-xs text-muted-foreground">
          <input
            checked={saveToPortfolio}
            className="size-3.5 accent-[var(--brand-violet-500)]"
            onChange={(e) => setSaveToPortfolio(e.target.checked)}
            type="checkbox"
          />
          {t("saveToPortfolio")}
        </label>
      </header>

      {/* 内联提示：入库失败或转交资产不可用。均不阻断编辑与下载 */}
      {saveError ? (
        <p className="border-b border-border bg-amber-500/10 px-4 py-1.5 text-xs text-amber-700 dark:text-amber-400" role="status">
          {t("saveFailed")}
        </p>
      ) : null}
      {handoffError ? (
        <p className="border-b border-border bg-red-500/10 px-4 py-1.5 text-xs text-red-600 dark:text-red-400" role="status">
          {t("handoffMissing")}
        </p>
      ) : null}

      {/* 左栏 rail + 面板 + 中央画布（右侧属性面板由 5.5 接入） */}
      <div className="flex min-h-0 flex-1">
        <DesignLeftRail active={activePanel} onSelect={setActivePanel} />
        {activePanel !== null && (
          <aside className="w-60 shrink-0 overflow-y-auto border-r border-border p-3" data-testid="design-panel">
            {activePanel === "templates" && <DesignTemplatePanel onSelect={handleSelectTemplate} />}
            {activePanel === "materials" && <DesignMaterialsPanel onSelect={handleSelectMaterial} />}
            {activePanel === "text" && (
              <DesignTextPanel
                onSelectFancy={handleSelectFancy}
                onSelectFont={handleSelectFont}
                onSelectPreset={handleSelectTextPreset}
              />
            )}
          </aside>
        )}
        <div className="relative min-h-0 flex-1" ref={canvasAreaRef}>
          <DesignCanvas dispatch={dispatch} state={state} surfaceRef={surfaceRef} />
        </div>
        <DesignRightPanel dispatch={dispatch} state={state} />
      </div>
    </main>
  );
}
