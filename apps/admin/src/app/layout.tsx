import type { Metadata } from "next";
import type { ReactNode } from "react";
import { cookies } from "next/headers";
import { AntdRegistry } from "@ant-design/nextjs-registry";
import { NextIntlClientProvider } from "next-intl";
import { ConfigProvider, Result } from "antd";
import zhCN from "antd/locale/zh_CN";
import { getTranslations } from "next-intl/server";
import { requireAdminFromCookieHeader } from "@oops/auth";
import { resolveGuardView } from "@/lib/guard-view";

export const metadata: Metadata = {
  title: "Oops Admin",
  description: "Oops operations console",
};

/** 401：会话失效引导页（验签失败/过期/ghost——ghost 在 requireUser 层即拒）。 */
async function ExpiredNotice() {
  const t = await getTranslations("common.guard");
  return (
    <Result
      status="warning"
      title={t("expiredTitle")}
      subTitle={t("expiredBody")}
    />
  );
}

/** 403：非 admin 无权限页（spec 指定 antd Result 形态）。 */
async function ForbiddenNotice() {
  const t = await getTranslations("common.guard");
  return (
    <Result status="403" title={t("forbiddenTitle")} subTitle={t("forbiddenBody")} />
  );
}

/**
 * 布局层门卫（admin-scaffold design D2 全量校验位置）：
 * proxy 只做 cookie 存在性引导；此处 requireAdminFromCookieHeader
 * 做验签/有效期/用户存在且 active/会话版本/role 全量校验并分流渲染。
 * html/body 必须完整返回，故三分支收敛在 body 内层。
 */
export default async function AdminRootLayout({
  children,
}: {
  children: ReactNode;
}) {
  const cookieStore = await cookies();
  const guard = await requireAdminFromCookieHeader(cookieStore.toString());
  const view = resolveGuardView(guard);

  return (
    <html lang="zh-CN">
      <body>
        <AntdRegistry>
          <NextIntlClientProvider>
            <ConfigProvider locale={zhCN}>
              {view === "expired" ? (
                <ExpiredNotice />
              ) : view === "forbidden" ? (
                <ForbiddenNotice />
              ) : (
                children
              )}
            </ConfigProvider>
          </NextIntlClientProvider>
        </AntdRegistry>
      </body>
    </html>
  );
}
