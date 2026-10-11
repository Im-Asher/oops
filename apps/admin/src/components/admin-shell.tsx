"use client";

// 管理端布局骨架（task 3.1）：antd Layout + 侧边六面导航。
// 必须为 client 组件：Menu 选中态/路由跳转需浏览器交互；antd 复合组件
// 静态属性在 RSC client-reference proxy 上不可访问（1.2 spike 纪律）。
import type { ReactNode } from "react";
import { Layout, Menu } from "antd";
import { useTranslations } from "next-intl";
import { usePathname, useRouter } from "next/navigation";

const { Header, Sider, Content } = Layout;

export default function AdminShell({ children }: { children: ReactNode }) {
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
        {/* task 3.2：头部管理员身份 + 退出按钮 */}
        <Header
          style={{
            background: "#fff",
            display: "flex",
            alignItems: "center",
            justifyContent: "flex-end",
            padding: "0 24px",
          }}
        />
        <Content style={{ padding: 24 }}>{children}</Content>
      </Layout>
    </Layout>
  );
}
