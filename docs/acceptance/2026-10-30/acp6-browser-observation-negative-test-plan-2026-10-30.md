# AC-P6 浏览器观测独立负例测试计划

状态：**计划稿，未执行**
依赖：`acp6-browser-observation/v1-draft`、A 的 `acp6-gap-taxonomy/v1` 第 8 节、Phase 0 ACCEPT 归档。
边界：只规划契约验证和证据校验，不修改生产 SourceGraph，不创建正式 VerificationRun。

## 1. 测试目标

验证浏览器观测是绑定到可信 run/check/side 和双侧 SourceGraph 摘要的补充事实，而不是新的授权器。每个负例都要证明：

- 不能由几何位置或截图相似推断源码来源；
- 不能由静态 `semantic-candidate` 边冒充 strict consumer edge；
- 不能在没有 consumer edge 时制造 `sourceUseRef`；
- 不能把旧、重复、跨 run、篡改或不完整记录加入当前验证证据；
- 不能绕过七项 Verification、Scope、Candidate、Approval、Apply、Rollback 门控。

## 2. 测试夹具与不变量

为每个测试准备一份最小 baseline/candidate 图、一个可信 run manifest、一个合法 observation JSON 和一个普通文件工件。夹具应固定：

- `projectId=P-demo`；
- `runId=run-001`，`checkId=check-home-desktop`；
- route `/home`，页面三元组 `/home`、空 search、空 hash；
- viewport `1440x900`，state `default`；
- baseline/candidate 各自独立的 `sourceDigest`、`graphDigest`；
- 一个 `token-use` node、一个精确 `sourceUse` 和一个 consumer edge；
- artifact bytes、相对路径和重算 SHA-256；
- 七项 assertion 均由既有可信 run 记录提供，测试不会自行把 observation 写入 assertions。

测试断言必须同时检查 `status`、`reasons`、`proof`、是否保留原始记录以及是否拒绝进入可信 receipt。所有负例的期望 `proof` 均为 `not-proven`。

## 3. 强制负例矩阵

| ID | 输入条件（只变异一项） | 预期拒绝原因（reason code） | 降级状态 | 所属门控 | 必须拒绝的升级 |
|---|---|---|---|---|---|
| OBS-N01 | 合法记录有 boundingBox，但删除 `sourceUseRef` | `geometry-only` | `unknown` | SourceGraph/source-mapping | geometry → source-proven |
| OBS-N02 | 两个不同 sourceUse 共享 boundingBox，交换一个 `relationId` | `runtime-location-conflict` | `unknown` | SourceGraph/source-mapping | 坐标 → 精确来源 |
| OBS-N03 | 合法 consumer edge 的 `certainty` 改为 `semantic-candidate` | `non-strict-consumer-edge` | `partial` | SourceGraph/source-mapping | candidate edge → strict edge |
| OBS-N04 | 只有静态 `css-cascade` candidate，没有 consumer relation | `missing-consumer-edge` | `partial` 或 `unknown` | SourceGraph/source-mapping | 静态 selector → source proof |
| OBS-N05 | 删除 consumer edge，但保留 DOM `runtimeInstanceId` | `runtime-instance-without-edge` | `unknown` | SourceGraph/source-mapping | DOM instance → consumer edge |
| OBS-N06 | `graphNodeId` 指向 declaration node，不是 token-use/source-use node | `declaration-node-not-source-use` | `unknown` | SourceGraph/source-mapping | 声明位置 → sourceUseRef |
| OBS-N07 | `sourceUseRef.relationId` 不存在于该 side 图 | `relation-not-in-graph` | `unknown` | graphDigest/source binding | 调用者字符串 → 图边 |
| OBS-N08 | `sourceUse` path/charOffset/byteOffset 与 relation 不一致 | `source-use-location-mismatch` | `unknown` | graphDigest/source binding | 部分位置匹配 → 精确 edge |
| OBS-N09 | candidate 侧 `sourceDigest` 改变，仍沿用旧记录 | `source-digest-mismatch` | `stale` | source binding | 旧源码证据 → 当前 candidate |
| OBS-N10 | candidate 侧 `graphDigest` 改变但 `sourceDigest` 不变 | `graph-digest-mismatch` | `stale` | graph binding | 旧图 → 当前图 |
| OBS-N11 | `runtimeFingerprint/collectorVersion` 不是本次受信版本 | `runtime-version-stale` | `stale` | Runtime Identity | 旧运行器 → 当前 run |
| OBS-N12 | 只有 candidate side，缺 baseline side | `missing-side` | `unavailable` | 双侧 Verification | 单侧 → 双侧证明 |
| OBS-N13 | artifact 文件缺失或 bytes 为空 | `missing-artifact` | `unavailable` | artifact integrity | 声明路径 → 工件存在 |
| OBS-N14 | artifact SHA-256 被篡改 | `artifact-hash-mismatch` | `unavailable` | artifact integrity | 调用者 SHA → 实际字节 |
| OBS-N15 | artifact path 越界、绝对路径或符号链接 | `artifact-path-invalid` | `unavailable` | artifact integrity | 路径字符串 → 可信工件 |
| OBS-N16 | 重算 SHA 后替换原始文件 | `artifact-changed-after-validation` | `unavailable` | artifact integrity | 校验时序漏洞 → receipt |
| OBS-N17 | 同一 tuple 出现两条不等价 observation | `duplicate-record` | `unknown` | run/check uniqueness | first/last wins |
| OBS-N18 | 同一 artifact path 对应不同 bytes | `duplicate-artifact-conflict` | `unknown` 或 `unavailable` | artifact integrity | 重复工件 → 可选工件 |
| OBS-N19 | record 的 `runId` 属于另一 run | `cross-run` | `unavailable` | VerificationRun binding | 跨 run 借用 |
| OBS-N20 | baseline/candidate 的 `checkId` 不同 | `cross-check` | `unavailable` | VerificationCheck binding | 跨 check 配对 |
| OBS-N21 | baseline/candidate 的 `side` 字段互换 | `side-mismatch` | `unavailable` | dual-side binding | 侧别声明 → 自动修复 |
| OBS-N22 | pathname 相同但 search/hash 与检查计划不符 | `page-context-mismatch` | `unknown` | route/page identity | 只看 pathname |
| OBS-N23 | viewport 宽高或 DPR 与 check 不符 | `viewport-mismatch` | `unknown` | responsive-layout | 相邻 viewport 代替 |
| OBS-N24 | state id 不符、摘要缺失或交互前后混用 | `state-mismatch` | `unknown` | interaction/state | 默认状态代替真实状态 |
| OBS-N25 | 旧 DOM/runtimeInstanceId 与当前 route namespace 不符 | `route-namespace-stale` | `stale` | Runtime Identity | 旧 DOM → 当前实例 |
| OBS-N26 | 无 key 的 map 实例伪报为 `stable-keyed-instance` | `identity-not-stable` | `unknown` | Runtime Identity | position-dependent → stable |
| OBS-N27 | `::before/::after` 记录普通 host element 为 strict owner | `pseudo-element-without-host-proof` | `unknown` | SourceGraph/source-mapping | 伪元素 → 普通 JSX owner |
| OBS-N28 | 动态 class 静态候选数为 1，但无运行时严格映射 | `dynamic-without-runtime-map` | `partial` | SourceGraph/source-mapping | 一对一数量 → source proof |
| OBS-N29 | `projectId` 改为临时 worktree 名，图摘要不变 | `logical-project-mismatch` | `unavailable` | project identity | 临时项目名 → 逻辑身份 |
| OBS-N30 | payload 自行添加 `source-proven` 或修改七项 assertion | `untrusted-capture` | `unavailable` | trusted executor/authorization | 调用者字段 → 授权 |
| OBS-N31 | Scope 包含页面但无 `source-proven` PageImpact | `page-impact-not-proven` | `partial` 或 `unknown` | Scope/source mapping | includedRefs → 来源证明 |
| OBS-N32 | 七项 assertion 任一为 risk/unknown/not-run/failed-to-run/stale | `required-verification-not-pass` | run 不得为 `passed` | Verification/Approval | 观测 → Verification/Approval 放行 |

## 4. 正例与边界例

正例只验证结构完整：双侧摘要、route/page tuple、viewport/state、工件重算、精确 `sourceUseRef` 和图边全部匹配时，单侧为 `complete`，pair 最多为 `runtime-observed`。它不应在没有 A 的正式 PageImpact/Verification 裁决时返回 `source-proven`。

边界例需要覆盖：

1. `source-proven` graph edge 存在但 `sourceProvenPageImpact()` 返回 `partial`：保留 `partial`；
2. 两侧均有完整 DOM 位置但只有 `semantic-candidate` edge：保留 `partial`；
3. one side complete、另一侧 missing strict edge：pair 为 `partial`；
4. 一侧 stale、另一侧 complete：pair 为 `stale`；
5. 两侧都有记录但有重复：pair 为 `unknown`，不选记录；
6. 正常页面截图通过但 `source-mapping` assertion 未通过：不得生成可审批 receipt。

## 5. 建议的执行层次（后续实现时）

### 5.1 纯契约单测

建议新增但本轮不创建：

- `src/core/acp6-browser-observation-contract.test.ts`：字段、状态机、digest、tuple 和边身份；
- `src/core/acp6-browser-observation-fixtures.ts`：合法记录和每个独立变异器；
- `src/core/acp6-browser-observation-artifact.test.ts`：越界、符号链接、哈希篡改、校验后替换。

每个测试只变异一个事实，避免“一个坏夹具触发多个拒绝原因”掩盖缺口。断言应验证具体 reason code，而非只断言 throw。表中的“所属门控”是该负例首先必须被拦截的边界；如果多个门控都能拒绝，测试仍要断言列出的主 reason code。

### 5.2 独立归档校验

建议新增但本轮不创建：

- `scripts/validation/validate-acp6-browser-observation.mjs`；
- `docs/acceptance/2026-10-30/acp6-browser-observation-fixtures/`。

脚本接受 manifest、baseline/candidate graph、observation records 和 artifact root，输出机器可读结果、每个 case 的 exit status、`status/reasons/proof` 和重算摘要。不得读取网络或自动下载外部 URL。

### 5.3 Verification 连接测试

待 A 冻结后，新增只读连接测试，验证 observation 只能附在可信 `VerificationRun` 上，不能改变七项 assertion、ScopeDecision、CandidateRecord、Approval 或 Apply。真实浏览器和四视口验收另行由负责人授权，不能用此计划的合成夹具代替。

## 6. 通过标准

- 正例结构校验通过，但 `proof` 不超过 `runtime-observed`；
- N01–N32 每个负例独立失败，且 reason code 与状态表一致；
- 任意 sourceDigest/graphDigest、run/check/side、route、viewport、state 或 artifact 不匹配都不会生成可信 receipt；
- 几何、静态 candidate、DOM instance、Scope includedRefs 都不能单独形成 strict consumer edge；
- 七项 Verification 和授权门控结果不被 observation payload 改写；
- 测试运行不修改生产 SourceGraph，不接线正式 VerificationRun，不写入 Approval/Apply 权限。

## 7. 停点

本测试计划完成后保持 HOLD。只有 C Phase 1 精确验收、A 协议会签冻结、独立外审复跑和正式授权都完成，才可建立实现分支并申请接线。
