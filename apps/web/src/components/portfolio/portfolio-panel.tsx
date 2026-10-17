"use client";

/**
 * 作品集面板（spec portfolio）：嵌在 /home 主区，非独立路由页。
 * 瀑布流用 CSS multi-column——assets 已记录宽高，columns 足够且省一个 JS 依赖（design.md D8）。
 */
import { PortfolioCard } from "@/components/portfolio/portfolio-card";
import { PortfolioDeleteDialog } from "@/components/portfolio/portfolio-delete-dialog";
import { PortfolioEditDialog } from "@/components/portfolio/portfolio-edit-dialog";
import { PortfolioPreview } from "@/components/portfolio/portfolio-preview";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-error";
import { usePortfolioList, type PortfolioItem } from "@/lib/portfolio/use-portfolio-list";
import { Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useState } from "react";

export function PortfolioPanel() {
  const t = useTranslations("portfolio");
  const tc = useTranslations("common.apiErrors");
  const router = useRouter();
  const list = usePortfolioList((k) => t(`page.${k}` as "page.loadFailed"));

  const [preview, setPreview] = useState<PortfolioItem | null>(null);
  const [editing, setEditing] = useState<PortfolioItem | null>(null);
  const [deleting, setDeleting] = useState<PortfolioItem | null>(null);

  const failMessage = async (res: Response): Promise<string> => {
    const body = (await res.json().catch(() => null)) as {
      code?: string;
      message?: string;
    } | null;
    return apiErrorMessage(body, tc as never, body?.message ?? "");
  };

  const patchAsset = async (
    id: string,
    patch: { title?: string | null; tags?: string[]; savedAt?: string | null },
  ) => {
    const res = await fetch(`/api/assets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) throw new Error(await failMessage(res));
    // PATCH 只回 title/savedAt，不回标签 id——本地按名称构造 chip，
    // tagId 缺失时用名称占位（筛选按名称提交，不依赖 tagId）。
    const body = (await res.json()) as { item: { title: string | null; savedAt: string } | null };
    if (patch.title !== undefined || patch.tags !== undefined) {
      list.replace(id, {
        title: body.item?.title ?? null,
        tags: (patch.tags ?? []).map((name) => ({ tagId: `local:${name}`, name })),
      });
    }
  };

  const unsave = async (item: PortfolioItem) => {
    try {
      await patchAsset(item.id, { savedAt: null });
      list.remove(item.id);
      setPreview((cur) => (cur?.id === item.id ? null : cur));
    } catch {
      // 失败时保留条目，避免让用户以为已取消
    }
  };

  const saveMeta = async (id: string, patch: { title: string | null; tags: string[] }) => {
    await patchAsset(id, patch);
  };

  const destroy = async (item: PortfolioItem) => {
    const res = await fetch(`/api/assets/${item.id}`, { method: "DELETE" });
    if (!res.ok) throw new Error(await failMessage(res));
    list.remove(item.id);
  };

  // 加工出口：assetId 经 URL 传递而非 url——服务端校验归属后才给地址，
  // 避免用户手改参数注入任意外部图片源（design.md D7）
  const toCanvas = (item: PortfolioItem) => router.push(`/canvas?assetId=${item.id}`);
  const toDesign = (item: PortfolioItem) => router.push(`/design?assetId=${item.id}`);

  return (
    <div className="mx-auto w-full max-w-5xl px-6 py-8">
      <header className="mb-5 flex flex-wrap items-center gap-3">
        <h2 className="text-lg font-semibold text-foreground">{t("page.title")}</h2>
        {list.state === "ready" && list.items.length > 0 ? (
          <span className="text-sm text-muted-foreground">
            {t("page.subtitle", { count: list.items.length })}
          </span>
        ) : null}
      </header>

      {list.allTags.length > 0 ? (
        <div className="mb-5 flex flex-wrap gap-1.5">
          <TagChip
            active={list.activeTag === null}
            onClick={() => list.setTag(null)}
            label={t("page.allTags")}
          />
          {list.allTags.map((tag) => (
            <TagChip
              key={tag.tagId}
              active={list.activeTag === tag.name}
              onClick={() => list.setTag(list.activeTag === tag.name ? null : tag.name)}
              label={tag.name}
            />
          ))}
        </div>
      ) : null}

      {list.state === "loading" ? (
        <div className="flex items-center justify-center py-24">
          <Loader2Icon className="size-6 animate-spin text-muted-foreground" />
        </div>
      ) : list.state === "error" ? (
        <div className="flex flex-col items-center gap-3 py-24 text-center">
          <p className="text-sm text-muted-foreground">{list.error}</p>
          <Button variant="outline" onClick={list.retry}>
            {t("page.retry")}
          </Button>
        </div>
      ) : list.items.length === 0 ? (
        <div className="flex flex-col items-center gap-2 py-24 text-center">
          <p className="text-base font-medium">{t("page.empty.title")}</p>
          <p className="max-w-sm text-sm text-muted-foreground">{t("page.empty.hint")}</p>
        </div>
      ) : (
        <>
          <div className="gap-3 [column-fill:_balance] sm:columns-2 lg:columns-3">
            {list.items.map((item) => (
              <PortfolioCard
                key={item.id}
                item={item}
                onDelete={setDeleting}
                onEdit={setEditing}
                onOpen={setPreview}
                onToCanvas={toCanvas}
                onToDesign={toDesign}
                onUnsaved={unsave}
              />
            ))}
          </div>

          <div className="mt-6 flex justify-center">
            {list.loadingMore ? (
              <Loader2Icon className="size-5 animate-spin text-muted-foreground" />
            ) : list.hasMore ? (
              <Button variant="outline" onClick={list.loadMore}>
                {t("page.loadMore")}
              </Button>
            ) : (
              <p className="text-xs text-muted-foreground">{t("page.end")}</p>
            )}
          </div>
        </>
      )}

      <PortfolioPreview
        item={preview}
        onClose={() => setPreview(null)}
        onToCanvas={(item) => {
          setPreview(null);
          toCanvas(item);
        }}
        onToDesign={(item) => {
          setPreview(null);
          toDesign(item);
        }}
      />
      <PortfolioEditDialog item={editing} onClose={() => setEditing(null)} onSave={saveMeta} />
      <PortfolioDeleteDialog item={deleting} onClose={() => setDeleting(null)} onConfirm={destroy} />
    </div>
  );
}

function TagChip({
  active,
  onClick,
  label,
}: {
  active: boolean;
  onClick: () => void;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={
        active
          ? "rounded-full bg-foreground px-3 py-1 text-xs text-background transition"
          : "rounded-full border border-border px-3 py-1 text-xs text-muted-foreground transition hover:bg-accent hover:text-foreground"
      }
    >
      {label}
    </button>
  );
}