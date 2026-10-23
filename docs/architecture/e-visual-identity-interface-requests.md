# E 视觉接线 × C+D 身份合同接口需求（交付 C+D 确认）

状态：已交付 C+D Agent（本文档随 A HEAD `dc8269f` 进入公共核心，C+D 新分支
自 A HEAD 切出即接收）；与 AC-P2a/b 并行，不构成其前置。
请求方：E（PR #30，`feat/e-visual-wiring-20261023`）；协调与审查：A。
基准代码：`dc8269f` 的 `src/core/runtime-identity.ts` / `src/core/model.ts`。

## 1. identityAssessment

现有 `RuntimeIdentityAssessment`（runtime-identity.ts:195）：

```
sourceRef / runtimeInstanceId? / certainty / page /
locatable / instanceIdentityProven / sameSourceCount / reasons
```

- `instanceIdentityProven === true` 的通过条件（以代码注释为准，请 C+D
  确认对外冻结）：stable certainty（stable-keyed-instance /
  stable-react-instance）+ 非空 `runtimeInstanceId` + 无采集期 reason +
  `context.fileDigest(file)` 读数等于页面注册版本 + 显式 `expectedPage`
  且 `samePage` 匹配。
- **E 侧判定严格实例证明不得以 `identityAssessment != null` 代替
  `instanceIdentityProven === true`**；`locatable === true` 仅授权
  导航到源码（`createRuntimeSourceMap` 路径），不构成实例级结论。
- 请确认：`RuntimeIdentityReason` 词表对 E 的只读冻结范围；
  `fileDigest` 的项目/候选/来源版本绑定口径（必须读与 SourceGraph
  同一修订的摘要；候选场景 = 候选 worktree 修订）。

## 2. Runtime observations

- 现状（runtime-identity.ts:170 `selectableRuntimeObservations`）：仅收集
  有 `runtimeInstanceId`、certainty ≠ unknown/unmapped、且无降级 reason
  的记录；position-dependent 保留可导航，但 `resolveRuntimeElement`
  拒绝其为实例目标。
- 请确认：E 验证容器（Docker 四视口）允许采集哪些观测值进入
  `RuntimeIdentitySnapshot`；观测工件如何与当前 VerificationRun 绑定
  （runId / revision 字段形态）；`createRuntimeSourceMap` /
  `resolveRuntimeElement` 对接边界是否允许 E **只读消费** observation
  级数据（E 不侧重评估身份，评估一律回到 `assessRuntimeIdentity`）。

## 3. RuntimePageContext

- 现状（model.ts:57）仅 `pathname / search / hash` 三元组。
- 请确认：三元组之外是否存在路由树位置、命名空间或实例定位的验证
  依据；在仅有三元组的现状下，**page-context 从 E `missingEvidence`
  安全移除的最低条件**——候选口径：双侧 snapshot.page 三元组一致，
  且该页面属于 SourceGraph 路由证明集合（route 节点可证明）。
- collection-reasons 与 graph-membership 的移除条件同理由 C+D 给出
  （每项移除需对应证据来源，不无依据清空）。

## 4. 红线（E + C+D 合并前后均须成立）

- 视觉证据只读辅助，`view.state` 无 `pass`；
- `missingEvidence` 不被无依据清空；
- 严格实例证明必经 `assessRuntimeIdentity()` 完整评估
  （`instanceIdentityProven === true`）；
- Approval / Receipt / Apply 安全合同不变；
- PR #29 与 PR #30 重叠代码只合入一次。

## 5. 新增公共字段纪律

接线必须新增公共字段时：先给出精确类型 + 最小样例（字段名、取值域、
生产者/消费者、版本化策略），交 A 登记、C+D 确认后 E 再接入。

## 6. 两阶段执行（A 协调，2026-10-23 确认）

- **阶段一（现在）**：E 修复 legacy sourceVersion 多文件 P1、CI 全绿后，
  A 启动 PR #30 只读视觉证据集成预演（基线 `dc8269f`）：验证真实
  VerificationRun、`run.visualEvidences` API View、证据隔离、审批门控
  不变。此阶段 `strictInstanceProofAvailable` 保持 false，完整严格
  实例证明继续禁用；**不以本节三项书面确认为前置**。
- **阶段二（C+D 合同到位后）**：严格实例证明接线与升级验收，单独交付；
  必须验证 `instanceIdentityProven`、版本一致与运行身份匹配，不得仅
  检查对象非空。
