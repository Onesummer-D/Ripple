# 给 A / C+D 的 Issue #6 公共接口需求 v3（可复制评论文本）

> 2026-10-24，B 侧更新（v3）：新增 **AC-P6**（CSS Custom Properties 来源证据与
> 执行器最小合同，基于真实 React/Vite 工程实测），已正式递交 A/C+D 评审
> （Issue #6 评论，2026-10-24）。AC-P4/AC-P5 维持待 A 处理；复验清单见
> `docs/probes/b-codescandy-reverification-checklist-20261024.md`，最小品牌色
> 验收案例见 `docs/probes/b-css-token-acceptance-case-20261024.md`。
> 2026-10-23 v2 原文保留；v1 见 `feat/thirdparty-dash-ui-20261019` 同名文件。
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

已提供**固定复现**（同 HEAD 双工作树状态全记录，含 core.autocrlf、git blob、磁盘字节、
图偏移、候选偏移、双方摘要）：`docs/probes/b-env1-eol-repro-20261023.md` +
`b-env1-eol-repro-20261023.json`，复跑脚本 `scripts/b-env1-eol-repro.mjs`。

要点：codescandy 的 git blob 全为 LF；CRLF 工作树仅来自 autocrlf=true 检出且被 git 报为
"干净"（Ripple 干净检查放行）；Ripple 以 `-c core.autocrlf=false` 建候选 worktree 得 LF
字节，与 CRLF 快照摘要必然不一致 → 候选创建被字节一致性检查拒绝（`mismatchDemonstrated:
true`，可稳定复现）。v2 复现（传入检出只读、双独立临时 clone）进一步确认：CRLF 快照摘要
与新建 autocrlf=true worktree 摘要一致（`a3d59740…`，同一 git 过滤器），v1 曾测得的第三
个摘要值为手工转换伪影，已取代；有操作意义的不一致仅为 CRLF 快照（`a3d59740…`）vs
autocrlf=false 候选 worktree（`016aee03…`）。

**B 不要求、也不建议**把 ProjectRevision/CandidatePatch/补丁范围/工作树完整性的摘要改为
"归一化文本后计算"——这些摘要必须尊重真实字节，归一化会使摘要与实际补丁不一致。
请 A 判断：修改**检出策略**（要求/固定 LF 工作树）、修改**源码版本合同**（快照记录 EOL
状态并在建候选 worktree 时显式对齐）或其他方案。
另：图偏移与候选偏移随 EOL 平移（#2620 ↔ #2691），任何写入源码位置的工件必须携带 EOL 状态。

## AC-P3：候选/工件目录互斥检查缺失 `path.isAbsolute` 守卫（Windows 跨盘误拒绝）

**现象**：`candidate.ts` L482-485 的"候选目录与补丁工件目录必须互不包含"检查对
`path.relative` 的跨盘结果（Windows 上返回绝对路径如 `D:\…`）缺少 `path.isAbsolute`
守卫——同函数 `outsideProject`（L60）有该守卫，此处遗漏。后果：Windows 上只要
`candidateRoot` 与 `artifactRoot` 位于**不同盘符**，即使两个目录完全不相干，也必然被
误拒绝（`候选目录与补丁工件目录必须互不包含`）。Linux/macOS 上 `path.relative` 总是
返回相对路径，不触发。

**最小复现**（Windows）：`createCandidate({ projectRoot: <C: 盘工程>, candidateRoot: 'D:\\tmp\\cand', artifactRoot: 'C:\\tmp\\art', … })` →
CandidateError"候选目录与补丁工件目录必须互不包含"。该行为是 B 的门控 selftest 在
Linux CI 失败、在 Windows 本地通过的差异根因（负例断言了拒绝原因，而误拒绝恰只发生在
Windows）。B 已把自身负例改为平台稳定断言（`negative-inside-project-location` 校验
确定性的 `项目原目录之外` 拒绝；`negative-caller-repo-proposal` 只断言"调用者检出零创建
+ 零改动"，不绑定拒绝原因），本需求不影响 B 现有结论。

**需求**：在 L484-485 的两个条件中补 `&& !path.isAbsolute(candidateRelative)` /
`&& !path.isAbsolute(artifactRelative)`（与 `outsideProject` 对齐），并为跨盘/UNC 路径
补一条正例测试（候选与工件分置两盘应成功创建）。

## AC-P4：基线 DOM 比对的页面选择与"绑定不唯一"误报文案（Verification incomplete 根因）

**现象**：codescandy ACCEPTED 候选的正式 Verification（A 核心 2f2e5a7）全链路走通
（预览启动、四视口 rendered、截图与 VerificationRun 产出），但七项断言中五项为
unknown，baselineComparisons 全部 `matched=false`，原因
`"Source binding for op-overview-text is not unique."`（证据：
`docs/probes/evidence/codescandy-verification-20261024/`）。

**根因（已定位到行，B 附最小复现）**：
1. `verification-execution.mjs` 的 `verifyViewport` 把基线 DOM 比对**固定在根页面 `/`**
   （两侧导航 `/` 后调 `snapshotOutsideTargets`）；而本候选的唯一受影响页是
   `/pages/profile`，`pageExpectations` 无 `/` 条目 → `spec.text=''` →
   L561 的 `!spec.text.trim()` 命中，返回上述文案。
2. L561 把 `sourceRefs.length!==1` 与 `!spec.text.trim()` 合并为同一句文案：
   **空页面期望被误报为"绑定不唯一"**，诊断方向被误导。
3. B 的复现 `scripts/b-verify-binding-probe.mjs`（可在 A-core 检出直接运行，无需
   Docker）证明 `sourceBindings()` 对两侧都返回**唯一**引用
   （`jsx:ProfileHeader.tsx#2522`，经包含元素回退）——绑定本身无问题。

**需求**（A 判断，B 不改核心）：
1. 比对页语义：当合同未声明 `/` 页面时，基线比对应改在**受影响页**（或跳过并说明），
   而不是固定在 `/` 要求一份不存在的期望；
2. 原因文案拆分：`sourceRefs.length!==1` 与 `!spec.text.trim()` 分别报告
   （如 `binding-not-unique` vs `page-expectation-missing:<pageRef>`）；
3. 补一条正例测试：页面级 Scope 候选（影响页非根页）的比对应在正确页面上进行。

## AC-P5：AC-P2a 引入的重复 reads 边（图卫生）

**现象**：`Overview` 字面量
（`literal:src/sub-components/profile/ProfileHeader.tsx#2620`）存在 **2 条完全相同的
reads 边**（同一 `from`=`component:…ProfileHeader.tsx#131`、同一 `to`、同一 kind、
均 source-proven）。`scripts/b-verify-binding-probe.mjs` 的 `duplicateIdenticalEdges`
可稳定复现。

**影响**：未影响本次绑定判定（`renderedSourceRefs` 按 jsx-element 过滤后走包含回退），
但重复边会放大一切按边计数的统计与传播逻辑，属于图构建卫生缺陷。

**需求**：SourceGraph 构建时对 (from,to,kind) 完全相同的边去重（保留一条，确定性
选择 certainty 较高者），并加一条回归测试。

## AC-P6：CSS Custom Properties 来源证据与执行器最小合同（P1 研究结论）

**实证基线**：真实 React/Vite + 纯 CSS Custom Properties 工程
（allanhue/webportflio @ `b244f85`，MIT），A core `2f2e5a7`。
完整报告：`docs/probes/b-css-token-source-20261024.md`；
探针：`scripts/b-css-token-probe.mjs`（`--assert` 固化 9 项边界为回归基线）。

**现状（实测）**：
1. token **定义**提取真实可用（11 个变量，值+文件/偏移精确捕获）；
2. token **消费**几乎全部缺失：212 处 `var(--x)` ground truth 对 1 条
   uses-token 边，且该边是指向上游提交的 dist/ 构建产物的顺序伪影；
3. 根因是"恰好唯一定义才连边"门控 × 真实工程普遍存在的**多作用域覆盖**
   （`:root` 暗色 + `[data-theme="light"]` 亮色逐变量覆盖）+ 已提交构建产物；
4. core 不捕获选择器/作用域 → token 身份仅 label 级，无法区分
   "改品牌色（全部主题）"与"仅改亮色主题"；
5. 该 HashRouter 工程 0 page 节点 → token→page 影响不可计算；
6. 链式别名（`--skill-color: var(--accent)`）、回退消费
   （`var(--accent-color, var(--accent))` 且 `--accent-color` 无定义）、
   媒体查询/伪类上下文、运行时主题状态（localStorage + data-theme）
   均无模型。

**最小合同建议**（A 统筹执行器/补丁/Scope/computed-style 验证，B 不新建管线）：
1. **Token 唯一来源标识**：`{file, offset, selectorScope}` 三元组替代 label 级
   身份；同名多作用域定义各自成节点，"编辑哪个作用域"是 Scope 决策输入；
2. **声明与消费关系**：`var(--x)` 消费连边不再要求全局唯一定义，而是连到
   声明集合并记录"选择器作用域 → 解析结果"映射（含层叠/继承规则与
   specificity 的确定性裁决，无法裁决时标 unknown 而非丢边）；
3. **页面影响范围**：CSS 消费边需要元素级锚点（selector 匹配到 jsx/host
   DOM 元素）才能借用 AC-P2a 的传播链到页面；file 级边不足。HashRouter
   `<Route element>` 形态需纳入路由识别，否则此类真实工程页面影响恒为
   不可计算；
4. **用户 Scope 决策**：候选创建时把"目标作用域"（如仅亮色 / 全部主题 /
   某断点）作为用户可确认的决策项，随 CandidateRecord 持久化；
5. **样式覆盖与不确定性**：层叠冲突、未定义变量回退、运行时注入
   （setAttribute / localStorage）显式建模为 unknown，禁止静默丢弃；
6. **浏览器 computed-style 证据要求**：Verification 对 token 修改断言
   `getComputedStyle(element).getPropertyValue('--x')` 的 before/after，
   作为 target-change 的机器可判证据（比 DOM 文本比对更贴合样式操作）。

---

## English version — ready-to-post GitHub Issue #6 comment

**Measured v2 baseline (codescandy frozen SHA `b700bbd…c9f0`, Ripple baseline
`feat/a-cd-rehearsal-20261023` @ `1485439`):** 4957 nodes / 5384 edges /
37 routes / media asset-consumer edges 178 (61 source-proven — identical to
the v1 baseline on the same metric — plus 117 semantic-candidate; 100
source-proven `reads` edges to media nodes are a separate kind and not counted
here) / media page impacts 0 source-proven, 60 partial, 40 unknown /
2283 TEXT data nodes / 3593 source-proven TEXT reads / 0 tokens /
0 dangling source-proven edges / unresolved 3. Full TEXT candidate creation
is still **BLOCKED** by the fail-closed page-impact gate (verified live:
`createCandidate` throws CandidateError). Route growth is real but does NOT
constitute acceptance.

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

**B-ENV-1 (environment note, pinned repro v2):** codescandy git blobs
are LF; a CRLF working tree arises from a `core.autocrlf=true` checkout and is
reported clean by git, so Ripple's snapshot check lets it through; Ripple then
builds the candidate worktree with `-c core.autocrlf=false` (LF bytes), which
can never match the CRLF snapshot digest — candidate creation fails the
byte-identity check (`mismatchDemonstrated: true`). v2 (read-only source, two
independent script-owned clones) further shows the CRLF snapshot digest equals
a fresh `autocrlf=true` worktree digest (`a3d59740…`, same git filter); the
third digest seen in v1 was a manual-conversion artifact and is superseded.
The only operative mismatch is CRLF snapshot (`a3d59740…`) vs the
autocrlf=false candidate worktree (`016aee03…`). Full record:
`docs/probes/b-env1-eol-repro-20261023.md`, rerunnable via
`scripts/b-env1-eol-repro.mjs` (with `--selftest` file-safety negatives:
dirty source returned byte-identical, foreign sentinel untouched). We
explicitly do NOT propose hashing normalized text —
ProjectRevision/CandidatePatch/patch-scope/worktree-integrity digests must
respect real bytes. Decision (checkout policy vs source-version contract
recording EOL state) is A's. Graph and candidate offsets shift with
EOL (#2620 ↔ #2691); artifacts carrying source offsets must record EOL state.

**Repro:** `scripts/b-thirdparty-candidate-gate.mjs`,
`scripts/b-thirdparty-reprobe-stats.mjs`, reports in `docs/probes/`
(`b-codescandy-reprobe-2026-10-23.json`, `b-codescandy-reprobe-stats-20261023.json`,
`thirdparty-text-blocker-matrix.md` v2).

**AC-P4 — baseline DOM comparison page selection + misleading "not unique"
reason (root cause of the Verification incomplete).** The formal codescandy
Verification on A core 2f2e5a7 ran the full chain (preview started, all four
viewports rendered, screenshots + VerificationRun produced) but five of seven
assertions are unknown; every baselineComparison reports
`"Source binding for op-overview-text is not unique."` (evidence:
`docs/probes/evidence/codescandy-verification-20261024/`). Root cause, pinned to
the line: `verifyViewport` in verification-execution.mjs always runs the
baseline DOM comparison on the ROOT page `/`, while this candidate's only
impacted page is `/pages/profile`, so `pageExpectations` has no entry for it →
`spec.text=''` → the `!spec.text.trim()` branch at L561 returns that message.
L561 merges `sourceRefs.length!==1` and `!spec.text.trim()` into one string, so
a missing page expectation is misreported as a non-unique binding. B's minimal
repro `scripts/b-verify-binding-probe.mjs` (runs on any A-core checkout, no
Docker) proves `sourceBindings()` returns a UNIQUE ref on both sides
(`jsx:ProfileHeader.tsx#2522` via the containing fallback) — the binding is
fine. Ask A: (1) when the contract declares no `/` page, run the baseline
comparison on the impacted page (or skip with explanation), not on `/`; (2)
split the refusal reasons (`binding-not-unique` vs
`page-expectation-missing:<pageRef>`); (3) add a positive test for a page-level
candidate whose impacted page is not the root.

**AC-P5 — duplicate reads edges from AC-P2a (graph hygiene).** The Overview
literal has TWO identical reads edges (same from=`component:…ProfileHeader.tsx#131`,
same to, same kind, both source-proven); `duplicateIdenticalEdges` in
`scripts/b-verify-binding-probe.mjs` reproduces it. It did not affect this
binding decision but inflates any edge-counting logic. Ask A: dedupe edges
identical on (from,to,kind) at graph build time and add a regression test.

**AC-P3 — add the missing `path.isAbsolute` guard to the candidate/artifact
mutual-containment check (false rejection across Windows drives).**
In `candidate.ts` (~L482-485), the "candidate dir and artifact dir must not
contain each other" check compares `path.relative` results without an
`path.isAbsolute` guard — the sibling `outsideProject` (~L60) has one. On
Windows, `path.relative` returns an absolute path for cross-drive pairs, so
ANY `candidateRoot`/`artifactRoot` pair on different drives (completely
disjoint dirs) is wrongly rejected with "候选目录与补丁工件目录必须互不包含".
Minimal repro: `createCandidate({ projectRoot: <drive C:>, candidateRoot:
'D:\\tmp\\cand', artifactRoot: 'C:\\tmp\\art', … })`. This was the root cause
of B's gate selftest failing on Linux CI while passing on Windows (the
negative case asserted the refusal reason, and the false refusal only happens
on Windows). B has since made its negatives platform-stable
(`negative-inside-project-location` asserts the deterministic
"项目原目录之外" refusal; `negative-caller-repo-proposal` only asserts zero
creation/mutation in the caller checkout), so this does not affect B's
conclusions. Ask: add the two `isAbsolute` guards (aligned with
`outsideProject`) plus a positive test with candidate and artifact on
separate drives.

**AC-P6 — CSS Custom Properties source evidence and minimal executor contract
(P1 study).** Empirical baseline: a REAL React/Vite project using pure CSS
Custom Properties (allanhue/webportflio @ `b244f85`, MIT), on A core
`2f2e5a7`. Full report `docs/probes/b-css-token-source-20261024.md`; probe
`scripts/b-css-token-probe.mjs` (`--assert` pins 9 boundary facts as a
regression baseline). Measured: (1) token DEFINITION extraction is real and
source-proven (11 variables, byte-exact values with file/offset); (2) token
CONSUMPTION is almost entirely missing — 212 raw `var(--x)` occurrences
against ONE uses-token edge, and that edge is a per-file ordering artifact
pointing into the upstream-committed dist/ build output; (3) root cause: the
"exactly one definition" edge gate × multi-scope overrides that real projects
actually have (`:root` dark + `[data-theme="light"]` per-variable overrides)
× committed build artifacts; (4) no selector/scope capture → token identity
is label-only, cannot distinguish "rebrand everywhere" from "light theme
only"; (5) zero page nodes for this HashRouter project → token→page impact
is not computable; (6) chained aliases, fallback-only consumers, media-query
and pseudo-class contexts, and runtime theme state (localStorage +
setAttribute) are all unmodelled. Minimal contract ask (A owns the
executor/patch/Scope/computed-style verification; B is not building a
parallel pipeline): (a) token identity = `{file, offset, selectorScope}`
triple, same-name scoped definitions are distinct nodes and "which scope to
edit" is a Scope decision input; (b) `var(--x)` edges connect to the
declaration SET with a deterministic cascade/inheritance resolution, marking
unresolvable cases unknown instead of dropping them; (c) page impact needs
element-level anchors (selector → jsx/host element) to reuse the AC-P2a
propagation chain — file-level edges are insufficient — and HashRouter
`<Route element>` needs route recognition, otherwise page impact is
uncomputable for this class of real projects; (d) persist the user's target
scope decision (all themes vs light only vs breakpoint) in the
CandidateRecord; (e) model cascade conflicts, undefined-variable fallbacks
and runtime injection as explicit unknowns, never silently drop; (f)
Verification should assert before/after
`getComputedStyle(el).getPropertyValue('--x')` as the machine-checkable
target-change evidence for style operations.
