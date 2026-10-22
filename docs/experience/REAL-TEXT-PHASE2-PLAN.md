# F 第二阶段：真实 TEXT 集成计划（准备稿 · 合同冻结版）

> 分支：`feat/f-real-text-phase2-20261023`（从 A 最新稳定集成基线 `feat/project-first-core-20261018@16e737c` 创建）。
> 基线含 F 演示层（PR #14 合入），Real Adapter 第一阶段（PR #25，Draft）待 A 负责人合并后并入本分支再开工能代码。
> 合同来源：C+D PR #28（Draft，HEAD `1dbaa53`）冻结声明 + `docs/architecture/sourcegraph-runtime-identity-contract.md`
> （由 A 在基线同步时入库；本文引用均以源码与 PR #28 冻结评论为准）。
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

## 4. 开发顺序（PR #25 并入本分支后开工）

1. **并入 PR #25**（A 负责人合并后 `merge` 进本分支；保持 F 第一阶段审查历史）。
2. 点选桥接通：`/project/source-selection` 真实请求 + 信封校验 + 身份评估映射到选择摘要。
3. SourceGraph 关联渲染：impact 三档确定性 UI（PR #14 页面关系组件已就绪，接入真实字段）。
4. 编辑 + Scope 决策 → `/candidate` 创建，候选状态终态优先映射（已立）。
5. 四视口验证展示 + E 证据只读对齐。
6. Approval → Apply → Rollback 接入 + 版本胶片同步（apply/rollback 响应含重分析，按 generation 守卫刷新）。
7. 全程：真实浏览器交互测试 + 截图 + 接口数据核对；与 MEDIA 保持统一候选和范围决策体验。

## 5. 验收标准

- 用户从 F 统一界面完成 §0 全链路，无需离开工作台；
- RouterProvider 场景降级符合 §3（阻断实例操作、保留页面定位、原因可见）；
- Approval/Apply/Rollback 全部经 A 正式接口，前端无任何模拟生命周期状态；
- 与 E 的证据接口只读兼容，证据标注不超过实际确定性；
- 体验层单测 + e2e + 正式 CI 全绿；交真实界面截图与缺失接口清单。

## 6. 当前阻塞项

- PR #25（Real Adapter 第一阶段）待 A 负责人确认合并；
- PR #28 合同文档 `sourcegraph-runtime-identity-contract.md` 待 A 基线同步入库；
- 上述落地前本分支只承载计划与合同映射，不改功能代码。
