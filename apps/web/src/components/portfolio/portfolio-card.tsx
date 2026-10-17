"use client";

/**
 * 作品集卡片：图片 + 标题 + 标签 chip + 来源名，hover 出操作条。
 * 宽高在入库时已记录，因此即使图片 404，布局也不跳动（design.md R1）。
 */
import { cn } from "cn";
import {
  MoreHorizontalIcon,
  PencilIcon,
  StarIcon,
  Trash2Icon,
  Wand2Icon,
} from "lucide-react";
import { useTranslations } from "next-intl";
import { useState } from "react";
import type { PortfolioItem } from "@/lib/portfolio/use-portfolio-list";

export interface PortfolioCardProps {
  item: PortfolioItem;
  onOpen: (item: PortfolioItem) => void;
  onEdit: (item: PortfolioItem) => void;
  onDelete: (item: PortfolioItem) => void;
  onUnsaved: (item: PortfolioItem) => void;
  onToCanvas: (item: PortfolioItem) => void;
  onToDesign: (item: PortfolioItem) => void;
}

function MoreMenu({
  item,
  onEdit,
  onDelete,
}: Pick<PortfolioCardProps, "item" | "onEdit" | "onDelete">) {
  const t = useTranslations("portfolio.card");
  const [open, setOpen] = useState(false);
  return (
    <div className="relative">
      <button
        type="button"
        aria-label={t("edit")}
        title={t("edit")}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((v) => !v);
        }}
        className="rounded-md bg-black/55 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/75"
      >
        <MoreHorizontalIcon className="size-4" />
      </button>
      {open ? (
        <>
          {/* 点击遮罩关闭；不阻止卡片点击打开预览 */}
          <button
            type="button"
            aria-hidden
            tabIndex={-1}
            className="fixed inset-0 z-10 cursor-default"
            onClick={(e) => {
              e.stopPropagation();
              setOpen(false);
            }}
          />
          <div
            role="menu"
            className="absolute right-0 top-full z-20 mt-1 w-40 overflow-hidden rounded-lg border border-border bg-popover py-1 shadow-md"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
              onClick={() => {
                setOpen(false);
                onEdit(item);
              }}
            >
              <PencilIcon className="size-3.5 text-muted-foreground" />
              {t("edit")}
            </button>
            <button
              type="button"
              role="menuitem"
              className="flex w-full items-center gap-2 px-3 py-2 text-left text-sm text-red-600 hover:bg-accent dark:text-red-400"
              onClick={() => {
                setOpen(false);
                onDelete(item);
              }}
            >
              <Trash2Icon className="size-3.5" />
              {t("delete")}
            </button>
          </div>
        </>
      ) : null}
    </div>
  );
}

/**
 * 卡片图：宽高已入库，故锁定宽高比，加载前不产生布局位移；404 时回落占位块。
 * 直接用 <img>：原图取自 files 路由且资产表无缩略图字段，
 * next/image 的优化在此无收益（design.md R1）。
 */
function CardImage({ item, ratio }: { item: PortfolioItem; ratio: string | undefined }) {
  const t = useTranslations("portfolio.card");
  const [broken, setBroken] = useState(false);
  if (broken) {
    return (
      <span className="flex h-full w-full min-h-32 items-center justify-center p-4 text-center text-xs text-muted-foreground">
        {t("imageMissing")}
      </span>
    );
  }
  return (
    <img
      src={item.url}
      alt={item.title ?? ""}
      loading="lazy"
      decoding="async"
      onError={() => setBroken(true)}
      className={cn("h-full w-full object-cover transition", !ratio && "aspect-square")}
    />
  );
}

export function PortfolioCard(props: PortfolioCardProps) {
  const t = useTranslations("portfolio.card");
  const { item, onOpen, onUnsaved, onToCanvas, onToDesign } = props;
  // 已记录宽高时锁定宽高比，图片加载完成前不产生布局位移
  const ratio =
    item.width && item.height && item.width > 0 && item.height > 0
      ? `${item.width} / ${item.height}`
      : undefined;

  return (
    <figure
      className="group relative mb-3 break-inside-avoid overflow-hidden rounded-xl border border-border bg-muted/40"
      style={ratio ? { aspectRatio: ratio } : undefined}
    >
      <button
        type="button"
        className="block w-full"
        onClick={() => onOpen(item)}
        aria-label={item.title ?? t("untitled")}
      >
        <CardImage item={item} ratio={ratio} />
      </button>

      <figcaption className="pointer-events-none absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/70 to-transparent p-2 pt-8 text-white opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <p className="truncate text-xs font-medium">
          {item.title ?? t("untitled")}
        </p>
        <p className="truncate text-[11px] text-white/75">
          {item.sessionTitle ? t("fromSession", { name: item.sessionTitle }) : t("sourceUnknown")}
        </p>
      </figcaption>

      <div className="absolute right-2 top-2 flex gap-1 opacity-0 transition group-hover:opacity-100 group-focus-within:opacity-100">
        <button
          type="button"
          aria-label={t("unsave")}
          title={t("unsave")}
          onClick={(e) => {
            e.stopPropagation();
            onUnsaved(item);
          }}
          className="rounded-md bg-amber-500/90 p-1.5 text-white backdrop-blur-sm transition hover:bg-amber-500"
        >
          <StarIcon className="size-4 fill-current" />
        </button>
        <button
          type="button"
          aria-label={t("toCanvas")}
          title={t("toCanvas")}
          onClick={(e) => {
            e.stopPropagation();
            onToCanvas(item);
          }}
          className="rounded-md bg-black/55 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/75"
        >
          <Wand2Icon className="size-4" />
        </button>
        <button
          type="button"
          aria-label={t("toDesign")}
          title={t("toDesign")}
          onClick={(e) => {
            e.stopPropagation();
            onToDesign(item);
          }}
          className="rounded-md bg-black/55 p-1.5 text-white backdrop-blur-sm transition hover:bg-black/75"
        >
          <PencilIcon className="size-4" />
        </button>
        <MoreMenu item={item} onEdit={props.onEdit} onDelete={props.onDelete} />
      </div>
    </figure>
  );
}