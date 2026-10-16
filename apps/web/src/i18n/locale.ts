import { defaultLocale, isSupportedLocale, type Locale } from "./messages";

// locale 解析链（design D2）：显式 cookie → Accept-Language 推断 → 默认 zh。
// 纯函数便于矩阵单测；request.ts 负责从 next/headers 取值并接线。

// 解析 Accept-Language，返回按 q 值降序排列后的首选语言标签（小写）。
// `*` 与空段忽略；q 缺省为 1；非法 q 视作 1。
function preferredLanguage(header: string | undefined | null): string | undefined {
  if (!header) return undefined;
  const candidates = header
    .split(",")
    .map((part) => {
      const [lang, ...params] = part.trim().split(";");
      let q = 1;
      for (const param of params) {
        const [key, value] = param.trim().split("=");
        if (key === "q") {
          const parsed = Number(value);
          if (Number.isFinite(parsed)) q = parsed;
        }
      }
      return { lang: lang.toLowerCase(), q };
    })
    .filter((candidate) => candidate.lang && candidate.lang !== "*")
    .sort((a, b) => b.q - a.q);
  return candidates[0]?.lang;
}

// en 系（en/en-US）归 en，zh 系（zh/zh-CN/zh-TW）归 zh；均不命中走默认。
export function resolveLocale(
  cookieValue: string | undefined | null,
  acceptLanguage: string | undefined | null,
): Locale {
  const cookie = cookieValue?.trim().toLowerCase();
  if (cookie !== undefined && isSupportedLocale(cookie)) return cookie;

  const lang = preferredLanguage(acceptLanguage);
  if (lang?.startsWith("en")) return "en";
  if (lang?.startsWith("zh")) return "zh";
  return defaultLocale;
}
