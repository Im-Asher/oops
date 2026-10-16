import type { locales, Messages } from "./messages";

// next-intl v4 类型增强（官方 TypeScript 工作流）：让 t() 的 key 与 useLocale()
// 的返回值获得编译期校验。zh 为基准词典（design D4）。
declare module "next-intl" {
  interface AppConfig {
    Locale: (typeof locales)[number];
    Messages: Messages;
  }
}
