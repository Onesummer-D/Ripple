# RFC：E geometry sampler 身份采集最小扩展合同

分支：`feat/e-visual-verification-integration-20261023`（E 独立冻结 `0dd2e91`）；
接线实现：`feat/e-visual-wiring-20261023`（第二批）
状态：**E 自有合同字段、配对守卫与 C+D 真实接线均已实现**；
**严格实例证明（strictInstanceProofAvailable=true）仍待 A/C+D 提供
`identityAssessment` 与运行时观察合同，E 永不自行构造。**
背景：`source-ref-dual-alignment.md` §1/§5，`scope.missingEvidence`
逐项含义见下文。

## 1. 目标

让 `pairCrossVersionElements` 的 `scope.missingEvidence` 可以逐项清空，
最终使实例候选配对在证据齐全且 C+D 完整身份评估通过时升级为 C+D 口径
的严格实例证明，同时保持：视觉证据只读、辅助、永不 PASS；不改 A 审批
门控与 Receipt。

## 2. sourceVersion（已接线）

- **实际来源**：served 源码文件的 SHA-256。C+D 侧由
  `sourceAnnotationPlugin` 在标注模块加载时把 `<sourceFile, sha256>`
  注册进 `globalThis[Symbol.for('ripple.runtime-identity')].sourceVersions`
  （PR #28 `runtime-identity.ts`）。E 的页内采样器（
  `visual-geometry-sampler.mjs`）**从同一 registry 读取**（
  `sourceVersionHistory` 中同一文件出现多个 digest 时该文件整项省略，
  不归属任一版本），不允许自行再哈希源文件。**已接线。**
- **粒度**：采样合同新增 `sourceFileVersions`（`file → sha256`，
  ≤64 项，解析器校验）。页面含多个来源文件时以映射为准；旧单字段
  `sourceVersion` 仅在整页恰好一个来源文件且版本已解析时填充，
  多文件页面恒为 null——**不再允许单文件哈希代表整页元素**。
  解析器对 `sourceFileVersions` / `pageContext` 的校验与
  `sourceVersion` 同口径：非法即拒绝整个样本。
- **验证方式（宿主侧，已接线）**：`visual-verification-attach.ts` 用 C+D
  `sourceFileDigest` 按侧取预期摘要——baseline 侧绑定
  `candidate.projectRoot`（基线预演服务的工作树），candidate 侧绑定
  `candidate.candidateRoot`（候选 worktree），逐文件 memo。读不出摘要
  的文件不产出条目：未核验，永不当匹配，也永不发明。
- **配对语义（已实现 + 已接线）**：`pairCrossVersionElements` 第三个可选
  参数 `options.expectedSourceVersions` 提供后：
  - 每一侧自己的采集版本与其**自身修订**预期摘要不一致 =
    `source-version-mismatch`（硬矛盾，落 unproven）；检查按
    sourceRef 解析出的来源文件进行，**不依赖两侧 sourceRef 字符串一致**
    （offset 漂移保留文件、不保留偏移，版本失效仍被识别）。
  - 合法跨版本差异（H1 != H2 且各自有效）**不是**矛盾，
    instance-candidate 维持。
  - 预期摘要或采集版本缺失 = 未核验：`missingEvidence` 继续列
    `source-version`，但不判失效。
  - 不传 `options` 时保留旧保守语义（任何声明差异只记降级原因），
    冻结期全部旧测试不受影响。

## 3. pageContext（采集已接线，严格证明输入仍缺失）

- E 已采集：`route` + `locationSuffix`（sha256 化）配对守卫（不同即
  `different-page-context`）。
- **已接线**：采样合同新增 `pageContext`（C+D `RuntimePageContext`
  序列化形态 `{pathname, search, hash}`，解析器有界校验），来自页内
  `location`，与 C+D 采集器同源同形态。
- **仍缺失**：C+D 完整页面身份（pathname 命名空间、路由树位置、每页
  token）的**核验**合同未冻结，`missingEvidence` 的 `page-context`
  项保持列出；E 只采集展示，不据此升级。

## 4. reasons 的采集与评估区分（采集已接线）

- **已接线**：E 采样器通过 `buildDomGeometrySampler(collectorSource)`
  嵌入 C+D `collectRuntimeIdentitySnapshot` 的序列化源（与
  `candidate-preview-vite.config.mjs` 同一模式；collector 源由宿主
  `verification-runner` 经 `input.json` 以数据形式下发，容器纯 Node
  无 TS 变换，永不 import `.ts`）。元素按 C+D 认可的 label 关联属性
  模式逐元素对应，`record.reasons` 原样进入元素级 `identityReasons`
  （≤8 条、≤64 字符，解析器有界）。**E 不重评估、不发明 reason。**
- 采集器缺失/抛错时降级为 null（证据缺失），几何采集不受影响。
- 评估期不变：配对器只把 C+D blocking reason 作为降级事实
  （`blocking-identity-reason`）。
- `RuntimeIdentityReason` 词表按 C+D PR #28 只读消费。

## 5. offset 漂移的可证明映射（未决，维持候选配对）

- 问题与请求不变（稳定锚或构建期映射表，随 candidate 工件哈希绑定）。
- 在 C+D 答复前，E 配对到 `instance-candidate` 即停止；sourceRef 只做
  同文件检查。版本核验（§2）已不依赖字符串一致。

## 6. 严格证明开关（类型级收紧）

`strictInstanceProofAvailable` 现为
`missingEvidence.length === 0 && options.identityAssessment != null`：

- `identityAssessment` 只由 A/C+D 提供（C+D 完整身份评估结果），
  **E 永不构造**；即使未来 `missingEvidence` 清空，无评估结果严格证明
  恒不可用，从合同上杜绝空数组误升级。
- 当前 `page-context` / `collection-reasons` / `graph-membership` 三项
  无条件列出（C+D 路由合同与运行时观察合同未接入），故现网恒为 false。

## 7. E 自有已实现清单

| 项 | 状态 |
|---|---|
| 采样合同 `sourceVersion`（可选，sha256 校验，缺失=null） | 已实现（解析器 + 类型） |
| 采样合同 `sourceFileVersions`（file→sha256 映射，有界校验） | 已实现 + 已接线 registry |
| 采样合同 `pageContext`（C+D RuntimePageContext 形态） | 已实现 + 已接线 |
| 采样合同元素级 `identityReasons`（可选，有界） | 已实现 + 已接线 C+D collector |
| 配对守卫 `different-page-context`（route/location suffix） | 已实现 + 测试 |
| 配对守卫 `source-version-mismatch` / `blocking-identity-reason` | 已实现 + 测试 |
| 按侧预期摘要核验（C+D sourceFileDigest，offset 漂移不失效漏检） | 已实现 + 测试 |
| 合法跨版本哈希差异不降级（各自有效维持 instance-candidate） | 已实现 + 测试 |
| 严格证明开关类型级收紧（identityAssessment 门） | 已实现 |
| 多无 ID 元素同 sourceRef 禁止数组顺序配对 | 已实现 + 测试 |
| `scope{level, strictInstanceProofAvailable, missingEvidence}` | 已实现 + 测试 |
| ViewModel 降级呈现（`crossVersion` additive + 中文标签） | 已实现 + 测试 |

## 8. 剩余 A/C+D 联合集成项（E 不单独推进）

- `identityAssessment`：C+D 完整身份评估结果传入配对（唯一升级路径）。
- 运行时观察合同：验证容器内采集 C+D runtime observations，
  供 `createRuntimeSourceMap`/`resolveRuntimeElement` 正式评估。
- `RuntimePageContext` 命名空间/路由树核验合同冻结后清空
  `page-context` 项。
- 真实 `sourceFileVersions` 全链路已在 `attach` 接线；F 消费
  `run.visualEvidences[].view` 已在 `verificationView` 暴露（只读投影，
  宿主工件路径不外泄）。
