"use client";

import Image from "next/image";
import { useTranslations } from "next-intl";

// B7.4：类别只以 6px 前导色点标注于中性 chip 上，不做彩色填充——
// 最高对比永远属于主行动。coral 与 error 撞色（B2.3）不用，第三类走过渡蓝。
const AGENTS = [
  {
    key: "atmosphere",
    src: "/samples/sample-scene-01.webp",
    width: 1024,
    height: 1024,
    dot: "var(--brand-cyan-500)",
  },
  {
    key: "poster",
    src: "/samples/sample-poster-01.webp",
    width: 1024,
    height: 1536,
    dot: "var(--brand-violet-500)",
  },
  {
    key: "photographer",
    src: "/samples/sample-product-01.webp",
    width: 1024,
    height: 1024,
    dot: "var(--brand-blue-500)",
  },
] as const;

export function LandingAgents() {
  const t = useTranslations("landing.agents");

  return (
    <section data-landing-section="agents" className="px-4 py-16 sm:px-6 lg:py-24">
      <div className="mx-auto max-w-6xl">
        <h2 className="landing-rise text-center text-2xl font-bold tracking-tight text-[var(--brand-ink-900)] sm:text-3xl" style={{ animationDelay: "80ms" }}>
          {t("title")}
        </h2>
        <p className="mt-3 text-center text-base text-[var(--brand-ink-600)]">{t("sub")}</p>

        <div className="mt-10 grid gap-6 md:grid-cols-3">
          {AGENTS.map((agent) => (
            <article
              key={agent.key}
              className="shadow-[var(--shadow-1)] flex flex-col overflow-hidden rounded-media border border-[var(--brand-ink-100)] bg-white"
            >
              <div className="aspect-[4/5] w-full overflow-hidden">
                <Image
                  src={agent.src}
                  alt={t(`${agent.key}.sampleAlt`)}
                  width={agent.width}
                  height={agent.height}
                  sizes="(max-width: 768px) 100vw, 384px"
                  className="h-full w-full object-cover"
                  loading="lazy"
                />
              </div>
              <div className="flex flex-1 flex-col gap-2 p-5">
                <span className="flex w-fit items-center gap-2 rounded-pill bg-[var(--brand-ink-100)] px-3 py-1 text-xs text-[var(--brand-ink-700)]">
                  <span aria-hidden className="h-1.5 w-1.5 rounded-full" style={{ background: agent.dot }} />
                  {t(`${agent.key}.job`)}
                </span>
                <h3 className="text-lg font-semibold text-[var(--brand-ink-900)]">{t(`${agent.key}.name`)}</h3>
                <p className="text-sm leading-relaxed text-[var(--brand-ink-600)]">{t(`${agent.key}.detail`)}</p>
                <p className="mt-auto pt-2 text-xs text-[var(--brand-ink-400)]">{t(`${agent.key}.pick`)}</p>
              </div>
            </article>
          ))}
        </div>
      </div>
    </section>
  );
}
