import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function AgentsPage() {
  const t = await getTranslations("common.section.agents");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
