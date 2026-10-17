import { Button, Result } from "antd";
import { getTranslations } from "next-intl/server";

/**
 * 401：会话失效引导页（验签失败/过期/ghost/被降级——见 requireAdmin）。
 * 管理端自带登录入口，故直接给出去登录页的出口，不再引导到 web 端。
 */
export async function ExpiredNotice() {
  const t = await getTranslations("common.guard");
  const tLogin = await getTranslations("common.login");
  return (
    <Result
      status="warning"
      title={t("expiredTitle")}
      subTitle={t("expiredBody")}
      extra={
        <Button type="primary" href="/login">
          {tLogin("title")}
        </Button>
      }
    />
  );
}

/** 403：非 admin 无权限页（spec 指定 antd Result 形态）。 */
export async function ForbiddenNotice() {
  const t = await getTranslations("common.guard");
  return (
    <Result status="403" title={t("forbiddenTitle")} subTitle={t("forbiddenBody")} />
  );
}
