"use client";

/**
 * 大图预览：等比适配 + 下载 + 元信息。
 * 不做缩放/平移——首版不为未经证实的需求建交互组件（design.md D8）。
 */
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { useTranslations } from "next-intl";
import { DownloadIcon } from "lucide-react";
import type { PortfolioItem } from "@/lib/portfolio/use-portfolio-list";

function Row({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div className="flex gap-3 text-sm">
      <span className="w-16 shrink-0 text-muted-foreground">{label}</span>
      <span className="min-w-0 break-words">{value}</span>
    </div>
  );
}

/**
 * 原图预览：等比适配容器，不做缩放交互（design.md D8）。
 * 直接用 <img>：原图取自 files 路由且资产表无缩略图字段，
 * next/image 的优化在此无收益（见 portfolio-card 同处说明）。
 */
function PreviewImage({ item }: { item: PortfolioItem }) {
  return (
    <img
      src={item.url}
      alt={item.title ?? ""}
      className="max-h-[68vh] w-auto max-w-full object-contain"
    />
  );
}

export function PortfolioPreview({
  item,
  onClose,
  onToCanvas,
  onToDesign,
}: {
  item: PortfolioItem | null;
  onClose: () => void;
  onToCanvas: (item: PortfolioItem) => void;
  onToDesign: (item: PortfolioItem) => void;
}) {
  const t = useTranslations("portfolio");
  if (!item) return null;

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="max-w-4xl">
        <DialogTitle className="pr-8">{item.title ?? t("card.untitled")}</DialogTitle>
        <div className="grid gap-4 md:grid-cols-[1fr_240px]">
          <div className="flex max-h-[70vh] items-center justify-center overflow-auto rounded-lg bg-muted/40 p-2">
            <PreviewImage item={item} />
          </div>
          <div className="flex flex-col gap-3">
            <div className="flex flex-col gap-2">
              <Row label={t("preview.size")} value={item.width && item.height ? `${item.width} × ${item.height}` : null} />
              <Row label={t("preview.model")} value={item.model} />
              <Row label={t("preview.savedAt")} value={new Date(item.savedAt).toLocaleString()} />
            </div>
            {item.prompt ? (
              <div className="flex flex-col gap-1">
                <span className="text-sm text-muted-foreground">{t("preview.prompt")}</span>
                <p className="max-h-40 overflow-auto rounded-md bg-muted/40 p-2 text-sm">{item.prompt}</p>
              </div>
            ) : null}
            <div className="mt-auto flex flex-col gap-2">
              <Button asChild variant="outline">
                <a href={item.url} download>
                  <DownloadIcon className="size-4" />
                  {t("preview.download")}
                </a>
              </Button>
              <Button variant="outline" onClick={() => onToCanvas(item)}>
                {t("card.toCanvas")}
              </Button>
              <Button variant="outline" onClick={() => onToDesign(item)}>
                {t("card.toDesign")}
              </Button>
            </div>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}