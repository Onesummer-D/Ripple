# AC-P6 v0.6 Phase 1 实施计划

状态：等待 A 会签，当前只提交设计资产，不修改生产 SourceGraph。

## 1. 基线、证据和范围

### 1.1 生产基线

- 生产开发基线：`feat/a-v06-base-20261028`
- 生产基线 HEAD：`5b75fe699afce98638e6fd6ad110911d83389dc8`
- 生产基线 Tree：`ede999bd2eb1507ac03b55762c94d489b93d9965`
- 本计划分支：`feat/cd-acp6-v06-phase1-plan-20261030`
- 本计划工作树从上述生产 SHA 新建；Phase 0 evidence HEAD `a0c5c5349003deb8f8a8e479086b1e7389ec4c80` 不作为生产合并基线。
- 原 dirty worktree 保留在原位置，仅有既有 `M tsconfig.node.tsbuildinfo` 现场，未被本计划工作树读取、覆盖或清理。

### 1.2 冻结输入

- 固定第三方项目：`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- Phase 0 正式证据目录：`docs/acceptance/2026-10-29/acp6-phase0-v2/`
- Phase 0 正式 B 输入：1,035,281 bytes，SHA-256 `0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a`
- Phase 0 原始分类来源：`c851bfe...` 证据，SHA-256 `89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200`
- Phase 0 Manifest SHA-256：`d024157fc856433b35cc26e5026f1100906972f5f89577d8ee4b2be30febbe8e`
- Taxonomy：`acp6-gap-taxonomy/v1`
- 逐行映射：`acp6-gap-mapping/v1`
- 本计划保留 AC6.2 和 AC6.4 的原始统计单位，不将 source-use row 与 consumer pair 互相映射后再计数。

### 1.3 冻结统计

| 指标 | Phase 0 冻结值 | 本计划处理方式 |
| --- | ---: | --- |
| AC6.2 source-use rows | 123 | 逐行保留稳定 `rowId`、`sourceRef`、UTF-8 `byteOffset` |
| AC6.2 covered / uncovered | 85 / 38 | 38 条逐行规划；不改 B v5 阈值 |
| Token | 8，1 条完整，7 条未闭合 | 多作用域声明继续分开，不能按名称折叠 |
| AC6.4 consumer pairs | 147 | 与 AC6.2 独立分析 |
| AC6.4 static anchors / UNKNOWN | 131 / 16 | UNKNOWN 单独列出，9 static、7 dynamic |

## 2. 当前实现和不变合同

### 2.1 已有 SourceGraph 能力

- `src/core/css-token-source.ts` 已从真实 CSS 解析自定义属性声明和每次 `var(--token)` 使用，保存字符偏移、UTF-8 `byteOffset`、`selectorScope`、`mediaContext`、属性名和 fallback 内层引用。
- `src/core/project.ts` 已生成 `token` 与 `token-use` SourceNode，建立 declaration → `var()` 的 `token-reference`、使用位置 → 静态 className 的 `css-cascade` 候选边，以及消费者 → 声明的 `uses-token` 候选边。
- `src/core/model.ts` 已有 `SourceNode.selectorScope`、`mediaContext`、`byteOffset`、`dynamicClassName`、`tokenOrigin`，以及 `Relation.sourceUse`、`Relation.certainty`、`SourceGraph.unresolved`。
- `src/core/scope.ts` 已对非 `source-proven` 关系 fail-closed；第一批不改变 PageImpact、Scope 或 Candidate 门控。
- 现有路由分析已经覆盖 named/default import、alias、lazy、重复 path、HashRouter/BrowserRouter 和不可信 path；第一批只消费现有 page identity，不改路由解析。

### 2.2 第一批不新增公共模型字段

第一批不修改 `model.ts`。`selectorScope` 继续表示解析出的原始 selector 文本，不升级为可计算的 cascade 身份；`mediaContext` 只记录上下文，不表示媒体已激活；`tokenOrigin` 仍是来源类别，不是作用域证明。

如果后续需要独立的 scope identity，先由 A 会签一个可选字段（候选名为 `selectorScopeKey` 或单独的 scope evidence 对象），并提供旧图适配：缺失字段一律按 unknown 读取，不能从旧 `selectorScope` 猜测。任何 schema 版本或序列化变更都留在 A 的公共模型会签范围内，本阶段不预埋。

### 2.3 证明边界

- 静态边仍使用 `semantic-candidate`；不能改成 `source-proven`。
- 无法确认 owner、DOM 激活、主题、媒体、级联、继承、伪元素或动态 className 时，保留 `unknown` 关系和 `unresolved` 诊断。
- 同名多作用域声明分别建节点，候选边可以枚举声明集，但不能选择“最终生效者”。
- fallback 中每个 `var()` 保留独立使用位置；未定义外层或内层变量继续 UNKNOWN。
- `sourceRef` 和 UTF-8 `byteOffset` 是来源定位，不能替代运行时实例证明；`graphNodeIds.status=missing` 时不猜测节点。

## 3. 38 条 AC6.2 uncovered 逐行缺口矩阵

表中“当前来源”使用 Phase 0 正式矩阵的 `sourceRef.file:offset (byteOffset)` 和 selector；所有行的 `sourceUseGraphNodeIds` 当前均为 `missing`。`primary / secondary` 使用已签署 canonical taxonomy，raw 标签只作为证据说明保留。

| # | rowId | token / 当前来源 | primary / secondary gap | 可证明边界 | 拟修复模块 / 批次 | 预期验收 |
|---:|---|---|---|---|---|---|
| 1 | `acp6-gap-1a07ac810794baae` | `--text-primary`; `src/css/style.css:995 (995)`, `body` | global-or-theme-selector / no-static-element-anchor | 可定位 CSS 声明和 `var()`；不能证明全局页面 owner 或最终级联 | selector owner + scope candidate / B2 | 保留原 offset；全局 selector 仍 candidate/unknown，不能 source-proven |
| 2 | `acp6-gap-a99b0609ab86f64f` | `--text-primary`; `src/css/style.css:3320 (3320)`, `.content h2` | no-static-element-anchor | 仅可证明 selector 文本和候选 class；不能证明唯一 JSX 元素 | selector normalization / B1 | 精确 owner 才新增 candidate source edge，否则 unresolved |
| 3 | `acp6-gap-af7e7830fa2a14a4` | `--text-primary`; `src/css/style.css:10495 (10495)`, `.btn-secondary` | no-static-element-anchor | 静态 class 可匹配时仍只是候选 | selector normalization / B1 | 不修改 declaration/use ID；无唯一 host 保持 unknown |
| 4 | `acp6-gap-b67204d231e5653b` | `--border-color`; `src/css/nav.css:2061 (2061)`, `.nav-links` | dynamic-or-ambiguous-class / candidate-without-source-edge | CSS 使用位置可证明；动态 class 不能由静态图证明 | dynamic candidate retention / B3 | 保留 dynamic unknown；待 D 的 DOM 证据，不提升 strict edge |
| 5 | `acp6-gap-87321cad295188a3` | `--border-color`; `src/css/style.css:10537 (10537)`, `.btn-secondary` | no-static-element-anchor | selector 可能命中多个 host，缺唯一 owner | selector owner resolver / B1 | 多 host 或无 host 均不 source-proven |
| 6 | `acp6-gap-3a9f56944909d61f` | `--border-color`; `src/css/style.css:10994 (10994)`, `.social-links a` | no-static-element-anchor | 需 compound selector owner；当前仅候选 class | selector normalization / B1 | 只在静态 ancestor 证据完整时建立 candidate edge |
| 7 | `acp6-gap-94b8fb684ea376dd` | `--border-color`; `src/css/style.css:12487 (12487)`, `.stat-card` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class、重复实例和 CSS 命中范围未证明 | dynamic candidate retention / B3 | 归入 dynamic UNKNOWN；浏览器观测另行绑定 VerificationRun |
| 8 | `acp6-gap-c4609510f77e7b44` | `--accent`; `src/css/footer.css:600 (600)`, `.footer-brand` | no-static-element-anchor | 可保存 footer selector 与使用位置；owner 未闭合 | selector owner resolver / B1 | 静态 JSX anchor 可复算，否则保持 unresolved |
| 9 | `acp6-gap-1027a7455bb3d74f` | `--accent`; `src/css/footer.css:952 (952)`, `.footer-cta` | candidate-without-source-edge | 已有 candidate consumer，但缺 source edge | source-edge binder / B1 | 仅对可定位 JSX 元素补 candidate relation；不改变 certainty |
| 10 | `acp6-gap-dc96bd48e41e2565` | `--accent`; `src/css/footer.css:1739 (1739)`, `.footer-links li a:hover` | no-static-element-anchor | `:hover` 是伪类；静态元素可候选，状态和最终样式不可证明 | selector classifier + owner / B1+B3 | 不误归 pseudo-element；hover 保持 candidate/unknown |
| 11 | `acp6-gap-3e431957897adb9f` | `--accent`; `src/css/footer.css:4553 (4553)`, `[data-theme="light"] .footer-brand` | global-or-theme-selector / no-static-element-anchor | theme selector、激活状态和 cascade 未证明 | theme scope metadata / B2+B3 | 保留 theme-cascade unresolved；需 D/A VerificationRun 才能观察 |
| 12 | `acp6-gap-e9cd71230c8fecdf` | `--accent`; `src/css/style.css:1998 (1998)`, `.section-title` | no-static-element-anchor | 只能枚举 class candidate | selector owner resolver / B1 | 精确静态 owner 可补 candidate，不能证明最终 CSS |
| 13 | `acp6-gap-d81381d84c0356ee` | `--accent`; `src/css/style.css:2232 (2232)`, `.section-title::after` | pseudo-element-or-generated-content / no-static-element-anchor | 伪元素没有普通 JSX 元素 anchor | pseudo classifier / B3 | 生成内容保持 UNKNOWN；不伪造 JSX node |
| 14 | `acp6-gap-9b280c12225690cb` | `--accent`; `src/css/style.css:3231 (3231)`, `.content h1` | no-static-element-anchor | compound owner 未闭合 | selector normalization / B1 | 仅在 ancestor/element 关系可复算时补 candidate |
| 15 | `acp6-gap-fdd0a9e050c54406` | `--accent`; `src/css/style.css:4227 (4227)`, `.image-container img` | no-static-element-anchor | 需要静态容器和元素类型同时匹配 | selector normalization / B1 | 任何缺少 host/ancestor 证据都保持 unknown |
| 16 | `acp6-gap-e8087459138cbb21` | `--accent`; `src/css/style.css:5143 (5143)`, `.social-media a` | no-static-element-anchor | 需要 JSX ancestor 与 anchor | selector normalization / B1 | 只补可复算 candidate relation |
| 17 | `acp6-gap-e29cecb2c1316328` | `--accent`; `src/css/style.css:9209 (9209)`, `.company` | no-static-element-anchor | class 可能跨组件复用 | selector owner resolver / B1 | 多组件匹配保持 ambiguous |
| 18 | `acp6-gap-8538bd1e7defa405` | `--accent`; `src/css/style.css:10635 (10635)`, `.btn-secondary:hover` | no-static-element-anchor | hover 状态未激活，不能由源码证明 | selector classifier + owner / B1+B3 | 伪类不是伪元素；状态关系保持 unknown |
| 19 | `acp6-gap-f242b0230ed3acb5` | `--accent`; `src/css/style.css:10660 (10660)`, `.btn-secondary:hover` | no-static-element-anchor | 同 selector 的第二个 var 使用必须独立保留 | source-use identity / B1 | 两个 use offset 均保留；不能合并 |
| 20 | `acp6-gap-28601cf0954a9348` | `--accent`; `src/css/style.css:11060 (11060)`, `.social-links a:hover` | no-static-element-anchor | ancestor、element、hover 状态均未闭合 | selector normalization / B1+B3 | 静态 owner 候选与运行时状态分开 |
| 21 | `acp6-gap-99850a3adda7e481` | `--accent`; `src/css/style.css:12735 (12735)`, `.stat-card::before` | pseudo-element-or-generated-content / dynamic-or-ambiguous-class / candidate-without-source-edge | 伪元素和动态 class 双重缺证 | pseudo + dynamic boundary / B3 | 保留三个原因；只可生成 candidate/unknown |
| 22 | `acp6-gap-8a7a8f3d659dfb5d` | `--accent`; `src/css/style.css:13011 (13011)`, `.stat-card:hover` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class 与 hover activation 未证明 | dynamic candidate retention / B3 | 等待 DOM/VerificationRun；不得 strict edge |
| 23 | `acp6-gap-80b33ac13167c0c1` | `--accent`; `src/css/style.css:16133 (16133)`, `.project-link` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class 不能由 JSX 静态属性推导 | dynamic candidate retention / B3 | dynamic UNKNOWN 保持；sourceRef 不丢失 |
| 24 | `acp6-gap-e5fd86b599c27aa2` | `--text-secondary`; `src/css/footer.css:687 (687)`, `.footer-tagline` | candidate-without-source-edge | 已有候选来源，缺 host/source edge | source-edge binder / B1 | 补 edge 需有精确 JSX anchor；否则 partial |
| 25 | `acp6-gap-2624fa0fa5f6d031` | `--text-secondary`; `src/css/footer.css:1536 (1536)`, `.footer-links li a` | no-static-element-anchor | descendant selector 的 owner 不唯一 | selector normalization / B1 | 保持 `sourceUse` 和 selectorScope，不能升级 strict |
| 26 | `acp6-gap-2b8c0eda083726f4` | `--text-secondary`; `src/css/style.css:3418 (3418)`, `.content p` | no-static-element-anchor | ancestor + element 需要源码级 JSX 结构 | selector normalization / B1 | 结构完整才补 candidate，否则 unknown |
| 27 | `acp6-gap-193ee5fb755f60b5` | `--text-secondary`; `src/css/style.css:8978 (8978)`, `.title` | candidate-without-source-edge | class candidate 缺 strict source edge | source-edge binder / B1 | 绑定到 exact JSX location 后仍是 semantic-candidate |
| 28 | `acp6-gap-de767764ebbc4de1` | `--text-secondary`; `src/css/style.css:10897 (10897)`, `.social-links a` | no-static-element-anchor | compound selector owner 未闭合 | selector normalization / B1 | 无完整 ancestor 证据不升级 |
| 29 | `acp6-gap-98288a263b162995` | `--background`; `src/css/footer.css:977 (977)`, `.footer-cta` | candidate-without-source-edge | 候选消费者存在，来源 edge 缺失 | source-edge binder / B1 | 生成可追溯 candidate edge；没有 anchor 仍 unknown |
| 30 | `acp6-gap-a854d2e75c916e13` | `--background`; `src/css/style.css:966 (966)`, `body` | global-or-theme-selector / no-static-element-anchor | `body` 是全局运行时容器，不能归属单一 JSX host | global selector boundary / B2 | 保留全局 unknown；不生成伪造 host |
| 31 | `acp6-gap-584a50dce381d511` | `--background`; `src/css/style.css:7524 (7524)`, `.hero-background` | no-static-element-anchor | CSS class 与 JSX owner 未闭合 | selector owner resolver / B1 | 精确静态 owner 可候选，最终样式仍未证明 |
| 32 | `acp6-gap-a242cedaab77a87c` | `--background`; `src/css/style.css:11085 (11085)`, `.social-links a:hover` | no-static-element-anchor | compound selector + hover 状态 | selector normalization / B1+B3 | 保持状态 unknown |
| 33 | `acp6-gap-f6c2a5153396edf2` | `--background`; `src/css/style.css:16184 (16184)`, `.project-link` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class 与重复项目实例 | dynamic candidate retention / B3 | 浏览器观测前不建立 strict edge |
| 34 | `acp6-gap-345b1ce52c592eb6` | `--card-bg`; `src/css/style.css:10602 (10602)`, `.btn-secondary:hover` | no-static-element-anchor | hover selector 的静态 owner 未闭合 | selector normalization / B1+B3 | 不误判为伪元素；保持 unknown |
| 35 | `acp6-gap-e20fc1493021c241` | `--card-bg`; `src/css/style.css:10871 (10871)`, `.social-links a` | no-static-element-anchor | compound owner 未闭合 | selector normalization / B1 | 只生成可复算 candidate |
| 36 | `acp6-gap-84c08bdb0b00726a` | `--card-bg`; `src/css/style.css:12385 (12385)`, `.stat-card` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class 及实例集合未证明 | dynamic candidate retention / B3 | dynamic UNKNOWN 保持 |
| 37 | `acp6-gap-1cfcc36cf6678e9a` | `--accent-secondary`; `src/css/style.css:16148 (16148)`, `.project-link` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class，且同一 JSX host 有多个 token use | dynamic candidate retention / B3 | 每个 use 独立保留，不能按 host 合并 |
| 38 | `acp6-gap-fbdb1f3a2f99a2cb` | `--accent-secondary`; `src/css/style.css:16547 (16547)`, `.project-link:focus-visible` | dynamic-or-ambiguous-class / candidate-without-source-edge | 动态 class、focus-visible 状态未证明 | dynamic candidate retention / B3 | 保留 focus-visible unknown，等待运行时证据 |

## 4. AC6.4 UNKNOWN pair 独立分析

AC6.4 的 pair 不是 AC6.2 row。下表保持原始 pairId、JSX file/offset、CSS source-use，并按 Phase 0 的 `dynamic` 字段分组。

### 4.1 9 个 static UNKNOWN

| pairId | token | JSX 来源 | CSS source-use | C 计划 / 边界 |
|---|---|---|---|---|
| `acp6-unknown-pair-5be818af566075f7` | `--text-secondary` | `src/layouts/Footer.jsx:492`, `.footer-tagline` | `src/css/footer.css:687` | B1 尝试 exact JSX owner；无 source edge 则 UNKNOWN |
| `acp6-unknown-pair-0109278560bac3ca` | `--accent` | `src/layouts/Footer.jsx:557`, `.footer-cta` | `src/css/footer.css:952` | B1 source-edge binder；不证明 cascade |
| `acp6-unknown-pair-43362b94b7102601` | `--background` | `src/layouts/Footer.jsx:557`, `.footer-cta` | `src/css/footer.css:977` | 与上行独立 token-use；不得按 host 合并 |
| `acp6-unknown-pair-58afe02cfc3e2641` | `--text-primary` | `src/layouts/Footer.jsx:446`, `.footer-section` | `src/css/footer.css:1192` | compound selector owner candidate；缺 edge 保持 UNKNOWN |
| `acp6-unknown-pair-fa9848702c52331e` | `--accent` | `src/layouts/Footer.jsx:446`, `.footer-section` | `src/css/footer.css:1325` | 同 host 不同 use 独立定位 |
| `acp6-unknown-pair-a2cdb4f46d76eef1` | `--text-primary` | `src/layouts/Nav.jsx:2049`, `.nav-link` | `src/css/nav.css:890` | B1 静态 class owner；不得推导 page/runtime proof |
| `acp6-unknown-pair-4c25661e6b724433` | `--accent` | `src/layouts/Nav.jsx:2049`, `.nav-link` | `src/css/nav.css:1067`, `.nav-link:hover` | CSS owner candidate；hover 状态仍 UNKNOWN |
| `acp6-unknown-pair-52e3fec633a3b4c7` | `--background` | `src/layouts/Nav.jsx:2049`, `.nav-link` | `src/css/nav.css:1103`, `.nav-link:hover` | 与上一 use 分开；状态不由静态图证明 |
| `acp6-unknown-pair-e3adaceaec850447` | `--text-secondary` | `src/pages/Home.jsx:4687`, `.title` | `src/css/style.css:8978` | B1 可尝试静态 source edge；若多 owner 则 partial |

### 4.2 7 个 dynamic UNKNOWN

| pairId | token | JSX 来源 | CSS source-use | D 依赖 / 边界 |
|---|---|---|---|---|
| `acp6-unknown-pair-eafecf373112c2e8` | `--border-color` | `src/layouts/Nav.jsx:1104`, dynamic `nav-links` | `src/css/nav.css:2061` | D 采集真实 DOM class、页面 tuple 和 element anchor；静态图不升级 |
| `acp6-unknown-pair-f6092dcf170ae1b6` | `--card-bg` | `src/pages/Home.jsx:6381`, dynamic `stat-card` | `src/css/style.css:12385` | D 观察实例集合和 computed style |
| `acp6-unknown-pair-dea3144405339a6a` | `--border-color` | 同上 | `src/css/style.css:12487` | 与 card-bg use 独立配对 |
| `acp6-unknown-pair-873c0b5480b51d20` | `--accent` | 同上 | `12735 ::before`, `13011 :hover` | 伪元素和 hover 需分别观察；不能以普通 element anchor 代替 |
| `acp6-unknown-pair-7aeac6cbfa7b8a31` | `--accent` | `src/pages/Home.jsx:8788`, dynamic `project-link` | `src/css/style.css:16133` | D 绑定实际 DOM 实例和 sourceRef |
| `acp6-unknown-pair-23c1e6accb9661ed` | `--accent-secondary` | 同上 | `16148`, `16547 :focus-visible` | 两个 source-use 独立证据；focus 状态需动作证据 |
| `acp6-unknown-pair-eb29202ee5ac796b` | `--background` | 同上 | `src/css/style.css:16184` | 主题/级联/实例来源需 VerificationRun |

AC6.4 的 `unknownPairIds`、pair 内容和 sourceUses 必须逐项与 Phase 0 输入保持一致。任何后续减少 UNKNOWN 都必须由 D 的真实浏览器观测和 A 的正式 VerificationRun 共同支撑，不能由 AC6.2 静态边数量推导。

## 5. 分批路线与依赖

### Batch B1：静态 selector owner 与 source-edge（C，可先开发）

目标是闭合能从真实 JSX 源码唯一定位的简单 selector/compound selector，不计算 CSS cascade。

1. 在 `css-token-source.ts` 增加保守的 selector 分解和规范化结果，覆盖现有简单 class、element、descendant/compound 的可验证子集。
2. 在 `project.ts` 中以现有 JSX SourceNode 的文件、字节位置、静态 className 和父子结构建立候选 owner；一对多、缺失或动态输入继续 unresolved。
3. 让 `candidate-without-source-edge` 仅在 exact source anchor 已存在时补充可追溯 candidate relation，关系 certainty 仍为 `semantic-candidate`。
4. 保留原始 selectorScope、use offset、declaration offset 和 byteOffset；不改变 token/use node ID 生成规则。

依赖：现有 SourceNode/Relation 模型和路由 page identity。无 A Candidate/Verification 依赖。B 只复跑未修改的 v5 matcher/probe。

### Batch B2：声明集、主题和媒体上下文（C，B1 验收后）

1. 对同名多声明保留 declaration set，按文件、offset、selectorScope、mediaContext 分开。
2. 继续枚举 declaration → use 候选边，不选择 cascade winner。
3. 对 `:root`、`[data-theme=...]`、全局 `body` 和 `@media` 只增加可追溯上下文和明确 unresolved 原因。
4. fallback 逐个保留；未定义变量或跨作用域无法证明时不生成 strict edge。

依赖：B1 的 selector AST/normalization；A 会签未来 selector scope 扩展位置。主题、媒体激活和 computed style 仍依赖 D/A，不在 C 静态批次闭合。

### Batch B3：动态 class、伪元素和复杂 selector（D 观测接口后）

1. C 提供动态 class 的 SourceGraph candidate、sourceRef、use key 和 unresolved 原因。
2. D 通过真实 Chromium 采集 DOM element、页面 tuple、主题/媒体状态、伪元素/ComputedStyle 证据。
3. A 将验证结果绑定正式 VerificationRun；只有正式合同允许的结果才能改变运行时 certainty。
4. 旧 DOM、动态 class、重复实例、`:hover`/`:focus-visible`、`::before/::after`、复杂/转义 selector 继续 fail-closed。

依赖：A 的 VerificationRun 合同和 D 的浏览器证据；不能提前进入 Token Candidate 或 Apply。

### 推荐第一批范围

先只做 B1，覆盖 static `candidate-without-source-edge` 以及具有可复算 JSX owner 的 `no-static-element-anchor` 子集。B1 不承诺 38 条全部闭合，不触碰 B3 的 8 个 dynamic 主因和 2 个 pseudo 主因，也不把 AC6.4 dynamic UNKNOWN 变成 proven。

## 6. 技术设计

### 6.1 数据流

```text
CSS bytes
  -> PostCSS declaration/use + UTF-8 byteOffset
  -> token / token-use SourceNode
  -> declaration --token-reference--> exact var() use
  -> var() use --css-cascade--> static JSX owner candidate
  -> consumer --uses-token--> declaration candidate set
  -> unresolved(reason) when owner/cascade/runtime proof is absent
```

每个节点和边均保留原始文件与偏移。selector 规范化只用于比较，不能覆盖原始 selectorScope；同名声明的 candidate set 维持多节点。

### 6.2 selectorScope 和关系 certainty

- `SourceNode.selectorScope`：保留 CSS selector 原文；不承担 theme/cascade winner 语义。
- `SourceNode.mediaContext`：保留 at-rule 上下文；不表示当前 viewport 已激活。
- `Relation.sourceUse`：在 token-use 相关边上保存 CSS 文件、charOffset、byteOffset、offsetUnit。
- `Relation.certainty=semantic-candidate`：用于静态 selector/owner 候选。
- `Relation.certainty=unknown` 与 `SourceGraph.unresolved`：用于缺 owner、动态 class、cascade/theme/media、pseudo/generated content、非法/复杂 selector 等未证明情形。
- 只有 A/D 后续正式 VerificationRun 能提供运行时证明，C 不改变 `source-proven` 门控。

### 6.3 兼容策略

第一批不新增字段、不改序列化版本、不改变既有 node/edge ID。若 A 以后批准 `selectorScopeKey` 或 scope evidence 对象：字段必须可选，旧图读取为 unknown；旧 `selectorScope` 不得被反序列化为精确作用域；新旧图混合时只按共同可证明字段比较。

## 7. 代码、测试和文件白名单

### 7.1 第一批可能修改

| 文件 | 计划改动 | 归属/冲突 |
|---|---|---|
| `src/core/css-token-source.ts` | selector 保守分解/规范化、原始 selector 保留 | C；不得改 token offset 或 fallback 语义 |
| `src/core/project.ts` | JSX owner/source-edge 候选绑定、明确 unresolved 原因 | C；与 A 的公共 model 变更需先会签 |
| `src/core/css-token-source.test.ts` | selector、伪类/伪元素、escaped/复杂 selector 负例 | C；不改 B v5 |
| `src/core/project.test.ts` | exact owner、重复 owner、动态 class、同名声明和 PageImpact fail-closed | C；不放宽 scope/candidate 断言 |
| `src/core/sourcegraph-runtime-identity.test.ts` | 仅在需要验证 page/sourceRef 不回退时补只读断言 | C+D；不能修改 Runtime Identity 合同 |
| 固定第三方验收 fixture 的派生报告 | 仅作为验证工件，不硬编码答案进解析逻辑 | B 复核；不修改 v5 matcher/probe |

### 7.2 明确不修改

- `src/core/model.ts`：第一批不改；任何新字段先交 A。
- `src/core/scope.ts`、Candidate、Verification、Approval、Apply、Rollback：不改门控。
- Runtime Identity v1/v2、SourceGraph page namespace：不改。
- B v5 matcher/probe 和历史冻结验收阈值：不改。
- E 的配对/消费接口、F 的 Token Candidate UI：不改。

### 7.3 Agent 边界

| Agent | 责任 | 接口 |
|---|---|---|
| C | CSS 声明、var()、静态 selector owner 和 SourceGraph candidate/unresolved | 输出稳定 sourceUse、sourceRef、候选边和 gap reason |
| D | 动态 DOM、主题、媒体、伪元素和真实运行时采样 | 只提供可复验浏览器观测，不能替代 C 的来源生产 |
| A | SourceGraph 公共模型、VerificationRun 和 Candidate/Scope 正式合同 | 会签字段、证据结构和证明升级条件 |
| B | 固定项目和 v5 验收器复核 | 不调整 matcher/probe 或阈值 |
| E | 只读消费最终可信运行证据 | 不从 candidate edge 推导 strict proof |
| F | 后续 Token 输入、范围、验证和历史展示 | 本阶段无 UI/授权变更 |

## 8. 分批回归与验收矩阵

| 批次 | 正例 | 必须失败/UNKNOWN 的反例 | 验收量化 | 冻结不变量 |
|---|---|---|---|---|
| B1 静态 owner | 单一静态 class、element、可复算 descendant；sourceRef 与 JSX byteOffset 可复算 | 多 owner、缺 host、dynamic class、escaped/复杂 selector | 逐行检查 sourceUse、owner anchor、edge ID；只统计新增可追溯 candidate | 123/85/38 输入统计、node/edge ID 规则、semantic-candidate、PageImpact fail-closed |
| B2 声明集 | 同名 `:root`/theme 分离、fallback 内外层、mediaContext 保留 | 同名多作用域 winner 推断、主题/媒体激活猜测、未定义 fallback | 每个 declaration/use 位置独立；unknown reason 完整 | 8 token、1 complete/7 incomplete 的基线只可由真实证据改变 |
| B3 运行时接口 | D 采集新 DOM、页面 tuple、主题/媒体状态，A 形成正式 VerificationRun | 旧 DOM、返回历史 URL、重复实例、无独立证据、伪元素无 anchor | AC6.4 147/131/16 逐 pair 对照；运行证据缺失则 UNKNOWN | 不改 Runtime Identity、Scope、Verification、Approval、Apply、Rollback |
| 全量复核 | 固定 SHA `b244f857...` 未修改验收器重跑 | 通过改阈值、删除 unresolved、手工 fixture 答案 | Typecheck、Vitest、Build、Docker/Chromium 按批准批次执行 | B v5 exit semantics 和原始 row/pair IDs 不变 |

### 8.1 建议第一批测试夹具

1. 单一 `.button` 静态 class 对应唯一 JSX host：应生成可追溯 candidate edge，certainty 仍为 `semantic-candidate`。
2. `.social-links a` 具备明确 JSX parent/element：应保留 selectorScope、sourceUse 和 owner anchor。
3. 同名 `.theme-a` / `.theme-b` 声明：应有两个 token nodes 和两个候选 declaration edges，不能选 winner。
4. `var(--defined, var(--missing))`：两个 use 各自保留，missing 仍 unresolved。
5. `className={condition ? 'a' : 'b'}`、模板拼接、数组 join：dynamic unknown，不得 strict。
6. `::before`、`:hover`、`:focus-visible`：分别识别 pseudo-element 与 pseudo-class，不能把伪元素创建成普通 JSX owner。
7. escaped selector、attribute selector、组合选择器无法完整解析：保留原文和 unknown，不通过放宽匹配。

## 9. 风险清单

- **动态 className**：静态 AST 只能知道表达式形状，不能证明最终 class 集合、实例数量或页面状态；D 需提供真实 DOM，A 决定是否可进入 VerificationRun。
- **主题**：`[data-theme]` 和 `:root` 只是声明作用域候选；未观测主题状态、级联顺序和继承时保持 UNKNOWN。
- **媒体**：`@media` 上下文保留在 `mediaContext`，不能按开发机 viewport 推断激活；需 D/A 运行时证据。
- **伪元素/生成内容**：`::before/::after` 没有普通 JSX element anchor；即使父元素可定位，也不能把伪元素消费证明成父元素的 strict source。
- **fallback**：外层和内层 `var()` 的 source-use 必须独立；缺失变量不能被已定义 fallback 覆盖为 proven。
- **多作用域声明**：同名 token 不能合并；candidate set 可能包含多个声明，最终 winner 需 cascade/runtime 证据。
- **复杂 selector**：复杂、转义、属性、组合和伪类 selector 的静态解析子集必须明确；超出子集就 unresolved，不用宽松字符串包含制造命中。
- **重复使用位置**：同一 selector 中的多个 var()、同一 JSX host 的多个 token pair 必须以独立 offset/sourceUse 追踪，不能按 token 名或 host 合并。
- **跨平台 offset**：本计划只复用 Phase 0 已归档的真实 source bytes；任何新的 Linux/Windows 结论必须有独立工件，不能复制字段。

## 10. A 会签请求和启动条件

请 A 会签以下事项后，C 才启动 Batch B1 生产代码：

1. 确认第一批不新增 `model.ts` 字段，继续使用现有 `selectorScope`、`sourceUse`、`semantic-candidate` 和 `unresolved`。
2. 确认如果未来需要精确 selector scope，采用可选扩展并由 A 维护序列化兼容，而不是把现有 selectorScope 改成新语义。
3. 确认静态 owner/source-edge 仍不能单独进入 Candidate/Scope/Verification/Approval/Apply。
4. 确认 AC6.2 38 rows 与 AC6.4 16 pairs 保持独立统计，dynamic 9 rows 与 dynamic 7 pairs 不做无证据一一映射。
5. 确认 B1 的白名单文件和负例范围；A 会签后再建立生产实现提交。

### 会签前状态

- 生产代码：未修改。
- B v5 matcher/probe：未修改。
- Runtime Identity、权限门控和阈值：未修改。
- AC6.2/AC6.4：仍按 Phase 0 统计，未宣称 PASS。
- 第一批启动：`HOLD`，等待 A 正式会签。


