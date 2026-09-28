"use client";

interface ImageThumbnailProps {
  url: string;
  active: boolean;
  /** 会话内第几张图（1 起），用于生成可区分的无障碍名称 */
  position: number;
  onActivate: () => void;
}

/**
 * 消息里的图片缩略图：点击（或悬停浮层）即上屏为画布激活图。
 * 激活态以白色描边 + 外发光呈现，随激活图切换而转移。
 */
export function ImageThumbnail({ url, active, position, onActivate }: ImageThumbnailProps) {
  return (
    <button
      aria-label={active ? `第 ${position} 张图，已上屏` : `上屏第 ${position} 张图`}
      aria-pressed={active}
      className={`group relative mt-2 block size-24 cursor-pointer overflow-hidden rounded bg-zinc-950 transition-shadow duration-200 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-zinc-50 ${
        active
          ? "ring-2 ring-white shadow-[0_0_12px_rgba(255,255,255,0.45)]"
          : "hover:ring-2 hover:ring-zinc-500"
      }`}
      onClick={onActivate}
      title={active ? "已上屏" : "上屏"}
      type="button"
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img alt={`生成的第 ${position} 张图`} className="size-full object-contain" loading="lazy" src={url} />
      <span className="absolute inset-0 flex items-center justify-center bg-black/55 text-xs text-white opacity-0 transition-opacity duration-200 group-hover:opacity-100 group-focus-visible:opacity-100">
        {active ? "已上屏" : "上屏"}
      </span>
    </button>
  );
}
