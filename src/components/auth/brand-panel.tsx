"use client";

import Image, { type StaticImageData } from "next/image";
import { useState } from "react";

import sampleProduct01 from "../../../public/samples/sample-product-01.webp";
import sampleScene01 from "../../../public/samples/sample-scene-01.webp";
import sampleScene02 from "../../../public/samples/sample-scene-02.webp";

const HEADLINE = "用说话的方式，得到能直接上架的电商图片";
const EXPERT_LINE = "驻场氛围图设计师 · 场景图 / 产品图";

function SampleImage({
  src,
  alt,
  sizes,
  priority = false,
}: {
  src: StaticImageData;
  alt: string;
  sizes: string;
  priority?: boolean;
}) {
  const [failed, setFailed] = useState(false);

  if (failed) {
    return (
      <div className="flex h-full w-full items-center justify-center rounded-2xl bg-muted/40 text-xs text-muted-foreground ring-1 ring-inset ring-border">
        <span>{alt}</span>
      </div>
    );
  }

  return (
    <Image
      src={src}
      alt={alt}
      fill
      sizes={sizes}
      priority={priority}
      onError={() => setFailed(true)}
      className="rounded-2xl object-cover"
    />
  );
}

export function AuthBrandPanel() {
  return (
    <>
      {/* 窄视口：顶部紧凑条 */}
      <header className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 md:hidden">
        <p className="text-base font-semibold tracking-tight text-foreground">oops</p>
        <p className="min-w-0 flex-1 text-right text-xs leading-snug text-muted-foreground">
          {HEADLINE}
        </p>
      </header>

      {/* md+：左侧品牌面板（约 55/45 分屏） */}
      <aside
        aria-label="产品介绍"
        className="relative hidden flex-col justify-between overflow-hidden border-r border-border/60 p-10 md:flex md:w-[55%] lg:p-14 xl:p-16"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-white/[0.04] blur-3xl"
        />
        <div className="animate-in fade-in duration-200">
          <p className="text-lg font-semibold tracking-tight text-foreground">oops</p>
          <p className="text-sm text-muted-foreground">AI 电商图像工作台</p>
        </div>
        <div className="animate-in fade-in duration-200">
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-foreground xl:text-5xl xl:leading-tight">
            {HEADLINE}
          </h1>
        </div>
        <div className="grid h-[min(380px,45vh)] grid-cols-5 grid-rows-2 gap-3 animate-in fade-in duration-200 xl:h-[min(440px,48vh)]">
          <div className="relative col-span-3 row-span-2">
            <SampleImage
              src={sampleScene01}
              alt="晨光木桌上的白瓷杯咖啡场景图"
              sizes="(min-width: 1280px) 40rem, 34rem"
              priority
            />
          </div>
          <div className="relative col-span-2">
            <SampleImage
              src={sampleScene02}
              alt="拿铁心形拉花特写氛围图"
              sizes="(min-width: 1280px) 24rem, 20rem"
            />
          </div>
          <div className="relative col-span-2">
            <SampleImage
              src={sampleProduct01}
              alt="白底红苹果产品图"
              sizes="(min-width: 1280px) 24rem, 20rem"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground animate-in fade-in duration-200">
          {EXPERT_LINE}
          <span className="ml-2 text-xs text-muted-foreground">示例图均由 oops 生成</span>
        </p>
      </aside>
    </>
  );
}
