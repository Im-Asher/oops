"use client";

/**
 * 作品集页（spec portfolio）：独立全屏、无应用侧栏，与 /canvas、/design 同壳。
 * 瀑布流用 CSS multi-column——assets 已记录宽高，columns 足够且省一个 JS 依赖（design.md D8）。
 */
import { PortfolioCard } from "@/components/portfolio/portfolio-card";
import { PortfolioDeleteDialog } from "@/components/portfolio/portfolio-delete-dialog";
import { PortfolioEditDialog } from "@/components/portfolio/portfolio-edit-dialog";
import { PortfolioPreview } from "@/components/portfolio/portfolio-preview";
import { Button } from "@/components/ui/button";
import { apiErrorMessage } from "@/lib/api-error";
import {
  usePortfolioList,
  type PortfolioItem,
} from "@/lib/portfolio/use-portfolio-list";
import { ArrowLeftIcon, Loader2Icon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useState } from "react";

export default function PortfolioPage() {
  const t = useTranslations("portfolio");
  const tc = useTranslations("common.apiErrors");
  const router = useRouter();
  const list = usePortfolioList((k) => t(`page.${k}` as "page.loadFailed"));

  const [preview, setPreview] = useState<PortfolioItem | null>(null);
  const [editing, setEditing] = useState<PortfolioItem | null>(null);
  const [deleting, setDeleting] = useState<PortfolioItem | null>(null);

  const patchAsset = async (
    id: string,
    patch: { title?: string | null; tags?: string[]; savedAt?: string | null },
  ) => {
    const res = await fetch(`/api/assets/${id}`, {
      method: "PATCH",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(patch),
    });
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new Error(apiErrorMessage(body, tc as never, body?.message ?? ""));
    }
    // 成功后用服务端返回的字段更新本地，避免乐观更新与服务端不一致。
    // PATCH 只回title/savedAt，不回标签 id——本地按名称构造 chip，
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
    if (!res.ok) {
      const body = (await res.json().catch(() => null)) as { code?: string; message?: string } | null;
      throw new Error(apiErrorMessage(body, tc as never, body?.message ?? ""));
    }
    list.remove(item.id);
  };

  // 加工出口：assetId 经URL 传递而非 url——服务端校验归属后才给地址，
  // 避免用户手改参数注入任意外部图片源（design.md D7）
  const toCanvas = (item: PortfolioItem) => router.push(`/canvas?assetId=${item.id}`);
  const toDesign = (item: PortfolioItem) => router.push(`/design?assetId=${item.id}`);

  return (
    <div className="min-h-dvh bg-background">
      <header className="sticky top-0 z-20 border-b border-border bg-background/85 backdrop-blur">
        <div className="mx-auto flex max-w-6xl items-center gap-3 px-4 py-3">
          <Link
            href="/home"
            className="rounded-md p-1.5 text-muted-foreground transition hover:bg-accent hover:text-foreground"
            aria-label="back"
          >
            <ArrowLeftIcon className="size-5" />
          </Link>
          <h1 className="text-base font-semibold">{t("page.title")}</h1>
          {list.state === "ready" && list.items.length > 0 ? (
            <span className="text-sm text-muted-foreground">
              {t("page.subtitle", { count: list.items.length })}
            </span>
          ) : null}
        </div>

        {list.allTags.length > 0 ? (
          <div className="mx-auto flex max-w-6xl flex-wrap gap-1.5 px-4 pb-3">
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
      </header>

      <main className="mx-auto max-w-6xl px-4 py-6">
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
            {/* CSS 瀑布流：列数随视口自适应，break-inside 避免卡片被截断 */}
            <div className="[column-fill:_balance] gap-3 sm:columns-2 lg:columns-3 xl:columns-4">
              {list.items.map((item) => (
                <PortfolioCard
                  key={item.id}
                  item={item}
                  onOpen={setPreview}
                  onEdit={setEditing}
                  onDelete={setDeleting}
                  onUnsaved={unsave}
                  onToCanvas={toCanvas}
                  onToDesign={toDesign}
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
      </main>

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