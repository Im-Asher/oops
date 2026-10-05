# 设计：轻量领域化目录结构（单应用，不引入 monorepo / 全量 DDD）

> 日期：2026-09-28
> 状态：已确认设计（待实现）
> 关联：替换 `ARCHITECTURE.md` §8 原 `services/` + `db/` 扁平结构；承接「monorepo + DDD 是否合适」讨论的结论——当前 MVP 阶段采用折中方案。

## 背景与决策

用户提出是否采用 monorepo + DDD。评估结论：当前阶段（MVP / 绿地、一体化 Next.js、无第二部署物、领域复杂度低）直接上 monorepo + 全量 DDD 属 YAGNI。

采用**折中方案**：保持单 Next.js 应用，内部做轻量领域化——

- `src/server/domain/`：纯领域（实体 + 仓储接口 + 领域逻辑），不依赖具体 Provider / 框架。
- `src/server/infra/`：基础设施实现（db / storage / providers / render），藏在接口后。
- `src/server/agent/`：声明式 Agent 运行时，**保持不动**（独立关注点，避免与「零代码新增 Agent」决策冲突）。

不为 monorepo 引入 pnpm workspaces；不写防腐层 / CQRS；repository 实现与领域模块同处，不另起空层。

## 目录结构

```
src/server/
├── domain/                 # 纯领域：实体 + 仓储接口 + 领域逻辑（不依赖具体 Provider/框架）
│   ├── sessions/           # session 生命周期、会话元数据
│   │   └── session.repo.ts        # 接口 + Drizzle 实现
│   ├── messages/           # 消息持久化、UIMessage 重建（事件即持久化）
│   │   └── message.repo.ts
│   ├── assets/             # 资产元数据实体 + 仓储（落库的是对象 key）
│   │   └── asset.repo.ts
│   └── tasks/              # 生成任务实体 + 状态机 pending→running→done/failed
│       ├── task.repo.ts
│       └── task-executor.ts       # 进程内 Worker 编排（调 domain + infra）
├── infra/                  # 基础设施实现（具体技术，藏在接口后）
│   ├── db/                 # Drizzle client + schema + migrations（原 db/）
│   ├── storage/            # MinIO / S3 客户端（原 asset 存储实现）
│   ├── providers/          # Seedream / 万相 生图客户端（原 image-generation）
│   └── render/             # Playwright 截图（原 render.ts）
├── agent/                  # 声明式 Agent 运行时——保持不动（独立关注点）
│   ├── registry.ts
│   ├── runtime.ts          # agentLoop ↔ SSE 桥接
│   ├── agents/             # defineAgent 配置（一文件一 Agent）
│   ├── prompts/
│   └── tools/              # ToolRegistry + 实现（内部调 domain/infra）
└── (config 仍在 src/lib/config.ts，client-safe)
```

## 分层原则（替换原 `services/` 二分法）

- 原 `asset / session / image-generation / render / task-executor` 按「是否为领域逻辑」二分：
  - 进 `domain/`：sessions、messages、assets、tasks（会话/消息/资产/任务为业务实体）。
  - 进 `infra/`：providers（生图）、storage（MinIO）、render（Playwright）、db（Drizzle client）。
- Repository 实现放在 domain 模块内（`<x>.repo.ts` 同一模块导出接口 + Drizzle 实现），减少空转分层。
- `agent/` 不归入 domain：声明式 Agent 是「配置 + 运行时」关注点，与业务领域不同；保持现状以尊重「零代码新增 Agent」决策。
- `task-executor` 作为编排者留在 `domain/tasks/`，调用 domain 仓储 + infra 实现。

## 与既有决策的兼容性

- 一致：`ARCHITECTURE.md` §1「一体化 Next.js、无独立后端」、`AGENTS.md` import 边界（server 禁被客户端 import）、声明式 Agent 机制均不受影响。
- 文档同步：`ARCHITECTURE.md` §8 目录树、`AGENTS.md` Project structure + Layering convention + Async tasks 路径需同步（本次已更新，同提交）。

## 实现拆解（建议顺序）

1. 建 `src/server/domain/{sessions,messages,assets,tasks}/` 各 `*.repo.ts`（接口 + Drizzle 实现，初期可薄封装现有 schema）。
2. 建 `src/server/infra/{db,storage,providers,render}/`，把原 `services/` 实现迁入（db client、MinIO、Seedream/万相、Playwright）。
3. `task-executor` 迁入 `domain/tasks/`，改为依赖 domain 仓储 + infra 实现。
4. `agent/tools/` 实现改为调 `domain/*` + `infra/*`（而非原 `services/*`）。
5. Route Handlers 改调 `domain/*`（经 repo），保持薄壳。
6. 同步更新 `AGENTS.md` / `ARCHITECTURE.md`（已完成于本设计提交）。
7. 单测：domain 用 mock repo；infra 用 mock provider / MinIO（零网络）。
