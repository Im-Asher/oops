import { getRequestConfig } from "next-intl/server";
import messages from "../../messages/zh.json";

// 每请求执行一次（next-intl 无路由模式，与 web 的 cookie 模式同构）。
// admin v0.1.0 为中文单语：固定 zh。将来扩双语时在此接入
// cookie/Accept-Language 解析并按 locale 选 messages（参照 apps/web/src/i18n/）。
export default getRequestConfig(async () => {
  return {
    locale: "zh",
    messages,
  };
});
