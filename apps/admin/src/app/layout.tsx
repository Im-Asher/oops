import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { NextIntlClientProvider } from "next-intl";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

import { ANTD_THEME_TOKEN } from "@/lib/theme";

export const metadata: Metadata = {
  title: "Oops Admin",
  description: "Oops operations console",
};

// 文档壳：只装 SSR 样式抽取与 i18n/antd 全局 Provider。
// 门卫全量校验在 (console)/layout（admin-scaffold design D2）——
// 门卫与身份查询同 layout 完成，避免每请求重复验签查库。
export default function AdminRootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <NextIntlClientProvider>
            <ConfigProvider locale={zhCN} theme={{ token: ANTD_THEME_TOKEN }}>{children}</ConfigProvider>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
