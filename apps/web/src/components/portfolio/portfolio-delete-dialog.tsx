"use client";

/**
 * 彻底删除确认：与「取消收藏」语义不同（前者删对象字节，后者只清标记），
 * 两者不在同一处触发，避免误操作。
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PortfolioItem } from "@/lib/portfolio/use-portfolio-list";

export function PortfolioDeleteDialog({
  item,
  onClose,
  onConfirm,
}: {
  item: PortfolioItem | null;
  onClose: () => void;
  onConfirm: (item: PortfolioItem) => Promise<void>;
}) {
  const t = useTranslations("portfolio.card");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  if (!item) return null;

  return (
    <Dialog
      open
      onOpenChange={(open) => {
        if (!open && !busy) onClose();
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogTitle>{t("delete")}</DialogTitle>
        <p className="text-sm text-muted-foreground">{t("deleteHint")}</p>
        {error ? (
          <p role="status" className="text-sm text-red-600 dark:text-red-400">
            {t("gone")}
          </p>
        ) : null}
        <div className="flex justify-end gap-2">
          <Button variant="ghost" onClick={onClose} disabled={busy}>
            {t("cancel")}
          </Button>
          <Button
            variant="destructive"
            disabled={busy}
            onClick={async () => {
              setBusy(true);
              setError(false);
              try {
                await onConfirm(item);
                onClose();
              } catch {
                // 保留对话框让用户看到失败，可重试或取消
                setError(true);
              } finally {
                setBusy(false);
              }
            }}
          >
            {t("confirm")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}