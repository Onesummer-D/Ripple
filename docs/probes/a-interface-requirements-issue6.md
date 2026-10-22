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
