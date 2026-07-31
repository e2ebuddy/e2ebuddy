# e2ebuddy

AI-powered acceptance testing for deployed web products.

## Install

```bash
npm install --global e2ebuddy
```

Node.js 20 or newer is required.

## Configure

Configure an OpenAI-compatible endpoint:

```bash
export AI_PROVIDER=openai-compatible
export AI_API_KEY=your-api-key
export AI_BASE_URL=https://your-provider.example/v1
export AI_AGENT_MODEL=your-agent-model
export AI_VISION_MODEL=your-vision-model
export AI_REPORT_MODEL=your-report-model
```

Alternatively, configure Anthropic with `ANTHROPIC_API_KEY`,
`ANTHROPIC_AGENT_MODEL`, and optionally `ANTHROPIC_REPORT_MODEL`.

Keep real API keys and test credentials out of source control.

## Use

```bash
# Understand the target and write understanding.json
e2ebuddy explore https://example.com --brief "Product requirements"

# Run the complete acceptance pipeline
e2ebuddy test https://example.com --brief "Product requirements"

# Exercise browser perception and one safe action without an AI key
e2ebuddy executor-demo https://example.com
```

`test` writes structured results to `e2ebuddy-output/<runId>/` and browser
artifacts to `./storage`. The CLI uses local files and does not require a
database or queue service.

For authenticated test flows, pass credentials through environment variables:

```bash
E2EBUDDY_TEST_USERNAME='test-user' \
E2EBUDDY_TEST_PASSWORD='test-password' \
e2ebuddy test https://example.com --brief "Authenticated product flow"
```

Only run e2ebuddy against sites you are authorized to automate. Private and
loopback targets are blocked by default.

---

## 简体中文

e2ebuddy 是一个面向已部署 Web 产品的 AI 验收测试工具。

### 安装

```bash
npm install --global e2ebuddy
```

需要 Node.js 20 或更高版本。

### 配置

配置 OpenAI 兼容接口：

```bash
export AI_PROVIDER=openai-compatible
export AI_API_KEY=你的-api-key
export AI_BASE_URL=https://你的模型服务.example/v1
export AI_AGENT_MODEL=agent-model
export AI_VISION_MODEL=vision-model
export AI_REPORT_MODEL=report-model
```

也可以通过 `ANTHROPIC_API_KEY`、`ANTHROPIC_AGENT_MODEL` 和可选的
`ANTHROPIC_REPORT_MODEL` 使用 Anthropic。不要把真实 API Key 或测试账号
提交到源码仓库。

### 使用

```bash
# 理解目标网站并生成 understanding.json
e2ebuddy explore https://example.com --brief "产品需求"

# 执行完整验收流程
e2ebuddy test https://example.com --brief "产品需求"

# 不调用 AI，只验证浏览器感知和一次安全动作
e2ebuddy executor-demo https://example.com
```

`test` 将结构化结果写入 `e2ebuddy-output/<runId>/`，浏览器产物写入
`./storage`。CLI 使用本地文件，不需要数据库或队列服务。

测试登录流程时，通过环境变量传入测试账号：

```bash
E2EBUDDY_TEST_USERNAME='测试账号' \
E2EBUDDY_TEST_PASSWORD='测试密码' \
e2ebuddy test https://example.com --brief "登录后的产品流程"
```

只能对已获得自动化测试授权的网站运行 e2ebuddy。默认禁止访问私网和
loopback 地址。

### MCP Server（给 Cursor / Claude 等 Agent）

```bash
e2ebuddy mcp
# 或 monorepo:
pnpm -F e2ebuddy exec node dist/cli.js mcp
```

stdio MCP。工具：`e2ebuddy_doctor`、`e2ebuddy_setup`、`e2ebuddy_run`、`e2ebuddy_status`、`e2ebuddy_report`、`e2ebuddy_list_runs`。

Cursor `mcp.json` 示例：

```json
{
  "mcpServers": {
    "e2ebuddy": {
      "command": "pnpm",
      "args": ["-F", "e2ebuddy", "exec", "node", "dist/cli.js", "mcp"],
      "cwd": "/absolute/path/to/e2ebuddy"
    }
  }
}
```

全局安装后可用 `"command": "e2ebuddy", "args": ["mcp"]`。环境变量与 CLI 相同（`AI_*`）。不需要 Redis / Docker。

### 多平台打包（对齐 AICore ADE 习惯）

e2ebuddy 是 **Node CLI + 本地 Web**，不是 Electron。各平台需在**目标 OS 本机**打包（与 ADE 的 `build-dmg.sh` / `build-win.ps1` 相同：本机架构构建、产物进 `release/`）。

```bash
# macOS（仓库根目录）
./build-mac.sh              # 本机 arch
./build-mac.sh arm64        # Apple Silicon 标签
./build-mac.sh x64          # Intel 标签
./build-mac.sh all          # x64 + arm64 stamp
./build-mac.sh arm64 --bump
./build-mac.sh arm64 --set 0.2.0

# Windows（Git Bash）
./build-win.sh x64
# 或 PowerShell
.\build-win.ps1 x64

# Linux
./build-linux.sh x64

# 等价 pnpm 入口（底层 scripts/pack.mjs，仿 ADE pack-desktop.mjs）
pnpm pack:mac
pnpm pack:mac:arm64
pnpm pack:mac:x64
pnpm pack:win:x64
pnpm pack:linux:x64
pnpm pack -- --mac --arm64 --skip-smoke
```

产物：

| 文件 | 说明 |
|------|------|
| `release/e2ebuddy-<version>.tgz` | `npm pack` 主包（JS 可跨平台） |
| `release/e2ebuddy-<version>-<os>-<arch>.tgz` | 平台 stamp 副本 |
| `release/e2ebuddy-<version>-<os>-<arch>-buildinfo.json` | 宿主 OS/arch/Node 证明 |

安装 Playwright 浏览器仍在目标机执行：`e2ebuddy setup`。
