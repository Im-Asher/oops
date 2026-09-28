# AGENTS.md — oops

Guidance for AI coding agents working in this repository.

## Project overview

**oops** is a text-to-image web system for e-commerce customers. Users describe
requirements (and upload product assets) in a chat box, pick a specialized
design agent, and receive generated product-detail images, posters, and
atmosphere/scene images.

Key characteristics:

- **Hybrid image generation** — posters / product-detail long images are
  rendered from agent-generated HTML and screenshotted server-side (precise
  text & layout control); atmosphere/scene images use pure text-to-image APIs
  (Seedream / Wanxiang).
- **Declarative agents** — every agent is a single config file under
  `src/server/agent/agents/` (system prompt + tool list + defaults). Adding an
  agent requires **no** frontend or runtime code changes.
- **All-in-one Next.js app** — no separate backend service. Route Handlers
  stream agent events via SSE. Server-only code lives in `src/server/` and is
  protected from client imports by ESLint.
- **Task-based generation** — all image work runs through an in-process task
  executor with concurrency limits; tasks are persisted and retryable.
- **MVP single-tenant** — simple passcode/invite-code auth with a cookie
  session. All tables carry a `userId` column so multi-tenancy can be added
  later without schema redesign.

See `docs/ARCHITECTURE.md` for the full architecture and data model.

## Documentation maintenance

- `docs/ARCHITECTURE.md` and this file must stay in sync with the actual
  implementation. When a change alters architecture decisions, agents/tools,
  commands, conventions, or security requirements, update the relevant doc
  **in the same change** — doc updates are part of the definition of done.
- Sync rules and deferred doc TODOs live in `IMPROVEMENT.md`; it is **not** a
  change log — doc-update history is tracked in git commits, never duplicated
  in a manual table. If docs and code conflict, code wins — fix the doc
  immediately.


## Tech stack (summary)

| Layer          | Choice                                              |
| -------------- | --------------------------------------------------- |
| Framework      | Next.js 16 (App Router, `proxy.ts` not middleware)  |
| Language       | TypeScript (strict)                                 |
| UI             | shadcn/ui + AI Elements + Tailwind CSS v4           |
| Agent runtime  | `@earendil-works/pi-agent-core` + `pi-ai`           |
| Database       | PostgreSQL via Drizzle ORM                          |
| Rendering      | `playwright-core` + headless Chromium               |
| Package mgr    | pnpm 11                                             |

## Project structure

```
src/
├── app/            # Thin routing shell: pages + Route Handlers only
├── server/         # SERVER-ONLY: domain (pure) + infra (impl) + agent runtime
│   ├── domain/     # sessions / messages / assets / tasks：实体 + 仓储 + 领域逻辑
│   ├── infra/      # db / storage(MinIO) / providers / render：具体技术实现
│   └── agent/      # 声明式 Agent 运行时（registry/runtime/agents/tools）
├── components/     # React components (client)
├── lib/            # Shared utilities (client-safe, 含 config)
└── types/          # Shared TypeScript types
```

**Import boundary (critical):** code under `src/server/` must never be
imported from client code (`src/app/**/page.tsx`, `src/components/**`, or any
`"use client"` module). This is enforced via ESLint `no-restricted-imports`.

## Build and test commands

```bash
pnpm install            # Install dependencies
pnpm dev                # Dev server (http://localhost:3000)
pnpm build              # Production build
pnpm start              # Start production server
pnpm lint               # ESLint (includes import-boundary rules)
pnpm typecheck          # tsc --noEmit
pnpm test               # Run unit tests (Vitest)
pnpm db:generate        # Generate Drizzle migrations
pnpm db:migrate         # Apply migrations (requires running Postgres + .env.local)
```

Package manager is **pnpm 10** — do not use npm/yarn. Lockfile is
`pnpm-lock.yaml` and must be committed.

## Code style guidelines

- **TypeScript strict mode.** No `any` in new code; use `unknown` + narrowing
  or proper types. Export explicit types from `src/types/` when shared.
- **Layering convention:**
  - `src/app/` is a thin shell: pages, `route.ts` handlers, minimal glue.
    Pure domain logic belongs in `src/server/domain/`; infrastructure
    (providers/storage/db/render) lives in `src/server/infra/` behind
    interfaces; `src/server/agent/` holds the declarative agent runtime.
  - Route Handlers validate input (zod), call server services, and return
    responses. They must stay short.
  - Shared UI helpers go in `src/lib/`; components in `src/components/`.
- **Naming:** files `kebab-case.ts(x)`; components/Types `PascalCase`;
  functions/variables `camelCase`; constants `SCREAMING_SNAKE_CASE`.
- **Agent definition (declarative):** one file per agent in
  `src/server/agent/agents/<agent-id>.ts` calling `defineAgent({...})`.
  System prompts live in `src/server/agent/prompts/<agent-id>.md` — never
  inline long prompts in code. Tools are referenced **by name** from the
  ToolRegistry; do not implement ad-hoc tools inside agent files.
- **Tools:** implementations live in `src/server/agent/tools/`, registered in
  the ToolRegistry with zod schemas for inputs. Tools return structured
  results; errors are returned as structured error payloads (the agent
  explains them in natural language) — never throw raw errors upward.
- **React:** function components only; `"use client"` only where needed;
  prefer server components. AI Elements components are the base for all chat
  UI — do not hand-roll message/attachment/tool UI.
- **Async tasks:** image generation and HTML rendering must go through
  `src/server/domain/tasks/task-executor.ts`. Never call provider APIs or
  Playwright directly from tools/route handlers with unbounded concurrency.
- **Comments:** explain *why*, not *what*. No narration comments.
- **Commits:** conventional commits (`feat:`, `fix:`, `chore:`, `docs:`...).

## Testing instructions

- Framework: **Vitest** (unit) with tests co-located or under `src/**/*.test.ts`.
- What to test:
  - **Unit (required for new logic):** agent registry loading, tool input
    schemas, services with mocked providers (image generation, render),
    session/auth helpers.
  - **Route handlers:** validate request parsing and error shapes with mocked
    services.
  - **Manual smoke path** after changes to the chat flow: login → create
    session → pick agent → send message → observe SSE stream → verify
    generated asset appears in gallery.
- Run `pnpm lint && pnpm typecheck && pnpm test` before declaring work done.
- Playwright screenshot rendering is covered by a service-level test using a
  minimal HTML fixture; keep it hermetic (no network).

## Security considerations

- **Secrets:** provider API keys (LLM, Seedream, Wanxiang) live only in
  `.env*` (gitignored). Access them exclusively through
  `src/lib/config.ts`; never log secrets or echo them into prompts/errors.
- **Auth:** cookie session with HttpOnly + Secure + SameSite=Lax. Every Route
  Handler must verify the session before touching DB or spawning tasks.
  MVP passcode/invite-code auth is intentionally minimal — do not weaken it
  further (no query-string tokens).
  **状态（2026-09-28，foundation 阶段）：认证有意延后**——当前全部请求以固定
  `OWNER_ID`（`src/lib/config.ts`）作为唯一用户，无任何会话校验；cookie-session
  认证待后续 change 补充，届时同步本节并恢复上面的校验要求。
- **Uploads:** validate MIME type and size on upload (images only, hard cap);
  store with generated filenames (never user-supplied names); serve user
  files through the `files` route with correct `Content-Type` and
  `Content-Disposition` to prevent stored-XSS via SVG/HTML.
- **HTML rendering sandbox (important):** agent-generated HTML is rendered in
  headless Chromium. Render with `--disable-js` where feasible, block
  outbound network requests except whitelisted asset hosts, and set
  per-render timeouts. Never render user/agent HTML with access to internal
  network URLs (SSRF) or local file paths.
- **Prompt-injection containment:** user-supplied text and file contents are
  untrusted input to the LLM. Tools must validate inputs with zod
  regardless of what the model asks for; the tool registry blocks any tool
  not declared for the active agent.
- **Content compliance:** text-to-image providers perform their own content
  moderation; surface provider rejections to the user verbatim (via the
  agent), and keep an entry-level keyword screen before LLM calls.
- **Error handling:** return structured errors to clients; never leak stack
  traces, SQL, or internal paths in responses. Log server-side with request IDs.


