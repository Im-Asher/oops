import { App } from "antd";
import { render, type RenderOptions, type RenderResult } from "@testing-library/react";
import { NextIntlClientProvider } from "next-intl";
import type { ReactElement, ReactNode } from "react";
import zh from "../../messages/zh.json";

// 组件测试统一注入 zh 词典（admin 为 zh 单语；与 web 侧同名助手同约定）。
// 外层 antd App 提供 message/notification/modal 上下文——视图走 App.useApp()，
// 缺了它 message 实例为空对象，调用即抛。
export function renderWithI18n(
  ui: ReactElement,
  options?: RenderOptions,
): RenderResult {
  function Wrapper({ children }: { children: ReactNode }) {
    return (
      <App>
        <NextIntlClientProvider locale="zh" messages={zh}>
          {children}
        </NextIntlClientProvider>
      </App>
    );
  }
  return render(ui, { wrapper: Wrapper, ...options });
}
