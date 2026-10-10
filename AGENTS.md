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
  `src/server/agent/definitions/` (system prompt + tool list). Adding an
  agent requires **no** frontend or runtime code changes.
- **All-in-one Next.js app** — no separate backend service. Route Handlers
  stream agent events via SSE. Server-only code lives in `src/server/` and is
  protected from client imports by ESLint.
- **Task-based generation** — all image work runs through an in-process task
  executor with concurrency limits; tasks are persisted and retryable.
- **In-session memory & compact** — every turn rebuilds LLM context from the
  persisted `messages.transcript` view (dual-view: UI parts + LLM transcript on
  the same row), capped by a last-40 fallback. When the estimated context
  exceeds ~30k tokens (char-approx), older turns are compacted into a skeleton
  LLM summary (`sessions.summary` + `summarized_up_to` watermark, originals
  never deleted). Thinking blocks and base64 images are never persisted.
- **MVP single-tenant** — simple passcode/invite-code auth with a cookie
  session. All tables carry a `userId` column so multi-tenancy can be added
  later without schema redesign.

See `docs/ARCHITECTURE.md` for the full architecture and data model.

## Documentation maintenance

- `docs/ARCHITECTURE.md` and this file must stay in sync with the actual
  implementation. When a change alters architecture decisions, agents/tools,
  commands, conventions, or security requirements, update the relevant doc
  **in the same change** — doc updates are part of the definition of done.
- `docs/PRODUCT_DESIGN.md` is the product design constitution (principles &
  philosophy only — no implementation details, no status tracking). When a
  change makes a UX/product-principle decision, resolves a principle conflict,
  or would behave against a stated principle, update its affected sections
  **in the same change** (its own update rules live in §7 of that doc).
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
| Image gen      | DashScope 万相 `wan2.7-image` via pi-ai `createImagesProvider` (Token Plan China) |
| i18n           | next-intl（无 URL 路由的 cookie 模式）— `messages/zh.json` + `en.json`，typed messages |
| Package mgr    | pnpm 11                                             |

## Project structure

```
src/
├── app/            # Thin routing shell: pages + Route Handlers only
├── server/         # SERVER-ONLY: domain (pure) + infra (impl) + agent runtime
│   ├── domain/     # sessions / messages / assets / tasks：实体 + 仓储 + 领域逻辑
│   ├── infra/      # db / storage(MinIO) / providers / render：具体技术实现
│   ├── llm/        # LLM 装配层：模型目录 catalog（分文本/图像域+能力位）+ 角色解析 resolver（llm-assembly spec）；infra/providers 是其技术实现
│   └── agent/      # 声明式 Agent 运行时（registry/runtime/compact/transcript/definitions/tools）
├── components/     # React components (client)
├── i18n/           # next-intl 装配：locale.ts/request.ts locale 解析链 + messages.ts 词典装载与类型（client-safe）
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
  `src/server/agent/definitions/<agent-id>.ts` calling `defineAgent({...})`.
  System prompts live in `src/server/agent/definitions/prompts/<agent-id>.md` —
  never inline long prompts in code (the compact summary skeleton
  `session-summary.md` lives in the same directory). Tools are referenced
  **by name** from the ToolRegistry; do not implement ad-hoc tools inside
  agent files.
- **Tools:** implementations live in `src/server/agent/tools/`, registered in
  the ToolRegistry with zod schemas for inputs. Tools return structured
  results; errors are returned as structured error payloads (the agent
  explains them in natural language) — never throw raw errors upward.
- **i18n (next-intl, cookie locale — no URL routing):** every new user-visible
  UI string (layer A) MUST go through the dictionaries: `messages/zh.json` is
  the source of truth and `messages/en.json` mirrors its key structure exactly
  (a key-alignment unit test enforces this); update both **in the same
  change**. Keys are type-checked via `IntlMessages` (typo = typecheck error).
  Text layering — layer B (LLM conversation text: agent prompts, tool errors,
  provider rejections) never enters the dictionaries; prompts carry a
  language-following instruction so the agent replies in the user's language.
  Server error responses keep a Chinese `message` plus a stable `code`;
  clients render dictionary copy by `code` and fall back to `message` for
  unregistered codes. Inspiration-card presets are dictionary keys
  (`chat.presets.<agentId>.<key>`) resolved per request locale in
  `GET /api/agents` (en presets are English-written prompts, not literal
  translations). Bare-CJK strings in client UI code are lint-blocked
  (`no-restricted-syntax`, error level) — exemptions: comments, test files,
  `route.ts` handlers (server messages stay Chinese by design) and
  `src/server/**`.
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
    session → pick agent → send message (first message auto-titles the
    session) → observe SSE stream → verify the generating placeholder appears
    on the canvas and settles in place (image or failure card with retry) →
    select a canvas image to attach it as a reference chip and submit a
    follow-up edit (new version placed near the source) → chat result chip
    locates the item on canvas → switch/reload sessions to confirm messages,
    canvas items, draft and view restore (workspace saved locally per session)
    → deleting a session must remove its MinIO objects and asset rows (GC)
    → narrow-viewport check: chat/canvas toggle exclusively, session drawer.
  - **Poster flow** (needs `LLM_MAIN_MODEL` pointed at a vision model and
    Chromium installed): pick poster-designer → attach a product image →
    request a poster → verify the rendered poster appears in chat and canvas
    (vision input, HTML sandbox render) → select the poster as a reference
    for an edit round → reload to confirm restore.
- Run `pnpm lint && pnpm typecheck && pnpm test` before declaring work done.
- Playwright screenshot rendering is covered by a service-level test using a
  minimal HTML fixture; keep it hermetic (no network).

## Security considerations

- **Secrets:** provider API keys (LLM, Seedream, Wanxiang) live only in
  `.env*` (gitignored). Access them exclusively through
  `src/lib/config.ts`; never log secrets or echo them into prompts/errors.
- **Auth:** cookie session with HttpOnly + Secure + SameSite=Lax. Every Route
  Handler must verify the session before touching DB or spawning tasks — call
  `requireUser` (`src/server/auth/require-user.ts`) and return 401 on null.
  `proxy.ts` only redirects pages for UX (cookie presence check, never a
  security boundary — Edge has no DB access); the full verification (HMAC
  signature, expiry, `users.status=active`, session-version match) lives in
  `requireUser`. The session payload carries a token version (`tv`): on
  password change the same UPDATE writes the new scrypt hash and bumps
  `users.token_version`, and the response issues a fresh cookie — the current
  client stays logged in while all other sessions 401. Profile read/update and
  password change (`/api/profile*`) are `requireUser`-protected the same way;
  the password endpoint reuses per-IP rate limiting to blunt current-password
  brute force. Registration requires a valid invite code (conditional-UPDATE
  decrement prevents concurrent over-issue). Passwords are salted scrypt hashes
  (never plaintext). Keep it minimal — no query-string tokens.
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


