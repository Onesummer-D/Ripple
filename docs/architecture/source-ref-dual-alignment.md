# E × C+D sourceRef 双侧对齐合同

分支：`feat/e-visual-verification-integration-20261023`（E）
对齐对象：C+D `feat/integration-cd-sourcegraph-20261022`（PR #28，HEAD `1dbaa53`）
状态：已实施并经过一轮独立审查修正（2026-10-23）。审查要求的 P1 降级
已落地：**配对等级全部改用弱语义命名**，与 C+D 严格实例证明显式区分。
共享接口层面的改动仅为 RFC，见 `visual-sampler-identity-rfc.md`，未冻结。

## 1. 目的与边界

E 的视觉证据在分析期需要回答一个问题：candidate 侧的渲染差异，对应
baseline 侧的哪个 JSX 来源元素？本合同定义 baseline ↔ candidate 元素的
配对规则与证据分级。**只配对、不授权**：配对结果只影响视觉证据的
`report.crossVersion` 呈现，不进 Scope、不进审批门控、不改 Receipt。

**关键语义声明（审查修正）**：本配对是**运行时标注支持的跨版本候选
配对**（`annotation-pairing`），**不是** C+D 完整身份评估后的实例证明。
C+D 的严格实例证明还要求 sourceVersion 与 SourceGraph 版本一致、
pageContext 匹配、采集/评估 reasons 为空、sourceRef 属于当前有效源码图
（`resolveRuntimeElement`），这些输入 E 的采样器目前**未采集**，由
`scope.missingEvidence` 如实列出，`scope.strictInstanceProofAvailable`
恒为 `false`。

## 2. sourceRef 词法

- 形态：`jsx:<file>#<offset>`（C+D PR #28 冻结）。
- 文件提取：`sourceFileFromSourceRef(ref)`，正则 `/^jsx:(.+)#\d+$/`；
  不匹配返回 `undefined`，绝不猜测。
- `runtimeInstanceId` 形态：`<pathname>:<owner>`（C+D），与 sourceRef
  是**两个独立维度**：同一 sourceRef 可渲染多个实例（如共享 Footer），
  同一实例 id 不允许在同一页重复出现（C+D `project.ts` 读取期强校验）。

## 3. 配对等级（弱语义，审查修正后）

`pairCrossVersionElements(baseline, candidate)` 对两侧几何描述符做
配对，每对落在且只落在以下一级：

1. **instance-candidate**：两侧各恰有一个元素满足
   `runtimeInstanceId` 等值，双侧 certainty 均为稳定档
   （`stable-keyed-instance` / `stable-react-instance`，C+D `isStable`
   同口径），两侧 `sourceRef` 指向同一文件，双侧采样共享 route 与
   location suffix，声明的 sourceVersion 不冲突，且双侧均无 C+D
   blocking 采集期 reason。**这是运行时标注能支持的最强配对，但它
   只是候选配对**——在 `scope.missingEvidence` 清空且完成 C+D 级评估
   之前，不得对外表述为“实例身份已证明”。
2. **same-sourceRef-observed**：两侧 `sourceRef` **字符串精确等值**，
   但没有实例级证据，或实例证据被非冲突类原因降级（身份不稳定、
   blocking reason 等）。**注意**：sourceRef 含字符偏移，不同版本在
   相同 offset 处可能对应**不同 JSX 节点**；该等级只是“观察到相同
   字符串”，不是“同一来源元素已证明”。
3. **unproven**：其余一切。典型原因（additive，可并存）：
   `duplicate-runtime-instance`（同侧同 id 多于一个）、
   `different-source-file`、`identity-not-stable`、
   `position-dependent-identity`、`unmapped-owner`、
   `source-not-in-graph`、**`different-page-context`**（双侧 route 或
   location suffix 不同）、**`source-version-mismatch`**（双侧都声明了
   sourceVersion 且不相等）、**`blocking-identity-reason`**（任一侧带
   C+D blocking 采集期 reason）。后三类是**主动矛盾**：即使字符串
   相同也压到 unproven，不允许停留在观察级。

**显式禁用**：任何文本相似度、DOM 位置、URL/路由的推断配对；
无实例 ID 的多元素同 sourceRef 场景**禁止按数组顺序推定**逐元素
对应（两侧各恰一个才配对）。配对不上就是 unproven 或单侧列出，
永不回退到猜测。

### 配对结果结构（版本化）

```
crossVersion: {
  scope: {
    level: 'annotation-pairing',          // 本配对的性质
    strictInstanceProofAvailable: false,   // missingEvidence 非空恒 false
    missingEvidence: ['source-version', 'page-context', 'collection-reasons', 'graph-membership']
  },
  instanceCandidate / sameSourceRefObserved / unproven: 计数 + 有界 pairs,
  baselineOnly / candidateOnly: 单侧残留
}
```

`pairs[]` 每项：`sourceRef{baseline,candidate}`、`runtimeInstanceId`、
`proof`、`reasons`。非 dual 输入的旧路径逐字节不变。

### 新旧语义对照表（审查要求）

| 旧表述（91dd54d，已废弃） | 新表述（本轮） | 语义差异 |
|---|---|---|
| `instance-proven` | `instance-candidate` | 旧名暗示 C+D 级实例证明；新名明确只是标注支持的候选配对，`scope.strictInstanceProofAvailable=false` |
| `source-file-proven` | `same-sourceRef-observed` | 旧名暗示来源身份已证明；新名明确只是字符串观察，offset 漂移后可对应不同 JSX 节点 |
| `unproven` | `unproven`（不变） | 新增 `different-page-context` / `source-version-mismatch` / `blocking-identity-reason` 三个主动矛盾原因 |
| （无） | `scope` 块 | 新增：声明配对性质与缺失的严格证明输入，F 不得自行升级措辞 |

字段级向后兼容：计数字段 `instanceProven`/`sourceFileProven` 更名为
`instanceCandidate`/`sameSourceRefObserved`；该结构自 91dd54d 引入、
尚无外部消费者（F 此前只能看到 view），更名无历史包袱，映射以本表为准。

### 5 类问题分类（F 消费口径）

| 分类 | 含义 |
|---|---|
| `baseline-only` | 仅 baseline 侧有此来源，candidate 已移除/未渲染 |
| `candidate-only` | 仅 candidate 侧有此来源，新增元素 |
| `instance-candidate` | 候选配对成功（标注支持，未经身份核验） |
| `same-sourceRef-observed` | 仅观察到来源字符串一致 |
| `unproven` | 配对失败或存在主动矛盾，需人工复核 |

## 4. 跨版本配对与几何风险计算的关系（实际核对结果）

**核对结论：跨版本配对目前只用于展示与归因，不参与几何风险规则。**
遮挡（new-overlap）、溢出（new-viewport-overflow / new-clip-overflow）、
文档横向溢出（new-document-horizontal-overflow）与位移
（elementDisplacements）全部以 `matchElements()` 的同版本精确身份匹配
为输入；`pairCrossVersionElements()` 的输出只写入
`report.crossVersion`，不进任何风险规则。

因此：**“报告中跨版本配对成功”不得宣称为“几何风险检测已获得跨版本
匹配能力”**。JSX offset 改变时，新配对能看到两侧元素，但遮挡/溢出/
位移规则的匹配仍按精确身份（同 sourceRef 或同实例 id）执行，offset
漂移的元素不会被风险规则当作同一元素比较。只有取得完整身份与版本
证据（sourceVersion、pageContext、采集期 reasons、图谱成员关系）之后，
才允许将跨版本配对升级为几何规则的可信输入；该升级属于 A 总集成
合同，E 不越权实现。

## 5. 与 PR #28 字段对照及语义差异

| 字段 | C+D 侧语义（PR #28） | E 视觉侧现状 | 差异 |
|---|---|---|---|
| `sourceRef` | `jsx:<file>#<offset>`，SourceGraph 证明 | 同一词法，测试/注入场景由宿主提供 | E 不生成 offset，只消费 |
| `runtimeInstanceId` | `<pathname>:<owner>`，页面内唯一 | 同一词法，从几何描述符读取 | 一致 |
| `certainty` | 五档：stable-keyed-instance / stable-react-instance / position-dependent / unknown / unmapped | 同五档，配对只认前两档为稳定 | 一致 |
| `instanceIdentityProven` | `reasons` 为空即证明（零 reason 口径） | E 不产出该字段；配对 scope 明确 `strictInstanceProofAvailable=false` | E 更保守且明示 |
| `sourceVersion` | served 文件 sha256；版本不一致则旧身份作废 | 采样合同已加可选字段（null=未采集）；双侧声明冲突时压到 unproven | 采样器接线见 RFC |
| `pageContext` | 每页上下文（路由等） | E 只采集 route + location suffix 子集；不一致压到 unproven | 完整 pageContext 见 RFC |
| `reasons` | 采集期降级原因（blocking 六类） | 元素级可选字段已入合同；带 blocking reason 禁止实例候选 | 采样器接线见 RFC |

## 6. 验证

`src/core/visual-dual-targets.test.ts` 20 例：

- 原 8 对照场景（位置偏移 / 共享 Footer 重复实例 / 同源不同实例 /
  RouterProvider unknown / 来源不一致 / 跨页消费者 / 无目标变化 /
  版本失效）；
- 审查新增 P1 负例：① sourceRef 相同但 sourceVersion 不同；
  ② 实例 id 相同但 pageContext 不同；③ 实例 id 相同但 sourceVersion
  失效；④ 同 sourceRef 多次渲染且无稳定身份不配对；⑤ 多无 ID 元素
  同 sourceRef 禁止数组顺序推定；⑥ blocking 采集期 reason 禁止实例
  候选；⑦ RouterProvider unknown 与 source-only 两例**端到端断言最终
  Evidence/ViewModel 可见等级**（scope、proofLabel、计数），不允许只
  查内部配对数组。

固件字节零变化（golden fixture 未触碰）。旧输入路径（非 dual）逐字节
不变。
