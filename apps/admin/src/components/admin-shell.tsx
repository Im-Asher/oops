"use client";

// 管理端布局骨架（task 3.1/3.2）：antd Layout + 侧边六面导航 + 头部身份/退出。
// 必须为 client 组件：Menu 选中态/路由跳转需浏览器交互；antd 复合组件
// 静态属性在 RSC client-reference proxy 上不可访问（1.2 spike 纪律）。
import type { ReactNode } from "react";
import { ConfigProvider, Button, Layout, Menu } from "antd";
import zhCN from "antd/locale/zh_CN";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

const { Header, Sider, Content } = Layout;

export default function AdminShell({
  children,
  identity,
}: {
  children: ReactNode;
  identity: string;
}) {
  const t = useTranslations("common.nav");
  const tCommon = useTranslations("common");
  const pathname = usePathname();
  const router = useRouter();

  const items = [
    { key: "/", label: t("home") },
    { key: "/users", label: t("users") },
    { key: "/invite-codes", label: t("inviteCodes") },
    { key: "/points", label: t("points") },
    { key: "/agents", label: t("agents") },
    { key: "/models", label: t("models") },
    { key: "/audit", label: t("audit") },
  ];

  return (
    <ConfigProvider locale={zhCN}>
      <Layout style={{ minHeight: "100vh" }}>
      <Sider theme="dark" width={208}>
        <div
          style={{
            color: "rgba(255,255,255,0.85)",
            fontWeight: 600,
            fontSize: 16,
            padding: "16px 24px",
          }}
        >
          {tCommon("appTitle")}
        </div>
        <Menu
          theme="dark"
          mode="inline"
          selectedKeys={[pathname]}
          items={items}
          onClick={({ key }) => router.push(key)}
        />
      </Sider>
      <Layout>
        <Header
          style={{
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            gap: 16,
            padding: "0 24px",
          }}
        >
          <span style={{ color: "rgba(0,0,0,0.65)" }}>{identity}</span>
          {/* 原生 form POST：无 JS 依赖，浏览器自动跟随服务端 307 回 web 首页 */}
          <form action="/api/logout" method="post">
            <Button htmlType="submit" size="small">
              {tCommon("logout")}
            </Button>
          </form>
        </Header>
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
      </Layout>
    </ConfigProvider>
  );
}
