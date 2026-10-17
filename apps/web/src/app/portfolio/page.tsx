import { redirect } from "next/navigation";

/**
 * 作品集已并入 /home 主区（侧栏切换视图），不再占独立路由。
 * 保留本页仅为旧链接/书签可用。
 */
export default function PortfolioPage() {
  redirect("/home");
}