import zh from "../../messages/zh.json";
import en from "../../messages/en.json";

// 支持的语言区域。zh 为基准词典（IntlMessages 类型与 zh↔en 对齐测试的源头），
// en 缺失 key 由 deepMerge 回落到 zh（见 design D4）。
export const locales = ["zh", "en"] as const;
export type Locale = (typeof locales)[number];
export const defaultLocale: Locale = "zh";

// 与切换器写入、request.ts 读取共享的 cookie 名（design D2/D9）。
export const LOCALE_COOKIE = "oops-locale";

export type Messages = typeof zh;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    !(value instanceof Date)
  );
}

// 递归合并：override 中存在的 key 胜出，缺失处回落 base（zh 为底、en 覆盖）。
export function deepMerge<T extends Record<string, unknown>>(
  base: T,
  override: Record<string, unknown>,
): T {
  const result: Record<string, unknown> = { ...base };
  for (const [key, overrideValue] of Object.entries(override)) {
    const baseValue = base[key];
    if (isPlainObject(baseValue) && isPlainObject(overrideValue)) {
      result[key] = deepMerge(baseValue, overrideValue);
    } else {
      result[key] = overrideValue;
    }
  }
  return result as T;
}

// en 合并结果为确定值（输入均为模块常量），memoize 避免每请求重算。
let enMessagesCache: Messages | undefined;

export function getMessages(locale: Locale): Messages {
  if (locale === "zh") return zh;
  enMessagesCache ??= deepMerge(zh, en);
  return enMessagesCache;
}

export function isSupportedLocale(value: string): value is Locale {
  return (locales as readonly string[]).includes(value);
}
