# 设计：Docker Compose 部署 + PostgreSQL

> 日期：2026-09-28
> 状态：已确认设计（待实现）
> 关联：替换 `ARCHITECTURE.md` 中原「SQLite + 本地磁盘、MVP 零运维」基线决策。

## 背景与目标

原架构（`ARCHITECTURE.md`）采用 SQLite + Drizzle、本地磁盘存储、一体化 Next.js，定位 MVP 零运维。
现决定开发阶段即采用 **Docker Compose** 部署，数据库换 **PostgreSQL**，存储换 **MinIO（S3 兼容）**，
使本地栈与生产语义一致、为后续多实例演进铺路，同时不引入过重运维。

已确认的分叉决策：

- **数据库**：PostgreSQL 完全替换 SQLite（开发/生产统一，单一方言）。
- **存储**：compose 引入 MinIO，存储抽象指向 S3 兼容接口。
- **DX**：中间件进容器（`postgres` + `minio`），Next.js 应用本地 `pnpm dev` 跑；生产另用 standalone 镜像。

## 设计 §1 — 部署拓扑与数据库

最终栈 `app + postgres + minio`，本地开发只起后两者。

- `docker-compose.yaml` 只定义 `postgres` 与 `minio` 两个服务；Next.js 用本机 `pnpm dev` 跑（热更新），不进 compose。两者挂 named volume 持久化，minio 开 console 端口。
- 连接走环境变量：`DATABASE_URL=postgres://oops:oops@localhost:5432/oops`（compose 端口映射宿主机）、`MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET`。`src/lib/config.ts` 统一读取。
- Drizzle 切 pg 方言：驱动 `drizzle-orm/postgres-js` + `postgres`；`pnpm db:generate` / `db:migrate` 改连 PostgreSQL，不再有 SQLite 文件。
- Schema 方言调整：`parts`/`meta` 的 `JSON` → `jsonb`；`type`/`kind`/`status` 用 `pgEnum`（或 `varchar` + 应用约束）；时间列 → `timestamp`。`userId` 预留列不变。
- 迁移产物落 `src/server/db/migrations/`，`db:migrate` 应用。

## 设计 §2 — 对象存储与资产服务

存储抽象从本地磁盘切到 S3 兼容（MinIO）。

- 引入 `@aws-sdk/client-s3`（通用，能直连生产 OSS/S3）。`src/server/services/asset.ts` 重写：`save` 走 `PutObject` 到 bucket，落库对象 key（`assets/<uuid>.<ext>`）；`files` route 改为 presign URL 或代理读取。
- 安全要求保持（AGENTS.md Security）：上传校验 MIME + 大小硬上限，存生成文件名；对外服务图片设正确 `Content-Type` / `Content-Disposition`，对 SVG/HTML 维持阻断或内容扫描，防 stored-XSS。
- 本地 DX：MinIO 在 compose 跑，bucket 用启动后 init 脚本自动建（compose 内 `mc` 一次性 job + healthcheck），无需手建。`MINIO_*` 进 `.env.example`。
- 多实例就绪：资产在共享 MinIO、DB 无状态，应用可水平扩展；但 `task-executor` 仍是进程内单例（BullMQ 延后），当前仍限单 app 实例。
- 清理：删 `data/assets/` 本地目录与 `data/` gitignore 项；`.env*` 继续 gitignore。

## 设计 §3 — docker-compose、环境与生产镜像

- `docker-compose.yaml`（开发）三个服务：
  - `postgres`：`postgres:16-alpine`，env `POSTGRES_USER/PASSWORD/DB`，端口 `5432:5432`，挂 `pgdata` volume，healthcheck `pg_isready`。
  - `minio`：`minio/minio`，`server /data --console-address :9001`，端口 `9000`(API)/`9001`(console)，挂 `miniodata` volume。
  - `minio-init`：依赖 minio healthy 的一次性 job，用 `minio/mc` 建 bucket 并设为 private。
- 环境变量：`.env.example` 提供 `DATABASE_URL`、`MINIO_ENDPOINT/ACCESS_KEY/SECRET_KEY/BUCKET`、`SESSION_SECRET`。`.env` gitignore；本地 `pnpm dev` 读 `.env.local`。
- 生产镜像：`Dockerfile` multi-stage 构建 Next.js standalone 输出，运行时只拷 `.next/standalone` + `public` + `.next/static`。可选 `compose.prod.yaml`（app + postgres + minio，可选 nginx 反代 443）。
- 端口约定：dev 下 postgres/minio 映射宿主机；生产走内部网络，app 暴露 3000，外网只过 nginx。

## 设计 §4 — 测试、数据流与文档同步义务

- 数据流基本不变：SSE 流、agentLoop、工具执行（ARCHITECTURE §5/§6）照旧，仅 `save_asset` 改落 MinIO、`tasks` 表换 pg。失败回喂、事件即持久化逻辑不变。
- 测试调整：
  - 单测：provider/render 仍 mock；asset 服务单测用 `@aws-sdk/client-s3` mock，保持 `pnpm test` 纯单测、零网络。
  - 集成测试（可选）：`docker compose up` 起 postgres+minio，跑 migration + `save_asset` round-trip，作为 CI 独立 job `pnpm test:integration`。
- 文档同步义务（命中 IMPROVEMENT.md 触发清单，属架构决策变更，须同一次提交完成，历史走 git）：
  - `AGENTS.md`：技术栈 SQLite→PostgreSQL；依赖增 `postgres` + `@aws-sdk/client-s3`；构建/测试命令补连接说明；Security 存储段改 MinIO。
  - `ARCHITECTURE.md`：§2 技术栈、§4 任务模型（pg 方言备注）、§7 数据模型（jsonb/pgEnum/timestamp）、§8 目录（删 `data/`、增 `migrations/`、`docker-compose.yaml`/`Dockerfile`）、§9 演进（多实例门槛降低）。
  - `IMPROVEMENT.md`：「实施计划文档」待办落地后划掉；不新增变更表。

## 实现拆解（建议顺序）

1. 加 `docker-compose.yaml`（postgres + minio + minio-init）+ `.env.example`。
2. 依赖：`postgres`、`drizzle-orm/postgres-js`、`@aws-sdk/client-s3`；`pnpm db:generate`/`db:migrate` 切 pg。
3. `src/server/db/schema.ts` 方言改造（jsonb / pgEnum / timestamp）。
4. `src/server/services/asset.ts` 重写为 S3；`files` route 改 presign/代理。
5. `src/lib/config.ts` 接 `DATABASE_URL` / `MINIO_*`。
6. `Dockerfile` + 可选 `compose.prod.yaml`。
7. 同步更新 `AGENTS.md` / `ARCHITECTURE.md`（同一次提交）。
8. 单测适配 + 可选 `test:integration`。
