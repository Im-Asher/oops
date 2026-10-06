import { getRequestConfig } from "next-intl/server";

// 1.1 阶段最小 stub：插件要求此文件存在。
// 完整解析链（cookie → Accept-Language → 默认 zh）见任务 1.3。
export default getRequestConfig(async () => {
  return {
    locale: "zh",
    messages: {},
  };
});
