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
  // 分层边界：客户端代码（components/hooks）禁止引用 src/server/**。
  // 服务端能力一律通过 /api 路由暴露；route handler 与 RSC 不在此限制内。
  {
    files: ["src/components/**/*.{ts,tsx}", "src/hooks/**/*.{ts,tsx}"],
    rules: {
      "no-restricted-imports": [
        "error",
        {
          patterns: [
            {
              group: ["@/server/*", "@/server/**", "**/server/**"],
              message:
                "客户端代码禁止引用 src/server/**，请通过 /api 路由访问服务端能力",
            },
          ],
        },
      ],
    },
  },
]);

export default eslintConfig;
