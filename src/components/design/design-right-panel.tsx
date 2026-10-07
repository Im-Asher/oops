"use client";

/**
 * 右侧属性面板（spec design-editor「属性面板」）：上下文渲染——无选中=画布
 * 属性（尺寸只读 + 背景色）；单选=类型属性（文本/图片/形状各自字段）+ 通用
 * 几何/层级；多选仅层级。双向同步：画布选中驱动面板，面板编辑经
 * patchElements/setCanvas/reorder 回写。历史粒度：连续输入（数字/取色器/
 * 内容文本）聚焦时 beginHistory 一次 + 无历史 patch，离散按钮单步入历史。
 */
import {
  BringToFrontIcon,
  ChevronDownIcon,
  ChevronUpIcon,
  SendToBackIcon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import { Textarea } from "@/components/ui/textarea";
import type { DesignAction, DesignState, ReorderMode } from "@/lib/design/design-reducer";
import type { DesignElement, ImageElement, ShapeElement, TextElement } from "@/lib/design/doc";
import { DESIGN_FONTS, ensureFontLoaded } from "@/lib/design/fonts";

/** 预设色板：黑白灰 + 常用电商高亮色。 */
const SWATCHES = [
  "#000000",
  "#ffffff",
  "#78716c",
  "#ef4444",
  "#f97316",
  "#eab308",
  "#22c55e",
  "#3b82f6",
  "#a855f7",
  "#ec4899",
];

type Dispatch = (action: DesignAction) => void;
type PanelT = ReturnType<typeof useTranslations>;

function clamp(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function SectionTitle({ children }: { children: React.ReactNode }) {
  return (
    <h3 className="mb-2 px-0.5 text-xs font-medium uppercase tracking-wide text-muted-foreground">{children}</h3>
  );
}

interface FieldPatch {
  (patch: Partial<DesignElement>, history?: boolean): void;
}

/** 数值行：focus 快照一次历史，连续输入 patch 不入历史（一次 undo 粒度）。 */
function NumberField({
  label,
  onCommit,
  onCommitStart,
  step = 1,
  testId,
  value,
}: {
  label: string;
  onCommit: (value: number) => void;
  onCommitStart: () => void;
  step?: number;
  testId: string;
  value: number;
}) {
  return (
    <label className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      {label}
      <Input
        className="h-7 w-20 text-right"
        data-testid={testId}
        onFocus={onCommitStart}
        onInput={(event) => {
          const next = Number.parseFloat(event.currentTarget.value);
          if (Number.isFinite(next)) onCommit(next);
        }}
        step={step}
        type="number"
        value={value}
      />
    </label>
  );
}

/** 颜色行：色板离散单步入历史；取色器连续变更同数值行粒度。 */
function ColorField({
  label,
  onCommit,
  onCommitStart,
  testId,
  value,
}: {
  label: string;
  onCommit: (color: string) => void;
  onCommitStart: () => void;
  testId: string;
  value: string;
}) {
  return (
    <div className="flex items-center justify-between gap-2 text-xs text-muted-foreground">
      {label}
      <input
        aria-label={label}
        className="size-6 cursor-pointer rounded border border-border bg-transparent"
        data-testid={`${testId}-picker`}
        onFocus={onCommitStart}
        onInput={(event) => onCommit(event.currentTarget.value)}
        type="color"
        value={value}
      />
    </div>
  );
}

function Swatches({ active, onPick }: { active: string; onPick: (color: string) => void }) {
  return (
    <div className="mb-1.5 flex flex-wrap gap-1">
      {SWATCHES.map((color) => (
        <button
          aria-label={color}
          className={`size-5 rounded border ${
            active.toLowerCase() === color ? "border-violet-500 ring-1 ring-violet-500" : "border-border"
          }`}
          key={color}
          onClick={() => onPick(color)}
          style={{ background: color }}
          type="button"
        />
      ))}
    </div>
  );
}

/** 分段选择按钮组（未装 RadioGroup，沿用 ARIA 分段按钮模式）。 */
function Segment<T extends string>({
  ariaLabel,
  onChange,
  options,
  testIdPrefix,
  value,
}: {
  ariaLabel: string;
  onChange: (value: T) => void;
  options: { label: string; value: T }[];
  testIdPrefix: string;
  value: T;
}) {
  return (
    <div aria-label={ariaLabel} className="flex overflow-hidden rounded-lg border border-border" role="radiogroup">
      {options.map((option) => (
        <button
          aria-checked={value === option.value}
          className={`flex-1 px-1.5 py-1 text-xs ${
            value === option.value ? "bg-accent text-foreground" : "text-muted-foreground hover:bg-accent/60"
          }`}
          data-testid={`${testIdPrefix}-${option.value}`}
          key={option.value}
          onClick={() => onChange(option.value)}
          role="radio"
          type="button"
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function DesignRightPanel({ dispatch, state }: { dispatch: Dispatch; state: DesignState }) {
  const t = useTranslations("design.rightPanel");
  const { doc, selection } = state;
  const element = selection.length === 1 ? (doc.elements.find((el) => el.id === selection[0]) ?? null) : null;
  const multiSelected = selection.length > 1;

  const beginHistory = () => dispatch({ type: "beginHistory" });
  const patchSelected: FieldPatch = (patch, history = false) => {
    if (selection.length === 0) return;
    dispatch({
      type: "patchElements",
      history,
      patches: selection.map((id) => ({ id, patch })),
    });
  };

  const reorder = (mode: ReorderMode) => dispatch({ type: "reorder", mode });
  const singleSelected = element !== null;

  const layerSection = (
    <div>
      <SectionTitle>{t("layerTitle")}</SectionTitle>
      <div className="grid grid-cols-4 gap-1">
        {(
          [
            { icon: BringToFrontIcon, mode: "front", title: t("bringFront") },
            { icon: ChevronUpIcon, mode: "forward", title: t("bringForward") },
            { icon: ChevronDownIcon, mode: "backward", title: t("sendBackward") },
            { icon: SendToBackIcon, mode: "back", title: t("sendBack") },
          ] as const
        ).map(({ icon: Icon, mode, title }) => (
          <button
            aria-label={title}
            className="flex items-center justify-center rounded-lg border border-border p-1.5 text-muted-foreground hover:bg-accent/60 hover:text-foreground disabled:pointer-events-none disabled:opacity-40"
            data-testid={`design-props-layer-${mode}`}
            disabled={!singleSelected && mode !== "front" && mode !== "back"}
            key={mode}
            onClick={() => reorder(mode)}
            title={title}
            type="button"
          >
            <Icon className="size-4" />
          </button>
        ))}
      </div>
    </div>
  );

  const typeSpecific = (() => {
    if (!element) return null;
    switch (element.type) {
      case "text":
        return <TextFields beginHistory={beginHistory} element={element} onPatch={patchSelected} t={t} />;
      case "image":
        return <ImageFields beginHistory={beginHistory} element={element} onPatch={patchSelected} t={t} />;
      case "shape":
        return <ShapeFields beginHistory={beginHistory} element={element} onPatch={patchSelected} t={t} />;
    }
  })();

  return (
    <aside className="w-64 shrink-0 overflow-y-auto border-l border-border p-3" data-testid="design-right-panel">
      {element === null && !multiSelected && (
        <div>
          <SectionTitle>{t("canvasTitle")}</SectionTitle>
          <p className="mb-3 text-sm" data-testid="design-props-canvas-size">
            {doc.width} × {doc.height} px
          </p>
          <Swatches
            active={doc.background}
            onPick={(color) => dispatch({ type: "setCanvas", patch: { background: color } })}
          />
          <ColorField
            label={t("background")}
            onCommit={(color) => dispatch({ type: "setCanvas", history: false, patch: { background: color } })}
            onCommitStart={beginHistory}
            testId="design-props-background"
            value={doc.background}
          />
        </div>
      )}

      {element !== null && (
        <>
          {typeSpecific}
          <Separator className="my-3" />
          <SectionTitle>{t("geometryTitle")}</SectionTitle>
          <div className="grid grid-cols-2 gap-x-3 gap-y-1.5">
            <NumberField
              label={t("x")}
              onCommit={(value) => patchSelected({ x: value })}
              onCommitStart={beginHistory}
              testId="design-props-x"
              value={element.x}
            />
            <NumberField
              label={t("y")}
              onCommit={(value) => patchSelected({ y: value })}
              onCommitStart={beginHistory}
              testId="design-props-y"
              value={element.y}
            />
            <NumberField
              label={t("width")}
              onCommit={(value) => patchSelected({ w: Math.max(1, value) })}
              onCommitStart={beginHistory}
              testId="design-props-w"
              value={element.w}
            />
            <NumberField
              label={t("height")}
              onCommit={(value) => patchSelected({ h: Math.max(1, value) })}
              onCommitStart={beginHistory}
              testId="design-props-h"
              value={element.h}
            />
            <NumberField
              label={t("rotation")}
              onCommit={(value) => patchSelected({ rotation: value })}
              onCommitStart={beginHistory}
              testId="design-props-rotation"
              value={element.rotation}
            />
          </div>
          <Separator className="my-3" />
          {layerSection}
        </>
      )}

      {multiSelected && layerSection}
    </aside>
  );
}

/** 透明度行（0-100 整数展示，存 0..1）。 */
function OpacityField({ element, onPatch, onCommitStart, t }: {
  element: DesignElement;
  onPatch: FieldPatch;
  onCommitStart: () => void;
  t: PanelT;
}) {
  return (
    <NumberField
      label={t("opacity")}
      onCommit={(percent) => onPatch({ opacity: clamp(percent, 0, 100) / 100 })}
      onCommitStart={onCommitStart}
      testId="design-props-opacity"
      value={Math.round(element.opacity * 100)}
    />
  );
}

function TextFields({
  beginHistory,
  element,
  onPatch,
  t,
}: {
  beginHistory: () => void;
  element: TextElement;
  onPatch: FieldPatch;
  t: PanelT;
}) {
  const tFonts = useTranslations("design.textPanel");
  const pill = element.background;
  return (
    <div>
      <SectionTitle>{t("textTitle")}</SectionTitle>
      <label className="mb-1.5 block text-xs text-muted-foreground">
        {t("content")}
        <Textarea
          className="mt-1 min-h-16"
          data-testid="design-props-content"
          onFocus={beginHistory}
          onInput={(event) => onPatch({ content: event.currentTarget.value })}
          value={element.content}
        />
      </label>
      <div className="mb-1.5">
        <SectionTitle>{t("font")}</SectionTitle>
        <Segment
          ariaLabel={t("font")}
          onChange={(id) => {
            const font = DESIGN_FONTS.find((font) => font.id === id);
            if (font) void ensureFontLoaded(font);
            onPatch({ fontFamily: font?.family ?? element.fontFamily }, true);
          }}
          options={DESIGN_FONTS.map((font) => ({
            label: tFonts(`fonts.${font.id}`),
            value: font.id,
          }))}
          testIdPrefix="design-props-font"
          value={DESIGN_FONTS.find((font) => font.family === element.fontFamily)?.id ?? DESIGN_FONTS[0].id}
        />
      </div>
      <NumberField
        label={t("fontSize")}
        onCommit={(value) => onPatch({ fontSize: Math.max(1, value) })}
        onCommitStart={beginHistory}
        testId="design-props-font-size"
        value={element.fontSize}
      />
      <div className="my-1.5">
        <Segment
          ariaLabel={t("fontWeight")}
          onChange={(weight) => onPatch({ fontWeight: weight === "bold" ? 700 : 400 }, true)}
          options={[
            { label: t("weightNormal"), value: "normal" as const },
            { label: t("weightBold"), value: "bold" as const },
          ]}
          testIdPrefix="design-props-weight"
          value={element.fontWeight >= 700 ? "bold" : "normal"}
        />
      </div>
      <Swatches active={element.color} onPick={(color) => onPatch({ color }, true)} />
      <ColorField
        label={t("textColor")}
        onCommit={(color) => onPatch({ color })}
        onCommitStart={beginHistory}
        testId="design-props-color"
        value={element.color}
      />
      <div className="my-1.5">
        <Segment
          ariaLabel={t("align")}
          onChange={(align) => onPatch({ align }, true)}
          options={[
            { label: t("alignLeft"), value: "left" as const },
            { label: t("alignCenter"), value: "center" as const },
            { label: t("alignRight"), value: "right" as const },
          ]}
          testIdPrefix="design-props-align"
          value={element.align}
        />
      </div>
      <NumberField
        label={t("lineHeight")}
        onCommit={(value) => onPatch({ lineHeight: Math.max(0.5, value) })}
        onCommitStart={beginHistory}
        step={0.1}
        testId="design-props-line-height"
        value={element.lineHeight}
      />
      <div className="my-1.5">
        <Segment
          ariaLabel={t("pillBackground")}
          onChange={(mode) =>
            onPatch(
              { background: mode === "on" ? { color: "#ffffff", paddingX: 16, paddingY: 6, radius: 12 } : null },
              true,
            )
          }
          options={[
            { label: t("pillOff"), value: "off" as const },
            { label: t("pillOn"), value: "on" as const },
          ]}
          testIdPrefix="design-props-pill"
          value={pill ? "on" : "off"}
        />
      </div>
      {pill && (
        <Swatches
          active={pill.color}
          onPick={(color) => onPatch({ background: { ...pill, color } }, true)}
        />
      )}
      <OpacityField element={element} onCommitStart={beginHistory} onPatch={onPatch} t={t} />
    </div>
  );
}

function ImageFields({
  beginHistory,
  element,
  onPatch,
  t,
}: {
  beginHistory: () => void;
  element: ImageElement;
  onPatch: FieldPatch;
  t: PanelT;
}) {
  return (
    <div>
      <SectionTitle>{t("imageTitle")}</SectionTitle>
      <NumberField
        label={t("radius")}
        onCommit={(value) => onPatch({ radius: Math.max(0, value) })}
        onCommitStart={beginHistory}
        testId="design-props-radius"
        value={element.radius}
      />
      <div className="my-1.5">
        <Segment
          ariaLabel={t("fit")}
          onChange={(fit) => onPatch({ fit }, true)}
          options={[
            { label: t("fitCover"), value: "cover" as const },
            { label: t("fitContain"), value: "contain" as const },
          ]}
          testIdPrefix="design-props-fit"
          value={element.fit}
        />
      </div>
      <OpacityField element={element} onCommitStart={beginHistory} onPatch={onPatch} t={t} />
    </div>
  );
}

function ShapeFields({
  beginHistory,
  element,
  onPatch,
  t,
}: {
  beginHistory: () => void;
  element: ShapeElement;
  onPatch: FieldPatch;
  t: PanelT;
}) {
  return (
    <div>
      <SectionTitle>{t("shapeTitle")}</SectionTitle>
      <Swatches active={element.fill} onPick={(fill) => onPatch({ fill }, true)} />
      <ColorField
        label={t("fill")}
        onCommit={(fill) => onPatch({ fill })}
        onCommitStart={beginHistory}
        testId="design-props-fill"
        value={element.fill}
      />
      {element.kind === "rect" && (
        <NumberField
          label={t("radius")}
          onCommit={(value) => onPatch({ radius: Math.max(0, value) })}
          onCommitStart={beginHistory}
          testId="design-props-radius"
          value={element.radius ?? 0}
        />
      )}
      <OpacityField element={element} onCommitStart={beginHistory} onPatch={onPatch} t={t} />
    </div>
  );
}
