# Phase 1B-b SourceMapping 第二轮整改与 SM-03 兼容裁定

- 原始审查基线：`da89402738b3f46aeea1dc9eedaa5231a22fd571`
- 第一轮会签证据：`ecdb8d99b460dc1ae6084137b73d365f39d39f4d`
- 第一轮证据 Tree：`227da5870f4b5d490876df0e291195f883471dcb`
- 本地证据检查 HEAD：`e532f6bee5cfde30e269f85a9d370420aea7c881`
- 范围：合同与证据；`productionWrites=false`
- 最终裁定：**ACCEPT WITH SCOPE**
- 生产 Collector、GraphDigestV2 纯模块、SourceGraph、D-P1：继续 HOLD

## 1. PR #72 Producer 事实证明

`src/core/project.ts` 的 token-use 生成（本地检查 commit `4ba7ed829aab69f4769b5e770b1f1abf572a50b6`，约第 626–644 行）为：

```ts
const useNode: SourceNode = {
  id, kind: 'token-use', label: `var(${use.name})`, value: `var(${use.name})`,
  location: { path: file, start: use.offset, end: use.offset + 4 + use.name.length, offset: use.offset },
  byteOffset: use.byteOffset, selectorScope: use.selectorScope,
}
const sourceUse = {
  path: file, charOffset: use.offset, byteOffset: use.byteOffset, offsetUnit: 'code-unit',
}
```

因此当前 Producer 的事实是：

- `token-use.location.path` 存在；
- `token-use.location.offset` 存在，单位是 JavaScript/UTF-16 code-unit；
- `token-use.location.byteOffset` **缺失**；
- `token-use.byteOffset` 存在；
- `Relation.sourceUse.byteOffset` 存在，并与顶层 `token-use.byteOffset` 使用同一 `use.byteOffset`；
- file→token-use 的 `reads/source-proven` 锚点使用同一 `sourceUse`。

这不是 G0 纯模块 fixture 的字段形态问题。G0 fixture 已包含 `location.byteOffset`，而 PR #72 Producer 当前不会输出该嵌套字段。

## 2. 三种兼容方案

| 方案 | 来源证明 | GraphDigest 输入 | 生产代码 | G0 | PR #72 兼容性 | 裁定 |
| --- | --- | --- | --- | --- | --- | --- |
| 1. Adapter 在 canonical Graph 副本中补 `location.byteOffset` | 可以，但必须从同一不可变字节快照计算，不能补造 | 若补充字段进入 canonical input，会改变当前缺失该字段的 Producer 图摘要；G0 fixture 已有该字段，G0 本身可保持不变，但会形成 Adapter 特有规范化输入 | 不改 Producer，但需冻结“补字段后再 canonicalize”的新边界 | G0 数值不变，但不能据此证明所有 PR #72 图摘要不变 | 原始 SourceGraph 兼容，GraphDigest 输入语义改变 | **不采纳为默认方案** |
| 2. `location.byteOffset` 可缺失，要求已有字节偏移与冻结源码复算一致 | 可以。`node.byteOffset`、`Relation.sourceUse.byteOffset` 和快照复算共同证明字节位置 | **不改变** GraphDigestV2 十字段或现有 Producer 图结构 | 不改 Producer | **不改变** G0 | **完全兼容** PR #72 | **推荐并接受** |
| 3. Producer 强制输出 `location.byteOffset` | 可以，重复字段最强 | 新 Producer 图会增加 canonical 字段；现有缺失字段的摘要会变化，需重新审查回放 | 修改 `project.ts`、模型消费与测试，扩大生产范围 | G0 fixture 可保持，但 Producer 回放语义改变 | 需要所有 SourceGraph 消费者迁移 | **本轮不授权** |

方案 2 的边界是：Adapter 不向 canonical Graph 添加新字段；它只在 Mapping 验证阶段使用已有顶层 `node.byteOffset` 和 `Relation.sourceUse.byteOffset`，并把可选的 `location.byteOffset` 当作一致性附加检查。

## 3. 冻结 SM-02：UTF-16 code-unit

1. 从同一不可变源快照读取原始字节，使用严格 UTF-8 decoder（`fatal=true` 或等价行为）。
2. 非法 UTF-8 字节序列是 `source-utf8-invalid`，聚合为 `adapterStatus=unavailable`；不得使用替换解码结果继续做 Mapping。
3. 合法 UTF-8 编码的 U+FFFD（字节 `EF BF BD`）不是错误；严格解码后按普通字符处理。它占 1 个 UTF-16 code-unit 和 3 个 UTF-8 字节。
4. 建立 UTF-16 code-unit 边界到原始 UTF-8 字节位置的映射；不得用会把 lone surrogate 重新编码为替换字符的近似算法。
5. 对每个 token-use 要求 `location.offset === sourceUse.charOffset`，offsetUnit 必须为 `code-unit`，并验证起点/span 在解码文本和原始字节中均有界。
6. 缺失、越界、落在 surrogate pair 中间、span 不匹配或重算不一致，产生 `mapping-char-offset-mismatch`，即 `mappingDecision=mapping-rejected`、`adapterStatus=unavailable`。

## 4. 冻结 SM-03：兼容 PR #72 的字节证明

对进入 Mapping 覆盖集的 token-use，以下字段必须满足：

- `tokenUse.byteOffset`：**必需**；
- `mapping.sourceUse.byteOffset`：**必需**，且等于 `tokenUse.byteOffset`；
- `Relation.sourceUse.byteOffset`：**必需**，且与 Mapping 完全相等；
- `tokenUse.location.byteOffset`：**可缺失**；若存在，必须等于上述三者；
- `tokenUse.location.path`、`sourceUse.path` 和 file 节点规范路径必须逐字相等；
- 字节位置必须由原始 UTF-8 快照中对应的 code-unit 起点复算；不得做 LF/CRLF、NFC/NFD 或路径大小写归一化。

因此：

- `location.byteOffset` 缺失本身不是失败；
- 顶层 `tokenUse.byteOffset`、`sourceUse.byteOffset` 缺失或与快照不一致，才是 `mapping-byte-offset-mismatch`；
- 如果 `location.byteOffset` 存在但冲突，同样是 `mapping-byte-offset-mismatch`；
- 该规则不改变 GraphDigestV2 canonical 输入，也不破坏 G0。

## 5. Mapping 覆盖率

覆盖集合仍是 `SourceGraph.nodes` 中全部 `kind=token-use` 节点：

- 每个 token-use 恰好一条 Mapping；
- 每条 Mapping 恰好一个 token-use、一个唯一 reads/source-proven anchor；
- Mapping 数量必须等于 token-use 数量；
- 缺失、重复或冲突 Mapping：`mappingDecision=mapping-rejected` 或 `mapping-missing`，聚合 `adapterStatus=unavailable`；保留 graph/unresolved，不删节点、不补造 Mapping；
- 没有 token-use 时，Mapping 必须为空；
- semantic-candidate、UNKNOWN、cascade 和运行时消费者不计入覆盖率。

## 6. Adapter 状态语义

聚合状态冻结为：

| 状态 | 语义 |
| --- | --- |
| `rejected` | 结构或输入非法：未知字段、版本错误、重复 ID、未知端点、非法路径/offset、非法 Mapping 形状；不计算 Digest。 |
| `unavailable` | 结构合法但快照、严格 UTF-8、Registry、TOCTOU、字节证明或完整 Mapping 不足；不输出可信 Adapter 结果。 |
| `available-content-only` | 十字段、全部 Mapping、快照字节和 Registry 绑定均通过；只产生 content-only GraphDigestV2。 |

单条 Mapping 决策为 `accepted` 或 `mapping-rejected`。`mapping-rejected` 不是第三种聚合状态；它必须聚合为 `unavailable`。优先级为：

`rejected > unavailable > available-content-only`

合法 U+FFFD 与非法 UTF-8 必须分开：前者可继续验证，后者进入 `unavailable`，不能被笼统归入 Mapping mismatch。

## 7. digestTrackedTree() 与 G0

`da894027...` 固定记录尾部为一个实际 LF `0A` 字节：

```text
UTF-8(path byte length) : path : file byte length : file SHA-256 + 0A
```

Adapter/独立复算必须保留路径排序、原始文件字节、每文件 SHA、文件长度和单个 LF；`5C 6E`、CRLF、Unicode 规范化均为不同输入。该规则不改 GraphDigestV2 domain 或十字段，也不改 G0 digest。

## 8. Git Blob 身份勘误

第一轮本地会签提交的 Git Blob 与 GitHub 远端 Tree Blob 不是同一组标识：

| 文件 | 第一轮本地 commit blob | 第一轮远端 Tree `227da587...` blob |
| --- | --- | --- |
| signoff Markdown | `ee0dcab461833774903e9e41ebf3d21d222e3a83` | `d16d29cdb2bd970e18953c5b1eaa5ba8a6559806` |
| signoff JSON | `1bb0157d750ce8969736ee93b8779572a5a4c692` | `815b25aba1a2d563fc12f763aa59550749f39dec` |
| signoff Manifest | `7d2475b546d9ffb22eb84af07fb3164578d1d4ef` | `5775616bd96f8b561a8f833b6df0e85e44945556` |

本轮勘误以远端 Tree Blob 为 GitHub 审查身份；本地 Blob 仅保留为本地提交身份。新 Manifest 不再把本地 Blob 填入远端文件身份。

## 9. 最终裁定

**ACCEPT WITH SCOPE**。

接受范围：方案 2、SM-02/SM-03 兼容规则、全 token-use 覆盖率、`rejected/unavailable/mapping-rejected` 状态拆分、严格 UTF-8 与合法 U+FFFD 区分、LF `0A` 字节合同和纯模块/Adapter 边界。

限制：这只是合同会签，不代表 Adapter 已实现、固定工程已完成双实现复算或生产 Collector 已获授权。A/E 仍需冻结最终 Schema，并由后续 Adapter evidence 验证所有规则。
