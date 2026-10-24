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
2. **容器侧零改动可行性**：采集函数已自包含并经 input.json 数据下发（与
   `candidate-preview-vite.config.mjs` 同模式）。阶段二只需容器把已采集的
   snapshot 额外按运行点写入清单/工件（或新字段），sampler 与 collector 本身不动。
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

| # | 事项 | 阻塞内容 | 需要谁 |
|---|---|---|---|
| ① | `VerificationRun.runtimeIdentity` 字段化裁决（C+D §2.2，含字段名/归档格式/哈希要求；或批准工件替代方案） | 容器归档与宿主读取路径 | A（C+D 已提案） |
| ② | 宿主评估接线契约：谁来调 `assessRuntimeIdentity`（attach 内 vs runner）、expectedPage 从 verificationContract 派生的规则、fileDigest 按侧 memo 复用口径 | E 配对层传入 assessments，view 升级路径 | A + C+D |
| ③ | 严格证明措辞升级规则：`instanceIdentityProven=true` 时 view/pairs 允许的新 proof 级别与文案（含 `sameSourceCount>1` 必附警示）、`strictInstanceProofAvailable=true` 的置位条件 | view schema additive 扩展 | A（F 会签文案） |
| ④ | page-context 缺失清除的三条件核验由谁执行（宿主代核后只给结论，还是给 expectedPage+pageRefs 让 E 自核） | missingEvidence 清除逻辑 | A/C+D（合同 §3.2/§3.3 已给条件，缺执行归属） |
| ⑤ | 阶段二验收矩阵（§2）与 C+D it.each 词表的联合回归挂载点 | 联合 CI 用例 | A |

## 6. 边界重申

- 不重复合并阶段一（PR #29/#30 已交付 A）；不修改 A Scope/Approval；
  不合并 main；不触发 Bolt。
- A 冻结 ①②③ 之前，E 只做文档与测试设计，不动核心写入路径。
- 合同冻结后：先 ①容器归档 + ②宿主评估，跑 §2 矩阵真实浏览器用例，
  再 ③view 扩展与联合验收。
