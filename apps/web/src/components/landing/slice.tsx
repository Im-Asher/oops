"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

// B7.1.5 产品切片：输入气泡 + 真实产出图卡两帧，4:3、max 560px、
// --radius-media、--shadow-[var(--shadow-2)]；桌面并排 32px 间距 + 24px 胶囊箭头，移动端 48px 堆叠。
export function LandingSlice() {
  const t = useTranslations("landing.slice");

  return (
    <section data-landing-section="slice" className="px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-4xl">
        <h2 className="text-center text-2xl font-bold tracking-tight text-[var(--brand-ink-900)] sm:text-3xl">
          {t("title")}
        </h2>
        <div className="mt-10 flex flex-col items-center gap-12 md:mt-12 md:flex-row md:justify-center md:gap-8">
          <div className="w-full max-w-[560px] rounded-media border border-[var(--brand-ink-100)] bg-white p-4 shadow-[var(--shadow-2)] md:w-auto md:flex-1">
            <div className="flex items-start gap-2">
              <span aria-hidden className="flex h-8 w-8 shrink-0 items-center justify-center rounded-pill bg-[var(--brand-ink-100)] text-xs font-medium text-[var(--brand-ink-700)]">
                {t("bubbleAuthor")}
              </span>
              <p className="rounded-2xl rounded-tl-sm bg-[var(--brand-ink-50)] px-4 py-3 text-sm leading-relaxed text-[var(--brand-ink-900)]">
                {t("bubblePrompt")}
              </p>
            </div>
          </div>

          <div
            aria-hidden
            className="bg-brand-gradient flex h-12 w-12 shrink-0 items-center justify-center rounded-pill text-white transition-transform duration-200 rotate-90 md:rotate-0"
            role="img"
            aria-label={t("arrowLabel")}
          >
            →
          </div>

          <figure className="w-full max-w-[560px] md:w-auto md:flex-1">
            <div className="aspect-[4/3] w-full overflow-hidden rounded-media shadow-[var(--shadow-2)]">
              <Image
                src="/samples/slice-atmosphere.webp"
                alt={t("resultAlt")}
                width={1536}
                height={1024}
                sizes="(max-width: 768px) 100vw, 560px"
                className="h-full w-full object-cover"
                priority
              />
            </div>
            <figcaption className="mt-3 text-center text-xs text-[var(--brand-ink-400)]">{t("resultCaption")}</figcaption>
          </figure>
        </div>
      </div>
    </section>
  );
}
