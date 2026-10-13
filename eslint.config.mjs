// @ts-check
import tseslint from "typescript-eslint";

// packages 共享 lint 基线。apps/web 有自己的 next 专属配置（apps/web/eslint.config.mjs，
// flat config 从 cwd 向上查找时命中即停，本文件不影响 app）。
// 各包 lint 脚本 `eslint src` 从包目录运行，向上找到本配置。
export default tseslint.config(
  { ignores: ["**/node_modules/**", "**/dist/**"] },
  ...tseslint.configs.recommended.map((config) => ({
    ...config,
    files: ["packages/*/src/**/*.ts"],
  })),
  {
    files: ["packages/*/src/**/*.ts"],
    rules: {
      // 共享包禁 any（对齐 TS strict；recommended 默认仅 warn）
      "@typescript-eslint/no-explicit-any": "error",
      "@typescript-eslint/no-unused-vars": [
        "error",
        { argsIgnorePattern: "^_", varsIgnorePattern: "^_" },
      ],
    },
  },
);
