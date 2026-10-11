import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function AuditPage() {
  const t = await getTranslations("common.section.audit");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
