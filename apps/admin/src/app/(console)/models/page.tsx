import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function ModelsPage() {
  const t = await getTranslations("common.section.models");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
