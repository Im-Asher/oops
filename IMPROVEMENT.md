# IMPROVEMENT.md — 文档同步规则与待改进项

> 本文件是 `AGENTS.md` / `docs/ARCHITECTURE.md` 等文档的**防腐烂机制**：
> 只定义「何时更新 / 如何判定 / 谁负责 / 如何验证」的规则，以及**尚未实施的待改进项**。
> 变更历史不在此登记——它属于 git 提交记录（见下方「过期处理」）。

## 维护规则

### 1. 触发清单（正面：满足任一即必须在同一次提交更新对应文档）
- 架构决策变更：技术栈选型、分层边界（import 边界）、数据模型/表结构、Agent/工具机制（**决策确认时即触发**，含 `docs/plans/` 设计文档落库；须在同一次提交同步 `AGENTS.md`/`ARCHITECTURE.md` 的对应契约——`docs/plans/` 只是计划，不替代 `ARCHITECTURE.md` 作为权威架构描述）
- 新增 / 删除 / 重命名 Agent、工具、Service、Route Handler、前端组件
- 构建 / 测试命令、依赖版本（minor/major 且影响行为）、环境变量变化
- 安全要求变化：认证、上传校验、渲染沙箱白名单、密钥访问路径
- 端到端流程或意图分流逻辑变化

### 2. 豁免清单（负面：以下情况无需更新文档）
- 纯重命名且对外契约不变、内部函数/模块重构不改导出与目录
- 依赖 patch 版本升级且无行为变化
- 仅改注释、修正错别字、调整文档内排版
- minor 升级只加特性、不改默认行为与已记录 API

### 3. 判定阈值（三问自检，任一为「是」则必须更新）
1. 照着文档做的人 / AI 会不会做错？（行为契约被破坏）
2. 文档描述的事实是否仍成立？（事实契约失效，如「零改动新增 Agent」但新机制其实要改前端）
3. 是否改变了已记录的决策点？（决策契约变更）

### 4. 责任人与合并闸门
- 变更作者（人或编码 Agent）本人负责在同一次提交内同步文档。
- **PR 合并前由 reviewer 核对文档同步**：未同步文档的变更不得合并。
- 提交信息清晰说明文档改动（doc 同步可作为独立 `docs:` 提交，或并入对应 `feat:`/`fix:` 提交）。

### 5. 过期处理（代码为准）
- 文档与实现冲突时，以实现为准，立即修复文档。
- 文档更新历史通过 git 提交记录追溯，**不要**在本文件维护手工变更表（那会与 git 重复、必然腐烂）。
- 若某条文档暂时无法更新（如待实现功能），记入下方「待改进项」而非留作过期文字。

## 验证方法

更新文档后，用以下方式确认准确、完整、一致：

1. **事实核对（对代码）**：文档声称的目录/文件/表结构用实际代码核对；确认每个
   `src/server/agent/agents/*.ts` 都有对应 `prompts/*.md`；确认 `ARCHITECTURE.md` 目录树与真实树一致。
2. **可执行护栏**：运行 `pnpm lint && pnpm typecheck && pnpm test`，确认文档所述命令真实存在且通过。
3. **交叉一致性**：`AGENTS.md` 与 `ARCHITECTURE.md` 表述不冲突（技术栈等易重复处以 `ARCHITECTURE.md` 为准，`AGENTS.md` 只摘摘要并链接）。
4. **CI 自动校验（建议新增）**：加轻量 `docs:check` 脚本作为 PR 门禁，校验：
   - `ARCHITECTURE.md` 目录树列出的文件是否真实存在
   - 每个 Agent 定义是否都有对应 prompt md
   - 文档内相对链接是否 404

## 待改进项

> 仅登记**尚未实施**的改进与文档 TODO；每月复核一次，实现或放弃后删除并标注 `done/ dropped`。
> 复核时在最右侧标 `reviewed-on`，避免无限膨胀。

- [x] **实施计划文档**：已建 `docs/plans/2026-09-28-docker-postgres-design.md`（Docker Compose + PostgreSQL + MinIO 设计）；实现时同步 ARCHITECTURE 对应小节。
- [ ] **任务恢复策略**：`task-executor` 目前进程重启后 pending 任务标记失败；待多实例需求出现时评估 BullMQ + Redis，并同步 ARCHITECTURE.md §4。
- [ ] **批量生图工具**：`schedule_batch`（提交即返回 taskId）未实现，属于刻意延后项；实现后需在 ARCHITECTURE.md 工具语义表补充。
- [ ] **生图 Provider 抽象稳定化**：首批只接 Seedream；接入第二家（万相）后把 provider 接口固化并补接口文档。
- [ ] **渲染沙箱网络白名单**：Playwright 出网限制目前是设计要求（AGENTS.md Security），实现时需细化白名单配置项并补充示例。
- [ ] **数据模型演进**：`userId` 已预留但未启用；启动多租户时同步更新 ARCHITECTURE.md §7 与认证设计。
- [ ] **修复基线语义冲突**：`AGENTS.md` 称任务「persisted and retryable」，而 `ARCHITECTURE.md` §4 称「重启后 pending 标记失败」。需统一表述（任务级不恢复 vs 工具级可重试）。
