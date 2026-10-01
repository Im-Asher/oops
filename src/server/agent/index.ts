import "@/server/agent/tools"; // 注册内置工具
import "@/server/domain/tasks/task-executor"; // 注册 generate_image 任务处理器
import "./definitions/atmosphere-designer"; // 注册首个 Agent

export { agentRegistry } from "./registry";
