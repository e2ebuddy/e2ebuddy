<div align="center">

# e2ebuddy

**AI 造的产品，AI 来验收。**<br>
**Products built by AI, tested by AI.**

[English](#english) · [简体中文](#简体中文) · [实施规格](./E2EBUDDY_SPEC.md)

</div>

---

<a id="english"></a>

## English

e2ebuddy is a zero-configuration acceptance-testing platform for vibe coders. Give it a deployed website URL and, optionally, the original product brief and test credentials. An AI agent understands the product, plans and executes tests, and produces an evidence-backed report with prompts that can be pasted directly into an AI coding tool.

### Key capabilities

- Zero configuration: no test scripts, SDK, or CI integration required
- Three testing layers: functional flows, page content, and visual layout
- Requirement matching: identifies features missing from the original brief
- Evidence-driven results: captures step screenshots, accessibility trees, and videos
- Repair loop: creates an actionable fix prompt for every confirmed issue
- Low false-positive bias: uncertain findings are separated for human review and do not reduce the health score

### Project status

The M0–M6 implementation is complete: browser execution, the five-stage AI pipeline, full CLI, deterministic defect fixture, SQLite/Redis/S3 platform, web report experience, rate limiting, and cost telemetry. The three-site live-model exploration evaluation reached 100%; three fixture acceptance runs averaged 4.67/5 golden defects with at most one false positive per run. Build, strict type checking, linting, and all automated tests pass. The npm package `e2ebuddy` (Apache-2.0, `private: false`) is published: the `latest` tag is `0.1.0` and the `beta` tag is `0.1.1`.

### Architecture

```text
apps/worker ─▶ packages/brain ─▶ packages/executor ─▶ packages/shared
      │                                      ▲
      ├────────▶ packages/db ────────────────┤
      └────────▶ packages/storage ───────────┘

apps/web ─────▶ packages/db / packages/storage / packages/shared
```

Main directories:

```text
apps/
  web/        Web platform (M5)
  worker/     BullMQ test worker (M5)
  fixture/    Deterministic defect fixture and golden manifest
packages/
  shared/     Zod schemas, inferred types, and deterministic validators
  executor/   Playwright perception and action executor (M1)
  brain/      explore / plan / execute / judge / report (M2-M4)
  cli/        Command-line entry point published as e2ebuddy on npm
  db/         Prisma client (SQLite), TestRun repository, credential encryption
  storage/    Local and S3 StorageAdapter implementations
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
| Web UI | Next.js 16 + React 19 + Tailwind | Submit runs, progress, report pages |
| Job queue | BullMQ + Redis | **Web platform only** — not used by CLI |
| Database | Prisma + **SQLite** file DB | **Web platform only** — path via `DATABASE_URL=file:../data/e2ebuddy.db` |
| Object storage | Local filesystem or S3-compatible storage | CLI defaults to `STORAGE_DRIVER=local` |
| Credentials | AES-style encryption at rest | `CREDENTIALS_ENCRYPTION_KEY` (32-byte base64) |
| Tests | Vitest, ESLint, strict TypeScript | Shared contract tests in `packages/shared` |

**Dependency matrix**

| Capability | AI API | SQLite | Redis | S3 |
|---|---|---|---|---|
| CLI `explore` / `test` | Required | No | No | No (local disk) |
| CLI `executor-demo` | No | No | No | No |
| Local fixture `demo` | No | No | No | No |
| Web + Worker platform | Required | Yes | Yes | Optional (local or S3) |

### Runtime and deployment

Two supported ways to run e2ebuddy. Prefer **Mode A** for local acceptance testing without middleware.

#### Mode A — CLI (recommended, zero middleware)

Synchronous pipeline in-process. Outputs under `e2ebuddy-output/<runId>/`; screenshots under `./storage`.

| Requirement | Detail |
|---|---|
| Node.js ≥ 20, pnpm | via corepack |
| Playwright Chromium | installed by setup |
| `.env` AI keys | `AI_API_KEY` or Anthropic keys for explore/test |
| Database / Redis | **not required** |

```bash
# macOS / Linux
./run.sh setup
# edit .env → set AI_API_KEY (and model endpoints)
./run.sh cli explore https://example.com --brief "product brief"
./run.sh cli test https://example.com --brief "product brief"

# Windows PowerShell
.\run.ps1 setup
.\run.ps1 cli test https://example.com --brief "product brief"
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

#### Mode B — Web platform on the host (optional)

Async UX: browser form → BullMQ queue → worker → report pages. Needs a file SQLite DB and Redis; no Postgres.

| Component | Role |
|---|---|
| SQLite | Persist `TestRun` stages (understanding, plan, evidence, judgement, report) |
| Redis | BullMQ job queue + per-IP rate limit |
| Local disk or S3 | Screenshots / videos |
| `apps/web` | Next.js UI on `:3000` |
| `apps/worker` | Runs the five-stage pipeline |

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

Publish is **manual**. Consumers install the CLI only:

```bash
npm i -g e2ebuddy
e2ebuddy test https://example.com --brief "..."
```

No Redis/SQLite required for the published CLI path.

### Requirements

- Node.js 20 or newer
- pnpm 11.8.0
- CLI mode: AI provider credentials only (no external middleware)
- Web platform: SQLite file DB + Redis; storage local or S3-compatible

### Quick start

Preferred (no Redis or database service):

```bash
./run.sh setup
# fill AI_API_KEY in .env
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

Run only the shared contract tests:

```bash
pnpm -F shared test
```

Run the M1 executor demo:

```bash
pnpm -F e2ebuddy cli executor-demo https://example.com
```

The command prints the action result and screenshot artifact key. A blocked result is expected when the selected element would navigate off-origin or trigger another unsafe action.

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

Run the authorized three-site exploration evaluation:

```bash
pnpm eval:explore
```

Common commands:

| Command | Purpose |
|---|---|
| `./run.sh setup` / `.\run.ps1 setup` | Install, Playwright Chromium, build, prepare `.env` (no middleware) |
| `./run.sh cli ...` / `.\run.ps1 cli ...` | Run CLI explore/test/executor-demo |
| `./run.sh demo` | Local defect fixture on port 4173 |
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
| AI (OpenAI-compatible by default) | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_AGENT_MODEL`, `AI_VISION_MODEL`, `AI_REPORT_MODEL`, `AI_THINKING` | CLI explore/test, Web platform |
| Anthropic (optional compatibility) | `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_MODEL`, `ANTHROPIC_REPORT_MODEL` | Alternative to OpenAI-compatible |
| Database (SQLite) | `DATABASE_URL` (e.g. `file:../data/e2ebuddy.db`) | Web + Worker only |
| Queue / rate limit | `REDIS_URL` | Web + Worker only |
| Storage | `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` | CLI defaults to local; platform may use S3 |
| Security | `CREDENTIALS_ENCRYPTION_KEY` | Platform credentials; generate for Web |
| Limits | `RUN_TIMEOUT_MS`, `CASE_STEP_LIMIT` | Optional |
| Rate limiting | `RUNS_PER_IP_PER_HOUR` | Web only |

For local fixture acceptance only, temporarily set `E2EBUDDY_ALLOW_PRIVATE_TARGETS=true`. It affects the CLI only and restricts access to the initial URL's exact origin; never enable it in workers or production.

`CREDENTIALS_ENCRYPTION_KEY` must contain 32 random bytes encoded as base64:

```bash
openssl rand -base64 32
```

### Publishing to npm

Publishing is deliberately manual. The package is already release-prepared: licensed under Apache-2.0 with `private: false` in `packages/cli/package.json`. After live-model and beta-user acceptance, run:

```bash
npm login
npm whoami
pnpm build && pnpm test
pnpm -F e2ebuddy pack --pack-destination ./release
npm publish ./release/e2ebuddy-0.1.0.tgz --tag beta --access public
```

After beta validation, promote it with `npm dist-tag add e2ebuddy@0.1.0 latest`. Never publish automatically or commit an npm token.

### Security principles

e2ebuddy visits user-provided URLs, so every target page must be treated as untrusted input. The executor must defend against SSRF and private-network access, enforce same-origin navigation, resist prompt injection, encrypt and redact credentials, and block irreversible actions such as payments, deletion, publishing, and messaging. See [section 4.3 of the specification](./E2EBUDDY_SPEC.md#43-安全与边界) for the complete rules.

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
- 三层检查：覆盖功能流程、页面内容和视觉布局
- 需求对照：根据原始产品描述发现缺失功能
- 证据驱动：保存步骤截图、无障碍树和测试录屏
- 修复闭环：为每个确认的问题生成可直接粘贴给 AI 编程工具的修复 Prompt
- 低误报优先：置信度不足的问题单独进入“建议人工确认”，不影响健康分

### 当前状态

M0–M6 的代码实现已经完成：包括浏览器执行器、五阶段 AI 管道、完整 CLI、固定缺陷站、SQLite/Redis/S3 平台、Web 报告页、限流与成本埋点。三站真实模型探索评测达到 100%，固定缺陷站三次验收平均检出 4.67/5、每次误报不超过 1。构建、类型检查、Lint 和全部自动化测试均通过。npm 包 `e2ebuddy`（Apache-2.0，`private: false`）已发布：`latest` 标签为 `0.1.0`，`beta` 标签为 `0.1.1`。

### 架构

```text
apps/worker ─▶ packages/brain ─▶ packages/executor ─▶ packages/shared
      │                                      ▲
      ├────────▶ packages/db ────────────────┤
      └────────▶ packages/storage ───────────┘

apps/web ─────▶ packages/db / packages/storage / packages/shared
```

主要目录：

```text
apps/
  web/        Web 平台（M5）
  worker/     BullMQ 测试 worker（M5）
  fixture/    固定缺陷验收站与 golden manifest
packages/
  shared/     Zod schema、类型和确定性校验器
  executor/   Playwright 页面感知与动作执行器（M1）
  brain/      explore / plan / execute / judge / report（M2-M4）
  cli/        发布为 npm 包 e2ebuddy 的命令行入口
  db/         Prisma（SQLite）、TestRun repository 与凭证加密
  storage/    local / S3 StorageAdapter
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
| Web UI | Next.js 16 + React 19 + Tailwind | 提交任务、进度页、报告页 |
| 任务队列 | BullMQ + Redis | **仅 Web 平台**；CLI 不使用 |
| 数据库 | Prisma + **SQLite** 文件库 | **仅 Web 平台**；`DATABASE_URL=file:../data/e2ebuddy.db` |
| 对象存储 | 本地目录 或 S3 兼容存储 | CLI 默认 `STORAGE_DRIVER=local` |
| 凭证 | 落库加密 | `CREDENTIALS_ENCRYPTION_KEY`（32 字节 base64） |
| 测试 | Vitest、ESLint、strict TypeScript | `packages/shared` 契约测试 |

**依赖矩阵**

| 能力 | 大模型 API | SQLite | Redis | S3 |
|---|---|---|---|---|
| CLI `explore` / `test` | 需要 | 否 | 否 | 否（本地磁盘） |
| CLI `executor-demo` | 否 | 否 | 否 | 否 |
| 本地 fixture `demo` | 否 | 否 | 否 | 否 |
| Web + Worker 平台 | 需要 | 是 | 是 | 可选（本地或 S3） |

### 运行与部署方式

支持两种运行方式。本地验收优先使用 **方式 A**（零中间件）。

#### 方式 A — CLI（推荐，零中间件）

进程内同步跑完五阶段流水线。结果写入 `e2ebuddy-output/<runId>/`，截图写入 `./storage`。

| 要求 | 说明 |
|---|---|
| Node.js ≥ 20、pnpm | 可用 corepack |
| Playwright Chromium | setup 时安装 |
| `.env` 中的 AI Key | explore/test 需要 `AI_API_KEY` 或 Anthropic |
| 数据库 / Redis | **不需要** |

```bash
# macOS / Linux
./run.sh setup
# 编辑 .env，填写 AI_API_KEY 与模型地址
./run.sh cli explore https://example.com --brief "产品描述"
./run.sh cli test https://example.com --brief "产品描述"

# Windows PowerShell
.\run.ps1 setup
.\run.ps1 cli test https://example.com --brief "产品描述"
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

#### 方式 B — 本机 Web 平台（可选）

异步体验：网页表单 → BullMQ 入队 → worker 执行 → 报告页。需要 SQLite 文件库与 Redis，**不需要 Postgres**。

| 组件 | 作用 |
|---|---|
| SQLite | 持久化 `TestRun` 各阶段产物 |
| Redis | BullMQ 队列 + 按 IP 限流 |
| 本地磁盘或 S3 | 截图 / 录屏 |
| `apps/web` | Next.js，默认 `:3000` |
| `apps/worker` | 执行五阶段流水线 |

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

发布为**人工操作**。终端用户只装 CLI：

```bash
npm i -g e2ebuddy
e2ebuddy test https://example.com --brief "..."
```

发布版 CLI 路径同样不需要 Redis / SQLite。

### 环境要求

- Node.js 20 或更高版本
- pnpm 11.8.0
- CLI 模式：仅需大模型 API 凭证（无外部中间件）
- Web 平台：SQLite 文件库 + Redis；存储可用本地目录或 S3 兼容服务

### 快速开始

推荐（无 Redis、无独立数据库服务）：

```bash
./run.sh setup
# 在 .env 填写 AI_API_KEY
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

只运行 shared 契约测试：

```bash
pnpm -F shared test
```

运行 M1 executor demo：

```bash
pnpm -F e2ebuddy cli executor-demo https://example.com
```

命令会输出动作结果与 screenshot artifact key。跨域、支付、下载等危险动作被拦截属于正常结果。

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

运行三站 M2 评测：

```bash
pnpm eval:explore
```

常用命令：

| 命令 | 用途 |
|---|---|
| `./run.sh setup` / `.\run.ps1 setup` | 安装依赖、Playwright Chromium、构建、准备 `.env`（无中间件） |
| `./run.sh cli ...` / `.\run.ps1 cli ...` | 运行 CLI explore/test/executor-demo |
| `./run.sh demo` | 本地缺陷 fixture（4173 端口） |
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
| AI（默认 OpenAI 兼容） | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_AGENT_MODEL`, `AI_VISION_MODEL`, `AI_REPORT_MODEL`, `AI_THINKING` | CLI explore/test、Web 平台 |
| Anthropic（可选兼容） | `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_MODEL`, `ANTHROPIC_REPORT_MODEL` | 替代 OpenAI 兼容接口 |
| 数据库（SQLite） | `DATABASE_URL`（如 `file:../data/e2ebuddy.db`） | 仅 Web + Worker |
| 队列 / 限流 | `REDIS_URL` | 仅 Web + Worker |
| 存储 | `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` | CLI 默认 local；平台可用 S3 |
| 安全 | `CREDENTIALS_ENCRYPTION_KEY` | 平台凭证加密 |
| 限制 | `RUN_TIMEOUT_MS`, `CASE_STEP_LIMIT` | 可选 |
| 限流 | `RUNS_PER_IP_PER_HOUR` | 仅 Web |

本地 fixture 验收可临时设置 `E2EBUDDY_ALLOW_PRIVATE_TARGETS=true`。该开关仅影响 CLI，并把访问限制在初始 URL 的精确 origin；禁止在 worker 或生产环境开启。

`CREDENTIALS_ENCRYPTION_KEY` 必须是 base64 编码的 32 字节随机密钥：

```bash
openssl rand -base64 32
```

### 发布到 npm

发布是人工操作。包已完成发布准备：采用 Apache-2.0 许可证，`packages/cli/package.json` 中 `private` 已为 `false`。完成真实模型和内测验收后执行：

```bash
npm login
npm whoami
pnpm build && pnpm test
pnpm -F e2ebuddy pack --pack-destination ./release
npm publish ./release/e2ebuddy-0.1.0.tgz --tag beta --access public
```

完成 beta 验证后，用 `npm dist-tag add e2ebuddy@0.1.0 latest` 提升为 stable。不要从自动化流程直接发布，也不要提交 npm token。

### 安全原则

e2ebuddy 会访问用户提供的网址，因此执行器必须把目标页面视为不可信输入。实现必须包含 SSRF/私网地址拦截、同源导航限制、Prompt Injection 防护、凭证加密与脱敏，以及支付、删除、发布、发送等不可逆动作拦截。完整规则以 [规格书第 4.3 节](./E2EBUDDY_SPEC.md#43-安全与边界) 为准。

#### SSRF 防护

`packages/executor/src/url-safety.ts` 会解析每个目标主机，在任何导航之前拒绝 loopback、RFC1918、link-local、CGNAT、组播、保留地址和 IPv6 本地地址。生产环境还应在宿主机或网络边界执行相同的拒绝规则，以降低 DNS rebinding 和 TOCTOU 风险。

### 开发约定

- 严格按照 Milestone 顺序开发并通过对应验收标准
- 跨模块数据只能使用 `packages/shared` 导出的 Zod schema 和推导类型
- `brain` 不得直接导入 Playwright，`web` 不得直接调用 `brain`
- 规格之外的实现决策使用 `// SPEC-GAP:` 标注，并先更新规格

---
