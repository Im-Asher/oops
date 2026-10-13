import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import zh from "../../messages/zh.json";

// 组件测试统一注入 zh 词典（admin 为 zh 单语；与 web 侧同名助手同约定）。
export function renderWithI18n(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <NextIntlClientProvider locale="zh" messages={zh}>
        {children}
      </NextIntlClientProvider>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
