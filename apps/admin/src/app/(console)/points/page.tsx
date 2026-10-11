import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function PointsPage() {
  const t = await getTranslations("common.section.points");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
