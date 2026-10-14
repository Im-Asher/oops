"use client";

import { useLocale, useTranslations } from "next-intl";

// B7.1.3 blob 方法：不对称 border-radius、15° 倍数旋转、60–90px blur、
// 内容层之下且 pointer-events:none，永不覆盖正文。
function Blob({
  className,
  fill,
  rotate,
}: {
  className: string;
  fill: string;
  rotate: number;
}) {
  return (
    <div
      aria-hidden
      className={`pointer-events-none absolute -z-10 blur-[70px] ${className}`}
      style={{
        background: fill,
        borderRadius: "58% 42% 38% 62% / 46% 52% 48% 54%",
        transform: `rotate(${rotate}deg)`,
      }}
    />
  );
}

// B7.1.4 Headline：per-locale clamp——中文 3 行 / 英文 4 行预算内靠文案与
// 字号档位协同，不靠 CSS 压字号兜底（B3.4）。
const HEADLINE_CLAMP: Record<string, string> = {
  zh: "clamp(40px, 6vw, 64px)",
  en: "clamp(36px, 6vw, 60px)",
};

export function LandingHero() {
  const t = useTranslations("landing.hero");
  const locale = useLocale();

  return (
    <section data-landing-section="hero" className="relative overflow-hidden px-4 pb-16 pt-16 sm:px-6 lg:min-h-[70vh] lg:pb-24 lg:pt-24">
      <Blob className="right-[-8%] top-[-10%] h-[320px] w-[480px] lg:h-[420px] lg:w-[640px]" fill="var(--brand-blob-1)" rotate={15} />
      <Blob className="bottom-[-12%] left-[-10%] h-[260px] w-[380px] lg:h-[360px] lg:w-[560px]" fill="var(--brand-blob-2)" rotate={45} />
      <Blob className="left-[30%] top-[30%] h-[200px] w-[300px] opacity-10" fill="var(--brand-blob-3)" rotate={30} />

      <div className="landing-rise mx-auto flex max-w-4xl flex-col items-center gap-6 text-center">
        <p className="text-sm font-medium tracking-wide text-[var(--brand-ink-600)]">{t("eyebrow")}</p>
        <h1
          className="font-display text-brand-gradient text-balance"
          style={{ fontSize: HEADLINE_CLAMP[locale] ?? HEADLINE_CLAMP.zh, lineHeight: 1.05, letterSpacing: "-0.02em" }}
        >
          {t("headline")}
        </h1>
        <p className="max-w-[32ch] text-base leading-relaxed text-[var(--brand-ink-600)] sm:text-lg">{t("sub")}</p>
        <div className="mt-2 flex flex-col items-center gap-3 sm:flex-row">
          <a
            href="/register"
            data-cta-variant="gradient"
            className="shadow-brand inline-flex h-12 items-center rounded-pill bg-brand-gradient px-7 text-sm font-medium text-white transition-transform duration-200 ease-[var(--ease-back)] hover:-translate-y-0.5 hover:shadow-brand-hover focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("primaryCta")}
          </a>
          <a
            href="/login"
            className="inline-flex h-12 items-center rounded-pill border border-[var(--brand-ink-200)] bg-white px-7 text-sm font-medium text-[var(--brand-ink-900)] transition-transform duration-200 ease-[var(--ease-back)] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("secondaryCta")}
          </a>
        </div>
        <p className="text-xs text-[var(--brand-ink-400)]">{t("note")}</p>
      </div>
    </section>
  );
}
