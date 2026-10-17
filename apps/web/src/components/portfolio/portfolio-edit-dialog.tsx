"use client";

/**
 * 作品信息编辑：标题 + 标签覆盖式设置。
 * 标签为覆盖语义——传什么就是什么，清空即移除全部关联（design.md D3）。
 */
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogTitle } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { XIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PortfolioItem } from "@/lib/portfolio/use-portfolio-list";

const MAX_TAG_LENGTH = 64;
const MAX_TAGS = 20;

/** 外层壳：按 item.id 作为 key，切换条目时整块重挂载以重置内部状态。 */
export function PortfolioEditDialog(props: {
  item: PortfolioItem | null;
  onClose: () => void;
  onSave: (id: string, patch: { title: string | null; tags: string[] }) => Promise<void>;
}) {
  if (!props.item) return null;
  return <EditForm key={props.item.id} {...props} item={props.item} />;
}

function EditForm({
  item,
  onClose,
  onSave,
}: {
  item: PortfolioItem;
  onClose: () => void;
  onSave: (id: string, patch: { title: string | null; tags: string[] }) => Promise<void>;
}) {
  const t = useTranslations("portfolio");
  // 初值取自 item，无需 effect 同步——key 变化即重建
  const [title, setTitle] = useState(item.title ?? "");
  const [tags, setTags] = useState<string[]>(() => item.tags.map((tag) => tag.name));
  const [draft, setDraft] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const addTag = () => {
    const name = draft.trim();
    if (name.length === 0) {
      setError(t("edit.tagsPlaceholder"));
      return;
    }
    if (name.length > MAX_TAG_LENGTH) {
      setError(t("error.tagTooLong"));
      return;
    }
    // 大小写不敏感去重：避免 Poster / poster 成为两个标签
    if (tags.some((existing) => existing.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      setError(null);
      return;
    }
    if (tags.length >= MAX_TAGS) {
      setError(t("error.tooManyTags"));
      return;
    }
    setTags([...tags, name]);
    setDraft("");
    setError(null);
  };

  const save = async () => {
    setSaving(true);
    setError(null);
    try {
      await onSave(item.id, { title: title.trim() || null, tags });
      onClose();
    } catch {
      setError(t("edit.failed"));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Dialog open onOpenChange={(open) => !open && !saving && onClose()}>
      <DialogContent className="max-w-md">
        <DialogTitle>{t("edit.titleLabel")}</DialogTitle>
        <div className="flex flex-col gap-4">
          <div className="flex flex-col gap-1.5">
            <label htmlFor="portfolio-title" className="text-sm text-muted-foreground">
              {t("edit.titleLabel")}
            </label>
            <Input
              id="portfolio-title"
              value={title}
              maxLength={120}
              placeholder={t("edit.titlePlaceholder")}
              onChange={(e) => setTitle(e.target.value)}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <span className="text-sm text-muted-foreground">{t("edit.tagsLabel")}</span>
            <div className="flex gap-2">
              <Input
                value={draft}
                maxLength={MAX_TAG_LENGTH}
                placeholder={t("edit.tagsPlaceholder")}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault();
                    addTag();
                  }
                }}
              />
              <Button type="button" variant="outline" onClick={addTag}>
                {t("edit.tagsLabel")}
              </Button>
            </div>
            <p className="text-xs text-muted-foreground">{t("edit.tagsHint")}</p>
            {tags.length > 0 ? (
              <div className="flex flex-wrap gap-1.5 pt-1">
                {tags.map((tag) => (
                  <span
                    key={tag}
                    className="inline-flex items-center gap-1 rounded-full bg-muted px-2 py-0.5 text-xs"
                  >
                    {tag}
                    <button
                      type="button"
                      aria-label={tag}
                      onClick={() => setTags(tags.filter((v) => v !== tag))}
                      className="text-muted-foreground hover:text-foreground"
                    >
                      <XIcon className="size-3" />
                    </button>
                  </span>
                ))}
              </div>
            ) : null}
          </div>

          {error ? (
            <p role="status" className="text-sm text-red-600 dark:text-red-400">
              {error}
            </p>
          ) : null}

          <div className="flex justify-end gap-2">
            <Button variant="ghost" onClick={onClose} disabled={saving}>
              {t("card.cancel")}
            </Button>
            <Button onClick={save} disabled={saving}>
              {saving ? t("edit.saved") : t("edit.save")}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}