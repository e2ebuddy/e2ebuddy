# e2ebuddy 后续任务交接清单

> 更新日期：2026-07-31
>
> 当前运行策略：本机 CLI 为默认入口；Web + Worker 仅采用宿主机进程运行。

## 开始工作前必读

1. 本机 `E2EBUDDY_SPEC.md` 是产品实施的事实来源，目前被 `.gitignore` 忽略。规格变化需要先征求用户意见。
2. `.env` 保存真实 API Key，已被 Git 忽略。禁止输出、提交或复制其中的真实值。
3. npm 发布和 dist-tag 修改必须获得用户当次明确授权。
4. 测试普通生产网站前必须确认有自动化授权。
5. 不删除或覆盖用户已有改动，修改前先执行 `git status --short --branch`。

## 当前能力

- CLI：`explore`、`test`、`executor-demo`，默认使用本地文件存储。
- 本地演示站：`pnpm demo`，地址为 `http://127.0.0.1:4173/demo/login`。
- Web + Worker：SQLite 持久化、Redis/BullMQ 队列、本地或外部 S3 兼容存储。
- npm 包：`e2ebuddy`，Apache-2.0，`private: false`。

## 推荐运行方式

```bash
./run.sh setup
./run.sh cli test https://example.com --brief "产品需求"
```

CLI 结果写入 `e2ebuddy-output/<runId>/`，截图和录屏写入 `./storage`。

需要 Web 平台时，在宿主机准备 Redis 并执行：

```bash
pnpm -F db db:generate
pnpm -F db db:push
pnpm -F worker start
pnpm -F web dev
```

## 剩余任务

- [ ] 邀请真实目标用户完成内测，汇总完成率、误报率和 NPS。
- [ ] 修复内测发现的问题并重跑质量门禁。
- [ ] 保持 README、交接文档和本机规格状态一致。

## 质量门禁

```bash
pnpm build
pnpm typecheck
pnpm lint
pnpm test
git diff --check
```

如果修改 brain、executor 或 prompt，还需要运行登录 Demo，并复核真实模型
输出是否符合 runtime schema。

## 登录 Demo 快速回归

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
