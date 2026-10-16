"use client";

import { useTranslations } from "next-intl";

import { LocaleToggle } from "@/components/locale-toggle";

export function LandingFooter() {
  const t = useTranslations("landing.footer");
  return (
    <footer data-landing-section="footer" className="bg-[var(--brand-ink-950)] py-10">
      <div className="mx-auto flex max-w-6xl flex-col items-center gap-3 px-4 text-center sm:px-6">
        <p className="text-sm font-semibold tracking-tight text-white">oops</p>
        <p className="text-sm text-[var(--brand-ink-400)]">{t("tagline")}</p>
        <div className="flex items-center gap-2 text-sm text-[var(--brand-ink-400)]">
          <span>{t("langLabel")}</span>
          <LocaleToggle />
        </div>
        <p className="text-xs text-[var(--brand-ink-500)]">{t("copyright", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
