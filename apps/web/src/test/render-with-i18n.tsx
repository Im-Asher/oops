import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import type { Locale } from "@/i18n/messages";
import zh from "../../messages/zh.json";

type Options = RenderOptions & { locale?: Locale };

// 组件测试统一注入 zh 词典（默认 locale），既有中文断言零改动（design D7）。
// 需要模拟其他 locale 时传 { locale: "en" }（en 值当前与 zh 相同，词典随抽取任务分叉）。
export function renderWithI18n(
  ui: ReactElement,
  { locale = "zh", ...options }: Options = {},
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale={locale} messages={zh}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
