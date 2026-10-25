// @ts-check
import tseslint from "typescript-eslint";

// 创作域是纯 Node 服务：沿用 packages 的 TS 基线（无需 next 规则）。
// flat config 从 cwd 向上查找时会命中本文件，不再落到根配置的 packages/* 匹配范围。
export default tseslint.config(
  { ignores: ["node_modules/**", "assets/**"] },
  ...tseslint.configs.recommended,
  {
    rules: {
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
