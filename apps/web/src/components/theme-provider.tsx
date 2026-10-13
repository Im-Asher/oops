"use client";

import { Button } from "@/components/ui/button";
import { MoonIcon, SunIcon } from "lucide-react";
import { useTranslations } from "next-intl";
import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from "react";

export type Theme = "light" | "dark";

const THEME_KEY = "oops-theme";

interface ThemeContextValue {
  theme: Theme;
  setTheme: (theme: Theme) => void;
  toggleTheme: () => void;
}

const ThemeContext = createContext<ThemeContextValue | null>(null);

function readStoredTheme(): Theme | null {
  try {
    const stored = localStorage.getItem(THEME_KEY);
    return stored === "light" || stored === "dark" ? stored : null;
  } catch {
    return null;
  }
}

function applyTheme(theme: Theme) {
  document.documentElement.classList.toggle("dark", theme === "dark");
  try {
    localStorage.setItem(THEME_KEY, theme);
  } catch {
    // 存储不可用（隐私模式等）时主题仅在当前会话生效
  }
}

/**
 * 全局明暗主题（spec/ui-refactor）：html class 切换 + localStorage 持久化，
 * 默认暗色。首屏 class 由 layout 中的防闪烁阻塞脚本设置，挂载后从存储同步进
 * React 状态；SSR 首渲染固定为默认暗色，与初始 HTML 保持一致。
 */
export function ThemeProvider({ children }: { children: ReactNode }) {
  const [theme, setThemeState] = useState<Theme>("dark");
  useEffect(() => {
    // html class 已由防闪烁脚本就位，这里只补齐 React 状态（订阅外部存储的初始值）
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setThemeState(readStoredTheme() ?? "dark");
  }, []);
  const setTheme = useCallback((next: Theme) => {
    setThemeState(next);
    applyTheme(next);
  }, []);
  // 以 html class 为真源，避免与 setTheme 之外的修改（如防闪烁脚本）脱节
  const toggleTheme = useCallback(() => {
    setTheme(document.documentElement.classList.contains("dark") ? "light" : "dark");
  }, [setTheme]);
  return (
    <ThemeContext.Provider value={{ theme, setTheme, toggleTheme }}>
      {children}
    </ThemeContext.Provider>
  );
}

/** 读取当前主题；未挂 Provider 时回退默认暗色与 no-op（测试/独立渲染场景）。 */
export function useTheme(): ThemeContextValue {
  const ctx = useContext(ThemeContext);
  return ctx ?? { theme: "dark", setTheme: () => {}, toggleTheme: () => {} };
}

/** 明暗切换按钮：暗色显示太阳（点击转亮），亮色显示月亮。 */
export function ThemeToggle({ className }: { className?: string }) {
  const { theme, toggleTheme } = useTheme();
  const t = useTranslations("common");
  const dark = theme === "dark";
  const label = dark ? t("theme.toLight") : t("theme.toDark");
  return (
    <Button
      aria-label={label}
      className={className}
      onClick={toggleTheme}
      size="icon-sm"
      title={label}
      variant="ghost"
    >
      {dark ? <SunIcon /> : <MoonIcon />}
    </Button>
  );
}
