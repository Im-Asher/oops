import { getTranslations } from "next-intl/server";
import PointsView from "@/components/points-view";

/** 积分运营页（task 5.2 转正）：RSC 壳取词典标题，交互面在 PointsView（client）。 */
export default async function PointsPage() {
  const t = await getTranslations("common.section.points");
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>{t("title")}</h2>
      <PointsView />
    </div>
  );
}
