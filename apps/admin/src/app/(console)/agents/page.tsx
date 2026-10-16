import AgentsView from "@/components/agents-view";
import { getTranslations } from "next-intl/server";

export default async function AgentsPage() {
  const t = await getTranslations("common.section.agents");
  return (
    <>
      <h2 style={{ marginBottom: 16 }}>{t("title")}</h2>
      <AgentsView />
    </>
  );
}
