# E 阶段二准备：Runtime Identity 严格实例证明 — 接线复核、接口兼容与验收设计

> E Agent，2026-10-24。基准：A 集成候选 `feat/a-final-integration-20261023 @ 2f2e5a7`
> （开工前已核实远端 SHA 一致）。依据合同：`e-pr30-identity-contract-confirmation.md`
> （C+D 出具）、`sourcegraph-runtime-identity-contract.md`（PR #28 冻结版）、
> `e-visual-identity-interface-requests.md`（E 早前接口请求）。
>
> 本文档是**纯设计/复核交付**，不含核心字段写入。A 正式冻结
> `VerificationRun.runtimeIdentity` 之前不开始阶段二编码。
> 约定：视觉证据保持只读，永不产生正式 pass，永不改变 Approval 门控；
> `strictInstanceProofAvailable` 在正式接线前保持 `false`。

## 0. 基线核查备注

- 任务书要求阅读 `AGENTS.md`，但 `2f2e5a7` 仓库根目录**不存在该文件**
  （全仓 Glob 无匹配）。已用 `docs/architecture/` 下四份合同文档替代作为
  协作约定来源。请 A 确认 AGENTS.md 是否遗漏或已迁移。
- C+D 合同确认文档（`e-pr30-identity-contract-confirmation.md`）已就 E 早前
  三项接口请求（identityAssessment / runtime observations / RuntimePageContext）
  逐条答复，本文档以它为准。

## 1. P0 — 现有接线图：字段、消费位置、缺口

链路（实线 = 已接线，虚线 = 阶段二待接）：

```
[浏览器/容器内]                                          [宿主 host]
candidate-verification-runner.mjs
  └─ visual-capture-executor.mjs
       ├─ 截图 + descriptor（route/viewport/dpr/browser/state/sourceDigest/…）
       └─ page.evaluate(sampler)  ← buildDomGeometrySampler(collectorSource)
            collectorSource = collectRuntimeIdentitySnapshot.toString()
            经 input.json visualSamplerIdentity 数据下发（verification-runner.ts:380）
              │
              ▼
        geometry JSON（ripple-dom-geometry/v1，已含 E 阶段二采集字段）
          elements[].sourceRef / runtimeInstanceId / identityCertainty / identityReasons
          sourceFileVersions（C+D registry 逐文件）/ pageContext / sourceVersion(legacy 单文件)
              │
              ▼ 写盘 + SHA-256 记入执行清单 manifest.visualCaptures[]
═══════════════════ 容器/宿主边界（宿主校验路径、字节哈希后才消费）═══════════════════
verification-runner.ts:494 attachVisualEvidenceSafely(run, manifest, artifactRoot, …)
  └─ visual-verification-attach.ts attachVisualEvidence
       ├─ 完整性：CAPTURE_PATH 白名单 + manifest/declared 双 SHA-256 核验
       ├─ expectedSourceVersions：按侧 digestFor —— baseline=projectRoot、
       │    candidate=candidateRoot（C+D sourceFileDigest，不混用，memo 缓存）
       ├─ analyzeVisualDifference({subject=expectedIdentityFor(candidate, revision),
       │    targets, expectedSourceVersions, baseline, candidate})
       │    └─ pairCrossVersionElements 第三参 expectedSourceVersions 逐侧核验；
       │         identityAssessment 门已预留（可选参数；宿主当前不传 → 保守语义）
       └─ VisualRunEvidence{result, evidence, view: toVisualEvidenceView, artifacts}
            → run.visualEvidences[]（model.ts:264，attestation 之前挂载）
                 │
                 ▼ 只读消费
local-project-api.ts:136 → app/experience/real-adapter.ts:621 → scope-panel.tsx 展示
                 │
                 ▼ 阶段二待接（虚线）
assessRuntimeIdentity(graph, snapshot, record, {fileDigest 按侧, expectedPage})
  ← 需要容器把 RuntimeIdentitySnapshot 按运行点归档进 VerificationRun
  ← 需要宿主把 assessments 传入配对层（strictInstanceProofAvailable 的升级来源）
```

### 1.1 环节字段清单

| 环节 | 已有字段 | 尚未接入 | 实际消费位置 |
|---|---|---|---|
| 容器采集（sampler） | elements 的 sourceRef/runtimeInstanceId/identityCertainty/identityReasons；sourceFileVersions；pageContext；legacy sourceVersion | `runtimeInstanceId` 未做采集期去重之外的实例绑定；snapshot 原始 records 未单独落盘归档 | `attach` 的 `referencedFilesOf` → expectedSourceVersions；geometry parser |
| manifest 视觉记录 | checkId/route/state/viewport + 双侧 descriptor/screenshot/geometry 引用与 SHA-256 | 无 RuntimeIdentitySnapshot 运行点归档 | attach 校验与装载 |
| 宿主差异分析 | identity（subject 绑定核查）；comparability；coverage；regions(sourceRefs, attribution)；crossVersion 配对（proof 三级） | **identityAssessment 未接入**：配对层第三参已支持，宿主无人调用 `assessRuntimeIdentity` | `visual-evidence.ts` / `visual-geometry.ts` |
| VerificationRun | `visualEvidences[]`（model.ts:264） | `runtimeIdentity?: {checkId, viewport, state, snapshot}[]`（C+D §2.2 提案，A 未定字段名） | A 核心门控不消费视觉字段 |
| View（F 消费面） | state/summary/regions/findings/crossVersion(scope/counts/pairs)/artifacts/limitations | 严格证明升级后的视图措辞与逐对评估状态 | `local-project-api.ts` → F workbench |

### 1.2 四个必须区分的层级（不得互相替代）

| 层级 | 当前凭证 | 阶段二凭证 | 说明 |
|---|---|---|---|
| ① DOM 元素定位到源码 | sourceRef 在 geometry + graph 节点存在 | `locatable=true`（含版本不冲突） | 缺证据不阻断导航 |
| ② 运行实例身份严格证明 | **无**（`strictInstanceProofAvailable=false`） | `assessRuntimeIdentity` 产出 `instanceIdentityProven===true` | 唯一合法来源；≠ `identityAssessment != null` |
| ③ 视觉差异归因 | regions.sourceRefs（来源标注）+ crossVersion 候选配对 | 配对升级：评估通过的 instance-candidate | 候选配对措辞不得暗示实例证明 |
| ④ 正式 Verification 断言 | manifest.assertions（attestBrowserExecution） | 不变 | 视觉证据永不参与 |

### 1.3 双侧身份归档合同问题（复审补充①）

C+D §2.2 拟议的 `VerificationRun.runtimeIdentity` 条目仅含
`{checkId, viewport, state, snapshot}`，**缺 baseline/candidate 侧别**——同一次
视觉比较有两个运行点采集（双侧各一份 snapshot），无侧别则无法回答"这份身份
证据属于哪一侧的修订"，按侧版本核验（§1.4 两侧绝不混用）也无从执行。

E 建议（供 A/C+D 裁决，不自行修改 model.ts）：

1. **每份 snapshot 必须显式携带 `side: 'baseline' | 'candidate'`**；或改为双侧分组
   `{checkId, viewport, state, baseline: snapshot | null, candidate: snapshot | null}`——
   后者把"同一运行点的双侧身份对"作为归档单元，与视觉证据的双侧比较天然对齐，
   E 倾向双侧分组，但尊重 A 的字段化决定。
2. **每份 snapshot 的四重关联要求**：
   - **运行点**：checkId + viewport + state 三元组，与 `manifest.visualCaptures[]`
     及 `VisualRunEvidence` 的键完全一致，可按运行点回查；
   - **工程版本绑定**：baseline 侧绑定基线修订（`projectRoot` 工作树 /
     `baseSourceDigest`），candidate 侧绑定候选修订（`candidateTreeDigest`），
     两侧绝不混用——快照条目本身应可核对它所声称的版本；
   - **页面身份**：snapshot.page 三元组必须与该运行点采集 descriptor 的
     route/suffix 摘要一致（宿主归档时即可校验，不一致归档为带原因条目）；
   - **工件哈希**：与该运行点 geometry 文件 SHA-256、截图 SHA-256 并列记录
     （manifest 已有），snapshot 自身须可序列化、可哈希（C+D §2.2 已要求），
     使身份证据能绑定到具体字节。
3. 归档失败的运行点不得静默省略：侧别缺失或版本不可核对的条目以带原因形式
   保留（与 E "缺失证据不发明"语义一致）。

### 1.4 严格证明判定缺口（复审补充②，接线前必要修复）

`visual-geometry.ts:640` 当前以
`options?.identityAssessment !== undefined && !== null` 作为
`strictInstanceProofAvailable` 的部分条件——**只查非空，未核验
`instanceIdentityProven === true`**。生产路径目前无人传 assessment
（结果恒 false，无现实风险），但阶段二一旦宿主接线，任何非空 Assessment
（包括评估未通过的）都会错误置位严格证明。

接线前必须完成的最小修复（E 登记，待启动条件满足后实现）：

1. 判定位必须核验**真实 Assessment 的 `instanceIdentityProven === true`**；
   `missingEvidence` 为空数组**不得单独升级**（既有注释语义在代码层落实）。
2. 严格证明依赖 **A/C+D 宿主侧正式评估**，且需**逐对**核验身份与版本：
   现状是整个配对作用域共用一个 assessment，阶段二须改为按
   (side, sourceRef/instanceId) 键控的逐对评估回执，一对不合格不污染其他对。
3. 不传 assessment 的路径保持既有保守语义（annotation-pairing 不升级）。

### 1.5 页面身份校验差异（复审补充③）

`assessRuntimeIdentity()` 内 `samePage` 对 `expectedPage` 的 pathname 强制
（缺失即 `page-context-unverified`），但 search/hash 为**可选比较**
（`undefined` 即通过，runtime-identity.ts:160-163）。这与"三元组完整核验"的
合同表述存在差异：仅给 pathname 的 expectedPage 也能产出
`instanceIdentityProven=true`，且 search/hash 不匹配不会被发现。

E 不自行裁定，登记交 A/C+D 决定：严格证明与 page-context 缺失清除的最终
条件，是保持 pathname 强制 + search/hash 可选，还是要求完整三元组比对；
E 消费侧按冻结结论执行（`missingEvidence` 的 page-context 项在条件满足前
一律不清除）。

## 2. P0 — 阶段二验收矩阵（正反例，对齐 C+D it.each 词表）

C+D 评估矩阵（runtime-identity.test.ts:953）七项负例 + 正例已冻结。下表按 E 消费面
（view / identityReasons / 降级状态）建立对应验收预期。约定：
- `strict` = 宿主接线后该对满足 `instanceIdentityProven===true` 时 view 允许的最高措辞
  （措辞升级规则本身待 A 冻结，见 §5-③）；
- `missingEvidence` 四项词：source-version / page-context / collection-reasons / graph-membership。

| # | 用例 | 触发条件（C+D 词表） | view 预期 | identityReasons 预期 | 降级/缺失状态 |
|---|---|---|---|---|---|
| 1 | **单实例来源证明（正例）** | stable certainty、版本按侧匹配、expectedPage 匹配、reasons 空 | crossVersion 该对可升级 strict 措辞；`sameSourceCount=1` 无附带警示 | `[]` | `missingEvidence` 相应项可清除；page-context 清除须满足合同 §3.2 三条件 |
| 2 | **同源多实例** | 同 sourceRef 渲染 N>1 处，instanceId 各自区分 | strict 可成立，但 UI 必须并列展示"同源渲染 N 处，改源影响全部"（C+D §1.5） | `[]` | 无降级；`sameSourceCount=N` 如实呈现 |
| 3 | **无稳定 key** | certainty=position-dependent/unknown；或 `react-keys-unavailable` | proof ≤ `same-sourceRef-observed`，禁实例措辞 | 含 `identity-not-stable` / `react-keys-unavailable` | missingEvidence: collection-reasons；配对走来源级 |
| 4 | **版本不一致** | 按侧 digest ≠ 采集 sourceVersion | `locatable=false`；该对降级 unproven | 含 `source-version-mismatch`（附按侧信息） | missingEvidence: source-version；不清除 |
| 5 | **页面身份不匹配** | snapshot.page ≠ expectedPage 三元组 | 该视口证据整体标注页面级；涉实例措辞禁止 | 含 `page-context-mismatch` / `page-context-unverified` | missingEvidence: page-context；按 §3.2 无依据不清除 |
| 6 | **候选重新运行后证据过期** | run 的 candidateId/patchHash 等与现状不匹配 | `result='stale'`，既有语义已覆盖（attach.test.ts:148） | identity.status='stale' 既有 | 无新需求；回归既有 stale 路径 |
| 7 | **浏览器快照缺失** | collector 抛错 / snapshot.records 缺项 / 容器无 collectorSource | identityReasons=null → 保守配对；无 fabricated 身份 | `null`（不可得） | missingEvidence: collection-reasons + source-version；sampler 已保证 degrade-to-null |
| 8 | **身份评估失败** | sourceRef 不在 graph；fileDigest 读不到 | proof=unproven，区域归因 attribution=unmapped/unknown | 含 `source-not-in-graph` / `source-version-unavailable` | missingEvidence: graph-membership / source-version |
| 9 | **多视口证据不一致** | 同一 check 不同 viewport 下 pageContext/配对结果不同 | 每条 VisualRunEvidence 按 (route, viewport, state) 独立成项；F 分组展示，不得跨视口合并结论 | 逐视口各自 reasons | 视口级缺失独立列出，不互相覆盖 |

负例总规则（C+D 词表对齐）：任何 reason 非空 → `instanceIdentityProven=false` →
view 不得出现实例级已证明措辞；`locatable=true` 仅允许"可导航回源码"展示。

## 3. P0 — 阶段二接口兼容性报告

1. **类型层全部现网已有**：`RuntimeIdentitySnapshot/Record/Assessment`、`RuntimePageContext`、
   13 项 reason 词表（`model.ts:42-61`、`runtime-identity.ts`）均为 C+D 已冻结类型；
   E 配对层 `expectedSourceVersions` 按侧核验已上线（PR #30）。**新增公共类型仅
   C+D §2.2 一项**：`VerificationRun.runtimeIdentity?: Array<{checkId, viewport, state, snapshot}>`。
2. **采集函数可复用，但归档与接线需新实现**：现有 `collectRuntimeIdentitySnapshot`
   已自包含并经 input.json 数据下发（与 `candidate-preview-vite.config.mjs` 同模式），
   sampler 与 collector 本身无需改动；但 snapshot 按运行点的**独立归档**（双侧、
   带 §1.3 四重关联）与**宿主侧评估接线**是阶段二新工作，不是"零改动"。
3. **宿主侧接入点已预留**：`attachVisualEvidence` 的按侧 digestFor 与
   `analyzeVisualDifference` 的 `expectedSourceVersions` + identityAssessment 门
   均为可选参数；不传保持阶段一保守语义（冻结测试全过的兼容路径保留）。
4. **F 消费面兼容**：view schema 为 additive 演进（crossVersion 即先例，
   `strictInstanceProofAvailable` 字段已存在），阶段二可在不破坏 F 既有渲染的
   前提下追加严格证明状态字段；`proofLabel` 逐字渲染约定不变。
5. **风险项**：
   - `expectedPage` 来源——宿主 input.json 已有 `scopeTargetPageRefs`（按 operation），
     但视觉采集点是 (check, viewport, state)，期望页应从 verificationContract
     的页面集派生，映射规则需 A 定；
   - C+D §2.2 字段化 vs 复用 `evidence[]` 工件方案的取舍未定，影响 E 从哪读
     snapshot；
   - `samePage` 为逐字段可选语义（`expected.pathname===undefined` 即通过），
     E 消费 `page-context` 清除时必须确认 A 传入了完整三元组，否则保持列出。

## 4. P1 — F 工作台展示建议（只建议，不改 F）

现有 view 已能支撑：状态徽标、差异热区（regions.cssBox + classification +
attribution + sourceRefs）、复核清单（findings）、配对表（crossVersion.pairs，
proofLabel 逐字渲染）、完整性（artifacts 哈希）。建议按 (route, viewport, state)
分组（VisualRunEvidence 天然按此成项）：

| 展示目标 | 数据映射（现有 view 字段） | 建议组件 | 边界 |
|---|---|---|---|
| 源码来源关系 | regions[].sourceRefs + crossVersion.pairs[].sourceRef 双端 | 差异热区 ↔ 源码双向高亮；来源链 chips | sourceRefs 是来源标注，非实例证明 |
| 运行实例身份状态 | crossVersion.scope.{level, strictInstanceProofAvailable, missingEvidence} + pairs[].proof/proofLabel | 身份状态条：绿灯=可升级、灰灯=候选配对、黄灯=缺失证据列原因 | strict=false 时禁"实例级已证明"表述；`sameSourceCount>1` 并列警示 |
| 视觉变化区域 | regions（cssBox 截图坐标系）+ changedPixels | 叠加 diff 图的热区框，按 classification 着色 | 保持只读 |
| 证据对应视口/页面 | 条目级 checkId/route/viewport/state + pageContext（阶段二） | 视口 × 状态矩阵卡片 | 多视口结论不合并（矩阵用例 9） |
| 无法严格归因的原因 | missingEvidence + pairs[].reasons + limitations | "为什么不是实例证明"折叠面板，逐条映射 13 项 reason 的中文说明 | 原因原样带入，不吞不改写 |

阶段二additive 建议（待 A 冻结后）：`crossVersion.pairs[]` 增加宿主评估回执
（如 `assessment: {instanceIdentityProven, reasons} | null`），scope 增加
`provenance: 'host-assessed'`；`identityReasons` 汇总进 view 顶层，避免 F 逐对拼接。
以上均为新增可选字段，不影响 F 现有渲染。

## 5. 等待 A/C+D 冻结的最小接口清单

> **状态更新（2026-10-24，C+D 阶段二合同 v2 `feat/runtime-identity-phase2-20261024 @ 71da59d`，
> 已取代 v1 `2ad8528`）**：五项均已有候选方案，不再视为完全缺失；冻结前 E 不动核心写入。
> C+D v2 已含双侧归档字段（`side: 'baseline' | 'candidate'`）与逐实例一对多 assessment
> 结构（`RuntimeInstanceAssessmentEntry[]`）。本文 §1.3 的"侧别缺失"降级为"组织形式
> 二选一"（每侧一条 vs 双侧分组，A 冻结）；§1.4 逐实例关联缺口由 v2 §2 硬规则 1–3
> 覆盖，E 的 `visual-geometry.ts:640` 判定修复仍登记为 E 实施项。

| # | 事项 | 阻塞内容 | 需要谁 | 状态（C+D v2 对照） |
|---|---|---|---|---|
| ① | `VerificationRun.runtimeIdentities` 字段化（v2 §2：含 side、snapshotSha256、assessmentSha256、四重关联） | 容器归档与宿主读取路径 | A（C+D 已提案） | **已有候选方案**，等待 A 冻结（D1）；侧别组织形式二选一 |
| ② | 宿主评估接线：宿主编排调用 `assessRuntimeIdentity`（非 E）、attested 运行后定稿前、expectedPage 从合同 descriptor 派生 + 实际 URL 三元组、fileDigest 按侧 memo 固化 | E 配对层传入 assessments，view 升级路径 | A + C+D | **已有候选方案**（v2 §9-②），等待 A 冻结接线 |
| ③ | 严格证明判定修复（E 实施）+ view/pairs 措辞升级规则（A 冻结、F 会签）+ 跨版本四支柱配对回执（图侧来源对应归 A，v2 §14 未决） | view schema additive 扩展 + visual-geometry 判定修正 | A（F 会签文案） | **部分候选**：判定分工已定；四支柱配对 C+D 原型已实测；view 文案待冻结 |
| ④ | page-context 缺失清除：三元组全等 + pathname ∈ pageRefs + 无 route-namespace-stale；宿主代核、E 只消费；search/hash 清除以三元组全等为条件 | missingEvidence 清除逻辑 | A/C+D | **已有候选方案**（v2 §9-④），等待 A 裁决严格度；冻结前 E 不清除任何 search/hash 缺失标记 |
| ⑤ | 联合 CI 验收入口：C+D 原型工作流 10 项（真实 Chromium）+ E 容器矩阵 + A 集成预演汇总 | 联合 CI 用例 | A | **已有分工候选**（v2 §9-⑤），等待 A 确认入口 |

未决子项（详见配套设计文档 `e-container-snapshot-archival-design-20261024.md` §6
对照表）：digest recipe 公共函数（D2）、runtimeIdentities 写入权（D3）、工件保留期
（D4）、图侧来源对应 pillar 的 A 侧实现（v2 §14）。

## 6. 边界重申

- 不重复合并阶段一（PR #29/#30 已交付 A）；不修改 A Scope/Approval；
  不合并 main；不触发 Bolt。
- A 冻结 ①②③ 之前，E 只做文档与测试设计，不动核心写入路径。
- 合同冻结后：先 ①容器归档 + ②宿主评估，跑 §2 矩阵真实浏览器用例，
  再 ③view 扩展与联合验收。
