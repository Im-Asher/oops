"use client";

import { Button } from "@/components/ui/button";
import { LOCALE_COOKIE, type Locale } from "@/i18n/messages";
import { LanguagesIcon } from "lucide-react";
import { useLocale, useTranslations } from "next-intl";
import { useRouter } from "next/navigation";
import { useCallback, useTransition } from "react";

// 写入一年期 cookie（locale 唯一真源，design D3/D9）；随后 router.refresh()
// 让服务端树按新 locale 重渲，客户端状态（画布/会话）保留、页面不整刷。
function setLocaleCookie(locale: Locale) {
  document.cookie = `${LOCALE_COOKIE}=${locale}; path=/; max-age=31536000; samesite=lax`;
}

/**
 * 语言切换逻辑（cookie 写入 + router.refresh）：工具条按钮与用户菜单项共用，
 * 避免「两个入口两套写法」在切换语义上分叉。
 */
export function useLocaleSwitch() {
  const locale = useLocale();
  const router = useRouter();
  const [pending, startTransition] = useTransition();

  const switchLocale = useCallback(() => {
    const next: Locale = locale === "en" ? "zh" : "en";
    setLocaleCookie(next);
    startTransition(() => router.refresh());
  }, [locale, router]);

  return { pending, switchLocale };
}

/** 语言切换按钮：与 ThemeToggle 并列（画布聊天面板头部等）。 */
export function LocaleToggle({ className }: { className?: string }) {
  const t = useTranslations("common.localeToggle");
  const { pending, switchLocale } = useLocaleSwitch();

  return (
    <Button
      aria-label={t("label")}
      className={className}
      disabled={pending}
      onClick={switchLocale}
      size="icon-sm"
      title={t("label")}
      variant="ghost"
    >
      <LanguagesIcon />
    </Button>
  );
}
