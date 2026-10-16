import { cookies, headers } from "next/headers";
import { getRequestConfig } from "next-intl/server";
import { getMessages, LOCALE_COOKIE } from "./messages";
import { resolveLocale } from "./locale";

// 每请求执行一次（next-intl 无路由模式，design D2）：
// cookie oops-locale（显式选择）→ Accept-Language（首次访问推断）→ 默认 zh。
// proxy 不参与 locale；该配置同时供服务端组件与 NextIntlClientProvider 使用。
export default getRequestConfig(async () => {
  const cookieStore = await cookies();
  const headerStore = await headers();
  const locale = resolveLocale(
    cookieStore.get(LOCALE_COOKIE)?.value,
    headerStore.get("accept-language"),
  );

  return {
    locale,
    messages: getMessages(locale),
  };
});
