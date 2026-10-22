# E 视觉证据 × 最新 A：集成、真实截图合同与只读消费

本文档说明 E 视觉证据模块迁移到最新 A（`feat/project-first-core-20261018`，基线
`2525092`）之后的集成方式、真实截图数据合同、独立试运行结果，以及与正式验证
（VerificationRunner / Receipt / 审批门控）之间的隔离边界。

## 1. 迁移范围与依赖处理

迁移源：E Draft PR #12，HEAD `6940d5`。迁移目标分支：
`feat/integration-e-visual-evidence-20261022`。

只迁移 E 的独立成果，未触碰 A 的任何现有行为：

- `src/core/visual-capture.ts` —— 截图描述符、比较主体、身份核验、可比较性判定
- `src/core/visual-diff.ts` —— 有界像素差异、区域聚类、Diff 图渲染
- `src/core/visual-geometry.ts` / `visual-geometry-sampler.mjs` —— DOM 几何采样、
  元素匹配、位移与遮挡/溢出/位移风险规则
- `src/core/visual-png.ts` —— PNG 解码/编码、资源上限
- `src/core/visual-evidence.ts` —— `analyzeVisualDifference` 主入口与证据序列化
- `src/core/visual-evidence-fixtures.ts` + `test/fixtures/visual-evidence/` ——
  12 个合成验收 fixture（字节级 golden）
- `scripts/generate-visual-evidence-fixtures.mjs`、
  `scripts/check-visual-fixture-regeneration.mjs`、
  `scripts/benchmark-visual-evidence.mjs` —— 再生对照与资源基准
- `.github/workflows/agent-e-visual-acceptance.yml` —— E 独立正式验收（Node 22.22.0 固定）

依赖处理：`pixelmatch` 与 `pngjs` 在 A 的 package.json 中已锁定同一版本，
因此 package.json 仅追加两个脚本（`fixtures:visual-evidence`、`trial:visual-evidence`），
没有用 E 的旧清单整体覆盖 A。`src/core/vendor-types.d.ts` 为 pngjs 提供最小环境类型。

A 侧因基线前移产生的差异（`local-project-api.ts`、`vite.config.ts`、
`verification-*.ts` 等）一律保留 A 现状，不回退。

### Windows 检出约束

`test/fixtures/visual-evidence/**` 被 `.gitattributes` 标记为 `-text`：
fixture 的 golden JSON 按字节比较且 manifest 记录 SHA-256，Windows 的
`core.autocrlf=true` 会把 LF 转 CRLF 导致全部验收失败。此标记只影响该目录。

## 2. 真实截图数据合同

捕获侧（截图生产者）必须为每张截图提供描述符
（`normalizeVisualCaptureDescriptor` 校验，全部字段可空、空即“未观察”）：

| 字段 | 说明 |
| --- | --- |
| `side` | `baseline` / `candidate` |
| `route` / `pageUrl` | 同源路径与绝对 URL；query/fragment 以 SHA-256 摘要参与比较，原始值不落证据 |
| `viewport` / `devicePixelRatio` | CSS 视口与 DPR |
| `browser` / `runtimeFingerprint` | 渲染引擎身份与运行时指纹 |
| `interactionState` | 交互状态（逐字比较） |
| `sourceDigest` | baseline=项目源码摘要；candidate=候选树摘要 |
| `capture.*` | 完成标记、稳定性、是否整页、动画是否禁用、`fontsReady`、`capturedAt`、滚动偏移 |
| `screenshot.declaredSha256` | 生产者记录的截图字节 SHA-256 |

比较主体（`VisualComparisonSubject` / `ExpectedCandidateIdentity`）：

- `candidateId`、`projectId`、`patchHash`、`candidateTreeDigest`、
  `baseSourceDigest`、`runtimeFingerprint`、`scopeDecisionId`、`scopeVersion`。
- `projectId` 为本轮新增：`expectedIdentityFor` 从 `ProjectRevision.projectId`
  带出；仅当至少一侧声明 `projectId` 时才进入身份核验——两侧声明则精确比对，
  单侧声明降级为 `unverified`，两侧都未声明（旧输入）完全不产生该检查，
  保持既有 fixture 与旧消费者的语义字节级不变。
- 元素级证据：`geometry` 采样（`ripple-dom-geometry/v1`）携带每元素的
  `sourceRef`、`runtimeInstanceId`、`identityCertainty`（确定性等级）与实际
  DOM 几何（rect/clip/hiddenClip/visible），并用 `screenshotSha256` 绑定到
  具体截图字节。

可比较性与降级：缺少任何必要来源信息（路由、视口、DPR、交互状态、完成标记）
都会使两张截图**不可比较**；字体/动画状态、稳定性、来源完整性缺失记为
limitation，永不伪造为风险或通过。baseline 与 candidate 必须来自匹配的项目版本
及可比页面状态，否则按 `stale` / `unknown` / `not-run` / `failed-to-run`
保守语义降级。

## 3. 独立视觉证据试运行（真实 Chromium）

`npm run trial:visual-evidence`（`scripts/visual-evidence-real-trial.mjs`）
用真实 Chromium（Playwright）对合成页面拍摄 baseline/candidate 截图、在页面内
采样 DOM 几何，走完整证据管线。九个场景全部符合保守语义
（报告 `acceptance-artifacts/real-trial/report.json`，`allMatchedExpectation: true`）：

| 场景 | 结果 | 说明 |
| --- | --- | --- |
| 单纯文字修改 | `unknown` | 目标内像素变化，无几何规则触发；观察≠通过 |
| 共享元素改动影响其他页面 | `unknown` | /products 页 footer 变化无法归属到 Home 目标，`change-unattributed` 评审项 |
| 横版媒体替换为竖版 | `unknown` | 固定 overflow:hidden 框内裁切区域重绘 |
| 按钮遮挡标题 | `risk` | 身份一致且 `new-overlap` 几何规则触发 |
| 两侧截图版本不一致 | `stale` | candidate 来自旧树，摘要失配，不做比较 |
| 字体加载状态不同 | `unknown` | `fonts-not-ready` limitation 封顶置信度 |
| 缺失截图 | `not-run` | 缺席绝不算通过 |
| 损坏截图 | `failed-to-run` | 截断 PNG 解码失败，保守失败 |
| 重复/不可信 DOM 身份 | `unknown` | 运行时实例 ID 复用 + 确定性降级，匹配保持含糊 |

每场景输出 baseline/candidate/diff PNG 与证据 JSON（SHA-256 记录），
diff 图带区域轮廓，可作为 F 工作台的展示工件。

## 4. 与正式验证的隔离

硬边界（本轮未改、也不允许静默改动的文件）：

- `src/core/verification-runner.ts`
- `src/core/verification-execution.mjs`
- `src/core/verification-receipt.ts` 及审批门控

E 视觉结果只作为补充证据：视觉模块**不能独立决定候选 PASS**，一个
“无视觉变化”结果也**不能提升**正式验证状态。证据结果类型
`VisualEvidenceResult = Exclude<EvidenceResult, 'pass'>` 在类型层面封死这一点。

只读消费接口：`src/core/visual-evidence-view.ts` 的
`toVisualEvidenceView` / `toEvidenceItemView` 把证据映射为
`ripple-visual-evidence-view/v1` 纯 JSON 视图（区域、发现、限制、工件
SHA-256 与展示 URL）。视图永不重算、永不产出 `pass`、对同一证据幂等。
F 工作台应只通过该视图消费视觉证据。

## 5. 正式 VerificationRunner 接入（已实施，分支 `feat/e-visual-verification-integration-20261023`）

设计原则不变：容器只采集，宿主分析；视觉证据只读、辅助、永不 PASS；
Receipt 合同与审批门控零改动。

1. **触发点（容器侧）**：`verification-execution.mjs` 在全部视口检查完成、
   断言计算之前，对每个视口在根路由 `/` 上以全新 baseline/candidate 页对
   执行采集（scope checkId 命名空间 `-visual`，生命周期事件不与已验证
   视口混淆）。预算不足 `VISUAL_CAPTURE_MIN_BUDGET_MS`（8s）时跳过并记
   missing；单次采集有 30s 任务期限，失败、超时或清理不可证明完成一律
   记 missing，绝不影响 run 结果。
2. **采集（`src/core/visual-capture-executor.mjs`，纯 ESM）**：每侧两次
   连续整页截图测量稳定性（不再断言）、`sampleDomGeometryInPage` 采样
   DOM 几何并与截图 SHA-256 绑定、描述符按第 2 节合同记录。工件写入
   `<evidence>/visual/<viewport>/`，manifest 新增 `visualCaptures`，
   记录描述符 + 每个工件的相对路径与 SHA-256。
3. **分析（宿主侧 `src/core/visual-verification-attach.ts`）**：校验
   manifest 记录（路径白名单 `visual/<dir>/{baseline,candidate}.{png,-geometry.json}`、
   哈希、JSON 结构）→ 以 `expectedIdentityFor(candidate, revision)` 运行
   `analyzeVisualDifference` → diff 图与证据 JSON 写入
   `<run>/visual-analysis/<n>/` → 以 `toVisualEvidenceView` 生成 F 只读视图
   → 附加到 `run.visualEvidences`（attestation 之前）。manifest 记录与
   文件哈希不一致、路径逃逸、身份失配分别落到 `failed-to-run` /
   `stale`，缺失采集落到 `not-run`；任何视觉问题都不会使 run 失败。
4. **门控**：`VerificationRun.visualEvidences` 为可选附加字段，
   `validateRunRecord` 不读取它；断言、状态机、Receipt、审批门控均无
   视觉分支。视觉 `risk` 仅供 F 以“需人工复核”呈现。
5. **测试**：`visual-verification-attach.test.ts` 以真实 Chromium 端到端
   驱动 `executeVerification` → 宿主 attach，锁定 compared→`unknown`、
   missing→`not-run`、篡改字节→`failed-to-run`、错误来源树→`stale`、
   路径逃逸→拒绝六条保守语义；`verification-execution` 35 例全绿
   （页面装载计数按附加采集对已更新）。
6. **真实 React/Vite 样例**：`scripts/visual-evidence-vite-trial.mjs`
   用真实 Vite 构建（React 19）+ 真实 Chromium 走完整采集-分析链，
   产出 text-change（`unknown`）与 button-overlap（`risk`）两组
   baseline/candidate/diff 三图及证据 JSON（SHA-256 记录）。
7. **待验收**：Docker 容器端到端（本机无 Docker，容器路径由
   `verification-execution` 单测同 harness 覆盖）；F 工作台消费 UI；
   C+D sourceRef 与 `targetBindings.sourceRefs` 的精确对齐（当前取
   并集，未命中时按 `target-not-mapped` 保守降级）。

## 6. 回归基线

- `npm run typecheck`、`npm run build` 通过。
- 全量 Vitest：E 相关文件全绿；本机（Windows，无符号链接权限）上
  `runtime-identity`、`project`、`preview-resource-policy`、
  `verification-execution` 的符号链接/临时目录用例与 A 基线同 SHA 上的
  失败完全一致（57 例），属环境性失败，CI（Ubuntu）不受影响；
  E 唯一的符号链接负例同理（1 例）。
- Fixture 再生对照：除 projectId 合同扩展带来的既定字段外字节一致；
  PNG 像素级一致；环境元数据保持 CI 记录值。
- 五个资源基准场景（`large-many-regions` 等）全部在限内完成。
