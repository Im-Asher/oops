import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function AdminHomePage() {
  const t = await getTranslations("common.section.home");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
