import type { Metadata } from "next";
import type { ReactNode } from "react";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { NextIntlClientProvider } from "next-intl";
import { ConfigProvider } from "antd";
import zhCN from "antd/locale/zh_CN";

export const metadata: Metadata = {
  title: "Oops Admin",
  description: "Oops operations console",
};

export default function RootLayout({ children }: { children: ReactNode }) {
  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <NextIntlClientProvider>
            <ConfigProvider locale={zhCN}>{children}</ConfigProvider>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
