"use client";
/**
 * 文字面板（spec design-editor「文字与艺术字体」）：文字预设三档按钮以
 * 预设样式渲染样张文案（所见即所得）；艺术字体列表以各字体渲染预览，
 * 点击由页面层 ensureFontLoaded 预热后插入该字体文本元素。
 * 字体仅为新元素属性——面板不提供任何全局字体切换入口。
 */
import { useTranslations } from "next-intl";
import { useMemo } from "react";
import { DesignElementView } from "@/components/design/design-element-view";
import { fragmentBounds } from "@/lib/design/insert";
import { FANCY_TEXT_PRESETS, type FancyTextPreset } from "@/lib/design/fancy-text";
import { DESIGN_FONTS, type DesignFont } from "@/lib/design/fonts";
import { TEXT_PRESETS, type TextPreset } from "@/lib/design/text-presets";

/** 预设预览缩放：面板宽度有限，48px 级字号按比例示意（气质一致即可）。 */
const PREVIEW_MAX_FONT_SIZE = 26;
const FANCY_THUMB_WIDTH = 176;

/** 花字缩略：元素组原坐标铺放 + CSS scale 缩小（同模版缩略做法）。 */
function FancyThumb({ contents, preset }: { contents: string[]; preset: FancyTextPreset }) {
  const elements = useMemo(() => preset.build(contents), [contents, preset]);
  const bounds = fragmentBounds(elements);
  if (!bounds) return null;
  const k = FANCY_THUMB_WIDTH / bounds.width;
  return (
    <span className="relative block w-full overflow-hidden" style={{ height: bounds.height * k }}>
      <span
        className="absolute left-0 top-0 block"
        style={{
          height: bounds.height,
          transform: `scale(${k})`,
          transformOrigin: "top left",
          width: bounds.width,
        }}
      >
        {elements.map((el) => (
          <DesignElementView element={el} key={el.id} />
        ))}
      </span>
    </span>
  );
}

export function DesignTextPanel({
  onSelectFancy,
  onSelectFont,
  onSelectPreset,
}: {
  onSelectFancy: (preset: FancyTextPreset) => void;
  onSelectFont: (font: DesignFont) => void;
  onSelectPreset: (preset: TextPreset) => void;
}) {
  const t = useTranslations("design.textPanel");
  const tFancy = useTranslations("design.fancy");
  return (
    <div>
      <h2 className="mb-2 px-1 text-sm font-medium text-muted-foreground">{t("presetsTitle")}</h2>
      <div className="flex flex-col gap-2">
        {TEXT_PRESETS.map((preset) => (
          <button
            aria-label={t(`presets.${preset.id}.name`)}
            className="block rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-violet-400"
            data-testid={`design-text-preset-${preset.id}`}
            key={preset.id}
            onClick={() => onSelectPreset(preset)}
            type="button"
          >
            <span
              className="block truncate leading-tight"
              style={{
                color: preset.color,
                fontSize: Math.min(preset.fontSize, PREVIEW_MAX_FONT_SIZE),
                fontWeight: preset.fontWeight,
              }}
            >
              {t(`presets.${preset.id}.sample`)}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">
              {t(`presets.${preset.id}.name`)}
            </span>
          </button>
        ))}
      </div>

      <h2 className="mb-2 mt-5 px-1 text-sm font-medium text-muted-foreground">{t("fontsTitle")}</h2>
      <div className="flex flex-col gap-2">
        {DESIGN_FONTS.map((font) => (
          <button
            aria-label={t(`fonts.${font.id}`)}
            className="block rounded-lg border border-border px-3 py-2.5 text-left transition-colors hover:border-violet-400"
            data-testid={`design-font-${font.id}`}
            key={font.id}
            onClick={() => onSelectFont(font)}
            type="button"
          >
            <span
              className="block truncate leading-tight"
              style={{ fontFamily: font.family, fontSize: 22, fontWeight: font.weight }}
            >
              {t("fontSample")}
            </span>
            <span className="mt-1 block text-xs text-muted-foreground">{t(`fonts.${font.id}`)}</span>
          </button>
        ))}
      </div>
      <h2 className="mb-2 mt-5 px-1 text-sm font-medium text-muted-foreground">{t("fancyTitle")}</h2>
      <div className="flex flex-col items-center gap-3">
        {FANCY_TEXT_PRESETS.map((preset) => {
          const contents = preset.contentKeys.map((key) => tFancy(key));
          return (
            <button
              aria-label={tFancy(`${preset.id}.name`)}
              className="block w-full overflow-hidden rounded-lg border border-border text-left transition-colors hover:border-violet-400"
              data-testid={`design-fancy-${preset.id}`}
              key={preset.id}
              onClick={() => onSelectFancy(preset)}
              type="button"
            >
              <FancyThumb contents={contents} preset={preset} />
              <span className="block px-2 py-1.5 text-xs text-muted-foreground">
                {tFancy(`${preset.id}.name`)}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
}
