import { getTranslations } from "next-intl/server";
import MessagesView from "@/components/messages-view";

/** 消息管理页（task 5.5）：RSC 壳取词典标题，交互面在 MessagesView（client）。 */
export default async function MessagesPage() {
  const t = await getTranslations("common.section.messages");
  return (
    <div>
      <h2 style={{ fontSize: 18, fontWeight: 600, marginBottom: 24 }}>{t("title")}</h2>
      <MessagesView />
    </div>
  );
}
