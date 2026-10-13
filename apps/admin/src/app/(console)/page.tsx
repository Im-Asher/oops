import DashboardView from "@/components/dashboard-view";
import { getTranslations } from "next-intl/server";

export default async function AdminHomePage() {
  const t = await getTranslations("common.section.home");
  return (
    <>
      <h2 style={{ marginBottom: 16 }}>{t("title")}</h2>
      <DashboardView />
    </>
  );
}
