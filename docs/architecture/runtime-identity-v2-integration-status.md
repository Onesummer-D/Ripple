# Runtime Identity v1.2 v2 接线状态

本文件是集成状态与接口核对清单，不修改规范。唯一权威规则见 [合同权威登记](./runtime-identity-contract-authority.md) 指向的冻结 v1.2 正文。

## 冻结接口摘录

### C+D 生产端

- 每个实际 render/evaluation 对每个身份 ID 读取当时的 `window.location.pathname`、`search`、`hash`。
- `runtimeInstanceId` 使用 v1.2 §5.2 的精确编码：

  ```text
  ripple-page-v2:<encodeURIComponent(JSON.stringify([pathname, search, hash]))>:<原 identity suffix>
  ```

- 保留原 identity suffix 的来源锚点；完整 sourceRef 必须能在 suffix 中精确追溯。
- 不能在采集时才给历史 DOM 补写当前页面 tuple，否则会掩盖未重新 render 的 stale DOM。

### C+D collector

- Snapshot 页面上下文来自实际采集时的浏览器 location 三元组。
- 每条 v2 ID 都按 v1.2 §5.2 解析规范编码，并将 render-time tuple 与 Snapshot page 三字段逐项比较。
- tuple 无效、不规范、页面不相等或来源锚点错误时，保留该 record 并追加 `route-namespace-stale`，不能升级 certainty。
- 旧 v1 ID 按 v1.2 §5.1 保持兼容但 fail-closed；采集器观察到同 pathname 的 search/hash 变化后，sticky ambiguity 只作用于 v1 ID。
- 混合或未知协议不能被标记为可证明；宿主仍独立验证协议、namespace、页面、来源版本和字节工件。

### A 宿主消费端

A 的 `runtimeIdentityNamespaceProven` 对归档 Snapshot 执行独立的 v1/v2 namespace 复核。Collector 的 reason、protocol 或容器自报摘要均不是宿主信任根。A 只在规范 tuple、sourceRef anchor、唯一 expectedPage、两侧各自绑定的 source digest 和已验证归档均成立时，允许单条 Assessment 进入实例证明判定。

## 当前实现状态

PR #48 当前提交包含 v1 的 query/hash fail-closed 与同文档观察到 URL 变化后的 stale 保留。其改动没有变更 `src/core/source-annotation.ts`，因此尚未提供 v1.2 v2 render-time emitter。PR #48 的浏览器回归不应被描述为 v2 正例。

PR #48 的已知旧 CI 失败为 `e2e/experience-real-flow.spec.ts` 第二次 Candidate 请求等待超时；这是独立于 namespace 的工作台回归。追加精确 POST path 与状态/响应体诊断后的 run 仍须以其最终 GitHub 结果裁定。

## A②-3 前置验收

待 C+D v2 emitter/collector 生产实现完成后，必须在真实 Chromium 页面覆盖普通路径正例、query 正例、HashRouter 正例、query+hash 正例，以及页面变化但 memoized DOM 未重新 render 的负例。正例要证明真实采集器返回规范 v2 Snapshot 和当前 tuple ID；负例要证明保留旧 ID 并追加 `route-namespace-stale`。之后在 A+C+D 独立组合分支运行定向、全量、Typecheck、Build 和 Linux Docker/Chromium CI。全部通过前不启动 A②-3，也不向 E③提供“真实宿主回执已可用”的结论。
