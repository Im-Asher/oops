"use client";

import { useTranslations } from "next-intl";

export function LandingClosing() {
  const t = useTranslations("landing.closing");

  return (
    <section data-landing-section="closing" className="px-4 py-20 sm:px-6 lg:py-28">
      <div className="landing-rise mx-auto flex max-w-3xl flex-col items-center gap-6 text-center" style={{ animationDelay: "400ms" }}>
        {/* B2.5：渐变文字仅限首屏大标题，收尾标题走实色 display */}
        <h2 className="font-display text-balance text-3xl leading-tight tracking-tight text-[var(--brand-ink-900)] sm:text-4xl">
          {t("headline")}
        </h2>
        <div className="flex flex-col items-center gap-3 sm:flex-row">
          {/* 与首屏同一转化动作：/register 邀请码注册 */}
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
