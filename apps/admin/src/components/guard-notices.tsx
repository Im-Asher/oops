import { Result } from "antd";
import { getTranslations } from "next-intl/server";

/** 401：会话失效引导页（验签失败/过期/ghost——ghost 在 requireUser 层即拒）。 */
export async function ExpiredNotice() {
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
export async function ForbiddenNotice() {
  const t = await getTranslations("common.guard");
  return (
    <Result status="403" title={t("forbiddenTitle")} subTitle={t("forbiddenBody")} />
  );
}
