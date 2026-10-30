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

测试断言必须同时检查 `status`、`primaryReasonCode`、排序后的 `secondaryReasonCodes[]`、脱敏 `diagnosticText`、`proof`、是否保留原始记录以及是否拒绝进入可信 receipt。表中的 reason code 是该单项变异的预期 primary；若夹具同时命中其它原因，secondary 必须按合同顺序保留且不能改变状态优先级。所有负例的期望 `proof` 均为 `not-proven`。

## 3. 强制负例矩阵

每行只变异一个事实。`触发方式` 是独立执行器应执行的具体变异；`证据/复现` 要求保留输入、输出和校验器版本，能在无网络环境重跑。

| 编号 | 输入与前置条件 | 触发方式 | 预期 reasonCode | 预期状态 | 必须拒绝的下游操作 | 测试证据及复现方法 | 所属门控 |
|---|---|---|---|---|---|---|---|
| OBS-N01 | 合法记录有 boundingBox，无严格图边 | 删除 `sourceUseRef`，保留 DOM 坐标 | `geometry-only` | `unknown` | 不得生成 source-mapping receipt | `valid-record.json` 变异后运行 `--case OBS-N01`，断言 primary/status | SourceGraph/source-mapping |
| OBS-N02 | 两个 sourceUse 共享坐标，图边均有效 | 交换一个 `relationId` | `runtime-location-conflict` | `unknown` | 不得用坐标恢复精确来源 | 固定双边 fixture，断言 relation 与位置冲突被保留 | SourceGraph/source-mapping |
| OBS-N03 | consumer edge 存在且其它字段合法 | 将 certainty 改为 `semantic-candidate` | `non-strict-consumer-edge` | `partial` | 不得升级为 strict consumer edge | 修改单字段并重算 envelope，断言 proof=`not-proven` | SourceGraph/source-mapping |
| OBS-N04 | 只有静态 css-cascade candidate | 移除所有 consumer relation | `missing-consumer-edge` | `partial` | 不得由 selector 或静态候选形成来源证明 | 图快照删除 edge，运行边存在性检查 | SourceGraph/source-mapping |
| OBS-N05 | 有 DOM `runtimeInstanceId`，无 consumer edge | 删除 edge，保留实例 ID | `runtime-instance-without-edge` | `unknown` | 不得把 DOM instance 当消费边 | 对比删除前后 sidecar，断言无 edge 写入 | SourceGraph/source-mapping |
| OBS-N06 | 图含 declaration node 与 token-use node | 把 `graphNodeId` 改为 declaration node | `declaration-node-not-source-use` | `unknown` | 不得把声明位置冒充 sourceUseRef | 图节点类型校验失败且无 receipt | SourceGraph/source-mapping |
| OBS-N07 | relationId 在另一 side 存在，在当前 side 不存在 | 改写 `sourceUseRef.relationId` | `relation-not-in-graph` | `unknown` | 不得接受调用者字符串指定的图边 | 使用 side-specific graph，断言查找返回空 | graphDigest/source binding |
| OBS-N08 | relation 有精确 sourceUse 位置 | 改写 path 或 charOffset 或 byteOffset 任一值 | `source-use-location-mismatch` | `unknown` | 不得以部分位置匹配通过 | 单字段 mutation，断言位置逐字节比较失败 | graphDigest/source binding |
| OBS-N09 | candidate 记录绑定旧 sourceDigest | 替换当前 candidate sourceDigest | `source-digest-mismatch` | `stale` | 不得把旧源码证据加入当前 run | manifest 与记录双重核对，保存 stale 输出 | source binding |
| OBS-N10 | candidate sourceDigest 不变，图关系已改动 | 使用旧 graphDigest | `graph-digest-mismatch` | `stale` | 不得把旧图绑定当前记录 | 运行 G2 图样本并比较 digest，断言拒绝 | graph binding |
| OBS-N11 | 受信 runtime manifest 已登记 | 换成旧 runtimeFingerprint 或 collectorVersion | `runtime-version-stale` | `stale` | 不得把旧运行器结果当当前实例 | manifest 版本矩阵重放，断言 stale | Runtime Identity |
| OBS-N12 | candidate side 合法，baseline side 缺失 | 删除 baseline record/artifact | `missing-side` | `unavailable` | 不得由单侧形成双侧证明 | pair 聚合输入只含 candidate，断言 unavailable | 双侧 Verification |
| OBS-N13 | artifact 路径已登记但文件为空或不存在 | 删除文件或写入 0 字节 | `missing-artifact` | `unavailable` | 不得由声明路径伪造工件存在 | artifact root fixture，断言 lstat/size 失败 | artifact integrity |
| OBS-N14 | artifact bytes 合法，manifest 有正确 SHA | 修改 manifest SHA 或 record SHA | `artifact-hash-mismatch` | `unavailable` | 不得信任调用者 SHA | 重算 SHA 与 manifest 比较，保留失败记录 | artifact integrity |
| OBS-N15 | artifact root 合法 | 使用 `..`、绝对路径、越界路径、符号链接或目录 | `artifact-path-invalid` | `unavailable` | 不得将路径字符串当可信工件 | 每种路径各跑一次，断言 no-follow 检查拒绝 | artifact integrity |
| OBS-N16 | 校验器已打开文件并开始 hashing | hash 后替换、截断或增长文件 | `artifact-changed-after-validation` | `unavailable` | 不得利用 TOCTOU 生成 receipt | 双线程或受控 hook 注入替换，断言身份/size 变化 | artifact integrity |
| OBS-N17 | 同一 project/run/check/side/page tuple 有一条合法记录 | 增加内容不同的第二条记录 | `duplicate-record` | `unknown` | 不得 first/last wins 或择优 | pair fixture 添加第二记录，断言两条均保留且拒绝聚合 | run/check uniqueness |
| OBS-N18 | 一个 artifact path 已归档 | 让同路径指向不同 bytes 或不同 hash | `duplicate-artifact-conflict` | `unknown` | 不得把冲突工件当可选备份 | manifest 索引冲突重放，断言无自动选择 | artifact integrity |
| OBS-N19 | 记录属于 run-001 | 改为 run-002 | `cross-run` | `unavailable` | 不得跨 run 借用记录 | 两份 run manifest 对照验证 | VerificationRun binding |
| OBS-N20 | 双侧应使用同一 check | 将 candidate checkId 改为另一检查 | `cross-check` | `unavailable` | 不得跨 check 配对 | check plan fixture 配对，断言 key 不相等 | VerificationCheck binding |
| OBS-N21 | side 字段分别为 baseline/candidate | 互换 side 或将两条标成同一 side | `side-mismatch` | `unavailable` | 不得自动修正侧别声明 | side binding validator 重放，断言不修复输入 | dual-side binding |
| OBS-N22 | route pathname 合法 | 改 search 或 hash，或删除其中一项 | `page-context-mismatch` | `unknown` | 不得只看 pathname 通过 check | route tuple 与计划逐字段比较 | route/page identity |
| OBS-N23 | check 固定 viewport 与 DPR | 改宽高或 deviceScaleFactor | `viewport-mismatch` | `unknown` | 不得用相邻 viewport 替代 | viewport fixture 变异，断言 pair 不通过 | responsive-layout |
| OBS-N24 | state id 与 digest 已登记 | 改 state、删除 digest 或混入交互后状态 | `state-mismatch` | `unknown` | 不得用默认状态代替真实状态 | state manifest 对照，断言 tuple 不匹配 | interaction/state |
| OBS-N25 | runtime instance 来自旧 route namespace | 将旧 namespace 实例放入当前 route | `route-namespace-stale` | `stale` | 不得把旧 DOM 绑定当前实例 | namespace manifest 变异，断言 stale | Runtime Identity |
| OBS-N26 | map 实例没有稳定 key | 把 position-dependent 实例标为 stable-keyed-instance | `identity-not-stable` | `unknown` | 不得把位置身份提升为稳定身份 | runtime identity fixture 断言 certainty 被拒绝 | Runtime Identity |
| OBS-N27 | 记录目标是 `::before`/`::after` | 将普通 host element 标为 strict owner | `pseudo-element-without-host-proof` | `unknown` | 不得把伪元素归因给普通 JSX owner | 伪元素 fixture 运行 host proof 校验 | SourceGraph/source-mapping |
| OBS-N28 | 动态 class 只有一个静态候选 | 不提供运行时严格映射 | `dynamic-without-runtime-map` | `partial` | 不得以一对一数量形成来源证明 | 删除 runtime map，保留候选数，断言 partial | SourceGraph/source-mapping |
| OBS-N29 | 图摘要合法但 projectId 应由宿主绑定 | 改为临时 worktree 名 | `logical-project-mismatch` | `unavailable` | 不得用临时目录名替代逻辑身份 | host registry 与 record 对照 | project identity |
| OBS-N30 | payload 未经可信 executor 注册 | 自行添加 `source-proven` 或改写七项 assertion | `untrusted-capture` | `unavailable` | 不得由调用者字段授予授权 | 无 executor receipt 的 payload 重放 | trusted executor/authorization |
| OBS-N31 | Scope 有 includedRefs，但无正式 PageImpact | 保留页面几何命中，删除 source-proven PageImpact | `page-impact-not-proven` | `partial` | 不得由 includedRefs 形成来源证明 | Scope/PageImpact fixture 对照，断言不写回 Scope | Scope/source mapping |
| OBS-N32 | 七项 assertion 至少一项为 risk/unknown/not-run/failed-to-run/stale | 尝试把 run 状态改成 passed 或 approved | `required-verification-not-pass` | `unavailable` | 不得生成 passed、Approval、Apply 或 Rollback | 只读 run fixture 变异，断言权威结果不变 | Verification/Approval |

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

脚本接受 manifest、baseline/candidate graph、observation records 和 artifact root，输出机器可读结果、每个 case 的 exit status、`status/primaryReasonCode/secondaryReasonCodes/diagnosticText/proof` 和重算摘要。不得读取网络或自动下载外部 URL。

### 5.3 Verification 连接测试

待 A 冻结后，新增只读连接测试，验证 observation 只能附在可信 `VerificationRun` 上，不能改变七项 assertion、ScopeDecision、CandidateRecord、Approval 或 Apply。真实浏览器和四视口验收另行由负责人授权，不能用此计划的合成夹具代替。

### 5.4 graphDigest 黄金样本复现

黄金样本定义在接口文档第 4.2 节，执行器必须把 canonical JSON 和摘要同时写入证据目录：

1. 运行 G0，断言摘要为 `a0a7e9c7e63e94a3fc3fe3e1d5b92e256f1fed3f4153f6b0410aa0f82c402093`；
2. 运行 G1，仅交换 nodes、edges 和 set 成员输入顺序，断言摘要和 canonical JSON 与 G0 完全相同；
3. 运行 G2，仅把 certainty 改为 `source-proven`，断言摘要为 `88b500e631d7dd302fe8f526bb9f10b682228857605184639f7a11dbde0d42f4`；
4. 运行 G3，加入 projectId、runId、runtimeFingerprint、host OS、artifact path 等排除字段，断言摘要与 G0 相同；
5. 分别输入重复 ID、未知端点、非法数字、显式 null、未知白名单字段和重复 unresolved，断言每一项独立拒绝，不先去重或静默丢弃。

复现命令由未来实现提供，但必须是无网络命令，例如 `node scripts/validation/validate-acp6-browser-observation.mjs --golden G0`。输出应包含输入 fixture SHA、canonical JSON SHA、digest、validator version 和 exit code。

### 5.5 工件 TOCTOU 与归档复现

在可信根内创建固定大小的普通文件，使用受控读取 hook 在 hash 前后分别执行替换、截断、增长和 rename；每次运行都保存 lstat、文件 ID、size、mtime、读取 SHA、manifest SHA 和最终 reason。预期均为 `artifact-changed-after-validation` 与 `unavailable`。符号链接、reparse point、目录、越界路径、损坏文件和 hash 丢失分别单独运行，预期为 `artifact-path-invalid`、`missing-artifact` 或 `artifact-hash-mismatch`。失败 bytes 和诊断必须保留，不能删除后生成成功记录。

### 5.6 只读 sidecar 复现

为每个负例记录变异前后的 SourceGraph、PageImpact、Candidate、ScopeDecision、VerificationRun、Approval、Apply 和 Rollback 快照摘要。执行器只应写入 sidecar artifact；对生产对象的写入尝试应被拒绝并记录 `untrusted-capture`。测试必须断言 `sourceUseRef`、`recordId`、DOM 坐标和普通 `runtimeInstanceId` 都不能替代正式 Runtime Identity 或授权结果。

## 6. 通过标准

- 正例结构校验通过，但 `proof` 不超过 `runtime-observed`；
- N01–N32 每个负例独立失败，且 reason code 与状态表一致；
- 任意 sourceDigest/graphDigest、run/check/side、route、viewport、state 或 artifact 不匹配都不会生成可信 receipt；
- 几何、静态 candidate、DOM instance、Scope includedRefs 都不能单独形成 strict consumer edge；
- 七项 Verification 和授权门控结果不被 observation payload 改写；
- 测试运行不修改生产 SourceGraph，不接线正式 VerificationRun，不写入 Approval/Apply 权限。

## 7. 停点

本测试计划完成后保持 HOLD。只有 C Phase 1 精确验收、A 协议会签冻结、独立外审复跑和正式授权都完成，才可建立实现分支并申请接线。
