import path from "node:path";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": path.resolve(__dirname, "src"),
    },
  },
  test: {
    // 默认 node；DOM 组件测试按文件用 // @vitest-environment jsdom 声明（与 web 同约定）。
    environment: "node",
    include: ["src/**/*.test.{ts,tsx}"],
  },
});
