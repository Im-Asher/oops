import { getTranslations } from "next-intl/server";

// 入口层引导页（proxy 无 cookie 重定向目标，spec「未携带会话 cookie」场景）：
// 静态人话提示，无业务逻辑。登录动作在 web 端完成（免登录互通依赖同一会话 cookie）。
export default async function GatePage() {
  const t = await getTranslations("common");
  return (
    <main style={{ maxWidth: 480, margin: "96px auto", padding: 24 }}>
      <h1 style={{ fontSize: 20, fontWeight: 600 }}>{t("gate.title")}</h1>
      <p style={{ marginTop: 12, color: "rgba(0,0,0,0.65)" }}>{t("gate.body")}</p>
    </main>
  );
}
