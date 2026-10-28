# ACP6 v0.6 Phase 0 Taxonomy 会签合同

- 合同编号：`acp6-gap-taxonomy/v1`
- 映射规则版本：`acp6-gap-mapping/v1`
- 会签日期：2026-10-29
- 证据分支基线：`c851bfe11e6851e01695f94246a5a571435d8faa`
- 本文件只冻结证据分类与审查接口，不修改生产代码，不解锁 C Phase 1 或 D。

## 1. 证据来源边界

PR #61 与 PR #65 是两次不同的 Core 验收输入，不能因为统计相同而合并为一次验收。

### PR #61

- Core：`2ebd1e20d043287edbbfc2ec31c10f15688a4499`
- 可解析原始 JSON：`evidence/acp6-phase0/source/pr61-2ebd1e20/acceptance-2ebd1e20-final.json`
- SHA-256：`289edde457393f499bf53ecd85379b874e6bde4782949e08418194723cc0571b`
- JSON.parse：成功
- 该输入可用于 PR #61 对应历史基线的缺口分析。

### PR #65

- Core：`ed58cfdc2892acaa9b97363a3414b1c219d07053`
- 旧归档：`evidence/acceptance-ed58cfd-final.json`
- 旧归档 SHA-256：`b7500c9d5fc1b4c99bea8b889fa195915172abe8bc7ed9ccada52c64a3d037a4`
- 旧归档 JSON.parse：失败，必须保留，不能覆盖。
- 恢复输入：`evidence/acceptance-ed58cfd-original-recovered.json`
- 恢复输入 SHA-256：`0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- 恢复输入：1,035,281 bytes，JSON.parse 成功，退出码 2，3 PASS / 2 PENDING。
- PR #65 的矩阵必须明确使用恢复输入，并同时记录旧损坏文件的路径、SHA 和失败原因。

## 2. Canonical taxonomy

`gapClass` 和 `gapClasses` 只能使用以下五类：

1. `global-or-theme-selector`
2. `no-static-element-anchor`
3. `dynamic-or-ambiguous-class`
4. `candidate-without-source-edge`
5. `pseudo-element-or-generated-content`

C 当前标签只允许作为原始来源标签：

- `selector-owner-unresolved`
- `dynamic-className`
- `theme-cascade-ambiguity`
- `complex-selector-normalization`
- `candidate-without-strict-edge`

## 3. 逐行字段合同

每个 `coverageStatus=uncovered` 的 source-use row 必须包含：

```json
{
  "rawGapClass": "selector-owner-unresolved",
  "rawGapClasses": ["selector-owner-unresolved"],
  "gapClass": "no-static-element-anchor",
  "gapClasses": ["no-static-element-anchor"],
  "taxonomyVersion": "acp6-gap-taxonomy/v1",
  "mappingVersion": "acp6-gap-mapping/v1",
  "mappingRuleId": "MAP-SOU-OWNER-001",
  "secondaryReasons": ["no-unique-owner"]
}
```

- `rawGapClass` 保留 C 的原始主标签。
- `rawGapClasses` 保留 C 的全部原始标签，多原因时不得丢失。
- `gapClass` 是按优先级选择的 canonical 主因。
- `gapClasses` 是所有可证明的 canonical 原因，主因置首。
- `secondaryReasons` 保留主题、级联、owner、伪元素和 selector 规范化细节。
- `covered` 行不得添加伪造的 gap 归档字段。
- `gapClassCounts` 统计 canonical 主因；原始标签另列 `rawGapClassCounts`。

## 4. 主因优先级与映射规则

主因优先级从高到低：

1. `pseudo-element-or-generated-content`
2. `global-or-theme-selector`
3. `dynamic-or-ambiguous-class`
4. `candidate-without-source-edge`
5. `no-static-element-anchor`

| mappingRuleId | 必要证据 | canonical 主因 |
|---|---|---|
| `MAP-SOU-GLOBAL-001` | raw 为 `selector-owner-unresolved`，selector 为 `body/html/:root/*` 或主题作用域 | `global-or-theme-selector` |
| `MAP-SOU-PSEUDO-001` | raw 为 `selector-owner-unresolved`，selector 含 `::before`、`::after` 等伪元素 | `pseudo-element-or-generated-content` |
| `MAP-SOU-OWNER-001` | 非全局、非伪元素，且没有唯一 JSX/DOM owner | `no-static-element-anchor` |
| `MAP-DYN-001` | raw 为 `dynamic-className`，且 B 证据确认 dynamic className | `dynamic-or-ambiguous-class` |
| `MAP-DYN-PSEUDO-001` | dynamic class 同时作用于伪元素 | `pseudo-element-or-generated-content`，dynamic 为次因 |
| `MAP-CAND-001` | candidate consumer > 0、strict edge = 0，且没有更强原因 | `candidate-without-source-edge` |
| `MAP-THEME-001` | raw 为 `theme-cascade-ambiguity`，且 selector 有主题作用域 | `global-or-theme-selector`，附 `theme-cascade-unresolved` |
| `MAP-COMPLEX-001` | selector 规范化未完成 | `no-static-element-anchor`，附 `selector-normalization-unresolved` |

规则补充：

- `:hover`、`:focus-visible` 是伪类，不得归为伪元素。
- `body` 和 `[data-theme="light"] .footer-brand` 不能只保留 `selector-owner-unresolved`。
- `.section-title::after` 与 `.stat-card::before` 必须识别为伪元素。
- `.project-link` 可归为 dynamic 主因，candidate-without-source-edge 为次因。
- 多原因时不得用单一 alias 覆盖不同语义。

## 5. 预期分布

保持原始统计不变：

- source-use rows：123
- covered：85
- uncovered：38
- consumer pairs：147
- AC6.4 UNKNOWN：16

canonical 主因应为：

| gapClass | 预期数量 |
|---|---:|
| global-or-theme-selector | 3 |
| no-static-element-anchor | 21 |
| dynamic-or-ambiguous-class | 8 |
| candidate-without-source-edge | 4 |
| pseudo-element-or-generated-content | 2 |

当前 C raw 标签分布可单独记录为：

- selector-owner-unresolved：24
- dynamic-className：9
- candidate-without-strict-edge：4
- theme-cascade-ambiguity：1
- complex-selector-normalization：0

## 6. 必须失败的负例

校验器必须拒绝：

1. 缺少任一逐行必需字段；
2. 未知 raw 标签或未知 canonical 标签；
3. raw 标签、selector 和 mappingRuleId 不一致；
4. `selector-owner-unresolved` 未区分 global、owner、pseudo；
5. dynamic 标签没有 B dynamic 证据；
6. candidate 标签但 candidate consumer 为 0；
7. pseudo 标签但 selector 没有伪元素证据；
8. global/theme 标签但没有对应作用域；
9. 伪造 graphNodeIds 或把 declaration node 当作 source-use node；
10. 修改 sourceRef、byteOffset、输入 SHA 或 covered/uncovered 统计；
11. 乱序后 row identity、canonical 映射或统计发生变化；
12. 任一行无法映射时仍将整份归档标记为 pass。

未映射行必须保持 `uncovered`，归档校验结果为 `pass=false`，不得默认降级为 `no-static-element-anchor`。

## 7. Phase 0 解锁条件

C+D 必须提交新的远端证据分支和精确 HEAD，包含：

- 38 行完整字段；
- PR #61 或 PR #65 的明确输入来源；
- 实际输入 SHA-256、Core SHA、路径与 JSON 校验结果；
- 合法输入、乱序、非法映射、来源篡改负例；
- 校验脚本按本合同签 canonical 集合；
- 原始统计保持不变。

只有独立外审对新归档复跑并裁定 Phase 0 ACCEPT 后，C Phase 1 才能申请开工。D 继续等待 C 验收和观察合同冻结。

## 8. D 浏览器观测合同（预备，会签前不接线）

运行时观察必须绑定：

- 宿主关联的逻辑 `projectId`；
- baseline/candidate 各自 `graphDigest`、`sourceDigest`；
- `runId`、`checkId`、`side`、route、viewport、state；
- SourceGraph 消费边/ `sourceUseRef`；
- 页面三元组 `pathname/search/hash`；
- 实际工件路径、普通文件属性、字节 SHA-256。

`graphDigest` 使用规范化 UTF-8 JSON SHA-256：

- 节点按稳定唯一 node id 排序；
- 边按稳定唯一 Relation.id 排序，重复 id 拒绝；
- 包含 schemaVersion、sourceDigest、nodes、edges、unresolved；
- 排除临时 projectId、运行指纹、时间戳、日志和临时目录；
- baseline/candidate 图版本分别记录，临时目录 projectId 不得直接证明逻辑项目相等。

合法零消费者必须显式来自可信运行计划。缺失、重复、跨 run/check/side 混用、sourceDigest 或 graphDigest 不匹配、旧 DOM、无法定位消费边时，状态为 UNKNOWN/partial/unavailable，并 fail-closed。

这些观察只能形成补充证据，不能改变七项 Verification、Scope、Candidate、Approval、Apply 或 Rollback 权限。

## 9. F UI-RC2 合同（预备，会签前不接线）

- 使用 Demo Adapter 私有映射，不增加 `CanvasElementXp.demoPageRef`。
- Home、Products、Seasonal 可共享 TEXT 投影；Contact 可浏览但来源保持 UNKNOWN。
- Demo-only candidate 只生成演示投影，不调用真实 Project API，不创建真实 Candidate、VerificationRun、Approval、Apply 或 Rollback。
- 用户 Scope 选择不构成 source proof。
- Theme Token、SiteHeader 及尚无真实 source-proven 证据的关系继续标记为 DEMO/UNKNOWN。
- 页面切换不得清空草稿或候选；目标、Scope、历史按既有失效规则处理。
- F 负责组件/adapter/测试，UI Agent 负责素材、文案和设计说明。

本合同不解锁生产接线，不改变 Runtime Identity v1.2、Candidate、Scope、Verification、Approval、Apply、Rollback 或 v0.6 Base。
