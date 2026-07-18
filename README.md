<div align="center">

# e2ebuddy

**AI 造的产品，AI 来验收。**<br>
**Products built by AI, tested by AI.**

[简体中文](#简体中文) · [English](#english) · [实施规格](./E2EBUDDY_SPEC.md)

</div>

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

M0–M6 的代码实现已经完成：包括浏览器执行器、五阶段 AI 管道、完整 CLI、固定缺陷站、Postgres/Redis/S3 平台、Web 报告页、Docker Compose、限流与成本埋点。三站真实模型探索评测达到 100%，固定缺陷站三次验收平均检出 4.67/5、每次误报不超过 1。构建、类型检查、Lint 和 40 个自动化测试全部通过。仍需外部环境完成 Docker daemon 端到端验收、10 人内测和人工 npm 发布。npm 目标包名为 `e2ebuddy`，发布前继续保持 private。

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
  cli/        最终发布为 npm 包 e2ebuddy 的命令行入口
  db/         Prisma client、TestRun repository 与凭证加密
  storage/    local / S3 StorageAdapter
```

### 环境要求

- Node.js 20 或更高版本
- pnpm 11.8.0
- M0 不需要外部服务；后续完整运行需要 Postgres、Redis 和 S3 兼容存储

### 快速开始

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

本地启动完整平台（需要 Docker daemon 和 `.env`）：

```bash
docker compose up --build
```

打开 `http://localhost:3000`。MinIO Console 位于 `http://localhost:9001`。

常用命令：

| 命令 | 用途 |
|---|---|
| `pnpm build` | 构建整个 monorepo |
| `pnpm lint` | 检查所有 workspace |
| `pnpm test` | 运行全部测试 |
| `pnpm typecheck` | 运行 TypeScript strict 类型检查 |
| `pnpm -F shared test` | 只验证跨模块数据契约 |
| `pnpm eval:explore` | 对三个明确授权的自动化演示站运行探索评测 |
| `docker compose up --build` | 启动 Postgres、Redis、MinIO、worker 和 web |

### 环境变量

复制 [.env.example](./.env.example) 后填写所需配置。不要提交真实 API Key、测试账号或加密密钥。

| 分类 | 变量 |
|---|---|
| AI（默认 OpenAI 兼容） | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_AGENT_MODEL`, `AI_VISION_MODEL`, `AI_REPORT_MODEL`, `AI_THINKING` |
| Anthropic（可选兼容） | `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_MODEL`, `ANTHROPIC_REPORT_MODEL` |
| 数据 | `DATABASE_URL`, `REDIS_URL` |
| 存储 | `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` |
| 安全 | `CREDENTIALS_ENCRYPTION_KEY` |
| 限制 | `RUN_TIMEOUT_MS`, `CASE_STEP_LIMIT` |
| 限流 | `RUNS_PER_IP_PER_HOUR` |

本地 fixture 验收可临时设置 `E2EBUDDY_ALLOW_PRIVATE_TARGETS=true`。该开关仅影响 CLI，并把访问限制在初始 URL 的精确 origin；禁止在 worker 或生产环境开启。

`CREDENTIALS_ENCRYPTION_KEY` 必须是 base64 编码的 32 字节随机密钥：

```bash
openssl rand -base64 32
```

### 发布到 npm

发布是人工操作。完成真实模型、Docker 和内测验收后：先为项目选择许可证，将 `packages/cli/package.json` 的 `private` 改为 `false`，再执行：

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

### 开发约定

- 严格按照 Milestone 顺序开发并通过对应验收标准
- 跨模块数据只能使用 `packages/shared` 导出的 Zod schema 和推导类型
- `brain` 不得直接导入 Playwright，`web` 不得直接调用 `brain`
- 规格之外的实现决策使用 `// SPEC-GAP:` 标注，并先更新规格

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

The M0–M6 implementation is complete: browser execution, the five-stage AI pipeline, full CLI, deterministic defect fixture, Postgres/Redis/S3 platform, web report experience, Docker Compose, rate limiting, and cost telemetry. The three-site live-model exploration evaluation reached 100%; three fixture acceptance runs averaged 4.67/5 golden defects with at most one false positive per run. Build, strict type checking, linting, and all 40 automated tests pass. External validation remains: Docker end-to-end validation on a running daemon, the 10-user beta, and the manual npm publish. The target npm package is `e2ebuddy` and remains private until release approval.

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
  cli/        Command-line entry point eventually published as e2ebuddy on npm
  db/         Prisma client, TestRun repository, and credential encryption
  storage/    Local and S3 StorageAdapter implementations
```

### Requirements

- Node.js 20 or newer
- pnpm 11.8.0
- M0 requires no external services; the complete platform later requires Postgres, Redis, and S3-compatible storage

### Quick start

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

Start the complete local platform (requires a running Docker daemon and `.env`):

```bash
docker compose up --build
```

Open `http://localhost:3000`; the MinIO Console is available at `http://localhost:9001`.

Common commands:

| Command | Purpose |
|---|---|
| `pnpm build` | Build the entire monorepo |
| `pnpm lint` | Lint every workspace |
| `pnpm test` | Run all tests |
| `pnpm typecheck` | Run strict TypeScript checks |
| `pnpm -F shared test` | Validate cross-package runtime contracts only |
| `pnpm eval:explore` | Evaluate exploration on three automation-authorized demo sites |
| `docker compose up --build` | Start Postgres, Redis, MinIO, worker, and web |

### Environment variables

Copy [.env.example](./.env.example) and fill in the required values. Never commit real API keys, test credentials, or encryption keys.

| Category | Variables |
|---|---|
| AI (OpenAI-compatible by default) | `AI_PROVIDER`, `AI_API_KEY`, `AI_BASE_URL`, `AI_AGENT_MODEL`, `AI_VISION_MODEL`, `AI_REPORT_MODEL`, `AI_THINKING` |
| Anthropic (optional compatibility) | `ANTHROPIC_API_KEY`, `ANTHROPIC_AGENT_MODEL`, `ANTHROPIC_REPORT_MODEL` |
| Data | `DATABASE_URL`, `REDIS_URL` |
| Storage | `STORAGE_DRIVER`, `STORAGE_DIR`, `S3_*` |
| Security | `CREDENTIALS_ENCRYPTION_KEY` |
| Limits | `RUN_TIMEOUT_MS`, `CASE_STEP_LIMIT` |
| Rate limiting | `RUNS_PER_IP_PER_HOUR` |

For local fixture acceptance only, temporarily set `E2EBUDDY_ALLOW_PRIVATE_TARGETS=true`. It affects the CLI only and restricts access to the initial URL's exact origin; never enable it in workers or production.

`CREDENTIALS_ENCRYPTION_KEY` must contain 32 random bytes encoded as base64:

```bash
openssl rand -base64 32
```

### Publishing to npm

Publishing is deliberately manual. After live-model, Docker, and beta-user acceptance, choose a project license, change `private` to `false` in `packages/cli/package.json`, then run:

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

### Development rules

- Implement milestones in order and pass each milestone's acceptance criteria
- Use only Zod schemas and inferred types exported by `packages/shared` for cross-package data
- `brain` must not import Playwright directly; `web` must not call `brain` directly
- Mark decisions outside the specification with `// SPEC-GAP:` and update the specification first
