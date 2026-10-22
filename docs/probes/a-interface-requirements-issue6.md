# 给 A / C+D 的 Issue #6 公共接口需求 v2（可复制评论文本）

> 2026-10-23，B 侧复验更新。v1 见 `feat/thirdparty-dash-ui-20261019` 同名文件。
> v1 的 A-P1a 已由 PR #28 基本交付（见下"已交付"），本版聚焦两个新公共问题。
> 以下需求均附实测证据与最小复现，不阻塞 A 当前合并预演，可登记排期。

---

## 已交付核对（v1 → v2）

- **A-P1a data router 路由识别：基本交付 ✅**。复验实测 37 route 节点、
  `/pages/profile` source-proven、Profile → ProfileHeader → Overview 三段
  source-proven 消费链、0 悬空 source-proven 边。剩余缺口即本版 AC-P2a/AC-P2b。
- **A-P1b tsconfig/别名归因：部分交付 ⚠️**。unresolved 从 2 变为 3，旧有
  `Dropdowns → unresolvable-component:DropdownType` 不再出现；`theme.scss` 导入
  失败已有可定位 unresolved 记录。别名裸导入静默跳过问题未在 codescandy 复现，
  维持 v1 需求登记。

---

## AC-P2a：composite JSX 子代的 host-DOM 传播证明（第一阻断）

**现象**：codescandy ProfileHeader `<Link …>Overview</Link>` 的文本字面量
消费边确定性为 `semantic-candidate`（`composite-jsx-child:component:…ProfileHeader.tsx#131:literal:…#2620`），
`sourceProvenPageImpact` 返回 partial，**任何 TEXT 候选被 fail-closed 拒绝**
（实测 CandidateError，复现 `scripts/b-thirdparty-candidate-gate.mjs`）。

**需求**（任选其一，均不得放宽门控）：
1. 对已知路由库组件（react-router `Link`/`NavLink` 等）建立**可审计的 host 映射
   白名单**：composite 组件 → 其渲染的 host 元素，传播关系标 source-proven 并附
   白名单版本/依据；或
2. 提供运行时 DOM 传播验证执行器，把 semantic-candidate 升级为经验证证明；
   未命中白名单/未验证的 composite 一律维持现状 fail-closed。

**最小反例**：`_scratch/codescandy-dashui`（b700bbd）`src/sub-components/profile/ProfileHeader.tsx`
L71-73；图证据 `docs/probes/b-codescandy-reprobe-20261023.json` → `overviewTargets[0]`。

## AC-P2b：data-router 回退/条件消费者建模（工程级 unresolved）

**现象**：`App.tsx` L53 根路由 `errorElement: <NotFound />` 未被建模；
unresolved 记录 `data-router src/App.tsx#2358: conditional route fallback consumer is not modeled`
与 `route-coverage: 静态路由表存在无法证明的消费者或条件分支`。该工程级 unresolved
同样使候选门控拒绝（页面影响全集不可确认）。

**需求**：为 `errorElement`/`HydrateFallback`/`lazy` 等 data-router 消费者建立
明确模型：可静态证明的纳入图（route → 组件 source-proven），不可证明的保留
可定位 unresolved（维持 fail-closed）；`route-coverage` 的触发条件需可解释
（当前无法区分"真有未知消费者"与"分析器未覆盖语法"）。

**最小反例**：同一检出 `src/App.tsx` L48-53；unresolved 全文见
`docs/probes/b-codescandy-reprobe-stats-20261023.json`。

## B-ENV-1（环境登记，非需求）：Windows EOL × 候选 worktree 字节一致性

CRLF 检出的 codescandy 在首次 `createCandidate` 时被"隔离 worktree 的检出字节与
原工程不同"拒绝；LF 归一化后 503 文件 digest 完全一致、不再复现。该前置检查本身是
正确防御，但 Windows + `core.autocrlf` 组合可能使合法项目永远达不到字节一致。
建议 A 评估：快照中记录 EOL/换行归一化状态，或按归一化内容计算 digest。
另：图内源码偏移随 EOL 变化（#2691 ↔ #2620），工件需携带 EOL 元数据。
如需要，B 可提供 Windows 最小复现脚本（当前一次性观察，未稳定复现）。

---

## English version — ready-to-post GitHub Issue #6 comment

**Measured v2 baseline (codescandy frozen SHA `b700bbd…c9f0`, Ripple baseline
`feat/a-cd-rehearsal-20261023` @ `1485439`):** 4957 nodes / 5384 edges /
37 routes / 161 source-proven media consumption proofs / 2283 TEXT data nodes /
3593 source-proven TEXT reads / 0 tokens / 0 dangling source-proven edges /
unresolved 3. Full TEXT candidate creation is still **BLOCKED** by the
fail-closed page-impact gate (verified live: `createCandidate` throws
CandidateError). Route growth is real but does NOT constitute acceptance.

**AC-P2a — prove host-DOM propagation for composite JSX children (first blocker).**
The `<Link>Overview</Link>` literal in ProfileHeader.tsx has only a
`semantic-candidate` consumption edge; no TEXT candidate can be created.
Provide an auditable host-mapping allowlist for known router components
(react-router `Link`/`NavLink`, versioned), or a runtime DOM-propagation
verifier that upgrades the edge. Unknown composites must stay fail-closed.

**AC-P2b — model data-router fallback/conditional consumers.**
Root-route `errorElement: <NotFound />` is unmodeled; unresolved
"conditional route fallback consumer is not modeled" + "route-coverage"
blocks the project-level page-impact proof. Model provable fallbacks into
the graph (source-proven); keep traceable unresolved for the rest; make the
`route-coverage` trigger explainable.

**B-ENV-1 (environment note):** on a CRLF checkout, candidate creation was
once rejected by the worktree byte-identity check; after LF normalization all
503 tracked file digests match exactly. Consider recording EOL state in the
snapshot or hashing normalized content; graph offsets shift with EOL
(#2691 ↔ #2620). Not a blocker; registered for A's awareness.

**Repro:** `scripts/b-thirdparty-candidate-gate.mjs`,
`scripts/b-thirdparty-reprobe-stats.mjs`, reports in `docs/probes/`
(`b-codescandy-reprobe-2026-10-23.json`, `b-codescandy-reprobe-stats-20261023.json`,
`thirdparty-text-blocker-matrix.md` v2).
