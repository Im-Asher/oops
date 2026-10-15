"use client";

import { useTranslations } from "next-intl";

const STEPS = ["step1", "step2", "step3"] as const;

export function LandingHow() {
  const t = useTranslations("landing.how");

  return (
    <section data-landing-section="how" className="px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-5xl">
        <h2 className="landing-rise text-center text-2xl font-bold tracking-tight text-[var(--brand-ink-900)] sm:text-3xl" style={{ animationDelay: "160ms" }}>
          {t("title")}
        </h2>

        <ol className="mt-10 grid gap-8 md:grid-cols-3 md:gap-6">
          {STEPS.map((step, index) => (
            <li key={step} className="flex flex-row gap-4 md:flex-col md:gap-3">
              <span
                aria-hidden
                className="font-display shrink-0 text-5xl leading-none text-[var(--brand-ink-200)]"
              >
                {index + 1}
              </span>
              <div>
                <h3 className="text-lg font-semibold text-[var(--brand-ink-900)]">{t(`${step}.title`)}</h3>
                <p className="mt-1.5 text-sm leading-relaxed text-[var(--brand-ink-600)]">
                  {t(`${step}.detail`)}
                </p>
              </div>
            </li>
          ))}
        </ol>

        <div className="mt-10 flex justify-center">
          <a
            href="/register"
            className="inline-flex h-11 items-center rounded-pill border border-[var(--brand-ink-200)] bg-white px-6 text-sm font-medium text-[var(--brand-ink-900)] transition-transform duration-200 ease-[var(--ease-back)] hover:-translate-y-0.5 focus-visible:outline-2 focus-visible:outline-offset-2"
          >
            {t("cta")}
          </a>
        </div>
      </div>
    </section>
  );
}
