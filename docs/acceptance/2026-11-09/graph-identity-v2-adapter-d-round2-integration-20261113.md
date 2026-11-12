# Phase 1B-b D Round 2 合同整合

状态：`evidence-only / design-review`

本文件只整合 D 的 SourceMapping 合同，不申请 Phase 1B-b 生产实现权限。D 的 `ACCEPT WITH SCOPE` 只表示 D 合同本身可作为适配器设计输入，不表示 Adapter 已通过实现验收。

## 1. 精确基线与裁定

| 项目 | 精确引用 |
| --- | --- |
| D 合同提交 | `dd9c8b15251795ab7df8758fe64706532d9a1ce5` |
| D 合同 Tree | `d386e7cac2a3b64e4c347a5353a60f458be0b817` |
| D 裁定 | `ACCEPT WITH SCOPE` |
| C 设计基线 | `da89402738b3f46aeea1dc9eedaa5231a22fd571` |
| GraphDigestV2 纯模块 | `30030cd10c4eefbd976749be1b2b5df800bbf200` |
| 固定工程 | `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd` |

D 原合同历史文件保持不变。本轮在独立 C 设计证据中引用并细化 SM-01 至 SM-04；执行字段以 `graph-identity-v2-source-mapping-contract.json` 为准。

## 2. SM-03 采用方案 2

采用 D 推荐的 SM-03 方案 2：

- 顶层 `tokenUse.byteOffset`、`Relation.sourceUse.byteOffset`、`Mapping.sourceUse.byteOffset` 是必需字段，逐个从真实 UTF-8 源码快照复算并相互比较。
- `tokenUse.location.byteOffset` 可选。若生产者提供，必须与三个必需 byte offset 完全相等；缺失本身不构成拒绝。
- 不把 `location.byteOffset` 合成或追加到 GraphDigestV2 canonical 十字段；不改变 D G0 输入、GraphDigestV2 纯模块或既有 source span 原语义。
- `location.offset` 与 `sourceUse.charOffset` 仍表示 UTF-16 code-unit 偏移，必须在严格 UTF-8 解码后的文本上复算。

因此，位置字段的“存在性”与“字节一致性”分开验证：可选字段不能替代必需字段，也不能靠关系 ID、节点标签或字符串相等补足来源证明。

## 3. SM-02 严格 UTF-8 与偏移复算

Adapter 设计要求使用 fatal UTF-8 解码器：任何非法 UTF-8 字节序列返回 `source-utf8-invalid`，聚合状态为 `unavailable`，不得以 U+FFFD 替换后继续计算。合法的 U+FFFD 字符必须按其真实字节 `EF BF BD` 处理：一个 UTF-16 code-unit、三个 UTF-8 字节；它与非法字节序列严格区分。

适配器建立从 UTF-16 code-unit 边界到原始 UTF-8 byte boundary 的映射，并验证 token 起点及 span。落在 surrogate pair 中间的偏移、span 越界、byte span 与原始字节不一致，均为 `mapping-rejected` 的单条诊断并使聚合结果 `unavailable`。不做 LF/CRLF、NFC/NFD、大小写或路径归一化。

## 4. 全量 token-use 一一对应

覆盖域是 SourceGraph 中所有 `kind=token-use` 节点：

1. 每个 token-use 必须有且仅有一个 Mapping。
2. 每个 token-use 必须有且仅有一个唯一的 `reads`、`source-proven`、`file -> token-use` 锚点。
3. Mapping 数量必须与 token-use 节点数量相等；缺失、重复、冲突或额外 Mapping 均不能生成可用适配结果。
4. `sourceRef`、`graphNodeId`、`sourceAnchorRelationId` 和 `sourceUse` 必须来自同一真实节点/关系，不能由数组顺序或关系标签猜测。
5. 没有 token-use 节点时，`sourceMappings` 必须为空，覆盖检查成功；这是零 token-use 的完整行为，不是缺失证据。

声明节点、`semantic-candidate` 消费边、`css-cascade` 边和运行时消费者不属于本轮 SourceMapping 覆盖域，也不会因 Mapping 存在而升级为严格消费者证明。

## 5. 聚合状态与诊断优先级

只保留三种聚合状态，优先级固定为：

`rejected` > `unavailable` > `available-content-only`

- `rejected`：结构非法、未知字段、重复 ID、未知端点等输入错误；不计算摘要。
- `unavailable`：结构合法但快照、严格 UTF-8、host registry、TOCTOU、必需 byte proof 或完整 Mapping 覆盖无法证明；保留 Graph 与 unresolved 诊断，不输出可信适配结果。
- `available-content-only`：十字段、不可变字节、全量 Mapping、registry 绑定均通过；只表示纯内容摘要可复算，不表示 host trust、source-proven、runtime-proven 或授权。

`mappingDecision` 只允许 `accepted` 或 `mapping-rejected`。`mapping-rejected` 是单条诊断，不是新的聚合状态；出现它时聚合结果必须是 `unavailable`。未知字段或 malformed canonical Graph 仍优先归入 `rejected`，不能被 mapping 诊断覆盖。

## 6. 与方案 A、B 的兼容边界

### 方案 A：外部不可变快照 + 只读 Adapter

方案 A 不修改 `project.ts`。调用方必须先建立 exact checkout、Root Tree、tracked file set 和 OS 级不可写/写时复制快照；Analyzer 仍从该快照路径读取，Adapter 只使用同一批冻结字节做 SourceMapping 复核。若环境只能提供普通可写目录、无法证明读取期间字节不变，结果必须是 `unavailable`，不能假设 `analyzeProject()` 已接受冻结字节。

### 方案 B：FrozenSourceSnapshot 生产接线

若不能提供 OS 级不可变快照，或必须证明每次 parser read 都来自同一 byte buffer，才转为方案 B。方案 B 需要新的生产 API/文件白名单，使 Analyzer 接受 `FrozenSourceSnapshot` 或等价只读 byte provider，并禁止内部重新读取磁盘。方案 B 仍必须执行相同 SM-01 至 SM-04、全量 token-use 覆盖和状态优先级；它不是放宽证明规则的替代方案。

以下字段依赖快照实现方式，当前均为设计候选：`snapshot.rootTree`、`snapshot.trackedFileSet`、`snapshot.fileBytes`、`snapshot.fileSha256`、`snapshot.sourceDigest`、`snapshot.toctouCheck`。Option A 由外部快照提供这些字段；Option B 由新生产接口提供同一语义。两方案均不得从本地路径直接升级可信 `projectId`。

## 7. E 重算责任与边界

E 可以按同一份冻结 GraphDigestV2 合同独立重算 canonical bytes 和 domain-separated digest，并与 C/D 输出比对。E 不得重定义 digest、追加 Producer Evidence/Policy 字段到 canonical GraphDigestV2，也不能跳过 SourceMapping、source snapshot、host registry 或 producer evidence 的来源校验。重算相等只证明内容摘要相等；缺少来源证据时 E 的 Host Binding 仍为 `unavailable`。

## 8. 固定测试向量与会签入口

设计测试必须覆盖：

- 同一批真实 tracked bytes 上，生产 `digestTrackedTree()` 与独立复算器的完整 SHA-256 相等；LF `0A`、ASCII `5C 6E` 与 CRLF 负例不同。
- 中文/非 ASCII、合法 U+FFFD、非法 UTF-8、UTF-16 code-unit 边界和 byteOffset/span 复算。
- `location.byteOffset` 缺失可通过；存在但与三个必需 offset 不等则拒绝。
- 缺失/重复/冲突/额外 Mapping、所有 token-use 一一对应、zero-token-use 空映射。
- `rejected`、`unavailable`、`available-content-only` 聚合优先级及 `mapping-rejected` 单条诊断语义。
- 方案 A 与方案 B 对同一冻结字节的结果一致；普通可写目录、快照竞争、symlink/path escape、缺 host registry 保持 `unavailable`。
- 固定工程 exact checkout 的逐条结果；不能静态证明的部分保留 `UNKNOWN`/`unavailable`。

会签入口：A 确认状态/诊断候选与文件白名单；D 确认 SM-02/SM-03、零 token-use 和聚合状态；E 确认独立重算职责及来源校验；B 使用未修改 v5 matcher/probe 检查 AC6.2/AC6.4 不变。本轮不申请 Implementation ACCEPT，E 的 Option A Linux 实验结果仍是生产方案决策前置条件。
