import { getTranslations } from "next-intl/server";
import UsersView from "@/components/users-view";

/** 用户管理页（task 3.3 转正）：RSC 壳取词典标题，交互面在 UsersView（client）。 */
export default async function UsersPage() {
  const t = await getTranslations("common.section.users");
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>{t("title")}</h2>
      <UsersView />
    </div>
  );
}
