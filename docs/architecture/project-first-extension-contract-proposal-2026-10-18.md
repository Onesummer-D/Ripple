# Project-first 扩展契约（A/B 对齐记录）

**状态：五项 A/B 接口决策已互相接受；公共契约仍未冻结。** B 在 PR #3 评论 `6259317121` 逐项接受 subtype 命名、Session 错误格式、响应式 mechanism、CSS Token Scope 证据语义及运行环境字段位置。冻结仍需共同复核契约测试；结构化 MEDIA/TOKEN 执行和资产字节完整性尚未实现，本文不把类型定义等同于产品能力。

## 目标与已有事实

Ripple 的 Project-first 核心对象定义在 `src/core/model.ts`，会话转换在 `src/core/session.ts`。它们是本提案的领域事实基线，不再为 B 的实现另建一套平行的 Session、Scope、Operation 或 Evidence 状态机。B 的 ts-morph、Git worktree 和 Playwright 能力应作为适配/执行实现提供者，结果映射到以下契约。

目前已有 `ProjectRevision`、`SourceGraph`、`EditSession`、`EditOperation`、`ScopeDecision`、`CandidatePatch`、`VerificationRun`、`VerificationEvidence` 与 `.ripple/overrides.json`（schema v2）。受限的 React/Vite TEXT 候选闭环已实现；payloadless 字面量操作沿既有执行路径处理。结构化 `asset-swap` / `local-projection` 目前只有已校验的领域输入，候选执行器仍 fail-closed 拒绝。未被真实执行器证明的关系及断言仍是 `unknown`，不能通过适配器将其升级为通过。

## 共享领域契约

| 概念 | 现有规范对象 | 生产者 / 消费者约束 |
|---|---|---|
| 项目修订 | `ProjectRevision` | 项目读取器提供源摘要、Git 基线（若可得）及 runtime fingerprint。 |
| 源码与影响图 | `SourceGraph` / `SourceNode` / `Relation` | 分析器产生；只有可追溯的 `source-proven` 边参与写入影响闭包。运行时观察、语义候选和未知关系保留各自确定性。 |
| 编辑会话 | `EditSession` | 唯一流程容器；候选、验证、审批、应用、回滚均属于同一 session。 |
| 操作 | `EditOperation` | `kind` 表示 TEXT / MEDIA / TOKEN / CODE；操作以 `targetRef` 指向源码图目标，`before/after` 表示操作值。具体执行器不得忽略同一操作集合中的前项。 |
| 范围决策 | `ScopeDecision` | 用户选择的 included / excluded / protected refs、策略、操作者及版本。执行器必须独立校验源码传播；页面局部覆盖仍须排除或保护所有其他已证明消费者。 |
| 候选 | `CandidatePatch` | 只包含真实 worktree 产出的补丁和候选树摘要；`patchHash`、基线摘要、Scope ID/version 必须可复算、匹配。 |
| 验证 | `VerificationRun` / `VerificationEvidence` | 仅可信执行器创建可批准的回执；每项记录绑定候选、Scope、源码、运行环境、页面、视口、状态和工件摘要。缺少执行证据时结果为 unknown / not-run / stale。 |
| 页面覆盖 | `PageOverrideRegistry` | `.ripple/overrides.json` 记录 UUID 目标、页面值与源码 fallback；AST 标记是目标锚点。无法唯一映射或删除时必须报告冲突，不按位置猜测。 |

这些对象的字段与约束以 TypeScript 定义和领域断言为准。适配器可以转换外部格式，但不应改变 ID、范围和证据含义。

## 稳定边界与实验边界（2026-10-18）

| 状态 | 契约 / 实现 | B 集成约定 |
|---|---|---|
| 稳定 | `ProjectRevision` 的 `projectId`、`sourceDigest`、可选 Git commit/ref、`runtimeFingerprint` | 使用 Ripple 读取器产生的版本和摘要；B 可提供补充分析事实，但不维护第二份项目版本状态。 |
| 稳定 | `SourceGraph` 节点、关系 `certainty` 与 `evidenceRefs` | TEXT/MEDIA/TOKEN 可复用同一图；只有可追溯的 `source-proven` 消费关系进入自动写入影响闭包。 |
| 稳定 | `EditSession`、版本化 `ScopeDecision`、候选/验证/审批/应用生命周期 | B 的操作加入同一个 session，并通过已有 `stageOperations` / `createCandidate` 流程；不得另建媒体或 Token 候选生命周期。 |
| 稳定 | `CandidatePatch` 的基线、Scope 版本、补丁 SHA-256、候选树摘要 | B 的操作最终由唯一候选执行器落到同一个 worktree 和同一份补丁；工具输出不能自行声明已应用。 |
| 稳定 | `VerificationRun` / `VerificationEvidence` 的可信执行器与版本绑定 | 浏览器截图和 Playwright 记录由执行器生成并由接收边界复算；分析器或媒体工具只能报告观察，不得制造 `pass`。 |
| 稳定 | `.ripple/overrides.json` schema v2 的 UUID 目标及页面覆盖维护语义 | 复用目标身份、更新与删除规则；禁止以源码偏移生成长期 ID 或建立第二个覆盖注册表。 |
| 待确认 | `ProjectAdapter`、`CandidateExecutor`、`VerificationExecutor` 的接口名称与具体调用形状 | 作为职责草案，B 可给出现有函数映射；不为形式统一增加空包装器。 |
| 已实现、尚未冻结 | `EditOperation` payloadless 与结构化分支 | payloadless TEXT/MEDIA/TOKEN/CODE 保持现状；结构化 MEDIA 用 `asset-swap` + `MediaAssetSwapPayload`，结构化 TOKEN 用 `local-projection` + `TokenLocalProjectionPayload`。`session.ts` 校验字段路径、hash 格式、mechanism 与 kind/action/payload 配对；合法但未实现的执行器返回 `unsupported-operation`。不得回退为字符串替换。 |
| 未实现 | 结构化 MEDIA/TOKEN 候选执行 | 类型中的资源引用和摘要还不能代替实际资产字节；MEDIA 执行器必须暂存字节至候选 worktree，并让候选树、patch 与 Evidence 校验同一字节。TOKEN 局部投影执行与对应浏览器断言同样未实现。 |
| 实验 | `RuntimeSourceMap` 的实例级写入授权 | 浏览器点选可用于源码导航；在宿主核验实例唯一性、候选、源码摘要、页面状态及运行时指纹前，不可授权实例精准修改。 |
| 实验 | 任意 React/Vite 工程的运行命令与完整浏览器验收 | 当前受限预演适配是已验证的窄路径，不等同于一般项目的构建兼容承诺。 |

### 适配器交接的最小输入输出

- 项目/媒体/Token 分析返回 `SourceGraph` 增量事实或可映射节点与关系；明确指出证据来源和 certainty。不能返回独立 session、scope 或 candidate ID 空间。
- 编辑工具只生成一个 `EditOperation` 值提案（kind、targetRef、before/after、必要的目标元数据）；用户确认后进入原 `EditSession.operations`。同一次会话可混合 kind，但候选执行器必须拒绝自身尚未支持的 kind，不能静默忽略。
- Candidate 执行输入必须携带当前 `ProjectRevision`、完整图、ScopeDecision 和操作列表。候选及 patchHash 仍由 Ripple 唯一执行器生成。
- Verification 输入使用已确认的 CandidatePatch 和受支持检查契约；输出为页面/视口/状态观察及截图引用。原工程基线、scope 与操作影响的真实性不能由 B 的工具摘要替代。
- 覆盖维护使用同一个 UUID registry；相同 AST 锚点重复编辑更新旧 rule，来源删除或映射不唯一时返回 conflict/unknown，不按相近文案猜测恢复。

### A/B 共同测试锁定的行为与当前证据

1. **操作类型与序列化**：payloadless TEXT/MEDIA/TOKEN/CODE 兼容；结构化 action/payload 必须匹配；未知、缺失或畸形负载有字段路径地拒绝；JSON 往返后未实现执行器仍明确拒绝。A 的 `session.test.ts` 覆盖该边界，结果以对应 PR #2 commit 检查为准。
2. **Scope fail-closed**：included/excluded/protected、未知消费关系与页面传播由现有 Scope/candidate 规则判断；`scope.test.ts`、`project.test.ts` 和工作台 E2E 覆盖已支持的 TEXT 场景。未证明的关系仍为 UNKNOWN。
3. **同一补丁与证据**：现有测试校验多操作候选、审批/应用哈希、候选树、Scope 版本、运行环境和可信浏览器回执的一致性；四视口及未执行检查也在执行记录与 UI E2E 中核对。
4. **资产字节完整性**：篡改候选资产字节后 patch/tree/evidence 必须失败。此项尚不能执行验收，因为结构化 MEDIA 候选和 asset staging 尚未实现；不能用仅校验 `assetHash` 字符串的 schema 测试代替。
5. **覆盖幂等性**：TEXT registry v2 的连续维护、删除最后规则与源码清理已有自动化 E2E；不迁移到 registry v3，待真实 MEDIA/TOKEN 任务验证结构后再议。

**冻结条件补充：** 五项 A/B 决策已被双方接受，代码与测试是当前基线；这不代表结构化执行能力存在，也不单方面冻结契约。A/B 需共同确认上述已有测试足以固定共享边界，并在 B 的 MEDIA 垂直闭环中补齐实际资产暂存、篡改拒绝与四视口 Evidence 测试。TEXT registry v2 继续原样保留。

### 已确认的 EditOperation 最小兼容形状

B 在 PR #3 §4.1 的判别联合方案与 A 兼容边界已经互相接受。源头定义以 `src/core/model.ts` 为准：简单操作保持 payloadless，且类型与运行时都禁止额外 `action` / `payload`；结构化操作必须由 `kind`、命名 `action` 与必需的匹配 payload 组成：

```ts
type PayloadlessEditOperation<K extends EditKind> = EditOperationBase & {
  kind: K; action?: never; payload?: never
}
type EditOperation =
  | PayloadlessEditOperation<'TEXT' | 'CODE' | 'MEDIA' | 'TOKEN'>
  | (EditOperationBase & { kind: 'MEDIA'; action: 'asset-swap'; payload: MediaAssetSwapPayload })
  | (EditOperationBase & { kind: 'TOKEN'; action: 'local-projection'; payload: TokenLocalProjectionPayload })
```

稳定校验错误为 `SessionInvariantError`，API 形态 `{ error, code, path? }`，code 为 `invariant-violation | invalid-operation | unsupported-operation`；例如 `operations[0].payload.assetHash`。响应式 mechanism 为 `srcset | picture | css | container-rule`，必须匹配项目真实消费者与非空条件，不能从 viewport 标签推断。CSS Token 的文件级定义、`var()` 或普通 imports 不证明页面消费；只有可渲染 component/route 上 source-proven 的 `uses-token` / `css-cascade` 关系才证明页面影响。`runtimeFingerprint` 属于 `ProjectRevision` 并复制到 `VerificationRun`；详细 `RuntimeEnvironment` 由受信任执行器记于 `VerificationRun.execution`。

最小接入点已经实现于 `session.ts` 的运行时组合校验和 Candidate 的 fail-closed 拒绝。候选执行器只运行已实现的 payloadless 路径；任何未实现结构化 action 都返回 `unsupported-operation`，绝不忽略 payload 后做字符串替换。这个接口形状仍待双方依据共同测试确认，`OverrideRegistry` v2 不迁移。

## 建议的窄适配接口

下面是供讨论的形状，不是要求一次性实现新的抽象层。现有 `analyzeProject`、`createCandidate` 和 `runCandidateVerification` 可逐步满足这些职责，无需为了接口形式增加空包装。

```ts
interface ProjectAdapter {
  readonly id: string
  supports(projectRoot: string): Promise<{ supported: boolean; reason?: string }>
  readRevision(projectRoot: string): Promise<ProjectRevision>
  analyze(projectRoot: string, revision: ProjectRevision): Promise<SourceGraph>
}

interface CandidateExecutor {
  create(input: {
    projectRoot: string
    revision: ProjectRevision
    graph: SourceGraph
    scope: ScopeDecision
    operations: EditOperation[]
  }): Promise<CandidatePatch>
  discard(candidate: CandidatePatch): Promise<void>
}

interface VerificationExecutor {
  run(input: {
    candidate: CandidatePatch
    session: EditSession
    baseline: ProjectRevision
  }): Promise<VerificationRun>
}
```

适配器负责“读与解释项目”，候选执行器负责“在隔离副本变更”，验证执行器负责“在声明的支持范围内真实运行与采证”。用户审批与正式应用由核心工作流负责，不能委托给编辑 Agent 重新生成修改。候选执行器输入包含明确 Scope；它仍须根据源码关系校验传播，不能把调用方给出的 refs 当作安全证明。

若 B 现有实现无法直接落入某职责，应先指出职责冲突和已有证据，再协商调整，而不是复制一套领域模型。`supports` 应返回明确的不支持原因；它不应以猜测性 fallback 将任意工程标成受支持。

## Evidence 与审批信任边界

验证器输出先落为执行记录，再由 Ripple 受信任接收路径核实：执行器、run ID、candidate ID、patch hash、candidate tree digest、base source digest、Scope ID/version、runtime fingerprint、contract hash、每个 page/viewport/state、截图 PNG 签名与 SHA-256 都必须一致。恢复进程时应重新验证持久记录和工件，不能依靠内存对象身份或调用方提交的截图路径。

只有当前候选的最新完整 run 满足所有必需断言为 `pass`，状态机才可批准。审批只引用候选和验证 run；应用按同一 `CandidatePatch` 运行，先检查 Git 基线与候选完整性。发生漂移则拒绝应用；回滚发现应用后新增的用户修改则拒绝覆盖。

## 页面覆盖约定

- `override:<uuid>` 是持久目标 ID；JSX `RippleText` 标记把 UUID 与真实源码 fallback 关联。源偏移只用于本次分析位置，不是长期 ID。
- 同一目标后续编辑更新现有 registry 规则；新目标才产生新 UUID。
- 同一页面/目标的实际 baseline 是当前页面的已生效值，即现有页面覆盖优先于共享源值。候选值根据 Scope 计算；其他消费者保持其 Git baseline 的生效值。
- 注册表、runtime import 和页面 Provider 是可重复维护的 AST 变换。新增、更新、移除规则应能重复执行且不产生重复 Provider / import；最后一项规则移除时，删除无用注入代码和注册表。
- `src/core/scope.ts` 应是页面实际值预期的唯一纯计算入口。浏览器 runner 与领域校验消费同一结果，不复制 Scope 分支规则。

## 当前实现边界与协作项

1. 五项接口决策已由 B 在 PR #3 评论 `6259317121` 明确接受。PR #2 的 `session.test.ts` 覆盖结构化 payload JSON 往返、mechanism 与局部投影 schema 负例；共享 Scope/证据/四视口测试继续以现有模型为准。
2. B 请将 PR #4 分支 rebase 到最新 PR #2 后重跑 Linux/Docker CI 与冻结的 Qingye/Lovable 探针；A 随后只复验联合 SourceGraph + Scope 与公共契约，不改 B 负责的 `project.ts`。
3. 真实 Bolt 工作台验收仍依赖私有仓库只读输入和 Docker/受支持 Linux；本轮未能运行，工作台的合成 React/Vite CI 不能替代。
4. iframe 回传的实例 ID 仍只作导航/定位信息，不是编辑授权。MEDIA 焦点/变体与 TOKEN 局部投影继续显式不可执行，直至真实候选、字节完整性和受信 Evidence 完成。

**冻结条件：** 五项领域决策已有 B 的书面确认；双方还需确认共享契约测试范围，并将真实资产字节的 CandidatePatch/Evidence 完整性回归落到 MEDIA 执行器的端到端实现后，才能决定是否冻结版本。本文不宣称已完成 Bolt 专项、Windows/WSL2 实测或任意 React/Vite 适配。

