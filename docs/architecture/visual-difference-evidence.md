# 视觉差异 Evidence（A 侧任务 E）

状态：2026-10-21。这是一个独立模块，**尚未接入 VerificationRunner**。固定基线为 `10a808bb4845a0a947688080a7e97394095517a9`。

本模块比较同一候选的 Baseline（原工程）与 Candidate 截图，产出可复核的视觉变化观测。它回答“哪里变了、变了多少、能否归到哪个元素、证据是否属于当前候选”。它不回答“候选是否通过”。

## 1. 结论语义：从不 PASS

结果类型是 `VisualEvidenceResult = Exclude<EvidenceResult, 'pass'>`。

| result | 触发条件（按优先级） |
| --- | --- |
| `stale` | subject 与 expected 的 candidateId、patchHash、baseSourceDigest、candidateTreeDigest、runtimeFingerprint、scopeDecisionId、scopeVersion 任一不一致；或截图 descriptor 的 sourceDigest / runtimeFingerprint 与期望值不一致。此时不做比较。 |
| `failed-to-run` | 截图为空、损坏、超出分析上限、不可读（符号链接、FIFO、越出根目录），或与生产者记录的 SHA-256 不一致。 |
| `not-run` | 任一侧没有截图。 |
| `unknown` | 两张截图不可比较；或已比较但没有触发显式几何规则。**变化与无变化都落在这里。** |
| `risk` | 已比较、身份与期望候选完全一致（`identity.status = consistent`），且至少一条显式几何规则触发；两侧截图生产者哈希必须匹配，两侧 DOM 样本必须以实际截图哈希绑定，且完成、稳定、动画禁用、字体就绪标记均为 true。 |

- 画面有变化（changed）不等于 RISK。目标区外的变化记为 `change-outside-target`，严重度是 `review`：它可能是正常的回流或共享来源，也可能是误改，需要正式断言或人工来判断。
- 画面无变化（unchanged）不等于 PASS。意图是否满足、Scope 是否覆盖完整，仍以 VerificationRun 的 `target-change`、`scope-propagation`、`non-target-preserved` 等浏览器断言为准。
- 身份未验证（未提供 expected，或某项绑定缺失）时，即使几何规则触发，结果也只给 `unknown`，原因中会写明。
- 即使明确检测到遮挡，当生产者截图哈希、DOM 样本截图哈希或稳定性标记缺失时，仍保留 `geometry-risk` finding 供人工复核，主结果保持 `unknown`，附加 `risk-provenance-incomplete`。错误哈希仍为 `failed-to-run` 或 `stale`，不得按普通噪声放过。
- 正式 `toVerificationEvidence` 需要原始 `checkId` 非空且与检查项完全一致，禁止从外部 check 补填缺失归属。

## 2. 文件

| 文件 | 职责 |
| --- | --- |
| `src/core/visual-capture.ts` | descriptor 规范化（缺失记为 null，不填默认值）、URL/route 脱敏、身份评估、可比性评估 |
| `src/core/visual-png.ts` | 有界 PNG 读取：先遍历 chunk 与 IHDR、做 CRC 检查，限制内存后再做有上限的 inflate，校验精确长度，然后自行反滤波 8 位 RGB/RGBA；pngjs 只用于编码 |
| `src/core/visual-diff.ts` | pixelmatch 8 封装、变化掩码、网格合并区域、差异图渲染 |
| `src/core/visual-geometry.ts` | DOM 几何样本校验、截图绑定、CSS px → 设备 px 换算、跨版本元素匹配、位移、显式几何规则 |
| `src/core/visual-geometry-sampler.mjs`（及 `.d.mts`） | 页内采样函数，供 `page.evaluate` 调用。纯 JS，容器内执行器无需 TS 转换即可使用 |
| `src/core/visual-evidence.ts` | 编排入口 `analyzeVisualDifference`、序列化、`readScreenshotFile`、`toVerificationEvidence`、`summarizeVisualEvidence`、`summarizeVisualCoverage` |
| `src/core/visual-evidence-fixtures.ts`、`scripts/generate-visual-evidence-fixtures.mjs`、`test/fixtures/visual-evidence/**` | 确定性合成样例及其生成器 |
| `src/core/vendor-types.d.ts` | pngjs 7 同步 API 的最小类型声明（仓库没有 `@types/pngjs`） |

**未改动**：`verification-execution.mjs`、`verification-lifecycle.mjs`、`verification-runner.ts`、`candidate-verification-runner.mjs`、`verification-receipt.ts`、`candidate.ts`、`model.ts`、`session.ts`。

## 3. 输入（E1）

### 3.1 `VisualComparisonRequest`

| 字段 | 内容 |
| --- | --- |
| `subject` | 生产者声称的身份：candidateId、patchHash、baseSourceDigest、candidateTreeDigest、runtimeFingerprint、scopeDecisionId、scopeVersion、runId |
| `expected` | 调用方当前候选的身份，可用 `expectedIdentityFor(CandidatePatch, ProjectRevision)` 生成。不提供时身份保持 `unverified` |
| `baseline` / `candidate` | 各含 `descriptor`（未信任，内部校验）、`screenshot`（字节；`null` 表示不存在）、可选的 `geometry` |
| `targets.sourceRefs` | 被编辑目标的 `data-ripple-source` 值，即执行器 `targetBindings` 中的值 |
| `parameters` | 可覆盖的算法参数。安全上限只能收紧，不能放宽 |

### 3.2 每侧 descriptor

字段：`route`、`pageUrl`、`viewport`（CSS px）、`devicePixelRatio`、`browser{name,version}`、`runtimeFingerprint`、`interactionState`、`sourceDigest`（baseline 侧为源码摘要，candidate 侧为候选树摘要）、`capture{completed,stable,fullPage,animationsDisabled,fontsReady,capturedAt,scroll}`、`screenshot{declaredSha256,artifactPath}`。

- 缺失或非法的字段一律记为 `null`，并写入 `descriptorIssues`（`missing` / `invalid`），**不会填默认值**。
- `route` 与 `pageUrl` 会去掉凭据、query 和 fragment，并标记 `locationRedacted`。被去掉的部分只保留摘要：`routeSuffixSha256`，以及 `pageUrlLocationSha256`（覆盖 path+query+hash，不含 origin）。这两个摘要参与比较，所以 hash router 的 `/#/a` 与 `/#/b` 会被判为不同页面，而 query 原文不会进入 Evidence。

### 3.3 不可比较（`comparability.reasons`，出现即不做像素比较）

- `route-unknown` / `route-mismatch`（含 query、fragment 摘要）
- `viewport-unknown` / `viewport-mismatch`
- `device-pixel-ratio-unknown` / `device-pixel-ratio-mismatch`
- `interaction-state-unknown` / `interaction-state-mismatch`
- `browser-mismatch`
- `capture-incomplete` / `capture-completion-unknown` / `capture-unstable`
- `capture-extent-mismatch`（一侧全页、一侧视口）
- `image-size-mismatch`（全页截图高度不同即属此类，两侧尺寸都会记录）
- `image-viewport-inconsistent`（截图尺寸与 viewport × DPR 矛盾）
- `descriptor-side-mismatch`
- 另有 `screenshot-missing`、`screenshot-invalid`、`screenshot-hash-mismatch`、`identity-stale`、`analysis-resource-limit`

### 3.4 局限（`limitations`，比较照做，但证据强度受限）

- `browser-unknown`
- `capture-stability-unknown`
- `capture-extent-unknown`
- `viewport-only-capture`
- `animations-*`、`fonts-*`
- `screenshot-hash-undeclared` / `risk-provenance-incomplete`
- `transparent-pixels`
- `candidate-identity-unverified`
- `geometry-unavailable` / `geometry-rejected` / `geometry-partial` / `geometry-screenshot-unbound`
- `target-not-declared` / `target-not-mapped`

## 4. 图像差异（E2）

### 4.1 PNG 读取与校验

- 只接受 8 位 RGB/RGBA、非隔行的 PNG，也就是浏览器输出的格式。
- 检查签名与 chunk 结构：IHDR 必须是首个 chunk 且为 13 字节；IDAT 必须连续且至少一个；IEND 必须为空、位于末尾，其后不允许再有字节；每个 chunk 校验 CRC；遇到未知的 critical chunk 直接拒绝。
- 尺寸在 inflate 之前就检查。默认上限：

| 项目 | 默认上限 |
| --- | --- |
| 文件大小 | 64 MiB |
| 宽度 | 8192 px |
| 高度 | 32768 px |
| 像素总数 | 2^25 |

- IDAT 用 `zlib.inflateSync({ maxOutputLength })` 解压，结果长度必须**正好**等于 `height × (1 + ceil(width × channels × 8 / 8))`。
- 原因：pngjs 7 的同步 inflate 遇到“完整但偏短”的 zlib 流时，会返回未初始化的缓冲区。复审曾复现出这样的结果：截断的截图有时被判为“有变化”，有时复用了 baseline 的像素而被判为“无变化”。
- 每侧记录两个哈希：`sha256`（文件字节）与 `pixelSha256`（`ripple-rgba8:WxH\n` 前缀加 RGBA 数据，与编码参数无关）。

### 4.2 像素比较

- 使用 pixelmatch 8.0.0（ISC）。颜色距离为 OKLab HyAB，并启用抗锯齿检测。
- 默认 `threshold = 0.03`。理由：两侧来自同一 Chromium、同一容器，剩余噪声主要是亚像素抗锯齿，已由 AA 检测处理；阈值应能捕捉单个设计 token 级别的颜色变化。下表是 pixelmatch 8 的实测值：

| 颜色对 | 能被检出的最大阈值 |
| --- | --- |
| `#2563eb → #1d4ed8`（blue-600 → blue-700） | 0.070 |
| `#ffffff → #f0f0f0` | 0.050 |
| `#e2e8f0 → #fee2e2` | 0.045 |
| `#ffffff → #fafafa` | 0.015 |

  pixelmatch 的默认值 0.1 会漏掉前三项。阈值是通用参数，不针对任何具体案例，并记录在每份 Evidence 中。
- `includeAA = false`：被判为抗锯齿的像素单独计入 `antialiasedPixels`，不算作变化。

### 4.3 区域合并

- 网格 g = `ceil(mergeDistanceCssPx × DPR)`，默认 `mergeDistanceCssPx = 8`。8 邻接的有变化网格合并为一个区域。
- 结果：Chebyshev 距离 ≤ g 的两个变化像素必定同区；距离 ≥ 2g 的像素只能经由中间的变化像素才会合并。
- 区域按位置排序编号 `r1…`。最多报告 `maxRegions`（默认 100）个面积最大的区域，并记录 `regionCount` 与 `regionsTruncated`。像素总数始终完整统计。
- 新增独立的**执行资源预算**：最多 **12,000,000 像素**、**2,000,000 个合并网格**和**100,000 个连通区域**。PNG 接收格式上限仍是 2^25 像素；分析上限更紧，在解码前先检查尺寸与网格。连通区域超过预算则抛 `VisualResourceLimitError`，编排器回收为 `failed-to-run`、`analysis-resource-limit`，没有半成品或 RISK。PNG 编码上限与分析像素上限一致。资源上限不随 `maxRegions` 增大而放宽。
- 可重复的独立进程压力测试在 `scripts/benchmark-visual-evidence.mjs`。运行于 Node 22，用 `/usr/bin/time -v` 收集 peak RSS；样例均为合成输入，和真实浏览器验收无关。

### 4.4 差异图

| 元素 | 颜色 |
| --- | --- |
| 背景 | candidate 截图褪色灰度 |
| 变化像素 | 红 |
| 抗锯齿像素 | 琥珀 |
| 区域外框 · target | 蓝 |
| 区域外框 · non-target | 橙 |
| 区域外框 · mixed | 紫 |
| 区域外框 · unattributed | 深灰 |

外框画在区域外侧 2 px，变化像素最后绘制，所以外框不会遮住变化。Evidence 中记录差异图的 `sha256`、`pixelSha256` 和 `sizeBytes`。`diffArtifactPath` 必须是无 `.`/`..` 段、控制字符、反斜杠、盘符和空路径段的相对 POSIX 路径，非法值在写工件前拒绝。

## 5. DOM 几何（E3）

### 5.1 样本格式

格式为 `ripple-dom-geometry/v1`，每个元素包含：

- `id`、`parentId`（最近的被注解祖先）
- `sourceRef` / `runtimeInstanceId` / `identityCertainty`（来自 Ripple 的运行时注解）
- `rect`
- `clipRect`：所有裁剪祖先（hidden/clip/auto/scroll）留下的可见区域
- `hiddenClipRect`：只计 hidden/clip 祖先、且只计确实被裁的轴；只滚动的轴取 ±1e6
- `visible`

样本级字段：`documentSize`、`scroll`、`coordinateSpace`、`locationSuffix`（宿主只保留其摘要）、`screenshotSha256`。

### 5.2 采样器

- 会考虑 containing block：absolute 元素跳过 static 祖先；fixed 元素只受 transform、filter、contain、container-type 等祖先约束。
- 可见性用 `checkVisibility` 判断，因此会计入祖先的 opacity 与 visibility。
- 返回最多 `maxElements + 1` 个元素，宿主解析时超限即拒绝，不会被静默截断。

### 5.3 绑定到截图

以下任一条件不满足，该侧样本即被拒绝：

- 与截图的 route（含 query/fragment 摘要）、viewport、DPR、interactionState 都一致。
- 若样本记录了截图 SHA-256，必须相同。
- 截图范围已知；若是视口截图，需要已知滚动位置。
- 全页截图时，截图尺寸必须约等于 `max(viewport, documentSize) × DPR`，允许误差 `max(1, ceil(DPR))` px。这一条能发现 descriptor 和样本同时写错 DPR 的情况。

### 5.4 坐标换算

`device = floor/ceil((css + offset) × DPR)`，取能覆盖原框的最小像素框，再裁到图像范围内。offset 的取值：

| 截图范围 | 样本坐标系 | offset |
| --- | --- | --- |
| 全页 | document | 0 |
| 全页 | viewport | 样本 scroll |
| 视口 | viewport | 0（样本 scroll 必须等于截图 scroll） |
| 视口 | document | −截图 scroll |

### 5.5 目标与区域归类

- **目标掩码**：两侧目标框的并集为核心，另加 `targetMarginCssPx`（默认 2）的边缘环，用于容纳字形外溢和抗锯齿。环会在其他元素所在处撤回：凡是采样到的、既非目标的祖先也非后代的元素，覆盖到的部分都从环中去掉，所以相邻兄弟元素的变化不会被吸进目标。未被注解的邻居仍可能落入环内，这是已知局限。
- **区域归类**：只有当每个已采样侧都找到了全部声明的目标时，才计算 target / non-target / mixed；否则为 `unattributed`。归因元素取最具体（面积最小）的元素框，并记录各自的 `screenshotRect`。
- **身份匹配**：只按 `sourceRef + runtimeInstanceId` 匹配，且 certainty 不能是 unknown 或 unmapped。同一身份在一侧出现多次时记为 ambiguous，不参与匹配。不会根据文本或位置推断来源。

### 5.6 显式规则（容差 `geometryToleranceCssPx`，默认 1）

规则只作用于两侧都是稳定实例身份（stable-keyed / stable-react）且可见的元素，并且只报告**新出现**的问题。

| 规则 | 含义 |
| --- | --- |
| `new-overlap` | 两个互不嵌套的元素，可见框在 baseline 中不重叠，在 candidate 中两轴重叠都超过容差（可能遮挡） |
| `new-viewport-overflow` | 元素裁剪后的框新超出视口宽度 |
| `new-clip-overflow` | 元素新超出 hidden/clip 祖先；滚动容器不算 |
| `new-document-horizontal-overflow` | 文档 scrollWidth 新超出视口宽度 |

## 6. 输出（E4）

`VisualDifferenceEvidence` 的 schema 为 `ripple-visual-difference/v1`，主要字段：

- `id`（由规范化输入、哈希和参数决定，同样输入得到同样 id）、`checkId`、`result`、`resultReason`
- `subject`、`identity`（逐项 match / mismatch / unknown）
- `inputs`（descriptor、issues、两种截图哈希）
- `comparability`
- `observation`：outcome、changedPixels、changedRatio、antialiasedPixels、changedBounds、regions、diffImage
- `geometry`：mapped/partial/rejected、target、目标内外的像素数、matching、displacements、risks
- `findings`（info / review / risk）
- `coverage`（route / viewport / DPR / state / captureExtent / notChecked）
- `parameters`（算法与库版本、阈值、上限、规则文本）
- `environment`（Node、平台、zlib）

所有列表都有上限，并带 truncated 标记。

## 7. 未来公共集成接口（需负责人审核后再接入）

| 接口 | 作用 |
| --- | --- |
| `analyzeVisualDifference(request) → { evidence, diffPng }` | 主入口 |
| `readScreenshotFile(path, { root, maxBytes })` | 宿主按有界的普通文件读取截图：使用 O_NOFOLLOW 与 O_NONBLOCK，限定在根目录内（会解析父目录中的符号链接） |
| `serializeVisualEvidence(evidence) → { text, bytes, sha256 }` | 序列化并给出哈希 |
| `toVerificationEvidence(evidence, check, artifact)` | 投影为 Project-first 的 `VerificationEvidence`。check、route、viewport、state 不符时抛出 `VisualEvidenceProjectionError`；未观测到的值写为 `'unknown'` |
| `summarizeVisualEvidence(list)` | 生成建议性的 `visual-difference` 断言。它不属于 `REQUIRED_VERIFICATION_ASSERTION_IDS`，永不 pass |
| `summarizeVisualCoverage(plan, list, expected)` | 判断计划中的 route × viewport × state（× DPR）哪些已比较、哪些不可比较、哪些缺失。只计入身份与 expected 一致的 Evidence，其余列在 `excludedEvidence`；每项结果取所有匹配 Evidence 中最差的 |
| `sampleDomGeometryInPage(options)` | 页内几何采样 |

建议的接入顺序（**本轮均未实施**）：

1. 执行器在主页面对上为 baseline 也截一张同参数的全页图。目前只截 candidate，所以真实 run 还没有可比较的输入。
2. 截图前后调用采样器，并写入 `screenshotSha256`。
3. 在 manifest 中增加可选的 `visualComparisons`，由宿主在容器结束、并按现有方式重算截图哈希之后，在宿主侧运行本模块。pixelmatch 与 pngjs 目前是 devDependencies，宿主在开发环境中可以使用。
4. Receipt 若要校验这一部分，应按 `baselineComparisons` 的做法逐一重算哈希。即便如此，它也只能作为建议性信息，不能让 `non-target-preserved` 等必需断言变为 PASS。

## 8. 已知局限

- 合成样例只证明算法，不是浏览器证据，也不是 Bolt 或任何真实工程的验收。浏览器单测使用真实 Chromium，但页面也是合成的。
- 采样器运行在页面主世界，页面脚本可以伪造几何数据。这与预演平台“只预演受信任工程”的边界一致。
- fixed / sticky 元素在全页截图中的位置只是近似。
- Chromium 单边约 16384 px 以上的截图本身不可靠。
- 变化区域与元素框的关联是包围盒级别的，不是逐像素绘制归属。
