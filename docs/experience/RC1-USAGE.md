# v0.5 RC1 内部使用说明

## 使用范围

RC1 只用于受控开发机和 loopback 环境。使用可丢弃的 React/Vite 测试工程，或先复制并备份工程目录。不要把本机 API、预演端口或工程路径开放给公网、局域网其他用户或未授权进程。

## 启动

```bash
npm ci
npm run dev
```

打开 `experience.html?adapter=real`。可以附加 `project=<本机 React/Vite 工程绝对路径>`，也可以在工作台表单中输入路径。

Node 22 和 Linux Docker/Chromium 是 CI 验收环境。Windows 本地无法连接 Docker 时，不把本地跳过写成通过，使用 Linux CI 结果作为真实浏览器依据。

## 推荐操作顺序

1. 分析工程并确认工程身份、源码摘要和预演状态。
2. 在 iframe 中开启画布点选，确认 SourceSelection 返回当前 `projectId`、`previewId`、`sourceDigest` 和 `sourceRef`。
3. 修改草稿，逐页完成 ScopeDecision；不要把 `unknown` 或 `semantic-candidate` 当成已授权页面。
4. 创建 Candidate，确认服务端返回 Candidate ID 和 patchHash。
5. 打开候选预演并运行四视口 Verification。
6. 阅读七项断言、Runtime Identity、配对和视觉证据状态。保留 `UNKNOWN`、`RISK`、`STALE`、未配对和版本不可证提示。
7. 只有最新 VerificationRun 为 passed 时才执行 Approval；Apply 和 Rollback 需要再次显式确认。
8. 刷新后从 VersionFilmstrip 和 History 回读，不把旧 Candidate 或旧 VerificationRun 复用于新 Candidate。

## 操作边界

- 真实 Approval、Apply 和 Rollback 是服务端生命周期动作，不是本地演示状态。
- CSS SourceGraph 第一切片只提供候选关系，不能自动授予 Token 编辑权限。
- 不要修改 `RIPPLE_WORKBENCH_STATE_DIR` 指向共享目录。
- 发生验证失败、候选过期、预演不可用或来源不完整时，保留原始提示和 API 响应摘要，停止继续操作并记录 Candidate/runId。
- 公网旧 Demo 仅作静态演示入口，不具备真实 Project API，不要用它验收 RC1。

## 退出和回滚

完成后关闭预演并销毁临时工程副本。Candidate 级回滚使用工作台的“回滚此修改”；版本级回滚由发布负责人将部署回退到 #64 已验收 HEAD，不在开发机上直接覆盖公共分支。
