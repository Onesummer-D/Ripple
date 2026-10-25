# Runtime Identity 页面 Namespace v1.2 提案

状态：阶段一防线与 v1.2 namespace 接口方向已由 A 在 PR #48 完成架构会签；v2 emitter/collector 尚未实现。本文记录阶段一边界和阶段二接口建议，不替代正式 v1.2 合同。

## 已确认的问题

当前 `ripple-runtime-identity/v1` 的 `data-ripple-instance` 只在渲染时嵌入 `pathname`。采集时的 `RuntimePageContext` 虽含 `pathname`、`search`、`hash`，host 对 `expectedPage` 的精确比较只能证明采样时浏览器 URL 相等，不能证明保留的 DOM 实例是在该完整页面身份下生成的。React.memo 或不重新渲染的组件可能保留旧 id。

## 阶段一防线

在 v1 下，只要采集时 `search` 或 `hash` 非空，就把实例身份按既有 record-level reason `route-namespace-stale` 降级为 `unknown`。collector 还会在同一文档的连续采样之间记住页面三元组；若观察到 pathname 不变而 search/hash 改变，则把该 pathname 标为本次文档生命周期内有歧义，后续即使返回空 search/hash，也继续将 pathname-only 实例降级。该 reason 表示“当前 namespace 不能证明完整页面身份”，不声称 DOM 一定来自另一个页面。

这项历史记忆只覆盖 collector 实际观察到的路由状态。若 query/hash 导航完全发生在两次采样之间，v1 DOM 属性不含 render-time 三元组，collector 无法从最终 URL 还原该历史。因此本阶段不是完整页面来源证明；在 v1.2 的 render-time namespace 和 host 兼容合同会签、实现前，不能将其表述为对所有未采样导航都安全。

这不删除 `sourceRef`、源码版本或 DOM 观测，不更改 SourceGraph、PageImpact、Scope、Candidate、Verification、Approval 或 TEXT 生命周期合同。host 仍可按现有规则区分可定位导航与实例身份证明；不得把该记录提升为 `instanceIdentityProven`。

未知实例不进入 `createRuntimeSourceMap` 的精准实例映射；host 仍可使用保留的 `sourceRef` 解析 SourceGraph 节点并提供源码位置导航。工作台应区分“可打开源码位置”和“不可选为精准运行时编辑目标”，并说明需刷新/重新采集或等待可证明的页面身份，不应把拒绝精准点选呈现成源码映射丢失。

## 阶段二接口提案（待 A 会签）

- 页面身份使用精确三元组 `[pathname, search, hash]`；不进行 URL 解码、参数排序或 hash 剥离等语义变换。
- `source-annotation` 在每次实际 render/evaluation 时读取三元组。建议的 ID wire format 为 `ripple-page-v2:<encodeURIComponent(JSON.stringify([pathname, search, hash]))>:<原 identity suffix>`；编码 tuple 后的冒号是唯一边界，尾部保留原 owner/source/key 身份。URI 编码只表示 tuple，不规范化路由值。
- 新采集快照协议提议为 `ripple-runtime-identity/v2`。host 校验唯一边界、合法解码和重新编码的规范性，逐字段核对 namespace tuple、Snapshot.page 与 expectedPage，并验证 suffix 含 record 的精确 `sourceRef` anchor；缺失、格式歧义、旧 namespace 或版本不匹配均 fail-closed。
- v1 仍可用于源码导航/历史读取；任何非空 `search` 或 `hash` 下均不能用 v1 出具实例身份证明。只要 collector 在同一 pathname 观察到不同 search/hash，文档生命周期内该 pathname 的 v1 实例证明持续 fail-closed，包括回到先前 URL tuple 的情况。
- React key-chain 编码、多实例唯一性和既有稳定 key 语义保持不变。此协议只证明 URL 三元组，不证明应用内部、非 URL 路由状态。

## 职责与 reason 边界

- C+D：实例 namespace 的生成、collector 解析与 record-level reason、真实 Chromium 证据。
- A：宿主评估、运行记录、可信归档、跨侧配对裁决及所有正式授权门控。
- E：只消费 A 的最终 host proof，不自行解析 namespace 或提升确定性。
- `RuntimeIdentityReason` 保持 13 项单 record 原因。`cross-side-assessment-mismatch` 是 pair-level mismatch，不能进入 record 的 `reasons`，也不能由 C+D collector 作为单侧采集原因产生。

待 A 决定是否接受 namespace 格式、协议标识、v1/v2 兼容策略，以及 A②-3 的集成前置条件。未经会签，不实施阶段二或修改 A 宿主记录 schema。

