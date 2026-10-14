"use client";

import { LocaleToggle } from "@/components/locale-toggle";
import { useTranslations } from "next-intl";
import Link from "next/link";

const ANCHORS = [
  { key: "agents", href: "#agents" },
  { key: "how", href: "#how" },
  { key: "compare", href: "#compare" },
  { key: "faq", href: "#faq" },
] as const;

export function LandingNav() {
  const t = useTranslations("landing.nav");
  return (
    <header data-landing-section="nav" className="sticky top-0 z-40 border-b border-border/60 bg-white/85 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center px-4 sm:px-6">
        <Link href="/" className="text-lg font-semibold tracking-tight">oops</Link>
        <nav aria-label="Primary" className="ml-6 hidden gap-5 text-sm md:flex">
          {ANCHORS.map((a) => (
            <a key={a.key} href={a.href} className="rounded px-1 py-0.5 text-muted-foreground hover:text-foreground">{t(a.key)}</a>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <LocaleToggle />
          <a href="/login" className="rounded px-2 py-1 text-sm text-muted-foreground hover:text-foreground">{t("login")}</a>
          <a href="/register" className="rounded-full bg-[var(--brand-violet-500)] px-4 py-1.5 text-sm font-medium text-white">{t("startFree")}</a>
          <details className="relative md:hidden">
            <summary aria-label={t("mobileMenu")} className="flex h-9 w-9 cursor-pointer list-none items-center justify-center rounded hover:bg-muted [&::-webkit-details-marker]:hidden">≡</summary>
            <div className="absolute right-0 top-10 w-40 rounded-xl border border-border bg-white p-2 shadow-lg">
              {ANCHORS.map((a) => (
                <a key={a.key} href={a.href} className="block rounded px-3 py-2 text-sm hover:bg-muted">{t(a.key)}</a>
              ))}
            </div>
          </details>
        </div>
      </div>
    </header>
  );
}
