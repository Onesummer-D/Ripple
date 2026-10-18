# Project-first 扩展契约提案（供 B 审阅）

**状态：提案，尚未冻结。** 本文请求 B 对接口边界与字段充分性给出确认；在确认前，不代表团队已批准，也不应据此扩展 MEDIA / TOKEN 编辑能力。

## 目标与已有事实

Ripple 的 Project-first 核心对象定义在 `src/core/model.ts`，会话转换在 `src/core/session.ts`。它们是本提案的领域事实基线，不再为 B 的实现另建一套平行的 Session、Scope、Operation 或 Evidence 状态机。B 的 ts-morph、Git worktree 和 Playwright 能力应作为适配/执行实现提供者，结果映射到以下契约。

目前已有 `ProjectRevision`、`SourceGraph`、`EditSession`、`EditOperation`、`ScopeDecision`、`CandidatePatch`、`VerificationRun`、`VerificationEvidence` 与 `.ripple/overrides.json`（schema v2）。当前本机适配主要支持已分析的 React/Vite 工程和 TEXT 操作；未被真实执行器证明的关系及断言仍是 `unknown`，不能通过适配器将其升级为通过。

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
| 实验 | `EditOperation.before` / `after` 目前是字符串 | 当前经过执行器验证的是 TEXT。MEDIA 焦点/裁切与 TOKEN 值结构尚未定型；B 应提交带 kind 判别的值样例与序列化需求，双方评审后再决定最小类型联合，不要把 JSON 编码塞入字符串后宣称契约冻结。 |
| 实验 | `RuntimeSourceMap` 的实例级写入授权 | 浏览器点选可用于源码导航；在宿主核验实例唯一性、候选、源码摘要、页面状态及运行时指纹前，不可授权实例精准修改。 |
| 实验 | 任意 React/Vite 工程的运行命令与完整浏览器验收 | 当前受限预演适配是已验证的窄路径，不等同于一般项目的构建兼容承诺。 |

### 适配器交接的最小输入输出

- 项目/媒体/Token 分析返回 `SourceGraph` 增量事实或可映射节点与关系；明确指出证据来源和 certainty。不能返回独立 session、scope 或 candidate ID 空间。
- 编辑工具只生成一个 `EditOperation` 值提案（kind、targetRef、before/after、必要的目标元数据）；用户确认后进入原 `EditSession.operations`。同一次会话可混合 kind，但候选执行器必须拒绝自身尚未支持的 kind，不能静默忽略。
- Candidate 执行输入必须携带当前 `ProjectRevision`、完整图、ScopeDecision 和操作列表。候选及 patchHash 仍由 Ripple 唯一执行器生成。
- Verification 输入使用已确认的 CandidatePatch 和受支持检查契约；输出为页面/视口/状态观察及截图引用。原工程基线、scope 与操作影响的真实性不能由 B 的工具摘要替代。
- 覆盖维护使用同一个 UUID registry；相同 AST 锚点重复编辑更新旧 rule，来源删除或映射不唯一时返回 conflict/unknown，不按相近文案猜测恢复。

### 必须由共同测试锁定的行为

1. 同一 EditSession 可序列化、恢复混合 kind 操作；旧的 TEXT 操作及审批数据不因增加操作种类改变语义。
2. `included`、`excluded`、`protected`、共享影响及页面覆盖传播由唯一 Scope 规则计算，执行器对越界影响拒绝补丁。
3. 一次 CandidatePatch 含全部已确认操作；候选 SHA、树摘要、审批及应用记录指向相同字节。
4. B 工具不能自行构造可信 Evidence；执行失败、缺图、哈希不匹配或 stale 版本均不可批准。
5. 页面覆盖在重新分析、连续修改、规则移除、冲突恢复后保持唯一规则和幂等 AST 变换。

**冻结条件补充：** 上表标为“稳定”的语义可以由 B 映射使用；Adapter 名称、非 TEXT 的 operation value schema 及运行时实例授权仍待双方审查和同一组契约测试，不因本文进入 PR 就自动视为冻结。

### A 侧 EditOperation 最小兼容建议（尚待 B 确认）

B 在 PR #3 提出的 kind 判别联合方向可保留；兼容关键是区分“简单值替换”和“结构化资源操作”，而不是把所有 MEDIA / TOKEN 一律改成必须携带 payload。当前 `EditOperation` 的 `id`、`targetRef`、`before`、`after` 及可选 `overrideAction` 继续作为公共字段；简单字面量型 MEDIA / TOKEN 可维持现状，只有结构化操作携带按 `kind` 收窄的 payload：

```ts
type EditOperation = EditOperationBase & (
  | { kind: 'TEXT' | 'CODE'; payload?: never }
  | { kind: 'MEDIA'; payload?: MediaOperationPayload }
  | { kind: 'TOKEN'; payload?: TokenOperationPayload }
)
```

`payload` 缺省只表示既有的简单 `before/after` 操作；若操作意图需要资产字节、焦点裁切或 Token 定义等结构化字段，则由对应的 payload 子类型表达完整输入。执行器对缺字段、未知 payload 版本或当前不支持的结构化操作必须拒绝，不能忽略 payload 后退回字符串替换。`TEXT` / `CODE` 在类型层面禁止带 payload。

最小接入点是：`session.ts` 保留既有 `before/after` 不变量并验证 kind/payload 组合；`candidate.ts` 只执行其明确支持的变体，将结构化资源实际字节纳入同一候选树、patchHash 和应用/回滚；`verification-runner.ts` 只对执行器实际产生的候选与运行结果生成 Evidence，不从 payload 描述推定验证通过。当前候选执行器仍只证明了 TEXT；本建议不是宣称 MEDIA/TOKEN 已可执行。B 对该兼容形状及各自 payload 必需条件的回复、共享序列化/拒绝测试通过之前，类型仍保持未冻结，`OverrideRegistry` v2 也不迁移。

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

## 当前实现边界与请 B 确认的问题

1. 以上 `ProjectAdapter` / `CandidateExecutor` / `VerificationExecutor` 的职责是否与 B 的模块边界兼容？B 是否已有可直接映射的接口签名？
2. `ProjectRevision.runtimeFingerprint` 目前是字符串指纹。真实预演所需的 Node、包管理器、锁文件和启动命令信息，建议作为其生成依据还是单独随运行记录提供？
3. `RuntimeSourceMap` 目前描述来源和身份确定性；在实例级编辑开放前，B 是否能提供按候选 hash、运行环境、页面状态绑定且可由宿主复核唯一性的观测记录？当前 iframe 自报的 instance ID 不是编辑授权。
4. `EditOperation.before` 对带页面覆盖的目标仍是源码值；页面局部预期值来自 `expectedTextForPage`。请确认 B 执行与展示流程能够保留“共享 fallback”和“当前实例实际值”的区分。
5. 若 B 的媒体处理已具备 focal point / responsive variants 能力，请先提交现有领域对象、许可与依赖信息供契约评审；本提案不要求本轮复制实现。

**冻结条件：** B 书面确认职责和字段，A/B 以同一组契约测试验证序列化、Scope 拒绝、patch/evidence 一致性和页面覆盖维护，再决定是否冻结版本。此提案不宣称已完成 Bolt 专项、Windows/WSL2 实测或任意 React/Vite 适配。

