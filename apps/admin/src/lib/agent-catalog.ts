/**
 * Agent 只读清单（task 6.2「经配置约定」方案）：
 * agent registry 运行在 web 进程（apps/web/src/server/agent），admin 独立部署
 * 无法导入；v0.1.0 agent 集合小且稳定，此处静态同步 id/名称。
 * 同步义务：web 新增/更名 agent 必须同步此清单（缺失项在 /agents 页面不可见）。
 */
export interface AdminAgentEntry {
  id: string;
  name: string;
}

export const ADMIN_AGENT_CATALOG: readonly AdminAgentEntry[] = [
  { id: "atmosphere-designer", name: "氛围图设计师" },
  { id: "poster-designer", name: "海报设计师" },
  { id: "product-photographer", name: "产品摄影师" },
];
