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

The M0–M6 implementation is complete: browser execution, the five-stage AI pipeline, full CLI, deterministic defect fixture, Postgres/Redis/S3 platform, web report experience, Docker Compose, rate limiting, and cost telemetry. The three-site live-model exploration evaluation reached 100%; three fixture acceptance runs averaged 4.67/5 golden defects with at most one false positive per run. Build, strict type checking, linting, and all 43 automated tests pass. External validation remains: Docker end-to-end validation on a running daemon, the 10-user beta, and the manual npm publish. The npm package `e2ebuddy` (Apache-2.0, `private: false`) is published: the `latest` tag is `0.1.0` and the `beta` tag is `0.1.1`.

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

Publishing is deliberately manual. The package is already release-prepared: licensed under Apache-2.0 with `private: false` in `packages/cli/package.json`. After live-model, Docker, and beta-user acceptance, run:

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

#### Two layers of SSRF defense

1. **Application layer** — `packages/executor/src/url-safety.ts` resolves each target host and rejects loopback, RFC1918, link-local, CGNAT, multicast, reserved, and IPv6-local addresses before any navigation.
2. **Network layer (production worker)** — because DNS rebinding / TOCTOU means the packet that finally leaves the box can differ from what the app checked, the worker container also enforces a kernel-level egress policy as the last line of defense.

**Local Compose.** `docker compose up` runs the worker with `cap_add: [NET_ADMIN]` and the `worker-egress-entrypoint.sh` script, which installs an nftables policy **inside the worker's own network namespace** (it can never affect the host or other containers). Internal services (Postgres/Redis/MinIO) sit on a fixed `backplane` subnet (`10.31.7.0/24`) that is explicitly allowed; the public internet is allowed; loopback, all other private ranges, link-local, multicast, and the cloud-metadata address `169.254.169.254` are dropped. The mode is controlled by `WORKER_EGRESS_FIREWALL` (`enforce` default, `warn`, or `disabled`) and it fails closed: in `enforce` mode the worker refuses to start if the policy cannot be installed.

Verify it end-to-end after the stack is up:

```bash
./scripts/verify-egress.sh
```

It confirms the public internet and AI API are reachable, that metadata/loopback/RFC1918 targets are blocked at the network layer, and that the internal backplane services remain reachable.

**Managed platforms.** Where containers cannot hold `NET_ADMIN` (e.g. ECS/Fargate, Cloud Run), do not rely on the in-container policy — set `WORKER_EGRESS_FIREWALL=disabled` and instead enforce the same deny-list with a platform egress control: a VPC egress firewall / security group / NAT policy that blocks the link-local metadata address and all private ranges, or a dedicated forward proxy the worker must route through. The application-layer guard stays on in every deployment.

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

M0–M6 的代码实现已经完成：包括浏览器执行器、五阶段 AI 管道、完整 CLI、固定缺陷站、Postgres/Redis/S3 平台、Web 报告页、Docker Compose、限流与成本埋点。三站真实模型探索评测达到 100%，固定缺陷站三次验收平均检出 4.67/5、每次误报不超过 1。构建、类型检查、Lint 和 43 个自动化测试全部通过。仍需外部环境完成 Docker daemon 端到端验收、10 人内测和人工 npm 发布。npm 包 `e2ebuddy`（Apache-2.0，`private: false`）已发布：`latest` 标签为 `0.1.0`，`beta` 标签为 `0.1.1`。

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

发布是人工操作。包已完成发布准备：采用 Apache-2.0 许可证，`packages/cli/package.json` 中 `private` 已为 `false`。完成真实模型、Docker 和内测验收后执行：

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

#### 两层 SSRF 防护

1. **应用层** —— `packages/executor/src/url-safety.ts` 会解析每个目标主机，在任何导航之前拒绝 loopback、RFC1918、link-local、CGNAT、组播、保留地址和 IPv6 本地地址。
2. **网络层（生产 worker）** —— 由于 DNS rebinding / TOCTOU 会导致最终离开机器的数据包与应用层校验时不一致，worker 容器还在内核层强制执行出站策略，作为最终防线。

**本地 Compose。** `docker compose up` 会以 `cap_add: [NET_ADMIN]` 启动 worker，并通过 `worker-egress-entrypoint.sh` 在 **worker 自己的网络命名空间内** 安装一套 nftables 策略（不会影响宿主机或其他容器）。内部服务（Postgres/Redis/MinIO）位于固定的 `backplane` 子网（`10.31.7.0/24`）并被显式放行；公网放行；loopback、其余全部私网段、link-local、组播以及云元数据地址 `169.254.169.254` 全部丢弃。模式由 `WORKER_EGRESS_FIREWALL` 控制（默认 `enforce`，另有 `warn`、`disabled`），并且 fail-closed：`enforce` 模式下若无法安装策略，worker 拒绝启动。

在整套服务启动后端到端验证：

```bash
./scripts/verify-egress.sh
```

该脚本确认公网与 AI API 可达、元数据/loopback/RFC1918 目标在网络层被拦截，且内部 backplane 服务仍然可达。

**托管平台。** 在容器无法持有 `NET_ADMIN` 的环境（如 ECS/Fargate、Cloud Run），不要依赖容器内策略 —— 设置 `WORKER_EGRESS_FIREWALL=disabled`，改用平台级出站控制执行相同的拒绝清单：用 VPC egress 防火墙/安全组/NAT 策略拦截 link-local 元数据地址和全部私网段，或让 worker 强制经由专用正向代理出站。应用层防护在任何部署下都保持开启。

### 开发约定

- 严格按照 Milestone 顺序开发并通过对应验收标准
- 跨模块数据只能使用 `packages/shared` 导出的 Zod schema 和推导类型
- `brain` 不得直接导入 Playwright，`web` 不得直接调用 `brain`
- 规格之外的实现决策使用 `// SPEC-GAP:` 标注，并先更新规格

---
