"use client";

import { useLocaleSwitch } from "@/components/locale-toggle";
import { useTheme } from "@/components/theme-provider";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { resolveDisplayName } from "@/lib/nickname";
import { cn } from "cn";
import { LanguagesIcon, LogOutIcon, MoonIcon, SettingsIcon, SunIcon, UserRoundIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";

interface ProfileSummary {
  username: string;
  oopsId: string;
  displayName: string | null;
}

/** 摘要响应最小校验：非约定形状（如网关返回 HTML/JSON 错误体）按未登录处理，避免渲染崩溃。 */
function isProfileSummary(value: unknown): value is ProfileSummary {
  return !!value && typeof value === "object" && typeof (value as ProfileSummary).oopsId === "string";
}

/**
 * 用户菜单内容：账号摘要（昵称——默认裸 oops ID + oops_ 前缀 ID）/ 个人信息 / 退出登录。
 * 独立导出供时钟下拉底部复用（须渲染在某个 DropdownMenu 根内）。
 * 摘要随组件挂载拉取一次即可（账号信息变更频率极低）。
 */
export function UserMenuContent() {
  const t = useTranslations("chat.userMenu");
  const router = useRouter();
  const [profile, setProfile] = useState<ProfileSummary | null>(null);
  const [loggingOut, setLoggingOut] = useState(false);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (alive && isProfileSummary(body)) setProfile(body);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  async function onLogout() {
    setLoggingOut(true);
    try {
      await fetch("/api/auth/logout", { method: "POST" });
      router.replace("/login");
      router.refresh();
    } finally {
      setLoggingOut(false);
    }
  }

  const nickname = profile ? resolveDisplayName(profile) : "";

  return (
    <>
      {profile ? (
        <>
          <DropdownMenuLabel className="font-normal">
            <span className="block truncate text-sm">{nickname}</span>
            <span className="block truncate text-xs text-muted-foreground">
              oops_{profile.oopsId}
            </span>
          </DropdownMenuLabel>
          <DropdownMenuSeparator className="bg-muted" />
        </>
      ) : null}
      <DropdownMenuItem asChild>
        <Link href="/profile">{t("profile")}</Link>
      </DropdownMenuItem>
      <DropdownMenuItem
        className="text-red-400 focus:text-red-300"
        disabled={loggingOut}
        onSelect={(e) => {
          e.preventDefault();
          void onLogout();
        }}
      >
        <LogOutIcon />
        {loggingOut ? t("loggingOut") : t("logout")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * 偏好区：主题 / 语言 / 设置（spec home-landing「构建版本徽标的位置」）。
 *
 * 一级列只有 72px，底部再竖排三个偏好控件会吃掉 ~120px 的常驻高度预算
 * （DESIGN.md B7.2.2a），因此它们与账号一起收进用户菜单。写成 `DropdownMenuItem`
 * 而不是嵌套 ThemeToggle/LocaleToggle 按钮：菜单项才进 Radix 的方向键导航，
 * `asChild` 还会让子按钮自己的 onClick 覆盖掉 Radix 的选中处理。
 */
function UserPreferences() {
  const t = useTranslations("home");
  const tc = useTranslations("common");
  const { theme, toggleTheme } = useTheme();
  const { switchLocale } = useLocaleSwitch();
  const dark = theme === "dark";

  return (
    <>
      <DropdownMenuSeparator className="bg-muted" />
      <DropdownMenuItem onSelect={toggleTheme}>
        {dark ? <SunIcon /> : <MoonIcon />}
        {dark ? tc("theme.toLight") : tc("theme.toDark")}
      </DropdownMenuItem>
      <DropdownMenuItem onSelect={switchLocale}>
        <LanguagesIcon />
        {tc("localeToggle.label")}
      </DropdownMenuItem>
      {/* 可访问名取可见文字（设置），title 只解释为何不可用 */}
      <DropdownMenuItem disabled title={t("comingSoon")}>
        <SettingsIcon />
        {t("navSettings")}
      </DropdownMenuItem>
    </>
  );
}

/**
 * 用户入口：头像触发 + 用户菜单内容。
 * className 供窄形态（/home 一级列）缩小命中区，画布 AppHeader 沿用默认 40px。
 * showPreferences 把主题/语言/设置一并收进菜单——一级列底部只留铃铛与头像。
 */
export function UserMenu({ className, showPreferences = false }: { className?: string; showPreferences?: boolean }) {
  const t = useTranslations("chat.userMenu");
  const [profile, setProfile] = useState<ProfileSummary | null>(null);

  useEffect(() => {
    let alive = true;
    fetch("/api/profile")
      .then((res) => (res.ok ? res.json() : null))
      .then((body: unknown) => {
        if (alive && isProfileSummary(body)) setProfile(body);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  const nickname = profile ? resolveDisplayName(profile) : "";
  const initial = nickname[0] ?? "";

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button
          aria-label={t("label")}
          className={cn(
            "size-10 rounded-full text-foreground/80 hover:bg-accent hover:text-foreground",
            className,
          )}
          size="icon"
          variant="ghost"
        >
          {initial ? (
            <span className="flex size-6 items-center justify-center rounded-full bg-accent text-xs">
              {initial}
            </span>
          ) : (
            <UserRoundIcon />
          )}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent
        align="start"
        className="w-52 border-border bg-popover text-foreground"
      >
        <UserMenuContent />
        {showPreferences ? <UserPreferences /> : null}
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
