# B1.1 Relation ID 重复只读诊断

## 范围与结论

本报告只读取 B1.1 Base/Final 的完整 SourceGraph JSON，按 `Relation.id` 分组诊断重复情况。没有去重、重编号、删除边、修改 Relation schema、修改 D graphDigest 或修改 B v5。

- Base：`5b75fe699afce98638e6fd6ad110911d83389dc8`
- B1.1 生产实现：`34d2a22e696c9eb1af15d5cd9800cf76b7cf7883`
- 本地最终证据归档：`6388abec96183cc28824dc2b7fa486e4e944d305`
- 归档 Tree：`8455bfc0c6f2ff5491dad8a418c8b8a7bc78ba2e`
- 固定项目：`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`

完整逐 ID、逐 occurrence payload 在 [`b11-relation-id-duplicate-diagnostic.json`](./b11-relation-id-duplicate-diagnostic.json)。原始图仍保留：[`b11-graph-base.json`](./b11-graph-base.json)、[`b11-graph-final34d2.json`](./b11-graph-final34d2.json)。诊断生成器为 [`diagnose-b11-relation-id-duplicates.mjs`](../../../../scripts/diagnose-b11-relation-id-duplicates.mjs)。

## 原始输入哈希

| 输入 | 字节数 | SHA-256 |
| --- | ---: | --- |
| Base graph | 3,519,068 | `30047feae2d45f00ae39b8661048e6ccd1f2ad455dfa317df75cbedfe2e5c19f` |
| Final graph | 2,049,215 | `6d4ac66639d0320bca26090ae16a7d5151c9ae596fa244955f006b2aa3cd92ad` |
| Existing complete diff | 1,888,849 | `384521ab5a6b15b799dee9749e74e3d4565ba7731f3e621e9e769c39275db8d9` |

生成命令：

```powershell
node scripts/diagnose-b11-relation-id-duplicates.mjs
```

脚本读取两个完整图，JSON.parse 后按精确 `edge.id` 分组；payload 比较会递归稳定排序并排除 `id` 字段，同时检查 `from/to/kind/certainty/sourceUse/selectorScope/mediaContext/evidenceRefs`。输出包含每个重复 ID 的 occurrence 数、payload、端点集合和来源证据。

## 总量

| 图 | edges | 唯一 Relation ID | 重复 ID key | 额外重复 occurrence | unresolved | 重复 unresolved |
| --- | ---: | ---: | ---: | ---: | ---: | ---: |
| Base | 5,302 | 4,416 | 298 | 886 | 253 | 0 |
| Final B1.1 | 3,046 | 2,794 | 84 | 252 | 253 | 0 |

重复 multiplicity：

- Base：4 个 ID 出现 2 次，294 个 ID 出现 4 次。
- Final：84 个 ID 均出现 4 次。
- unresolved 数组没有重复键。

## 重复 ID 的精确分类

两个图中所有重复 ID 都属于同一 producer 前缀：

| producer / ID 前缀 | 图 | duplicate keys | extra occurrences | Relation kind | certainty | 端点差异 | payload 差异 |
| --- | --- | ---: | ---: | --- | --- | ---: | --- |
| `css-selector-candidate` | Base | 298 | 886 | `css-cascade` | `semantic-candidate` | 0 | 294 个只差 `selectorScope`；4 个 payload 完全相同 |
| `css-selector-candidate` | Final | 84 | 252 | `css-cascade` | `semantic-candidate` | 0 | 84 个只差 `selectorScope` |

所有重复 occurrence 的 `sourceUse` 与 `evidenceRefs` 保持相同；`mediaContext` 没有造成重复 payload 差异。没有发现同一 ID 对应不同 `from/to` 端点，也没有发现同一 ID 跨 Relation kind 或跨 certainty。

Base 中 payload 完全相同的 4 个 ID 是：

- `css-selector-candidate:token-use:dist/assets/index-hJgMd1dF.css#10730:jsx:src/pages/Home.jsx#7123`
- `css-selector-candidate:token-use:dist/assets/index-hJgMd1dF.css#10730:jsx:src/pages/Home.jsx#7693`
- `css-selector-candidate:token-use:src/css/style.css#14682:jsx:src/pages/Home.jsx#7123`
- `css-selector-candidate:token-use:src/css/style.css#14682:jsx:src/pages/Home.jsx#7693`

这 4 个 ID 各出现两次，两个 occurrence 的 selector 都是 `.skills-section .skill-badge`。其余重复项的完整 selectorScope 和 payload 保存在 JSON 中。

## 生产构造证据

`src/core/project.ts` 的生产构造可以直接解释这类重复：

- `project.ts:997-1003` 遍历同名 `tokenDefinitions`，把每个声明的 `selectorScope` 放进 metadata。
- `project.ts:1005-1008` 生成 declaration/use 和 use/declaration 关系时把声明节点 ID 纳入 ID，因此这些 Relation ID 没有进入重复集合。
- `project.ts:1011` 生成 CSS 消费候选：

```ts
addEdge(useNode.id, element.id, 'css-cascade',
  `css-selector-candidate:${useNode.id}:${element.id}`,
  'semantic-candidate', metadata)
```

该 ID 只包含 `useNode.id` 和 JSX `element.id`，没有包含当前 `definition.id`、`selectorScope` 或完整 cascade context。该调用位于 `for (const definition of tokenDefinitions)` 循环内，所以同一个 CSS `var()` use 与同一个 JSX host 对应多个声明时，会写入多个相同 Relation ID。`selectorScope` 由当前 definition 写入 payload，因此不同主题/作用域会形成同 ID 的不同 payload；重复声明的同一 selector 会形成同 ID 的相同 payload。

以 Final 的 `css-selector-candidate:token-use:dist/assets/index-hJgMd1dF.css#2088:jsx:src/pages/Cert.jsx#2154` 为例，4 个 occurrence 的 selectorScope 是：

1. `:root`
2. `[data-theme=light]`
3. `:root`
4. `[data-theme="light"]`

相关 `token-reference` / `uses-token` 关系分别带有 `definition.id`，因此这个样例没有把 token declaration/use 循环误计为重复 Relation ID。

## Base 与 B1.1 变化

重复 ID 集合交叉统计：

- 两图都重复：68 个 ID。
- 仅 Base 重复：230 个 ID。
- 仅 Final 重复：16 个 ID。

完整集合和每个 ID 的 payload 在诊断 JSON 的 `crossGraph`、`base.duplicateIds`、`final.duplicateIds` 中。按生产代码可直接证明的范围，B1.1 的静态 owner 收窄减少了可发出的 CSS selector candidate 数量，重复键从 298 降到 84；Relation ID 生成表达式没有在 B1.1 中改变。Base-only/Final-only 的逐 ID 归因没有仅凭 ID 字符串臆测，保留为可核对的证据集合。

## 下游消费核对

已在当前 checkout 中搜索 `Relation.id`、`edge.id`、`graphDigest` 和按 ID 建立的 Map/Set：

- `src/verification/fixtureValidator.ts:21-22` 对 `CaseFixture.graph.edges` 强制检查 edge ID 唯一。这是旧的 fixture 合同，不是 `SourceGraph.Relation` 的生产去重逻辑。
- `src/app/RelationshipMap.tsx:9` 用 `key={edge.id}` 并输出 `data-edge-id={edge.id}`。该组件消费的是 fixture projection；若未来直接喂入重复 SourceGraph Relation，会出现 React key/DOM 标识冲突风险。
- `src/app/App.tsx:269` 用 `key={edge.id}` 渲染 impact edge，同样属于工作台 fixture projection。
- `scripts/b-acp6-matching.mjs:267` 把命中的 `edge.id` 保留在 `edgeIds` 数组，未做去重；重复 occurrence 会继续反映在 `edgeCount`/数组中。
- `src/core/scope.ts:133` 只把 `edge.id` 写入 unresolved 文本，没有按 ID 建立唯一索引。
- `src/core/project.ts` 当前按 `graph.edges` 逐条过滤/遍历，没有发现把 SourceGraph Relation 放进 `Map<Relation.id, …>` 的代码。
- 当前 checkout 中没有 `graphDigest` 实现或校验器（`rg` 无匹配）。因此 D 的 graphDigest 影响只能记录为合同级诊断：若 D 实现要求 Relation ID 全局唯一，当前 Base 和 Final 图都会被拒绝或标记；本轮没有执行 D digest，也没有修改它。

## 结论与边界

1. 当前重复是生产 SourceGraph 中真实存在的身份问题，集中在 CSS selector candidate producer。
2. B1.1 没有修改 Relation ID 生成策略；其图差异和重复数量变化来自 owner candidate 发射数量变化。
3. 旧唯一 ID、`sourceUse`、`sourceRef`、`byteOffset`、rowId/pairId 和 Runtime Identity v1.2 不在本诊断范围内，未被改写。
4. 本轮不自动去重、不重新编号、不删除边、不修改 schema、不修改 D graphDigest、不修改 B v5。
5. Relation ID 身份治理需要 A 批准独立合同和文件白名单；候选治理输入至少应纳入 `kind/from/to/sourceUse/selectorScope/mediaContext/producer` 的规范化元组，同时保留旧 ID 兼容和审计映射。

当前 PR #70 仍保持 Draft。远端推送因沙箱网络错误未完成，Linux CI 针对 `6388abe…` 仍为 UNVERIFIED。
