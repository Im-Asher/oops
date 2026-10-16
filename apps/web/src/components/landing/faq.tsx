"use client";

import { useTranslations } from "next-intl";

export function LandingFaq() {
  const t = useTranslations("landing.faq");
  const items = t.raw("items") as { q: string; a: string }[];

  return (
    <section data-landing-section="faq" className="px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-3xl">
        <h2 className="landing-rise text-center text-2xl font-bold tracking-tight text-[var(--brand-ink-900)] sm:text-3xl" style={{ animationDelay: "320ms" }}>
          {t("title")}
        </h2>

        <div className="mt-8 flex flex-col gap-3">
          {items.map((item) => (
            <details
              key={item.q}
              className="group rounded-lg border border-[var(--brand-ink-200)] bg-white"
            >
              <summary className="flex cursor-pointer list-none items-center justify-between gap-4 px-5 py-4 text-sm font-medium text-[var(--brand-ink-900)] focus-visible:outline-2 focus-visible:outline-offset-2 [&::-webkit-details-marker]:hidden">
                {item.q}
                <span
                  aria-hidden
                  className="text-[var(--brand-ink-400)] transition-transform duration-200 group-open:rotate-45"
                >
                  +
                </span>
              </summary>
              <p className="px-5 pb-4 text-sm leading-relaxed text-[var(--brand-ink-600)]">{item.a}</p>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
