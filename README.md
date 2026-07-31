<div align="center">

# e2ebuddy

**AI 造的产品，AI 来验收。**<br>
**Products built by AI, tested by AI.**

[English](#english) · [简体中文](#简体中文)

</div>

---

<a id="english"></a>

## English

e2ebuddy is a zero-configuration acceptance-testing platform for vibe coders. Give it a deployed website URL and, optionally, the original product brief and test credentials. An AI agent understands the product, plans and executes tests, and produces an evidence-backed report with prompts that can be pasted directly into an AI coding tool.

### Key capabilities

- Zero configuration: no test scripts, SDK, or CI integration required
- Three running modes: CLI, local Web UI, and MCP server — no Redis or database required
- Three testing layers: functional flows, page content, and visual layout
- Requirement matching: identifies features missing from the original brief
- Evidence-driven results: captures step screenshots, accessibility trees, and videos
- Repair loop: creates an actionable fix prompt for every confirmed issue
- Low false-positive bias: uncertain findings are separated for human review and do not reduce the health score
- Real-time updates: SSE-based live pipeline phase progress in the Web UI
- MCP integration: use directly from Cursor, Claude Desktop, or any MCP-compatible tool

### Architecture

```text
                              packages/brain ─▶ packages/executor ─▶ packages/shared
                                     ▲                                      ▲
e2ebuddy web / e2ebuddy mcp ─────────┤                                      │
  (single-process local runtime)     ├────────▶ packages/storage ───────────┘
                                     │
e2ebuddy test / e2ebuddy explore ────┘
  (in-process CLI pipeline)
```

The local runtime (`packages/cli/src/runtime/`) combines an HTTP server, in-memory queue, JSON file store, and settings manager in a single Node.js process — no Redis, SQLite, or Docker required.

```text
packages/cli/src/
  cli.ts              Command routing
  commands/
    web.ts            Local Web UI launcher
    mcp.ts            MCP server launcher
    setup.ts          First-run setup (data dirs + Playwright)
    doctor.ts         Environment diagnostics
  runtime/
    server.ts         HTTP API + static SPA serving
    pipeline.ts       Acceptance pipeline (brain / demo mode)
    queue.ts          In-memory FIFO run queue
    store.ts          JSON file persistence (runs.json)
    settings.ts       Branding + LLM settings persistence
    report-markdown.ts Markdown report generation
  mcp/
    server.ts         MCP stdio transport
    tools.ts          6 MCP tools (doctor, setup, run, status, report, list_runs)
  lib/
    env.ts            .env file loader
    model.ts          Model client factory
    paths.ts          User data directory resolution
    port.ts           Port availability check
    open-browser.ts   Cross-platform browser opener
```

Main directories:

```text
apps/
  local-web/    Vite + React 19 + Tailwind + Zustand SPA (primary Web UI)
  fixture/      Deterministic defect fixture and golden manifest
  web/          Next.js 16 platform UI (legacy, requires Redis)
  worker/       BullMQ test worker (legacy, requires Redis)
packages/
  shared/       Zod schemas, inferred types, and deterministic validators
  executor/     Playwright perception and action executor
  brain/        explore / plan / execute / judge / report
  cli/          CLI + local runtime published as e2ebuddy on npm
  db/           Prisma client (SQLite), TestRun repository (legacy platform only)
  storage/      Local and S3 StorageAdapter implementations
```

### Tech stack

| Layer | Choice | Notes |
|---|---|---|
| Language / runtime | TypeScript 5.7, Node.js ≥ 20 | ESM packages in a monorepo |
| Workspace / build | pnpm 11.8 + Turborepo | `pnpm build` / `test` / `lint` / `typecheck` |
| Browser automation | Playwright (Chromium) | Perception (screenshot, a11y tree, interactables) + safe actions |
| AI pipeline | `packages/brain` five stages | explore → plan → execute → judge → report |
| Model clients | OpenAI-compatible (default) + Anthropic SDK | Multi-model: agent / vision / report |
| Contracts | Zod (`packages/shared`) | Cross-package schemas and structured LLM output |
| CLI distribution | `packages/cli` → npm `e2ebuddy` | Apache-2.0; local disk storage by default |
| Local Web UI | Vite + React 19 + Tailwind + Zustand | Workbench SPA served by `e2ebuddy web` |
| Local runtime | Node.js `http.Server` | Single-process: API + SPA + in-memory queue + JSON store |
| MCP server | `@modelcontextprotocol/sdk` | stdio transport; 6 tools for AI IDE integration |
| Persistence | JSON file (`runs.json`) | Under user data directory; no database required |
| Object storage | Local filesystem or S3-compatible storage | CLI defaults to `STORAGE_DRIVER=local` |
| Credentials | AES-style encryption at rest | `CREDENTIALS_ENCRYPTION_KEY` (32-byte base64) |
| Tests | Vitest, ESLint, strict TypeScript | Shared contract tests in `packages/shared` |

**Dependency matrix**

| Capability | AI API | Database | Redis | S3 |
|---|---|---|---|---|
| CLI `explore` / `test` | Required | No | No | No (local disk) |
| `e2ebuddy web` (local UI) | Required | No (JSON file) | No | No (local disk) |
| `e2ebuddy mcp` | Required | No (JSON file) | No | No (local disk) |
| CLI `executor-demo` | No | No | No | No |
| Local fixture `demo` | No | No | No | No |
| Legacy Web + Worker | Required | SQLite | Yes | Optional |

### CLI commands

```
e2ebuddy web [--host <host>] [--port <port>] [--no-open]
e2ebuddy mcp
e2ebuddy setup
e2ebuddy doctor
e2ebuddy executor-demo <url>
e2ebuddy explore <url> [--brief "..."]
e2ebuddy test <url> [--brief "..."]
```

| Command | Description |
|---|---|
| `web` | Start local Web UI on `http://127.0.0.1:6558` (no Redis/Docker) |
| `mcp` | Run as MCP server over stdio (Cursor / Claude Desktop) |
| `setup` | Idempotent first-run setup: user data dirs + Playwright Chromium |
| `doctor` | Environment diagnostics: version, Node, Playwright, AI config |
| `executor-demo` | Quick browser click demo, saves screenshot |
| `explore` | AI exploration of a site, writes `understanding.json` |
| `test` | Full acceptance pipeline: explore → plan → execute → judge → report |

### Runtime and deployment

#### Mode A — Local Web UI (recommended)

Single Node.js process with a full workbench SPA. Submit URLs, watch real-time SSE progress, view reports, retest individual issues. No Redis, no database, no Docker.

```bash
# Setup
./run.sh setup
# edit .env → set AI_API_KEY (and model endpoints)

# Start Web UI
./run-web.sh                    # production mode, http://127.0.0.1:6558
./run-web.sh --dev              # dev mode with Vite HMR on :5173 + API on :6558

# Or use the CLI directly
e2ebuddy web
e2ebuddy web --port 8080 --no-open
```

The Web UI includes:
- **Workbench**: URL input + brief, phase indicators, screenshot viewport, evidence panels (visual / DOM / a11y / network / console), timeline, report viewer
- **Settings**: branding (product name, logo upload), LLM configuration (provider, base URL, API key, models, test connection)
- **Retest per issue**: one-click retest focused on a specific confirmed issue
- **i18n**: English / Chinese toggle; dark / light theme

#### Mode B — CLI (headless, zero middleware)

Synchronous pipeline in-process. Outputs under `e2ebuddy-output/<runId>/`; screenshots under `./storage`.

```bash
./run.sh setup
# edit .env → set AI_API_KEY
./run.sh cli explore https://example.com --brief "product brief"
./run.sh cli test https://example.com --brief "product brief"
```

Equivalent without helper scripts:

```bash
corepack enable && pnpm install
pnpm -F executor exec playwright install chromium
cp .env.example .env   # then fill AI_*
pnpm build
set -a && source .env && set +a
pnpm -F e2ebuddy cli test https://example.com --brief "..."
```

#### Mode C — MCP server

Run as an MCP server over stdio for integration with Cursor, Claude Desktop, or any MCP-compatible tool.

```bash
e2ebuddy mcp
```

Available MCP tools: `e2ebuddy_doctor`, `e2ebuddy_setup`, `e2ebuddy_run`, `e2ebuddy_status`, `e2ebuddy_report`, `e2ebuddy_list_runs`.

Cursor `mcp.json` example:

```json
{
  "mcpServers": {
    "e2ebuddy": {
      "command": "npx",
      "args": ["-y", "e2ebuddy", "mcp"]
    }
  }
}
```

#### Mode D — Legacy Web + Worker platform (optional)

Async UX: Next.js form → BullMQ queue → worker → report pages. Requires SQLite and Redis. This mode uses `apps/web` (Next.js) and `apps/worker` (BullMQ), not the local runtime.

```bash
# .env essentials for platform mode
DATABASE_URL=file:../data/e2ebuddy.db   # relative to packages/db/prisma/
REDIS_URL=redis://localhost:6379
STORAGE_DRIVER=local
STORAGE_DIR=./storage
AI_API_KEY=...
CREDENTIALS_ENCRYPTION_KEY=...          # openssl rand -base64 32

pnpm -F db db:generate && pnpm -F db db:push
pnpm -F worker start    # terminal 1
pnpm -F web dev         # terminal 2 → http://localhost:3000
```

#### npm package

```bash
npm i -g e2ebuddy
e2ebuddy setup
e2ebuddy web                # open Web UI
e2ebuddy test https://example.com --brief "..."
```

No Redis/SQLite required for the published CLI path.

### Requirements

- Node.js 20 or newer
- pnpm 11.8.0
- CLI / Web / MCP modes: AI provider credentials only (no external middleware)
- Legacy platform mode: SQLite file DB + Redis; storage local or S3-compatible

### Quick start

```bash
./run.sh setup
# fill AI_API_KEY in .env
./run-web.sh               # open Web UI → http://127.0.0.1:6558
```

Or headless:

```bash
./run.sh cli test https://example.com --brief "This is a course website"
```

Or manual bootstrap:

```bash
corepack enable
pnpm install
pnpm -F executor exec playwright install chromium
cp .env.example .env

pnpm build
pnpm lint
pnpm test
```

Run the bundled login demo in one terminal:

```bash
pnpm demo
```

Open `http://127.0.0.1:4173/demo/login`, or test it from a second terminal with the documented fake account:

```bash
set -a
source .env
set +a
E2EBUDDY_ALLOW_PRIVATE_TARGETS=true \
E2EBUDDY_TEST_USERNAME=demo@e2ebuddy.dev \
E2EBUDDY_TEST_PASSWORD='DemoPass123!' \
pnpm -F e2ebuddy cli test http://127.0.0.1:4173/demo/login \
  --brief "Users can sign in, view the dashboard, create a test run, and log out."
```

Run a complete acceptance test. Put the real key in the git-ignored `.env`; never place it in the command line or commit it:

```bash
AI_PROVIDER=openai-compatible
AI_API_KEY=fill-this-locally
AI_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
AI_AGENT_MODEL=mimo-v2.5-pro
AI_VISION_MODEL=mimo-v2.5
AI_REPORT_MODEL=mimo-v2.5
AI_THINKING=disabled
```

```bash
set -a
source .env
set +a
pnpm -F e2ebuddy cli explore https://example.com --brief "This is a course website"
```

```bash
pnpm -F e2ebuddy cli test https://example.com --brief "This is a course website"
```

`explore` writes `understanding.json`. `test` writes understanding, plan, evidence, judgement, and report under `e2ebuddy-output/<runId>/`, with screenshots and videos stored through the configured StorageAdapter. Model metrics go to stderr without logging API keys or credentials.

When no AI key is configured, the pipeline runs in **demo mode** (fast placeholder) — useful for UI development and smoke testing.

Run the authorized three-site exploration evaluation:

```bash
pnpm eval:explore
```

Common commands:

| Command | Purpose |
|---|---|
| `./run.sh setup` / `.\run.ps1 setup` | Install, Playwright Chromium, build, prepare `.env` (no middleware) |
| `./run-web.sh` | Start local Web UI (`http://127.0.0.1:6558`) |
| `./run-web.sh --dev` | Start with Vite HMR for UI development |
| `./run.sh cli ...` / `.\run.ps1 cli ...` | Run CLI explore/test/executor-demo |
| `./run.sh demo` | Local defect fixture on port 4173 |
| `e2ebuddy web` | Start local Web UI via CLI |
| `e2ebuddy mcp` | Start MCP server (stdio) |
| `e2ebuddy doctor` | Check environment health |
| `pnpm build` | Build the entire monorepo |
| `pnpm lint` | Lint every workspace |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Run strict TypeScript checks |
| `pnpm -F shared test` | Validate cross-package runtime contracts only |
| `pnpm eval:explore` | Evaluate exploration on three automation-authorized demo sites |

### Environment variables

Copy [.env.example](./.env.example) and fill in the required values. Never commit real API keys, test credentials, or encryption keys.

| Category | Variables | Required by |
|---|---|---|
| UI branding | `E2EBUDDY_UI_PRODUCT_NAME`, `E2EBUDDY_UI_LOGO_PATH` | Optional; local Web UI |
| Local web runtime | `E2EBUDDY_WEB_HOST`, `E2EBUDDY_WEB_PORT` | Optional; defaults to `127.0.0.1:6558` |
| AI (OpenAI-compatible by default) | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_AGENT_MODEL`, `AI_VISION_MODEL`, `AI_REPORT_MODEL`, `AI_THINKING` | CLI explore/test, Web UI, MCP |
| Anthropic (optional compatibility) | `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_MODEL`, `ANTHROPIC_REPORT_MODEL` | Alternative to OpenAI-compatible |
| Storage | `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` | CLI defaults to local; platform may use S3 |
| Security | `CREDENTIALS_ENCRYPTION_KEY` | Platform credentials; generate for Web |
| Limits | `RUN_TIMEOUT_MS`, `CASE_STEP_LIMIT` | Optional |
| Rate limiting | `RUNS_PER_IP_PER_HOUR` | Legacy Web platform only |
| Database (SQLite) | `DATABASE_URL` | Legacy Web + Worker only |
| Queue / rate limit | `REDIS_URL` | Legacy Web + Worker only |

For local fixture acceptance only, temporarily set `E2EBUDDY_ALLOW_PRIVATE_TARGETS=true`. It affects the CLI only and restricts access to the initial URL's exact origin; never enable it in workers or production.

`CREDENTIALS_ENCRYPTION_KEY` must contain 32 random bytes encoded as base64:

```bash
openssl rand -base64 32
```

### Packaging and publishing

Cross-platform build scripts:

| Script | Platform |
|---|---|
| `./build-mac.sh` | macOS (x64 / arm64 / universal) |
| `./build-linux.sh` | Linux (x64 / arm64) |
| `./build-win.sh` / `build-win.ps1` | Windows (x64 / arm64) |

Each script builds the monorepo, verifies the CLI, runs a smoke test, and npm-packs to `release/`.

Or via pnpm:

```bash
pnpm pack:mac           # macOS universal
pnpm pack:mac:arm64     # macOS arm64 only
pnpm pack:win:x64       # Windows x64
pnpm pack:linux:x64     # Linux x64
```

Publishing is deliberately manual. After validation:

```bash
npm login
npm whoami
pnpm pack:mac
npm publish ./release/e2ebuddy-0.1.1.tgz --tag beta --access public
```

After beta validation, promote with `npm dist-tag add e2ebuddy@0.1.1 latest`. Never publish automatically or commit an npm token.

### Security principles

e2ebuddy visits user-provided URLs, so every target page must be treated as untrusted input. The executor must defend against SSRF and private-network access, enforce same-origin navigation, resist prompt injection, encrypt and redact credentials, and block irreversible actions such as payments, deletion, publishing, and messaging.

#### SSRF defense

`packages/executor/src/url-safety.ts` resolves each target host and rejects loopback, RFC1918, link-local, CGNAT, multicast, reserved, and IPv6-local addresses before any navigation. Production operators should also enforce the same deny-list at the host or network boundary to reduce DNS rebinding and TOCTOU risk.

### Development rules

- Implement milestones in order and pass each milestone's acceptance criteria
- Use only Zod schemas and inferred types exported by `packages/shared` for cross-package data
- `brain` must not import Playwright directly; `web` must not call `brain` directly
- Mark decisions outside the specification with `// SPEC-GAP:` and update the specification first

---

<a id="简体中文"></a>

## 简体中文

e2ebuddy 是一个面向 vibe coder 的零配置验收测试平台。提交一个已部署的网站 URL，以及可选的产品需求和测试账号，AI agent 会自动理解产品、规划测试、执行检查，并生成一份可以直接用于修复问题的报告。

### 核心能力

- 零配置：不要求测试脚本、SDK 或 CI 接入
- 三种运行模式：CLI、本地 Web UI、MCP 服务器 — 无需 Redis 或数据库
- 三层检查：覆盖功能流程、页面内容和视觉布局
- 需求对照：根据原始产品描述发现缺失功能
- 证据驱动：保存步骤截图、无障碍树和测试录屏
- 修复闭环：为每个确认的问题生成可直接粘贴给 AI 编程工具的修复 Prompt
- 低误报优先：置信度不足的问题单独进入"建议人工确认"，不影响健康分
- 实时进度：Web UI 通过 SSE 推送五阶段流水线实时进度
- MCP 集成：直接在 Cursor、Claude Desktop 等 MCP 兼容工具中使用

### 架构

```text
                              packages/brain ─▶ packages/executor ─▶ packages/shared
                                     ▲                                      ▲
e2ebuddy web / e2ebuddy mcp ─────────┤                                      │
  (单进程本地运行时)                  ├────────▶ packages/storage ───────────┘
                                     │
e2ebuddy test / e2ebuddy explore ────┘
  (进程内 CLI 管道)
```

本地运行时（`packages/cli/src/runtime/`）将 HTTP 服务器、内存队列、JSON 文件存储和设置管理整合在单个 Node.js 进程中 — 无需 Redis、SQLite 或 Docker。

```text
packages/cli/src/
  cli.ts              命令路由
  commands/
    web.ts            本地 Web UI 启动器
    mcp.ts            MCP 服务器启动器
    setup.ts          首次运行设置（数据目录 + Playwright）
    doctor.ts         环境诊断
  runtime/
    server.ts         HTTP API + 静态 SPA 服务
    pipeline.ts       验收管道（brain / demo 模式）
    queue.ts          内存 FIFO 运行队列
    store.ts          JSON 文件持久化（runs.json）
    settings.ts       品牌与 LLM 设置持久化
    report-markdown.ts Markdown 报告生成
  mcp/
    server.ts         MCP stdio 传输
    tools.ts          6 个 MCP 工具（doctor, setup, run, status, report, list_runs）
  lib/
    env.ts            .env 文件加载
    model.ts          模型客户端工厂
    paths.ts          用户数据目录解析
    port.ts           端口可用性检查
    open-browser.ts   跨平台浏览器打开
```

主要目录：

```text
apps/
  local-web/    Vite + React 19 + Tailwind + Zustand SPA（主 Web UI）
  fixture/      固定缺陷验收站与 golden manifest
  web/          Next.js 16 平台 UI（遗留，需要 Redis）
  worker/       BullMQ 测试 worker（遗留，需要 Redis）
packages/
  shared/       Zod schema、类型和确定性校验器
  executor/     Playwright 页面感知与动作执行器
  brain/        explore / plan / execute / judge / report
  cli/          CLI + 本地运行时，发布为 npm 包 e2ebuddy
  db/           Prisma（SQLite）、TestRun repository（仅遗留平台）
  storage/      local / S3 StorageAdapter
```

### 技术选型

| 层级 | 选型 | 说明 |
|---|---|---|
| 语言 / 运行时 | TypeScript 5.7、Node.js ≥ 20 | monorepo 内 ESM 包 |
| 包管理 / 构建 | pnpm 11.8 + Turborepo | `pnpm build` / `test` / `lint` / `typecheck` |
| 浏览器自动化 | Playwright（Chromium） | 页面感知（截图、a11y 树、可交互元素）+ 安全动作 |
| AI 流水线 | `packages/brain` 五阶段 | explore → plan → execute → judge → report |
| 模型接入 | 默认 OpenAI 兼容接口 + 可选 Anthropic SDK | 多模型：agent / vision / report |
| 数据契约 | Zod（`packages/shared`） | 跨包 schema 与 LLM 结构化输出 |
| CLI 分发 | `packages/cli` → npm `e2ebuddy` | Apache-2.0；默认本地磁盘存储 |
| 本地 Web UI | Vite + React 19 + Tailwind + Zustand | `e2ebuddy web` 服务的工作台 SPA |
| 本地运行时 | Node.js `http.Server` | 单进程：API + SPA + 内存队列 + JSON 存储 |
| MCP 服务器 | `@modelcontextprotocol/sdk` | stdio 传输；6 个工具用于 AI IDE 集成 |
| 持久化 | JSON 文件（`runs.json`） | 用户数据目录下；无需数据库 |
| 对象存储 | 本地目录 或 S3 兼容存储 | CLI 默认 `STORAGE_DRIVER=local` |
| 凭证 | 落库加密 | `CREDENTIALS_ENCRYPTION_KEY`（32 字节 base64） |
| 测试 | Vitest、ESLint、strict TypeScript | `packages/shared` 契约测试 |

**依赖矩阵**

| 能力 | 大模型 API | 数据库 | Redis | S3 |
|---|---|---|---|---|
| CLI `explore` / `test` | 需要 | 否 | 否 | 否（本地磁盘） |
| `e2ebuddy web`（本地 UI） | 需要 | 否（JSON 文件） | 否 | 否（本地磁盘） |
| `e2ebuddy mcp` | 需要 | 否（JSON 文件） | 否 | 否（本地磁盘） |
| CLI `executor-demo` | 否 | 否 | 否 | 否 |
| 本地 fixture `demo` | 否 | 否 | 否 | 否 |
| 遗留 Web + Worker | 需要 | SQLite | 是 | 可选（本地或 S3） |

### CLI 命令

```
e2ebuddy web [--host <host>] [--port <port>] [--no-open]
e2ebuddy mcp
e2ebuddy setup
e2ebuddy doctor
e2ebuddy executor-demo <url>
e2ebuddy explore <url> [--brief "..."]
e2ebuddy test <url> [--brief "..."]
```

| 命令 | 说明 |
|---|---|
| `web` | 启动本地 Web UI（`http://127.0.0.1:6558`，无需 Redis/Docker） |
| `mcp` | 以 MCP 服务器模式运行（stdio，支持 Cursor / Claude Desktop） |
| `setup` | 幂等首次运行设置：用户数据目录 + Playwright Chromium |
| `doctor` | 环境诊断：版本、Node、Playwright、AI 配置 |
| `executor-demo` | 快速浏览器点击演示，保存截图 |
| `explore` | AI 网站探索，生成 `understanding.json` |
| `test` | 完整验收流水线：explore → plan → execute → judge → report |

### 运行与部署方式

#### 方式 A — 本地 Web UI（推荐）

单 Node.js 进程 + 完整工作台 SPA。提交 URL、实时查看 SSE 进度、查看报告、单问题重测。无需 Redis、数据库或 Docker。

```bash
# 初始化
./run.sh setup
# 编辑 .env，填写 AI_API_KEY 与模型地址

# 启动 Web UI
./run-web.sh                    # 生产模式，http://127.0.0.1:6558
./run-web.sh --dev              # 开发模式，Vite HMR :5173 + API :6558

# 或直接用 CLI
e2ebuddy web
e2ebuddy web --port 8080 --no-open
```

Web UI 功能：
- **工作台**：URL 输入 + 需求描述、阶段指示器、截图视口、证据面板（视觉 / DOM / a11y / 网络 / 控制台）、时间线、报告查看器
- **设置**：品牌（产品名、Logo 上传）、LLM 配置（提供商、Base URL、API Key、模型、测试连接）
- **单问题重测**：一键重测特定确认问题
- **国际化**：中英文切换；深色 / 浅色主题

#### 方式 B — CLI（无头模式，零中间件）

进程内同步跑完五阶段流水线。结果写入 `e2ebuddy-output/<runId>/`，截图写入 `./storage`。

```bash
./run.sh setup
# 编辑 .env，填写 AI_API_KEY
./run.sh cli explore https://example.com --brief "产品描述"
./run.sh cli test https://example.com --brief "产品描述"
```

不用辅助脚本时：

```bash
corepack enable && pnpm install
pnpm -F executor exec playwright install chromium
cp .env.example .env   # 填写 AI_*
pnpm build
set -a && source .env && set +a
pnpm -F e2ebuddy cli test https://example.com --brief "..."
```

#### 方式 C — MCP 服务器

以 stdio 模式运行 MCP 服务器，用于 Cursor、Claude Desktop 等 MCP 兼容工具集成。

```bash
e2ebuddy mcp
```

可用 MCP 工具：`e2ebuddy_doctor`、`e2ebuddy_setup`、`e2ebuddy_run`、`e2ebuddy_status`、`e2ebuddy_report`、`e2ebuddy_list_runs`。

Cursor `mcp.json` 示例：

```json
{
  "mcpServers": {
    "e2ebuddy": {
      "command": "npx",
      "args": ["-y", "e2ebuddy", "mcp"]
    }
  }
}
```

#### 方式 D — 遗留 Web + Worker 平台（可选）

异步体验：Next.js 表单 → BullMQ 入队 → worker 执行 → 报告页。需要 SQLite 和 Redis。此模式使用 `apps/web`（Next.js）和 `apps/worker`（BullMQ），非本地运行时。

```bash
# 平台模式 .env 要点
DATABASE_URL=file:../data/e2ebuddy.db   # 相对 packages/db/prisma/
REDIS_URL=redis://localhost:6379
STORAGE_DRIVER=local
STORAGE_DIR=./storage
AI_API_KEY=...
CREDENTIALS_ENCRYPTION_KEY=...          # openssl rand -base64 32

pnpm -F db db:generate && pnpm -F db db:push
pnpm -F worker start    # 终端 1
pnpm -F web dev         # 终端 2 → http://localhost:3000
```

#### npm 包

```bash
npm i -g e2ebuddy
e2ebuddy setup
e2ebuddy web                # 打开 Web UI
e2ebuddy test https://example.com --brief "..."
```

发布版 CLI 路径同样不需要 Redis / SQLite。

### 环境要求

- Node.js 20 或更高版本
- pnpm 11.8.0
- CLI / Web / MCP 模式：仅需大模型 API 凭证（无外部中间件）
- 遗留平台模式：SQLite 文件库 + Redis；存储可用本地目录或 S3 兼容服务

### 快速开始

```bash
./run.sh setup
# 在 .env 填写 AI_API_KEY
./run-web.sh               # 打开 Web UI → http://127.0.0.1:6558
```

或无头模式：

```bash
./run.sh cli test https://example.com --brief "这是一个课程网站"
```

或手动初始化：

```bash
corepack enable
pnpm install
pnpm -F executor exec playwright install chromium
cp .env.example .env

pnpm build
pnpm lint
pnpm test
```

在一个终端启动内置登录演示站：

```bash
pnpm demo
```

浏览器打开 `http://127.0.0.1:4173/demo/login`，或在第二个终端使用公开的假账号直接测试：

```bash
set -a
source .env
set +a
E2EBUDDY_ALLOW_PRIVATE_TARGETS=true \
E2EBUDDY_TEST_USERNAME=demo@e2ebuddy.dev \
E2EBUDDY_TEST_PASSWORD='DemoPass123!' \
pnpm -F e2ebuddy cli test http://127.0.0.1:4173/demo/login \
  --brief "用户可以登录、查看仪表盘、创建测试任务并退出登录。"
```

运行完整验收。将真实 Key 写入已被 git 忽略的 `.env`，不要放进命令行或提交到仓库：

```bash
AI_PROVIDER=openai-compatible
AI_API_KEY=在本地填写
AI_BASE_URL=https://token-plan-cn.xiaomimimo.com/v1
AI_AGENT_MODEL=mimo-v2.5-pro
AI_VISION_MODEL=mimo-v2.5
AI_REPORT_MODEL=mimo-v2.5
AI_THINKING=disabled
```

```bash
set -a
source .env
set +a
pnpm -F e2ebuddy cli explore https://example.com --brief "这是一个课程网站"
```

```bash
pnpm -F e2ebuddy cli test https://example.com --brief "这是一个课程网站"
```

`explore` 生成 `understanding.json`；`test` 在 `e2ebuddy-output/<runId>/` 生成 understanding、plan、evidence、judgement 和 report，并将截图/录屏写入 StorageAdapter。模型调用指标写入 stderr，不记录 API Key 或用户凭证。

未配置 AI Key 时，管道以 **demo 模式**运行（快速占位输出），适用于 UI 开发和冒烟测试。

运行三站 M2 评测：

```bash
pnpm eval:explore
```

常用命令：

| 命令 | 用途 |
|---|---|
| `./run.sh setup` / `.\run.ps1 setup` | 安装依赖、Playwright Chromium、构建、准备 `.env`（无中间件） |
| `./run-web.sh` | 启动本地 Web UI（`http://127.0.0.1:6558`） |
| `./run-web.sh --dev` | 启动开发模式（Vite HMR） |
| `./run.sh cli ...` / `.\run.ps1 cli ...` | 运行 CLI explore/test/executor-demo |
| `./run.sh demo` | 本地缺陷 fixture（4173 端口） |
| `e2ebuddy web` | 通过 CLI 启动本地 Web UI |
| `e2ebuddy mcp` | 启动 MCP 服务器（stdio） |
| `e2ebuddy doctor` | 检查环境健康状况 |
| `pnpm build` | 构建整个 monorepo |
| `pnpm lint` | 检查所有 workspace |
| `pnpm test` | 运行全部测试 |
| `pnpm typecheck` | 运行 TypeScript strict 类型检查 |
| `pnpm -F shared test` | 只验证跨模块数据契约 |
| `pnpm eval:explore` | 对三个明确授权的自动化演示站运行探索评测 |

### 环境变量

复制 [.env.example](./.env.example) 后填写所需配置。不要提交真实 API Key、测试账号或加密密钥。

| 分类 | 变量 | 谁需要 |
|---|---|---|
| UI 品牌 | `E2EBUDDY_UI_PRODUCT_NAME`, `E2EBUDDY_UI_LOGO_PATH` | 可选；本地 Web UI |
| 本地 Web 运行时 | `E2EBUDDY_WEB_HOST`, `E2EBUDDY_WEB_PORT` | 可选；默认 `127.0.0.1:6558` |
| AI（默认 OpenAI 兼容） | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_AGENT_MODEL`, `AI_VISION_MODEL`, `AI_REPORT_MODEL`, `AI_THINKING` | CLI explore/test、Web UI、MCP |
| Anthropic（可选兼容） | `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_MODEL`, `ANTHROPIC_REPORT_MODEL` | 替代 OpenAI 兼容接口 |
| 存储 | `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` | CLI 默认 local；平台可用 S3 |
| 安全 | `CREDENTIALS_ENCRYPTION_KEY` | 平台凭证加密 |
| 限制 | `RUN_TIMEOUT_MS`, `CASE_STEP_LIMIT` | 可选 |
| 限流 | `RUNS_PER_IP_PER_HOUR` | 仅遗留 Web 平台 |
| 数据库（SQLite） | `DATABASE_URL` | 仅遗留 Web + Worker |
| 队列 / 限流 | `REDIS_URL` | 仅遗留 Web + Worker |

本地 fixture 验收可临时设置 `E2EBUDDY_ALLOW_PRIVATE_TARGETS=true`。该开关仅影响 CLI，并把访问限制在初始 URL 的精确 origin；禁止在 worker 或生产环境开启。

`CREDENTIALS_ENCRYPTION_KEY` 必须是 base64 编码的 32 字节随机密钥：

```bash
openssl rand -base64 32
```

### 打包与发布

跨平台构建脚本：

| 脚本 | 平台 |
|---|---|
| `./build-mac.sh` | macOS（x64 / arm64 / 通用） |
| `./build-linux.sh` | Linux（x64 / arm64） |
| `./build-win.sh` / `build-win.ps1` | Windows（x64 / arm64） |

每个脚本构建 monorepo、验证 CLI、运行冒烟测试，并 npm pack 到 `release/`。

或通过 pnpm：

```bash
pnpm pack:mac           # macOS 通用
pnpm pack:mac:arm64     # macOS arm64
pnpm pack:win:x64       # Windows x64
pnpm pack:linux:x64     # Linux x64
```

发布为人工操作。验证后执行：

```bash
npm login
npm whoami
pnpm pack:mac
npm publish ./release/e2ebuddy-0.1.1.tgz --tag beta --access public
```

完成 beta 验证后，用 `npm dist-tag add e2ebuddy@0.1.1 latest` 提升为 stable。不要从自动化流程直接发布，也不要提交 npm token。

### 安全原则

e2ebuddy 会访问用户提供的网址，因此执行器必须把目标页面视为不可信输入。实现必须包含 SSRF/私网地址拦截、同源导航限制、Prompt Injection 防护、凭证加密与脱敏，以及支付、删除、发布、发送等不可逆动作拦截。

#### SSRF 防护

`packages/executor/src/url-safety.ts` 会解析每个目标主机，在任何导航之前拒绝 loopback、RFC1918、link-local、CGNAT、组播、保留地址和 IPv6 本地地址。生产环境还应在宿主机或网络边界执行相同的拒绝规则，以降低 DNS rebinding 和 TOCTOU 风险。

### 开发约定

- 严格按照 Milestone 顺序开发并通过对应验收标准
- 跨模块数据只能使用 `packages/shared` 导出的 Zod schema 和推导类型
- `brain` 不得直接导入 Playwright，`web` 不得直接调用 `brain`
- 规格之外的实现决策使用 `// SPEC-GAP:` 标注，并先更新规格

---
