"use client";

import { useTranslations } from "next-intl";

export function LandingCompare() {
  const t = useTranslations("landing.compare");

  const traditionalRows = t.raw("traditional.rows") as string[];
  const oopsRows = t.raw("oops.rows") as string[];

  return (
    <section data-landing-section="compare" className="px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-5xl">
        <h2 className="landing-rise text-center text-2xl font-bold tracking-tight text-[var(--brand-ink-900)] sm:text-3xl" style={{ animationDelay: "240ms" }}>
          {t("title")}
        </h2>

        <div className="mt-10 grid gap-6 md:grid-cols-2">
          <div className="rounded-media border border-[var(--brand-ink-200)] bg-[var(--brand-ink-50)] p-6">
            <h3 className="text-base font-semibold text-[var(--brand-ink-500)]">{t("traditional.name")}</h3>
            <ul className="mt-4 flex flex-col gap-3">
              {traditionalRows.map((row) => (
                <li key={row} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--brand-ink-500)]">
                  <span aria-hidden className="mt-2 h-1 w-1 shrink-0 rounded-full bg-[var(--brand-ink-300)]" />
                  {row}
                </li>
              ))}
            </ul>
          </div>

          <div className="rounded-media border border-[var(--brand-violet-300)] bg-white p-6 shadow-[var(--shadow-2)]">
            <h3 className="font-display text-lg text-[var(--brand-ink-900)]">{t("oops.name")}</h3>
            <ul className="mt-4 flex flex-col gap-3">
              {oopsRows.map((row) => (
                <li key={row} className="flex items-start gap-2.5 text-sm leading-relaxed text-[var(--brand-ink-900)]">
                  <span aria-hidden className="mt-1.5 shrink-0 text-[var(--brand-violet-500)]">✓</span>
                  {row}
                </li>
              ))}
            </ul>
          </div>
        </div>
      </div>
    </section>
  );
}
