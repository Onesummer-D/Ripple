# RFC：E geometry sampler 身份采集最小扩展合同

分支：`feat/e-visual-verification-integration-20261023`（E）
状态：**E 自有部分已实现**（采样合同字段 + 配对守卫，见下）；
**需要 A / C+D 协同的部分仅为本 RFC，未冻结、未改写任何 C+D 源码**。
背景：`source-ref-dual-alignment.md` §1/§5，`scope.missingEvidence`
当前恒列四项，导致 `strictInstanceProofAvailable` 恒为 false。

## 1. 目标

让 `pairCrossVersionElements` 的 `scope.missingEvidence` 可以逐项清空，
最终使实例候选配对在证据齐全时能升级为 C+D 口径的严格实例证明，
同时保持：视觉证据只读、辅助、永不 PASS；不改 A 审批门控与 Receipt。

## 2. sourceVersion

- **实际来源**：served 源码文件的 SHA-256。C+D 侧由
  `sourceAnnotationPlugin` 在标注模块加载时把 `<sourceFile, sha256>`
  注册进 `globalThis[Symbol.for('ripple.runtime-identity')].sourceVersions`
  （PR #28 `runtime-identity.ts`），E 的页内采样器（
  `visual-geometry-sampler.mjs`，自包含、不可 import）应**从同一
  registry 读取**，不允许自行再哈希源文件。
- **验证方式**：采样合同字段 `sourceVersion`（64 位小写十六进制，
  已在 `parseDomGeometrySample` 校验）随几何工件落盘；分析期配对以
  “双侧均声明且相等”为兼容、“双侧均声明且不等”为
  `source-version-mismatch`（已实现）、“任一侧缺失”为
  `missingEvidence: 'source-version'`（已实现）。生产期 A 应以 C+D
  `resolveRuntimeElement` 同口径比对当前 SourceGraph 修订的文件摘要，
  该比对逻辑属 A/C+D 合同。
- **baseline/candidate 各自版本**：两侧本就是不同构建，sourceVersion
  **预期不同**；配对要求的是“各自有效”，不是“彼此相等”。因此 RFC
  建议：`source-version-mismatch` 降级仅在能证明 candidate 的
  sourceVersion 已不属于其自身当前图谱修订时升级为硬矛盾；两侧 mere
  不同不矛盾。E 侧在拿到 A 提供的“candidate 当前修订摘要”前，维持
  现有保守实现（不同即记录原因，不判无效）。

## 3. pageContext

- E 已采集：`route` + `locationSuffix`（sha256 化），配对用作
  page-context 子集守卫（不同即 `different-page-context`，已实现）。
- **缺口**：C+D `RuntimePageContext` 的完整身份（pathname 命名空间、
  路由树位置、每页 token）。RFC 请求 C+D 在冻结路由合同时给出
  `RuntimePageContext` 的序列化形态与命名空间规则；E 采样器将按同
  形态采集进采样合同（新增可选字段，解析器模式与 `sourceVersion`
  相同）。
- **命名空间**：建议沿用 C+D `RUNTIME_IDENTITY_PROTOCOL =
  'ripple-runtime-identity/v1'` 的注册表命名空间，E 只读不写。

## 4. reasons 的采集与评估区分

- **采集期**（页内）：C+D `collectRuntimeIdentitySnapshot` 已产出
  采集期 reasons（blocking 六类见 PR #28）。E 采样器按元素透传为
  `identityReasons`（合同字段已实现：≤8 条、≤64 字符）。
- **评估期**（宿主）：配对器只把 blocking reason 作为降级事实
  （`blocking-identity-reason`，已实现），不重评估、不发明 reason。
- RFC 请求 C+D 确认：`RuntimeIdentityReason` 词表是否对 E 只读冻结，
  以及非 blocking 的采集期 reason 是否允许进入视觉证据的 reasons
  展示字段（当前 E 只消费 blocking 交集）。

## 5. offset 漂移的可证明映射

- 问题：baseline `jsx:f#120` 与 candidate `jsx:f#156` 是否同一 JSX
  节点，不能靠字符串也不能靠偏移数值推断。
- RFC 请求 C+D 提供以下之一：
  1. sourceRef 纳入版本指纹的稳定锚（如节点路径哈希），使跨版本
     sourceRef 可证明地可比；或
  2. 构建期生成的 baseline→candidate sourceRef 映射表（随 candidate
     工件交付，哈希绑定）。
- 在 C+D 答复前，E 配对到 `instance-candidate` 即停止：实例 id 是
  跨版本锚，sourceRef 只做同文件检查，不做 offset 级断言。

## 6. E 自有已实现清单（本轮落地）

| 项 | 状态 |
|---|---|
| 采样合同 `sourceVersion`（可选，sha256 校验，缺失=null） | 已实现（解析器 + 类型） |
| 采样合同元素级 `identityReasons`（可选，有界） | 已实现（解析器 + 类型） |
| 配对守卫 `different-page-context`（route/location suffix） | 已实现 + 测试 |
| 配对守卫 `source-version-mismatch` / `blocking-identity-reason` | 已实现 + 测试 |
| 多无 ID 元素同 sourceRef 禁止数组顺序配对 | 已实现 + 测试 |
| `scope{level, strictInstanceProofAvailable, missingEvidence}` | 已实现 + 测试 |
| ViewModel 降级呈现（`crossVersion` additive + 中文标签） | 已实现 + 测试 |

采样器运行时接线（从 C+D registry 读 sourceVersion / pageContext /
reasons）等 C+D 路由合同冻结后由 A 总集成时接入；E 侧合同与守卫
已就绪，接线只是填数。
