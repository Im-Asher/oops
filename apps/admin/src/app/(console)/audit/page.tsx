import { getTranslations } from "next-intl/server";
import AuditView from "@/components/audit-view";

/** 审计流水页（task 1.3 转正）：RSC 壳取词典标题，交互面在 AuditView（client）。 */
export default async function AuditPage() {
  const t = await getTranslations("common.section.audit");
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>{t("title")}</h2>
      <AuditView />
    </div>
  );
}
