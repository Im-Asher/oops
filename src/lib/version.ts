import pkg from "../../package.json";

/**
 * 应用版本标识：构建时注入的 NEXT_PUBLIC_APP_VERSION 优先，缺失（或空白）时
 * 回退 package.json 的 version。版本随构建产物走、不读数据库——数据库行跨部署
 * 存活，会谎报运行版本（spec/home-landing「侧栏品牌版本标识」）。
 *
 * 注意：该变量在客户端 bundle 是构建期内联，在 Server 端是运行时读取——
 * 若只在构建机注入而运行时容器缺失，SSR 输出会回退 pkg.version 与客户端不一致；
 * 本常量仅供客户端组件使用，注入时请确保构建与运行环境一致。
 */
export const APP_VERSION: string =
  process.env.NEXT_PUBLIC_APP_VERSION?.trim() || pkg.version;
