"use client";

interface ImageThumbnailProps {
  url: string;
  /** 对应 asset 已在画布选中。 */
  active: boolean;
  /** 会话内第几张图（1 起），用于生成可区分的无障碍名称 */
  position: number;
  onSelect: () => void;
}

/**
 * 消息里的图片缩略图：点击在画布上选中对应条目。
 * 选中态以紫色描边呈现，随画布选中切换而转移。
 */
export function ImageThumbnail({ url, active, position, onSelect }: ImageThumbnailProps) {
  return (
    <button
      aria-label={active ? `第 ${position} 张图，已在画布选中` : `在画布中选中第 ${position} 张图`}
      aria-pressed={active}
      className={`group relative mt-2 block size-24 cursor-pointer overflow-hidden rounded bg-zinc-950 transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-50 ${
        active
          ? "ring-2 ring-violet-400"
          : "hover:ring-2 hover:ring-zinc-500"
      }`}
      onClick={onSelect}
      title={active ? "已在画布选中" : "在画布中选中"}
      type="button"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`生成的第 ${position} 张图`} className="size-full object-contain" loading="lazy" src={url} />
      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        {active ? "已选中" : "选中"}
      </span>
    </button>
  );
}
