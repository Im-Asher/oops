import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function UsersPage() {
  const t = await getTranslations("common.section.users");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
