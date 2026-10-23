# F 第二阶段：真实 TEXT 集成计划（执行中 · 第一批已交付）

> 分支：`feat/f-real-text-phase2-20261023`。
> 基线：A `feat/project-first-core-20261018` 最新 HEAD `fdf4a07` 已 merge 进本分支（merge `6dc3899`），
> 含 F 第一阶段（PR #14）、Real Adapter 第一阶段（PR #25，A 已合并，集成提交 `ac0da99`）与
> C+D 合同文档 `docs/architecture/sourcegraph-runtime-identity-contract.md`（已入库）。
> 合同来源：C+D PR #28 冻结声明 + 上述合同文档（本文引用以源码为准）。
> 本阶段验收目标：打开真实项目 → 点选元素 → 查看关系 → 修改与范围决策 → 生成候选 → 四视口验证 → 审批 → 应用 → 回滚。

## 1. 合同冻结要点（PR #28 冻结声明）

### 1.1 确定性字段（唯一权威判定）

**PageImpact**（`src/core/scope.ts`）：
- `certainty: 'source-proven' | 'partial' | 'unknown'` —— 唯一权威判定；`source-proven` 才可作为完整来源证明
- `pageRefs: string[]` —— 可证明的页面消费者（`page:<path>` 形式）
- `unresolved: string[]` —— 具体未决原因，逐条人读可诊断

**RuntimeIdentityAssessment**（`src/core/runtime-identity.ts`）：
- `locatable: boolean` —— 可导航定位回 JSX 源码（缺证据不阻断导航）
- `instanceIdentityProven: boolean` —— **唯一**表示"这一个渲染实例与所有其他实例被区分"。
  要求：稳定 certainty + 非空 runtimeInstanceId + 无采集原因 + fileDigest 与页面注册版本一致 + 页面上下文匹配。
  **它本身不构成任何授权**
- `sameSourceCount: number` —— 同源渲染元素数；>1 表示改源影响全部
- `reasons: RuntimeIdentityReason[]` —— 失败原因集合（共 13 项，源码为准）

### 1.2 阻断原因（`BLOCKING_RUNTIME_IDENTITY_REASONS`，六项）

`invalid-certainty` | `unmapped-owner` | `instance-unavailable` | `duplicate-runtime-instance` | `route-namespace-stale` | `react-keys-unavailable`

（更正记录：`source-version-*` 属评估侧降级原因，不在采集阻断之列。）

### 1.3 三级概念（不可混淆）

1. **完整来源证明**（PageImpact `certainty='source-proven'`）→ 仅前置输入；
2. **实例身份证明**（`instanceIdentityProven=true`）→ 未来实例级 Scope 的唯一合法起点，**本身不授予修改权限**；
3. **最终修改授权** → 只能来自 A 核心：ScopeDecision → CandidatePatch → VerificationRun → Approval → AppliedRevision。
   F 前端**不得另建模拟状态机**。

## 2. F 侧焦点 → 集成点映射

| 焦点 | 集成点（F） | 服务端合同 |
|---|---|---|
| 真实画布点选 | 预演 iframe 内注入 D 采集脚本 → `collectRuntimeIdentitySnapshot` → `runtime-selection-bridge`（`isCurrentPickerEnvelope` 校验 + `assessPickerDisplayIdentity`）→ POST `/project/source-selection`（`projectId, previewId, sourceDigest, sourceRef`）→ 响应 `element, sourceVersion, editableText[]`（每项含 `impact: PageImpact`） | PR #28 落定的 D 桥；响应 impact 已带 C 的 sourceProven 页面影响 |
| SourceGraph 关联 | 页面关系渲染直接消费 `editableText[].impact`（certainty/pageRefs/unresolved）与 analyze `targets[].impact`；`attachSourceRelations({provenUnaffectedRefs})` 挂点语义与 PR #28 对齐后启用，缺页一律 unproven/unknown | C `project-data-routes.ts`（路由证明，条件返回 fail-closed → partial；别名追踪）；PR #28 待 A 基线同步入库 |
| Scope 决策 | 范围决策 UI → `ScopeDecision` → POST `/candidate`（`projectId, rawIntent, operations[], scope`）；决策必须来自用户明确选择 + 来源证明默认值 | `src/core/scope.ts` |
| 候选创建 | 同上 `/candidate`；响应 `candidate{...}, verification, workflow` 如实映射 candidateStatus（终态优先规则在 PR #25 已立） | A 核心 |
| 浏览器验证 | POST `/candidate/verify` → 四视口截图/断言 evidence；F 只读展示 `verification.assertions/evidence`（与 E Visual Evidence 只读兼容，标注级别 ≤ 实际确定性） | A 核心（VerificationRun） |
| Approval/Apply/Rollback | `POST /candidate/approve`（需 `runId`，来自最近一次 verify）、`/apply`（仅 active+已审批）、`/rollback`（仅 applied）；stale 退役刷新界面 | A 核心身份授权规则，前端只呈现 |

## 3. RouterProvider 降级规则（任务硬约束）

**场景**：经 RouterProvider 的 data-router 链采集确定性为 `unknown` → `instanceIdentityProven=false`（PR #28 P1-4 联合测试如实记录，禁止强行升级）。

F 必须：
1. **阻断**精准实例点选/单实例修改授权流程（实例级 Scope、单实例 operations 一律不可用）；
2. **允许**页面级定位：`locatable=true` 仍可导航回源码，编辑只能落到源码级 target；
3. 界面明确显示降级原因（`reasons` 人读文案），并允许**重新采集**直到实例身份被证明；
4. `sameSourceCount > 1` 时提示"同源多实例，改源影响全部"，Scope 默认必须覆盖全部同源页或显式排除。

回归测试锚点：构造 RouterProvider 夹具（参照 PR #28 `e2e/cd-data-router-footer-fixture/`），断言
`instanceIdentityProven=false` 时 F 无实例级操作入口、页面级定位可用、原因如实显示。

## 4. 开发顺序

1. ~~并入 PR #25~~ ✅（A 已合并 `ac0da99`，merge `6dc3899` 同步进本分支）。
2. ~~点选桥接通~~ ✅（第一批）：父页 nonce 模式消息 + 信封校验（复用 A 核心
   `isCurrentPickerEnvelope`）+ POST `/project/source-selection` + 响应绑定当前
   previewId/projectId/sourceDigest + `assessPickerDisplayIdentity` 显示身份映射；
   画布工具栏「画布点选」入口（无可信预演会话时禁用并说明原因），
   点选落位只选已分析目标，绝不臆造可编辑目标。
3. ~~SourceGraph 关联渲染~~ ✅（第一阶段已立，本批未改动语义）：impact 三档确定性
   UI + `attachSourceRelations` 挂点保持 fail-closed；当前页确定性封顶规则
   （min(元素确定性, source-proven)）在 PR #14 审查轮已修复并有负例回归。
4. ~~编辑 + Scope 决策 → `/candidate` 创建~~ ✅（第一批）：审批门（approvalGate）
   调用方把关 + adapter 内二次校验（未选中 / unknown 目标 / 空草稿 / 有未决定页 /
   含未证明 include 逐条阻断）；ScopeDecision 由用户本轮显式决策构建；
   POST `/candidate` 成功后项目预演会话如实停止、回读历史，候选状态以服务端为权威；
   候选预演 `/candidate/preview[/stop]` 接入画布区 iframe。
5. ⏳ 四视口验证展示（POST `/candidate/verify`）+ E 证据只读对齐。
6. ⏳ Approval → Apply → Rollback 接入 + 版本胶片同步（apply/rollback 响应含重分析，按 generation 守卫刷新）。
7. 全程：真实浏览器交互测试 + 截图 + 接口数据核对；与 MEDIA 保持统一候选和范围决策体验。

### 4.1 第一批交付记录（2026-10-23）

- 新模块 `src/app/experience/real-selection.ts`：点选会话纯函数（nonce、模式消息、
  信封归属、响应绑定、稳定身份判定），全部复用 A 核心校验。
- Adapter 接口扩展（`adapter.ts`）：`applyPickedSource / createCandidate /
  openCandidatePreview / closeCandidatePreview`（均为可选，演示 adapter 不受影响）。
- `real-adapter.ts`：上述四方法真实实现 + 运行时身份登记（双键：sourceRef 与
  editableText 目标 id，仅显示）+ dispose 候选预演尽力清理。
- UI：`canvas-stage.tsx`（点选开关 / 提示 / 错误 / 运行时身份行 / 候选预演 iframe）、
  `scope-panel.tsx`（候选卡 + 「生成真实候选」按钮 + 审批门原因 + 真实审批未接入如实文案）、
  `experience-workbench.tsx`（picker/candidate 状态管理与过期响应忽略）。
- 测试：新增 `real-selection.test.ts`（7 例）+ `real-adapter-phase2.test.ts`（7 例），
  覆盖点选成功/会话不绑定/未分析目标拒绝、候选创建五道门、候选预演开关；
  体验层合计 77/77 单测绿，e2e 19/19 绿。
- 明确边界：四视口 Verification、Approval、Apply、Rollback 未接入，界面如实显示
  「真实审批尚未接入（验证/审批批次接入）」；审批/应用/回滚绝不在前端模拟。

## 5. 验收标准

- 用户从 F 统一界面完成 §0 全链路，无需离开工作台；
- RouterProvider 场景降级符合 §3（阻断实例操作、保留页面定位、原因可见）；
- Approval/Apply/Rollback 全部经 A 正式接口，前端无任何模拟生命周期状态；
- 与 E 的证据接口只读兼容，证据标注不超过实际确定性；
- 体验层单测 + e2e + 正式 CI 全绿；交真实界面截图与缺失接口清单。

## 6. 阻塞项状态（2026-10-23 清空）

- ~~PR #25（Real Adapter 第一阶段）待 A 负责人确认合并~~ ✅ 已合并（`ac0da99`）。
- ~~PR #28 合同文档待入库~~ ✅ `sourcegraph-runtime-identity-contract.md` 已在基线。
- 剩余依赖：第二批四视口验证与 Approval/Apply/Rollback 直接消费 A 核心既有接口
  （`/candidate/verify`、`/candidate/approve`、`/apply`、`/rollback`），合同已稳定，无新增阻塞。
