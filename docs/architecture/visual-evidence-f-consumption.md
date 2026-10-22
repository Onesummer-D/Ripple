# F 工作台消费说明：视觉证据只读 ViewModel

面向 F（青叶工作台）的消费合同。F **只能**通过
`run.visualEvidences[].view`（`toVisualEvidenceView` 产出，
schema `ripple-visual-evidence-view/v1`）消费视觉证据；不得读取
E 的内部模块，不得从 view 推导正式验证状态。

## 1. 总原则（完整身份确认之前）

- ✅ 可以展示前后截图与实际像素差异（`artifacts.urls`、`regions`）。
- ✅ 可以展示来源级或不确定的配对信息（`crossVersion`，措辞见 §3）。
- ✅ 可以提示潜在风险与需要人工复核的位置（`findings`）。
- ❌ **不可以**把未经核验的实例配对展示为“实例级已证明”。
- ❌ **不可以**因为 E 证据提升 Scope、Approval 或正式 VerificationRun
  的通过等级；view 的 `state` 类型层面就没有 `pass`。

## 2. 字段映射

| view 字段 | 类型 | F 用途 |
|---|---|---|
| `state` / `stateLabel` | `risk`/`unknown`/`not-run`/`stale`/`failed-to-run` + 中文标签 | 证据状态徽标，只读展示 |
| `summary` | string | 一句话摘要（含变化像素数、风险条数） |
| `regions[]` | 区域框 + `classification` + `attribution` + `sourceRefs` | 差异热区渲染；`sourceRefs` 是来源标注，**不是实例证明** |
| `findings[]` | `code`/`severity`/`detail`/`regionIds` | 复核清单；`severity='risk'` 需高亮 |
| `crossVersion` | 见下 | 仅 dual 模式证据出现；additive，旧证据无此字段 |
| `artifacts.diffImage` | `{sha256, pixelSha256}` | 完整性展示，不可改写 |
| `limitations` / `comparabilityReasons` | string[] | 不可比原因，折叠展示 |

### `crossVersion`（配对信息，**候选配对而非实例证明**）

```
crossVersion: {
  scope: {
    level: 'annotation-pairing',            // 恒为该值
    strictInstanceProofAvailable: boolean,  // false 时禁止任何“实例级已证明”表述；
                                           // 即使 true 也只表示 E 侧输入齐备且 C+D
                                           // 评估通过，F 仍按本说明渲染，不自行扩写
    missingEvidence: string[]               // 缺失的严格证明输入；'source-version' 表示
                                           // 版本未核验（≠失效），不单独影响配对等级
  },
  counts: { instanceCandidate, sameSourceRefObserved, unproven, baselineOnly, candidateOnly },
  pairs: [{ sourceRef: {baseline, candidate}, runtimeInstanceId, proof, proofLabel, reasons }]
}
```

## 3. 中文提示文案（逐字使用，不得自行改写升级）

| `proof` | `proofLabel`（view 已给出，直接渲染） |
|---|---|
| `instance-candidate` | 实例候选配对（运行时标注支持，未经身份核验） |
| `same-sourceRef-observed` | 来源字符串一致（仅观察到相同 sourceRef，版本偏移后可能对应不同 JSX 节点） |
| `unproven` | 未证实配对（需人工复核） |

配套固定文案：

- `scope.strictInstanceProofAvailable === false` 时在配对区顶部展示：
  **“以下为跨版本候选配对，未经完整身份核验，不构成实例级证明。”**
- 区域归因提示（`regions[].attribution === 'mapped'` 且存在
  `same-sourceRef-observed`/`unproven` 配对时）：
  **“像素变化已定位到来源区域，但不能确认为某一实例的确定修改。”**
- `baseline-only` / `candidate-only` 计数大于 0 时：
  **“存在仅单侧出现的来源元素，请人工核对增删。”**

## 4. 禁止行为清单

- 不得把 `pairs[].runtimeInstanceId` 相等渲染为“同一实例已确认”；
  它是候选配对的输入事实，不是证明结论。
- 不得把 `counts.instanceCandidate > 0` 渲染为“实例级变更已定位”；
  正确表述：“存在 N 组候选配对（未经身份核验）”。
- 不得用 `crossVersion` 的任何内容驱动 Scope 判定、Approval 按钮
  状态或 VerificationRun 结果展示。
- 不得缓存并对比不同证据的 `pairs[]` 来“推断”趋势；每份证据独立
  呈现。
