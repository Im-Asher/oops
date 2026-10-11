import { defineConfig, globalIgnores } from "eslint/config";
import nextVitals from "eslint-config-next/core-web-vitals";
import nextTs from "eslint-config-next/typescript";

const eslintConfig = defineConfig([
  ...nextVitals,
  ...nextTs,
  // Override default ignores of eslint-config-next.
  globalIgnores([
    // Default ignores of eslint-config-next:
    ".next/**",
    "out/**",
    "build/**",
    "next-env.d.ts",
  ]),
  // 项目约定：下划线前缀的变量/参数视为有意未使用
  {
    rules: {
      "@typescript-eslint/no-unused-vars": [
        "warn",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
  // 分层边界：客户端代码（components/hooks）禁止引用 src/server/** 与 packages 内部
  // 模块；服务端能力（@oops/db、@oops/auth 等）仅 route handler 与 RSC 可消费。
  {
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/server/**", "**/server/**", "@oops/db", "@oops/db/*", "@oops/auth", "@oops/auth/*"],
              message:
                "客户端代码禁止引用服务端模块（src/server/**、@oops/db、@oops/auth），请通过 /api 路由访问",
            },
          ],
        },
      ],
    },
  },
  // 禁裸中文（与 web 同一纪律）：客户端 UI 文案必须经 next-intl 词典。
  // 注释不在 AST 字符串节点天然豁免；测试断言、route handler（服务端结构化错误
  // message 保持中文，客户端按 code 渲染）不在规则范围。
  {
    files: ["src/components/**/*.{ts,tsx}", "src/app/**/*.{ts,tsx}"],
    ignores: ["**/*.test.*", "**/route.ts"],
    rules: {
      "no-restricted-syntax": [
        "error",
        {
          selector: "Literal[value=/[\\u4e00-\\u9fff]/]",
          message:
            "UI 文案禁止裸中文：必须经 next-intl 词典（messages/zh.json），见 AGENTS.md i18n 约定",
        },
        {
          selector: "TemplateElement[value.raw=/[\\u4e00-\\u9fff]/]",
          message:
            "UI 文案禁止裸中文：必须经 next-intl 词典（messages/zh.json），见 AGENTS.md i18n 约定",
        },
        {
          selector: "JSXText[value=/[\\u4e00-\\u9fff]/]",
          message:
            "UI 文案禁止裸中文：必须经 next-intl 词典（messages/zh.json），见 AGENTS.md i18n 约定",
        },
      ],
    },
  },
]);

export default eslintConfig;
