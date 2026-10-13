import ModelsView from "@/components/models-view";
import { getTranslations } from "next-intl/server";

export default async function ModelsPage() {
  const t = await getTranslations("common.section.models");
  return (
    <>
      <h2 style={{ marginBottom: 16 }}>{t("title")}</h2>
      <ModelsView />
    </>
  );
}
