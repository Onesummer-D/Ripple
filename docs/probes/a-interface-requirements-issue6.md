# 给 A 的 Issue #6 公共接口需求（可复制评论文本）

> 用途：粘贴到 Issue #6 评论。当前 B 侧凭据对 REST 写操作 401，未能自行发布，
> 文本由协调人/负责人代发。以下需求均附精确复现链接，不阻塞 A 当前 TEXT 核心工作，
> 可登记待 A 当前核心稳定后处理。

---

## A-P1a：React Router data router 路由识别（codescandy TEXT 候选第一阻塞）

**需求**：支持可静态证明的 `createBrowserRouter` route/component 关系，
覆盖 `element: <X />` 与 `Component: X` 两种基础模式；对嵌套 children、index route、
相对 path、动态参数（`:id`）、无法解析的组件采取明确的 partial/unknown 语义。

**约束**：
- 必须建立 route → component → source 的证明关系，**不是**放宽 Candidate 门控；
- 不能仅检测到 `createBrowserRouter` 字符串就生成 source-proven 页面关系；
- route 定义存在、组件可解析、渲染关系可证明是三个独立层次。

**复现**（最小真实工程，当前 0 route 节点、页面影响 fail-closed 为 unknown）：
`src/core/b-thirdparty-capability-repro.test.ts` → describe「codescandy 真实 data router 结构」。

## A-P1b：TypeScript 配置图与解析失败归因

**需求**：
1. 实现更通用的 tsconfig `references` / `extends` 读取与 options 解析，避免依赖固定文件名名单；
2. 项目内部模块别名/裸导入解析失败时，建立**可定位的 unresolved 记录**。

**约束（不得误伤）**：
- 正常组件来源边（id `source:<componentId>`，component → 自身文件）是既有正确语义，**不得删除或改变**；
- 不能把所有 npm 包导入一律标 unresolved（大量误报）；需区分：受支持的外部包、项目内部别名、未知别名、真实模块解析失败。

**根因**（`src/core/project.ts` ImportDeclaration 循环）：
`ts.resolveModuleName` 失败后，unresolved 判定只覆盖 `.` / `@/` 前缀的 specifier，
其余（如内部别名 `widgets`、`types`）被 continue 静默跳过——无 `import:` 模块边、无 unresolved。

**复现**：`src/core/b-thirdparty-capability-repro.test.ts` →「内部别名裸导入解析失败被静默忽略」
与「root tsconfig 仅有 references」用例。

## 后续能力（本轮不要求实现）

- **JSX 字符串属性**：真实 codescandy 存在 JSX 属性字符串中的文本（如
  `<PageHeading heading="Overview" />`，当前不提取为 data 节点）。其可编辑性需单独确定
  AST 来源证明、DOM 消费关系与授权范围。
- **SCSS Token**：当前不支持，保持 unsupported。

---

## English version — ready-to-post GitHub Issue #6 comment

> Status: NOT posted. B-side credentials return 401 on REST writes; this text
> is handed to the coordinator for posting. Do not report it as published.

---

### Public interface requirements from third-party (codescandy) investigation

Context: Issue #6 third-party generalization. The codescandy capability
investigation and gap attribution are complete (see PR #9 and the blocking
matrix below). Real TEXT full-lifecycle acceptance on codescandy is still
blocked; this comment registers the public-interface requirements for A.
No urgency — please keep current Bolt TEXT work as the priority; these can be
scheduled after the public core is stable.

**Measured baseline (codescandy dash-ui, frozen SHA
`b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`, MIT license):**
SourceGraph 4924 nodes / 5006 edges; media 100; 61 source-proven asset-consumer
edges; route nodes 0; token nodes 0; 100/100 media page impacts unknown;
unresolved 2. The 61 source-proven consumption edges prove consumption only —
not page propagation. Candidate gating correctly rejects any candidate today
(fail-closed; must not be relaxed).

**A-P1a — React Router data router recognition**

- Support statically provable `createBrowserRouter` route/component relations.
- Recognize both `element: <X />` and `Component: X` forms.
- Recognize nested `children`, index routes and relative paths.
- Dynamic params (`:id`) and unknown consumers keep conservative
  partial/unknown semantics.
- Build route → component → source proven relations; do NOT relax the
  Candidate full page-impact gate.

**A-P1b — TypeScript config graph and resolution attribution**

- Read tsconfig `references` / `extends` correctly; do not rely on a fixed
  config-file name list.
- Produce traceable unresolved records for failed internal alias / bare
  imports.
- Keep normal `source:` component-provenance edges unchanged.
- Do not mark all third-party npm imports as unresolved (would be noisy false
  positives); distinguish supported external packages, internal aliases,
  unknown aliases, and genuine resolution failures.

**Repro:** `src/core/b-thirdparty-capability-repro.test.ts` (7 cases) in PR #9 —
`https://github.com/Onesummer-D/Ripple/pull/9`. These are negative contract
tests locking the current gaps; they should be upgraded to positive contract
tests once A implements support.

**Blocking matrix:** `docs/probes/thirdparty-text-blocker-matrix.md`.
Capability stats JSON + probe: `docs/probes/b-codescandy-acceptance-2026-10-21.json`,
`scripts/thirdparty-acceptance.ts` (capability probe, not a lifecycle proof).

**Side note for A's tracking — browser preview stability:** CI run
https://github.com/Onesummer-D/Ripple/actions/runs/39546320560 failed once at
`e2e/page-override-lifecycle.spec.ts:308` with
`page.goto: net::ERR_NETWORK_CHANGED at http://127.0.0.1:34533/`
(8 passed / 1 failed / 1 skipped). An identical-tree re-run
(https://github.com/Onesummer-D/Ripple/actions/runs/39547183042) passed
(9 passed / 1 skipped). Registered as a public browser-preview stability
issue; not claimed resolved.
