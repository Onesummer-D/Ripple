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

## 2. sourceVersion（粒度：按文件映射）

- **粒度（本轮修正）**：一个页面渲染来自多个文件的元素
  （App.tsx、Header.tsx、Footer.tsx…），任何"整个页面单一文件哈希"
  都不能代表全部元素的来源版本。采样合同字段为**按文件映射**
  `sourceFileVersions: { <sourceFile>: <sha256> } | null`（已实施：
  解析器校验 ≤64 条目、键 ≤512 字符、值 64 位十六进制）。元素通过
  其 sourceRef 解析出的文件在映射中查版本。
- **实际来源**：served 源码文件的 SHA-256。C+D 侧由
  `sourceAnnotationPlugin` 在标注模块加载时把 `<sourceFile, sha256>`
  注册进 `globalThis[Symbol.for('ripple.runtime-identity')].sourceVersions`
  （PR #28 `runtime-identity.ts`），E 的页内采样器（
  `visual-geometry-sampler.mjs`，自包含、不可 import）应**从同一
  registry 按文件读取**，不允许自行再哈希源文件。
- **验证方式（本轮修正）**：配对入参 `expectedSourceVersions`（每侧
  各自的 `sourceFile → 期望 sha256`，来自该侧 SourceGraph 修订）。
  三种状态严格区分：
  - **已核验**：该侧采集值 == 该侧预期值；
  - **失效（source-version-mismatch）**：该侧采集值与该侧自己的
    预期值矛盾——这是唯一合法的 mismatch 来源；
  - **未核验**：未提供预期摘要（或映射缺该文件）——保留在
    `scope.missingEvidence: 'source-version'`，**绝不单独降级**。
  **错误已纠正**：baseline 与 candidate 是两个不同修订，文件哈希不同
  是合法且预期的事实；禁止把"两侧版本不同"当作冲突（d822819 之前
  的实现有此错误，已修）。
- **baseline/candidate 各自版本**：两侧预期摘要分别来自各自修订；
  不存在跨侧相等要求。
- **生产期比对责任**：A 以 C+D `resolveRuntimeElement` 同口径提供每侧
  预期摘要并调用配对入参；该比对逻辑属 A/C+D 合同，E 只消费结论。

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
| 采样合同 `sourceVersion`（可选，sha256 校验，缺失=null） | 已实现（解析器 + 类型）→ 本轮按审查修正为**按文件映射** `sourceFileVersions`，移除单哈希字段 |
| 采样合同元素级 `identityReasons`（可选，有界） | 已实现（解析器 + 类型） |
| 配对守卫 `different-page-context`（route/location suffix） | 已实现 + 测试 |
| 配对守卫 `source-version-mismatch` / `blocking-identity-reason` | 已实现 + 测试 |
| 多无 ID 元素同 sourceRef 禁止数组顺序配对 | 已实现 + 测试 |
| `scope{level, strictInstanceProofAvailable, missingEvidence}` | 已实现 + 测试 |
| ViewModel 降级呈现（`crossVersion` additive + 中文标签） | 已实现 + 测试 |

采样器运行时接线（从 C+D registry 读 sourceVersion / pageContext /
reasons）等 C+D 路由合同冻结后由 A 总集成时接入；E 侧合同与守卫
已就绪，接线只是填数。
