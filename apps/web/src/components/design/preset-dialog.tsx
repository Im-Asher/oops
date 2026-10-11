"use client";

/**
 * 尺寸前置设置弹窗（spec design-editor「尺寸前置设置弹窗」）：
 * 左侧分类（全部/常用尺寸/电商物料/社交媒体/最近使用），右侧自定义宽高
 * （锁定比例）+ 预设网格。预设/最近使用创建会记录最近使用，自定义不记录。
 */
import { Link2Icon, Link2OffIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useMemo, useRef, useState } from "react";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import {
  DESIGN_PRESET_GROUPS,
  loadRecentSizes,
  recordRecentSize,
  type DesignPreset,
  type DesignSize,
} from "@/lib/design/presets";

type CategoryId = "all" | "common" | "ecom" | "social" | "recent";

const MAX_SIZE = 10000;

function parsePositiveInt(raw: string): number | null {
  const value = Number.parseInt(raw, 10);
  return Number.isFinite(value) && value > 0 && value <= MAX_SIZE ? value : null;
}

/** 预设卡片：等比迷你示意 + 名称 + 像素尺寸。 */
function PresetCard({ preset, name, onPick }: { preset: DesignPreset; name: string; onPick: () => void }) {
  const aspect = preset.width / preset.height;
  const thumbW = aspect >= 1 ? 30 : Math.max(14, Math.round(30 * aspect));
  const thumbH = aspect >= 1 ? Math.max(14, Math.round(30 / aspect)) : 30;
  return (
    <button
      className="flex items-center gap-3 rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
      data-testid={`design-preset-${preset.id}`}
      onClick={onPick}
      type="button"
    >
      <span className="flex h-8 w-8 shrink-0 items-center justify-center">
        <span
          className="rounded-[3px] border border-border bg-muted"
          style={{ width: thumbW, height: thumbH }}
        />
      </span>
      <span className="min-w-0">
        <span className="block truncate text-sm text-foreground">{name}</span>
        <span className="block text-xs text-muted-foreground">
          {preset.width} × {preset.height} px
        </span>
      </span>
    </button>
  );
}

/** 最近使用列表：随弹窗打开挂载，懒初始化读取 localStorage（避免 effect 内 setState）。 */
function RecentList({
  emptyLabel,
  unitLabel,
  onPick,
}: {
  emptyLabel: string;
  unitLabel: string;
  onPick: (size: DesignSize) => void;
}) {
  const [recent] = useState(() => loadRecentSizes());
  if (recent.length === 0) {
    return <p className="py-8 text-center text-sm text-muted-foreground">{emptyLabel}</p>;
  }
  return (
    <div className="grid grid-cols-2 gap-2">
      {recent.map((size) => (
        <button
          className="flex items-center justify-between rounded-lg border border-border bg-card px-3 py-2.5 text-left transition-colors hover:border-primary/40 hover:bg-accent/50"
          data-testid={`design-recent-${size.width}x${size.height}`}
          key={`${size.width}x${size.height}`}
          onClick={() => onPick(size)}
          type="button"
        >
          <span className="text-sm text-foreground">
            {size.width} × {size.height}
          </span>
          <span className="text-xs text-muted-foreground">{unitLabel}</span>
        </button>
      ))}
    </div>
  );
}

export function PresetDialog({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (open: boolean) => void;
}) {
  const t = useTranslations("design.dialog");
  const tp = useTranslations("design.presets");
  const router = useRouter();
  const [category, setCategory] = useState<CategoryId>("all");
  const [widthText, setWidthText] = useState("");
  const [heightText, setHeightText] = useState("");
  const [locked, setLocked] = useState(false);

  const customValid = parsePositiveInt(widthText) !== null && parsePositiveInt(heightText) !== null;
  // 锁定比例的比值：开锁瞬间由当前合法值捕获，锁定期内固定（否则同步会自强化）。
  const ratioRef = useRef(1);

  const groups = useMemo(() => {
    if (category === "recent" || category === "all") return DESIGN_PRESET_GROUPS;
    return DESIGN_PRESET_GROUPS.filter((group) => group.id === category);
  }, [category]);

  function create(size: DesignSize, record: boolean) {
    if (record) recordRecentSize({ width: size.width, height: size.height });
    onOpenChange(false);
    router.push(`/design?w=${size.width}&h=${size.height}`);
  }

  /** 锁定比例：一侧变化时另一侧按开锁时捕获的比值同步。 */
  function syncLocked(side: "width" | "height", raw: string) {
    const num = parsePositiveInt(raw);
    if (num === null) return;
    const synced =
      side === "width" ? Math.round(num / ratioRef.current) : Math.round(num * ratioRef.current);
    const clamped = Math.min(MAX_SIZE, Math.max(1, synced));
    if (side === "width") setHeightText(String(clamped));
    else setWidthText(String(clamped));
  }

  const categoryLabels: Record<CategoryId, string> = {
    all: t("categoryAll"),
    common: t("groupCommon"),
    ecom: t("groupEcom"),
    social: t("groupSocial"),
    recent: t("recent"),
  };

  return (
    <Dialog onOpenChange={onOpenChange} open={open}>
      {/* sm:max-w-2xl 必须带 variant：基础组件的 sm:max-w-sm 在 ≥sm 视口按 CSS
          输出顺序覆盖无 variant 的 max-w-2xl，弹窗会被压成 384px，双栏挤压、
          预设网格溢出弹窗边界（卡片悬在遮罩上，点击即误关）。 */}
      <DialogContent aria-describedby={undefined} className="flex max-w-2xl gap-0 p-0 sm:max-w-2xl">
        {/* 左侧分类 */}
        <div className="w-40 shrink-0 border-r border-border bg-sidebar p-2">
          {(["all", "common", "ecom", "social", "recent"] as CategoryId[]).map((id) => (
            <button
              className={`mb-1 flex w-full items-center rounded-lg px-3 py-2 text-sm ${
                category === id
                  ? "bg-muted text-foreground"
                  : "text-muted-foreground hover:bg-accent/60 hover:text-foreground"
              }`}
              data-testid={`design-category-${id}`}
              key={id}
              onClick={() => setCategory(id)}
              type="button"
            >
              {categoryLabels[id]}
            </button>
          ))}
        </div>

        {/* 右侧内容 */}
        <div className="min-w-0 flex-1 p-5">
          <DialogHeader className="p-0 text-left">
            <DialogTitle>{t("title")}</DialogTitle>
            <DialogDescription>{t("description")}</DialogDescription>
          </DialogHeader>

          {/* 自定义尺寸 */}
          <section className="mt-4">
            <p className="mb-2 text-xs font-medium text-muted-foreground">{t("customSize")}</p>
            <div className="flex items-center gap-2">
              <Input
                aria-label={t("width")}
                className="h-9 w-24"
                inputMode="numeric"
                min={1}
                onChange={(e) => {
                  setWidthText(e.target.value);
                  if (locked) syncLocked("width", e.target.value);
                }}
                placeholder="800"
                type="number"
                value={widthText}
              />
              <span className="text-xs text-muted-foreground">{t("unit")}</span>
              <span aria-hidden className="text-muted-foreground">×</span>
              <Input
                aria-label={t("height")}
                className="h-9 w-24"
                inputMode="numeric"
                min={1}
                onChange={(e) => {
                  setHeightText(e.target.value);
                  if (locked) syncLocked("height", e.target.value);
                }}
                placeholder="800"
                type="number"
                value={heightText}
              />
              <span className="text-xs text-muted-foreground">{t("unit")}</span>
              <Button
                aria-label={t("lockRatio")}
                aria-pressed={locked}
                className="size-9 p-0"
                onClick={() => {
                  if (!locked) {
                    // 开锁瞬间捕获比值；当前值不合法则按 1:1
                    const width = parsePositiveInt(widthText);
                    const height = parsePositiveInt(heightText);
                    ratioRef.current = width !== null && height !== null ? width / height : 1;
                  }
                  setLocked((prev) => !prev);
                }}
                size="icon"
                type="button"
                variant={locked ? "secondary" : "ghost"}
              >
                {locked ? <Link2Icon className="size-4" /> : <Link2OffIcon className="size-4" />}
              </Button>
              <Button
                className="ml-auto"
                data-testid="design-create-custom"
                disabled={!customValid}
                onClick={() => {
                  const width = parsePositiveInt(widthText);
                  const height = parsePositiveInt(heightText);
                  if (width === null || height === null) return;
                  create({ width, height }, false);
                }}
                type="button"
              >
                {t("create")}
              </Button>
            </div>
          </section>

          {/* 预设 / 最近使用 */}
          <div className="mt-4 max-h-72 overflow-y-auto pr-1">
            {category === "recent" ? (
              <RecentList
                emptyLabel={t("recentEmpty")}
                onPick={(size) => create(size, true)}
                unitLabel={t("unit")}
              />
            ) : (
              groups.map((group) => (
                <section className="mb-4 last:mb-0" key={group.id}>
                  <p className="mb-2 text-xs font-medium text-muted-foreground">
                    {group.id === "common"
                      ? t("groupCommon")
                      : group.id === "ecom"
                        ? t("groupEcom")
                        : t("groupSocial")}
                  </p>
                  <div className="grid grid-cols-2 gap-2">
                    {group.presets.map((preset) => (
                      <PresetCard
                        key={preset.id}
                        name={tp(`${preset.id}.name`)}
                        onPick={() => create(preset, true)}
                        preset={preset}
                      />
                    ))}
                  </div>
                </section>
              ))
            )}
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}
