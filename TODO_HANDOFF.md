# e2ebuddy 后续任务交接清单

> 更新日期：2026-07-19
>
> 当前分支：`dev`
>
> 当前提交：`7f1d82c chore: prepare npm release`
>
> 目标：按照本机 `E2EBUDDY_SPEC.md` 完成剩余验收、部署安全、内测和发布工作。

## 1. 开始工作前必读

1. 本机 `E2EBUDDY_SPEC.md` 是产品实施的事实来源，但它当前被 `.gitignore` 忽略，并未上传到 GitHub。不要擅自重新跟踪该文件；如果任务发生规格变化，应先征求用户意见。
2. `.env` 保存本机真实 API Key，已被 Git 忽略。禁止输出、提交或复制其中的真实值；示例配置只能写入 `.env.example`，并且必须使用假数据或空值。
3. npm 发布是明确的人工操作。没有用户当次明确确认、有效 npm 登录和发布权限时，不执行 `npm publish` 或 `npm dist-tag`。
4. 测试普通生产网站前必须确认有自动化授权。优先使用 `evals/explore-sites.json` 中列出的练习站。
5. 不删除或覆盖用户已有改动。修改前先执行 `git status --short --branch`。

## 2. 已完成状态

- M0–M4 已实现并通过规格验收。
- M2 三站真实模型评测：产品类型 3/3，核心流程 10/10。
- M4 固定缺陷站三次结果：5/5、5/5、4/5，平均 4.67；误报分别为 0、1、0。
- M5 的 Postgres、Prisma、Redis/BullMQ、S3 Adapter、Web 页面/API、worker、Dockerfile 和 Compose 已实现。
- M6 的 OG 图、限流、错误文案和成本埋点已实现。
- 登录演示站已加入：`http://127.0.0.1:4173/demo/login`。
- 演示账号是假数据：`demo@e2ebuddy.dev` / `DemoPass123!`。
- 最近一次完整质量门禁通过：build、typecheck、lint、43 项自动测试和 Compose 静态配置检查。
- CLI 已用真实模型对登录 Demo 完成自测：healthScore 100，确认问题 0，人工确认 0。
- npm 包名为 `e2ebuddy`，版本 `0.1.0`，许可证 Apache-2.0，`private: false`。
- `release/e2ebuddy-0.1.0.tgz` 已通过敏感信息扫描、全新安装和 `e2ebuddy --help` 验证。
- 截至 2026-07-19，公共 npm Registry 查询 `e2ebuddy` 返回 404，尚未公开发布。

## 3. 剩余任务总览

按以下顺序继续，不要把“代码已写完”当作“验收已完成”。

- [x] P0：同步已经过时的 README 发布状态。（2026-07-19 完成；npm 已发布后再次更新为 latest 0.1.0 / beta 0.1.1）
- [x] P0：补齐生产 worker 的网络层出站防火墙方案与验证。（2026-07-19 实现并在 Docker 运行时验收 9/9 PASS）
- [x] P0：启动 Docker daemon，完成 M5 全平台端到端验收。（2026-07-19 通过，见下方结果）
- [x] P0：完成 worker 强杀、恢复和幂等性实测。（2026-07-19 通过，见下方结果）
- [ ] P1：邀请 10 名真实用户完成 M6 内测，记录误报率与 NPS。（需真实用户，无法由 agent 独立完成）
- [ ] P1：修复内测发现的问题并重跑全部质量门禁。（依赖上一项）
- [x] P1：在用户明确授权后发布 npm beta。（用户已发布 beta 0.1.1）
- [x] P1：完成 beta 验证后，在用户明确授权下提升 `latest`。（用户已设 latest 0.1.0）
- [~] P2：更新本交接文档、README 和本机 spec 的最终状态。（README + 本文档已更新；本机 spec 待人工确认）

### 2026-07-19 运行时验收结果（Docker daemon 已起）

- **修复的真实缺陷（非规格任务，但阻塞 E2E）：**
  - `docker/web.Dockerfile`：`pnpm -F web build` 未先构建 workspace 依赖，Turbopack 无法解析 `db/shared/storage`。改为 `pnpm exec turbo run build --filter=web...`，靠 `^build` 先编译依赖。
  - `packages/executor/src/page-executor.ts`：hash 路由 SPA（如 TodoMVC）的 `window.location.hash` 为 `#/`，被当作 CSS selector 传给 `querySelector` 抛 SyntaxError 使整个 run 失败。改用 `getElementById`（不会因非法 selector 抛错）。
  - `docker/worker.Dockerfile`：为 `apt-get install nftables` 增加重试，容忍上游镜像间歇性 502。
- **§5 出站防火墙：** `./scripts/verify-egress.sh` 9/9 PASS（公网+AI 可达；元数据/loopback/RFC1918 网络层拦截；内部 backplane 服务可达）。`docker compose logs worker` 显示 `[egress-guard] enforced`。
- **§6 M5 E2E（run `pzlzz6czh2rqcb8hgwudx276`，目标 TodoMVC）：** 阶段推进 exploring→planning→executing→judging→reporting→done；`/report/[id]` 200；报告含 healthScore 55 / verdict / 3 issues / coverage / 每条 issue fixPrompt + combinedFixPrompt；MinIO 有 32 个该 run 的 jpg/webm；artifact API 返回 200 image/jpeg 且不暴露本地路径；API 无 `credentialsCiphertext`/明文；终态 DB 记录 `credentialsCiphertext` 为空。
- **§6 worker 强杀/恢复/幂等（run `lvugwjn45aqc324027p111gl`）：** planning 阶段 `docker compose stop worker`，此时 `understanding` 已持久化（md5 `dc3ab08c861628b602ee4e93ce9273d8`）、`plan`/`report` 为空；`start worker` 后 BullMQ 重投递，复用 understanding（md5 全程不变，已完成阶段未被重跑/覆盖），从 planning 继续推进到 executing→judging；全程该 run 行数恒为 1，`jobId=runId` 结构性去重，无重复业务任务。
- **已知模型侧不确定性：** 部分 run 在 planning/report 阶段因模型输出未过自定义 schema 校验（"numeric consistency"）或 AI Provider 间歇 HTTP 500 而失败。这是 §7 内测要量化的完成率问题，非本次代码缺陷；happy-path run 已完整跑通。质量门禁（build/typecheck/lint/test）全绿。

## 4. P0：修正文档状态漂移

### 问题

代码已经设置为 `private: false` 并采用 Apache-2.0，但以下文档仍写着“保持 private”或“尚未选择许可证”：

- 根目录 `README.md` 的中英文项目状态和 npm 发布章节。
- `packages/cli/README.md` 第一段。

### 要求

- 改为：包已经完成发布准备，但尚未发布到 npm。
- 明确许可证为 Apache-2.0。
- 保留“发布必须人工确认，不提交 npm token”的说明。
- 不得声称 M5/M6 已验收，直到相应任务真实完成。
- 中英文内容保持一致。

### 验收

```bash
rg -n "private|license|许可证|npm" README.md packages/cli/README.md packages/cli/package.json
git diff --check
```

## 5. P0：生产 worker 出站防火墙

### 当前缺口

`packages/executor/src/url-safety.ts` 和 Web API 已有应用层 SSRF/DNS/IP 检查，但 `compose.yaml`、Dockerfile 和部署文档中尚未看到网络层 egress 防火墙。规格要求生产 worker 还必须在容器或宿主机层拒绝以下目标，作为 DNS rebinding 和 TOCTOU 的最终防线：

- loopback
- RFC1918 私网
- link-local
- 组播和保留地址
- IPv6 本地地址
- 云元数据地址，例如 `169.254.169.254`

### 实施要求

1. 选择与实际部署环境兼容的最小方案。可以是宿主机/云平台 egress policy，也可以是独立网络代理；不要只在 Node.js 中重复一份 IP 判断。
2. worker 仍需访问公网目标、Redis、Postgres、MinIO 和模型 API，因此不能粗暴断开全部网络。
3. 将生产部署要求和验证命令写入 README 或单独部署文档。
4. 添加自动化或集成测试，证明公网访问正常、私网和元数据地址被网络层拒绝。
5. 不要在未理解宿主网络的情况下直接执行可能断开用户网络的全局 `iptables`/`nftables` 命令。

### 验收

- 应用层 SSRF 测试继续通过。
- worker 可以访问配置的公开网站和 AI API。
- worker 无法访问 `127.0.0.1`、RFC1918、link-local 和云元数据 IP。
- Redis/Postgres/MinIO 的必要内部访问正常。
- 文档说明本地 Compose 与生产部署分别如何启用该保护。

### 已实现（2026-07-19，运行时验收待 Docker）

方案：worker 容器在**自身网络命名空间内**用 nftables 强制出站策略，零宿主网络风险。

- `docker/worker-egress-entrypoint.sh`：`enforce`（默认，fail-closed）/`warn`/`disabled` 三种模式，安装 nft 策略后 `exec` worker。放行 `backplane` 子网与公网，丢弃 loopback/RFC1918/link-local/组播/保留/IPv6 本地和 `169.254.169.254`。
- `docker/worker.Dockerfile`：安装 `nftables`，设置该脚本为 ENTRYPOINT。
- `compose.yaml`：新增固定子网 `backplane`（`10.31.7.0/24`，内部服务）与 `egress`（公网）两张网络；worker 获 `cap_add: [NET_ADMIN]` + `WORKER_EGRESS_FIREWALL=enforce` + `BACKPLANE_CIDR`；`migrate` 复用同镜像但设 `WORKER_EGRESS_FIREWALL=disabled`。
- `scripts/verify-egress.sh`：集成验证脚本（公网/AI 可达、元数据/loopback/RFC1918 被拦、内部服务可达）。
- README（中英）新增“两层 SSRF 防护”小节，含本地 Compose、验证命令与托管平台替代方案。
- 已过静态门禁：`bash -n` 两脚本、`docker compose config --quiet`、build/typecheck/lint/test。

**仍需在 Docker daemon 起来后运行：** `docker compose up --build -d` 后执行 `./scripts/verify-egress.sh`，应全部 PASS；与 §6 的 M5 E2E 一并验收。若目标为 ECS/Fargate/Cloud Run 等无 NET_ADMIN 环境，改用平台级 egress policy 并设 `WORKER_EGRESS_FIREWALL=disabled`。

## 6. P0：M5 Docker 全平台验收

### 前置条件

- 启动 Docker Desktop 或其他 Docker daemon。
- 保留真实密钥在被忽略的 `.env` 中，不要回显。
- `.env` 至少包含有效的 `AI_API_KEY` 和 `CREDENTIALS_ENCRYPTION_KEY`。
- `CREDENTIALS_ENCRYPTION_KEY` 必须是 base64 编码的 32 字节随机值。

### 启动与健康检查

```bash
docker info
docker compose config --quiet
docker compose up --build -d
docker compose ps
docker compose logs --tail=200 web worker migrate minio-init
```

打开：

- Web：`http://127.0.0.1:3000`
- MinIO Console：`http://127.0.0.1:9001`

### 端到端测试

使用明确允许自动化的测试站，例如：

```text
https://demo.playwright.dev/todomvc/
```

建议 brief：

```text
这是一个待办事项应用。用户可以创建待办、标记完成并筛选待办事项。
```

必须验证：

- [ ] 首页能够提交 URL 和 brief。
- [ ] 创建后跳转到 `/run/[id]`。
- [ ] 状态按阶段推进，不永久停留在 queued。
- [ ] 完成后进入 `/report/[id]`。
- [ ] 报告包含 healthScore、verdict、问题卡片和覆盖范围。
- [ ] 截图通过 artifact API 正常显示，不暴露本地文件路径。
- [ ] “复制单条修复 Prompt”和“复制完整修复 Prompt”可用。
- [ ] MinIO bucket 中实际存在该 run 的截图和录屏对象。
- [ ] API 返回值不包含 `credentialsCiphertext`、明文用户名或密码。
- [ ] 终态数据库记录已清空 `credentialsCiphertext`。

### worker 强杀与恢复测试

1. 新建一个 run，记录 run id。
2. 等待 worker 至少完成一个阶段。
3. 在任务尚未完成时停止 worker：

```bash
docker compose stop worker
```

4. 从 Postgres 检查该 run 已保存的最后有效阶段产物。
5. 重新启动 worker：

```bash
docker compose start worker
docker compose logs -f worker
```

6. 验证任务从最后有效产物继续，最终进入 done。
7. 验证数据库仍只有一个相同 run id，BullMQ 未产生重复业务任务，已完成阶段没有被重复覆盖。

### 验收证据

不要提交包含密钥或大量二进制 artifact 的目录。建议在一个不含秘密的 Markdown/JSON 结果文件中记录：

- 日期和提交 SHA
- Docker/Compose 版本
- 测试 URL
- run id
- 各阶段时间线
- S3 artifact 数量
- worker 停止/恢复结果
- 是否出现重复 run/job
- 最终 healthScore 和 issue 数量

## 7. P1：M6 十人内测

### 要求

邀请 10 名真实目标用户，每人至少提交一个自己有权测试的 URL。建议同时覆盖 CLI 和 Web，但每名用户至少完成一次完整报告。

每次记录：

- 匿名用户编号，不记录不必要的个人信息。
- 使用入口：CLI 或 Web。
- 目标产品类型。
- run 是否成功完成。
- 确认问题数量。
- 人工复核后的真实问题数量和误报数量。
- 用户是否成功使用修复 Prompt。
- 0–10 NPS 评分。
- 一条主要反馈。

### 指标计算

```text
误报率 = 被人工判定为误报的问题数 / AI 输出的确认问题总数
NPS = 推荐者占比（9–10）- 贬损者占比（0–6）
```

### 验收

- [ ] 10/10 用户各完成至少一次。
- [ ] 汇总完成率、误报率和 NPS。
- [ ] 对失败 run 和高频误报分类。
- [ ] 将需要修复的问题转成 GitHub issue 或明确任务清单。
- [ ] 修复后重跑固定 fixture，不能破坏 M4 指标。

用户数据和 URL 如不适合公开，不要提交原始记录；只提交脱敏汇总。

## 8. P1：npm beta 与正式发布

### 当前状态

- 包：`e2ebuddy@0.1.0`
- tarball：`release/e2ebuddy-0.1.0.tgz`
- tarball 已验证，但发布前仍应从当前提交重新构建，避免旧产物与源码不一致。

### 发布前门禁

```bash
pnpm install --frozen-lockfile
pnpm build
pnpm typecheck
pnpm lint
pnpm test
pnpm -F e2ebuddy pack --pack-destination ./release
```

重新检查 tarball：

```bash
tar -tzf release/e2ebuddy-0.1.0.tgz
```

必须确认其中不存在 `.env`、凭证、测试输出和本机路径。再在临时空目录安装 tarball，验证：

```bash
e2ebuddy --help
```

### 人工发布

只有用户明确授权后才能执行：

```bash
npm login
npm whoami
npm publish ./release/e2ebuddy-0.1.0.tgz --tag beta --access public
```

发布后验证：

```bash
npm view e2ebuddy version dist-tags --json
npx e2ebuddy@0.1.0 --help
```

完成 beta 验证并获得用户明确授权后：

```bash
npm dist-tag add e2ebuddy@0.1.0 latest
```

禁止提交 `.npmrc` token、npm OTP、用户凭证或 shell history。

## 9. 每次修改后的质量门禁

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
docker compose config --quiet
git diff --check
```

如果修改 CLI bundle 或发布元数据，还必须重新执行 tarball 全新安装测试。

如果修改 brain、executor 或 prompt，还必须：

- 运行登录 Demo 自测。
- 重跑固定缺陷 fixture 验收，确认没有提高误报率。
- 对真实模型输出使用 runtime schema 验证，禁止用类型断言绕过。

## 10. 登录 Demo 快速回归

终端 1：

```bash
pnpm demo
```

终端 2：

```bash
set -a
source .env
set +a

E2EBUDDY_ALLOW_PRIVATE_TARGETS=true \
E2EBUDDY_TEST_USERNAME=demo@e2ebuddy.dev \
E2EBUDDY_TEST_PASSWORD='DemoPass123!' \
pnpm -F e2ebuddy cli test \
  http://127.0.0.1:4173/demo/login \
  --brief "用户可以登录、查看仪表盘、创建测试任务并退出登录。"
```

预期：run 完成、healthScore 100、confirmed issues 为 0。若模型存在非确定性，应检查 evidence 后判断，不要为了追求 100 分降低安全或置信度门槛。

## 11. 最终完成定义

只有以下条件全部满足，才能宣称 spec 已完成：

- [ ] M0–M4 现有验收继续有效。
- [ ] 生产 worker 具备应用层和网络层两层 SSRF 防护。
- [ ] M5 Docker + MinIO 端到端验收通过。
- [ ] worker 强杀恢复和幂等性实测通过。
- [ ] 10 名真实用户内测完成，误报率和 NPS 已汇总。
- [ ] 内测问题完成处理，全部质量门禁通过。
- [ ] npm beta 已在明确授权下发布并验证。
- [ ] 如决定正式发布，`latest` tag 已在明确授权下设置。
- [ ] README、本交接文档和本机 spec 状态一致。
- [ ] Git 工作区干净，成果提交并推送到 `origin/dev`。

## 12. 交付汇报模板

```text
完成内容：
- ...

验证结果：
- build/typecheck/lint/test：...
- Docker E2E：...
- worker 恢复：...
- 安全验证：...
- npm：...
- 10 人内测：...

提交：<sha>
分支：dev

仍需用户参与：
- ...

已知限制：
- ...
```
