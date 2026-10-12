import { getTranslations } from "next-intl/server";
import InviteCodesView from "@/components/invite-codes-view";

/** 邀请码管理页（task 4.2 转正）：RSC 壳取词典标题，交互面在 InviteCodesView（client）。 */
export default async function InviteCodesPage() {
  const t = await getTranslations("common.section.inviteCodes");
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>{t("title")}</h2>
      <InviteCodesView />
    </div>
  );
}
