import { getTranslations } from "next-intl/server";
import SectionPlaceholder from "@/components/section-placeholder";

export default async function InviteCodesPage() {
  const t = await getTranslations("common.section.inviteCodes");
  return <SectionPlaceholder title={t("title")} description={t("description")} />;
}
