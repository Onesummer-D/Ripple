# SourceGraph × Runtime Identity 来源身份接口说明（C+D → F / E Visual Evidence）

> 版本：PR #28 HEAD `1dbaa53` 冻结版。供 F Agent（产品体验/精准点选）与 E Visual Evidence Agent（视觉证据）直接引用。
> 2026-10-23 A 总集成修订：① 明确 PageImpact 来源证明与实例身份证明为独立校验（`assessRuntimeIdentity()` 不检查 `PageImpact.certainty`）；② 精确化 `source-version-*` 采集/评估双侧产生语义；③ RouterProvider unknown 限定为已验证场景的结论。
> 本文档只描述合同，不授予任何权限；所有授权决策仍由 A 核心执行。

## 1. 三级概念必须区分（不可混用）

| 级别 | 由谁出具 | 含义 | 能否授权修改 |
|---|---|---|---|
| **完整来源证明**（source proof） | SourceGraph + Scope（`PageImpact.certainty === 'source-proven'`） | 目标的源码→页面消费者链全部可证明 | 否，仅是前置输入 |
| **实例身份证明**（instance identity） | Runtime Identity（`instanceIdentityProven === true`） | 这一个渲染实例被证明与所有其他实例区分（同源、同版本、同页） | **否**。`instanceIdentityProven=true` 本身不授予修改权限，它是未来实例级 Scope 的唯一合法起点，"never an authorization itself" |
| **最终修改授权**（authorization） | A 核心：Scope 决策 + 候选生命周期（`analyzed → scoped → candidate → verified → approved → applied`） | 唯一有效授权 | 是 |

两项校验相互独立：`assessRuntimeIdentity()` 不直接检查 `PageImpact.certainty`，来源证明不是实例身份证明在函数层面的必要条件——来源证明缺失时实例身份证明仍可能被独立出具（反之亦然）。对调用方而言，完整修改评估按级消费：来源证明是实例级修改评估的逻辑前置；实例身份证明是实例级修改评估的必要非充分条件；最终授权永远来自 A 核心的 ScopeDecision + CandidatePatch + VerificationRun + Approval 链。

## 2. PageImpact（`src/core/scope.ts`）

```ts
{
  pageRefs: string[]        // 可证明的页面消费者，形如 'page:<path>'
  unresolved: string[]      // 具体未决原因，逐条可读、可诊断
  certainty: 'source-proven' | 'partial' | 'unknown'
}
```

- `certainty` 是唯一权威判定。`'source-proven'` 表示完整来源证明；其余一律按降级处理。
- 判定规则：存在未决原因时，有页面消费者为 `partial`，否则 `unknown`；全部解析才为 `source-proven`。

## 3. RuntimeIdentityAssessment（`src/core/runtime-identity.ts`）

```ts
{
  sourceRef: string
  runtimeInstanceId?: string
  certainty: RuntimeIdentityCertainty
  page: RuntimePageContext
  locatable: boolean            // 可导航定位回 JSX 源码（缺证据不阻断导航）
  instanceIdentityProven: boolean
  sameSourceCount: number       // 同源渲染元素数；>1 表示改源影响全部
  reasons: RuntimeIdentityReason[]
}
```

`instanceIdentityProven=true` 的充要条件：`locatable && runtimeInstanceId 非空 && runtimeInstanceId !== sourceRef && reasons 为空`（稳定 certainty、无采集原因、fileDigest 与页面注册版本一致、页面上下文匹配）。

## 4. RuntimeIdentityReason（13 项，以 `src/core/model.ts` 为准）

`invalid-certainty`、`unmapped-owner`、`instance-unavailable`、`duplicate-runtime-instance`、`route-namespace-stale`、`source-version-unavailable`、`source-version-ambiguous`、`source-version-mismatch`、`source-not-in-graph`、`page-context-mismatch`、`page-context-unverified`、`react-keys-unavailable`、`identity-not-stable`。

**采集侧阻断常量**（`BLOCKING_RUNTIME_IDENTITY_REASONS`，以 `runtime-identity.ts` 实际常量为准，共六项）：
`invalid-certainty`、`unmapped-owner`、`instance-unavailable`、`duplicate-runtime-instance`、`route-namespace-stale`、`react-keys-unavailable`。

注意：`source-version-unavailable` / `source-version-ambiguous` 也可能在采集阶段产生；它们不属于六项 `BLOCKING_RUNTIME_IDENTITY_REASONS`，因此不阻断采集，但会作为降级原因进入 `reasons`（评估侧同样可能产生这两项及 `identity-not-stable`）。

路由证明降级诊断（出现在 `graph.unresolved`）：`conditional App RouterProvider mount`、`route array escapes to an unknown function`、`route array mutated through <name>`、`route table or route object mutated by assignment`、`route table or route object alias reassigned`、`目标存在非确定的消费者关系：<edgeId>`、`工程存在尚未证明的 data-router 消费者，无法确认页面影响全集`。

## 5. 三项已知边界（保留的保守降级，F/E 不得绕开）

### 边界 1：data-router 实例身份未知 → 禁止精准实例操作

在目前已验证的场景中，经 RouterProvider 的链采集确定性为 `unknown`，此时 `instanceIdentityProven=false`。这是当前已验证样本的结论，而非对所有 RouterProvider 工程的普遍结论；未来若采集链证明能力扩展，应逐场景重新验证后再更新表述。
- F：禁止按"第 N 个实例"精准点选/单实例修改授权；允许页面级定位（`locatable=true` 仍可导航回源码）与页面级影响声明；需实例级操作时必须重新采集至 `instanceIdentityProven=true`（reasons 清空）。
- E：此类实例证据只能标注"页面级/来源级"，不得标注"实例级已证明"。

### 边界 2：非数值下标别名关系未证明 → 继续降级

`resolveAlias` 只跟随 let、解引用数值下标并做符号去环；`table[key]` 等非数值下标别名不证明，命中即 `partial`/`unknown`。
- F/E：不得自行推断别名等价；按降级路径声明。

### 边界 3：条件返回中的挂载不能自动升级为完整来源证明

唯一显式 return 位于 if/switch/循环/try/catch/逻辑表达式之下时，挂载视为条件，PageImpact 封顶 `partial`。早抛守卫正例不受此限。
- F：conditional 挂载场景页面影响全集未知，不授予修改授权。
- E：证据确定性标注不得高于 `partial`。

## 6. 允许操作与降级路径

| 条件 | 允许 | 禁止 |
|---|---|---|
| `certainty='source-proven'` 且 reasons 为空 | 完整来源证明声明；进入 A 核心 Scope 决策 | 直接修改（仍需 §1 第三级） |
| `locatable=true`、`instanceIdentityProven=false` | 导航定位回源码；页面级证据/影响声明 | 精准实例点选、单实例修改授权 |
| 任一安全边界命中 | 按降级路径声明（`partial`/`unknown`）并记录 unresolved 原因 | 升级为 `source-proven` 或实例级已证明 |

**降级路径**：命中边界 → 读取 `unresolved`/`reasons` 定位原因 → 以降级的确定性继续后续流程（导航、页面级证据、重新采集申请）→ 将原因原样带入 A 核心，不得吞掉或改写。

## 7. 与 A 候选生命周期的衔接

本文档所有字段只覆盖"证明与身份"层。修改授权必须经过 A 核心的完整链路：`ScopeDecision`（scopeVersion）→ `CandidatePatch`（baseSourceDigest / patchHash / candidateTreeDigest）→ `VerificationRun`（evidence、baselineComparisons）→ `Approval` → `AppliedRevision`。任何消费方不得仅凭 SourceGraph 或 Runtime Identity 的字段跳过该链路。
