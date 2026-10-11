import { redirect } from "next/navigation";

/** 旧工作台路径：重定向到 AI 画布页，保证存量入口可用。 */
export default function ChatRedirectPage() {
  redirect("/canvas");
}
