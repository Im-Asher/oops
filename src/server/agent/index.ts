import "@/server/agent/tools"; // 注册内置工具
import "@/server/domain/tasks/task-executor"; // 注册 generate_image 任务处理器
import "./definitions/atmosphere-designer"; // 注册：氛围图设计师
import "./definitions/product-photographer"; // 注册：产品摄影师

export { agentRegistry } from "./registry";
