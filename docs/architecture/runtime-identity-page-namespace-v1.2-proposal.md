# Runtime Identity 页面 Namespace v1.2 提案

状态：C+D 提案，等待 A 会签。本文记录阶段一防线和阶段二接口边界，不代表 v1.2 已实现。

## 已确认的问题

当前 `ripple-runtime-identity/v1` 的 `data-ripple-instance` 只在渲染时嵌入 `pathname`。采集时的 `RuntimePageContext` 虽含 `pathname`、`search`、`hash`，host 对 `expectedPage` 的精确比较只能证明采样时浏览器 URL 相等，不能证明保留的 DOM 实例是在该完整页面身份下生成的。React.memo 或不重新渲染的组件可能保留旧 id。

## 阶段一防线

在 v1 下，只要采集时 `search` 或 `hash` 非空，就把实例身份按既有 record-level reason `route-namespace-stale` 降级为 `unknown`。该 reason 在此处表示“当前 pathname-only namespace 不能证明完整页面身份”，不声称 DOM 一定来自另一个页面。

这不删除 `sourceRef`、源码版本或 DOM 观测，不更改 SourceGraph、PageImpact、Scope、Candidate、Verification、Approval 或 TEXT 生命周期合同。host 仍可按现有规则区分可定位导航与实例身份证明；不得把该记录提升为 `instanceIdentityProven`。

## 阶段二接口提案（待 A 会签）

- 页面身份使用精确三元组 `[pathname, search, hash]`；不进行 URL 解码、参数排序或 hash 剥离等语义变换。
- `source-annotation` 在每次实际 render/evaluation 时读取三元组。提议用 `ripple-page-v2:` 加 URI 编码后的 JSON tuple 和无歧义分隔边界，再接原 owner/source/key 身份尾部。URI 编码仅负责表示 tuple，不对路由值做规范化。
- 新采集快照协议提议为 `ripple-runtime-identity/v2`。collector 解码并与采样三元组逐字段比对；旧 DOM 中的旧 tuple、缺失、格式歧义或版本不匹配均 fail-closed。
- v1 仍可用于源码导航/历史读取；任何非空 `search` 或 `hash` 下均不能用 v1 出具实例身份证明。
- React key-chain 编码、多实例唯一性和既有稳定 key 语义保持不变。此协议只证明 URL 三元组，不证明应用内部、非 URL 路由状态。

## 职责与 reason 边界

- C+D：实例 namespace 的生成、collector 解析与 record-level reason、真实 Chromium 证据。
- A：宿主评估、运行记录、可信归档、跨侧配对裁决及所有正式授权门控。
- E：只消费 A 的最终 host proof，不自行解析 namespace 或提升确定性。
- `RuntimeIdentityReason` 保持 13 项单 record 原因。`cross-side-assessment-mismatch` 是 pair-level mismatch，不能进入 record 的 `reasons`，也不能由 C+D collector 作为单侧采集原因产生。

待 A 决定是否接受 namespace 格式、协议标识、v1/v2 兼容策略，以及 A②-3 的集成前置条件。未经会签，不实施阶段二或修改 A 宿主记录 schema。
