"use client";

import { useTranslations } from "next-intl";
import Image, { type StaticImageData } from "next/image";
import { useState } from "react";

import sampleProduct01 from "../../../public/samples/sample-product-01.webp";
import sampleScene01 from "../../../public/samples/sample-scene-01.webp";
import sampleScene02 from "../../../public/samples/sample-scene-02.webp";

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
  const t = useTranslations("auth.brand");

  return (
    <>
      {/* 窄视口：顶部紧凑条 */}
      <header className="flex items-center justify-between gap-4 border-b border-border/60 px-5 py-4 md:hidden">
        <p className="text-base font-semibold tracking-tight text-foreground">oops</p>
        <p className="min-w-0 flex-1 text-right text-xs leading-snug text-muted-foreground">
          {t("headline")}
        </p>
      </header>

      {/* md+：左侧品牌面板（约 55/45 分屏） */}
      <aside
        aria-label={t("panelLabel")}
        className="relative hidden flex-col justify-between overflow-hidden border-r border-border/60 p-10 md:flex md:w-[55%] lg:p-14 xl:p-16"
      >
        <div
          aria-hidden
          className="pointer-events-none absolute -top-40 left-1/3 h-96 w-96 rounded-full bg-white/[0.04] blur-3xl"
        />
        <div className="animate-in fade-in duration-200">
          <p className="text-lg font-semibold tracking-tight text-foreground">oops</p>
          <p className="text-sm text-muted-foreground">{t("tagline")}</p>
        </div>
        <div className="animate-in fade-in duration-200">
          <h1 className="max-w-xl text-4xl font-semibold leading-tight tracking-tight text-foreground xl:text-5xl xl:leading-tight">
            {t("headline")}
          </h1>
        </div>
        <div className="grid h-[min(380px,45vh)] grid-cols-5 grid-rows-2 gap-3 animate-in fade-in duration-200 xl:h-[min(440px,48vh)]">
          <div className="relative col-span-3 row-span-2">
            <SampleImage
              src={sampleScene01}
              alt={t("sampleSceneAlt1")}
              sizes="(min-width: 1280px) 40rem, 34rem"
              priority
            />
          </div>
          <div className="relative col-span-2">
            <SampleImage
              src={sampleScene02}
              alt={t("sampleSceneAlt2")}
              sizes="(min-width: 1280px) 24rem, 20rem"
            />
          </div>
          <div className="relative col-span-2">
            <SampleImage
              src={sampleProduct01}
              alt={t("sampleProductAlt")}
              sizes="(min-width: 1280px) 24rem, 20rem"
            />
          </div>
        </div>
        <p className="text-sm text-muted-foreground animate-in fade-in duration-200">
          {t("expertLine")}
          <span className="ml-2 text-xs text-muted-foreground">{t("samplesNote")}</span>
        </p>
      </aside>
    </>
  );
}
