# D 任务交付：B MEDIA 独立成果集成准备与素材替换验收（2026-10-22）

分支：`feat/integration-media-preparation-20261022`（基线 = 最新 A `16e737c1`）
定位：独立模块移植 + 兼容性验证 + 接口准备。**未合入任何 PR 全部修改、未动
A/main、未动 `project.ts` / `scope.ts`、未触发 Bolt 或 MEDIA 专项正式验收。**

---

## 1. MEDIA 现有能力清单（九项逐项清点）

「CI」= 是否有正式 CI 覆盖（Linux GitHub Actions）；「Chromium」= 是否有真实
浏览器验收；「A」= 是否已进入最新 A 主线（本分支移植记为「本分支」）。

| # | 能力 | 代码位置 | 实现 | 正式 CI | 真实 Chromium | 合入 A | 外部依赖 |
|---|------|----------|------|---------|---------------|--------|----------|
| 1 | 资产 SHA-256 内容寻址暂存 | `src/core/media-asset-staging.ts`（`createStagedAssetStore`） | ✅ | ✅ 单测（含缺失/篡改 fail-closed） | 间接（青野验收使用） | 本分支 | 仅 node:crypto/fs/path |
| 2 | 资产路径与引用解析 | `media-asset-staging.ts` `resolveAssetRefToRelativePath` + A `project.ts` 媒体节点提取（A@2525092 L222 已有 `media` SourceNode） | ✅ | ✅ 单测（危险形式/`..`/`%2e` 拒绝） | 间接 | 部分（A 已有节点提取；B 的 receiver 收窄见 §7-RFC） | SourceGraph（project.ts） |
| 3 | MEDIA asset-swap validate/plan | `src/core/media-asset-swap.ts` | ✅ | ✅ 单测（畸形输入/variants 显式 unsupported/区间缺失拒绝） | 不适用（纯函数 plan，承诺零写盘有专例） | 本分支 | `candidate-operation-executors` seam（自合并基 5225fe3 以来 A 0 改动） |
| 4 | 结构化候选补丁生成 | `media-asset-swap.ts` plan → A `candidate.ts` 核心统一生成 Git binary patch + patchHash/candidateTreeDigest | ✅ | ✅ 集成用例（二进制补丁、完整性校验、原工程与未授权页面不受影响） | 青野真实补丁通过 Run 39536064634 | 本分支（走 A 既有候选核心，未退化字符串替换） | A candidate/session/apply |
| 5 | 图片替换的 Scope 限制 | B `project.ts` `narrowMediaByReceiverType`（+42，fail-closed 已审查）+ A `scope.ts` `sourceProvenPageImpact` | ✅ | ✅ B 侧 project.test.ts | 青野验收 | **未移植**（共享核心，C 正在改 project.ts/scope.ts，见 §5/§7） | A project.ts/scope.ts |
| 6 | 未授权素材与未证明页面拒绝 | `media-asset-swap.test.ts` fail-closed 组（未注册执行器/畸形 payload/受保护目标/page-override 下结构化操作）+ 验收脚本 `sourceLocation` 动态图 fail-closed | ✅ | ✅ | 青野验收对动态商品图 fail-closed 并如实标注 | 本分支 | A scope/candidate 门 |
| 7 | 四视口视觉证据 | `src/core/media-viewport-evidence.ts` + `scripts/media-viewport-evidence.ts`（桌面1440/平板768/375/390） | ✅ | ✅ 模块单测（含 source-mapping 严格化 8 负例） | ✅ 青野 Run 39536064634 四视口双端；本分支 Fixture 实测（§6） | 本分支 | playwright + `project-viewports` |
| 8 | MEDIA 审批、应用和回滚 | `src/core/media-acceptance-apply.ts`（`applyApprovedCandidateWithRecovery` + `classifyRecoveryOutcome` 三态）+ A `apply.ts`/`session.ts` 公共生命周期 | ✅ | ✅ 恢复注入 4 用例 + run-dir 5 负例 | ✅ 青野三场景实测（正常/post-apply 注入自动回滚/rollback-failure 现场保留） | 本分支 | A apply/session/project |
| 9 | 真实青野 MEDIA 验收历史 | GitHub Actions Run [`39536064634`](https://github.com/Onesummer-D/Ripple/actions/runs/39536064634) SUCCESS（workflow_dispatch @ main `5e1f909c`，Ripple `d01604c4` × 青野 `f7e4998a`，约 99s，工件 `ripple-qingye-media-39536064634`）+ 本机三次注入实测（证据在 B 侧 `_scratch/media-acceptance/`） | ✅ | ✅ | ✅ 双端四视口 | 否（验收针对 B 基线 d01604c4，非本分支） | 青野真实工程 + BOLT_REPO_TOKEN |

**范围声明（如实）**：第 9 项通过的是**青野分类图 source-proven MEDIA asset-swap
单操作闭环**。动态商品图（静态不可证明）、variants、SCSS Token 仍为未验证/不支持，
不宣传为已支持。第 4/8 项的「真实」仅指青野 Run；本分支只做模块级验证。

## 2. 已迁移文件及测试（本分支相对 A@2525092）

新增（字节级来自已审查的 `feat/b-media-overnight-20261021`）：

- `src/core/media-asset-staging.ts`
- `src/core/media-asset-swap.ts` + `media-asset-swap.test.ts`
- `src/core/media-viewport-evidence.ts` + `.test.ts`
- `src/core/media-acceptance-apply.ts` + `.test.ts`
- `src/core/media-acceptance-run-dir.ts` + `.test.ts`
- `src/core/media-acceptance-server.ts` + `.test.ts`
- `scripts/media-qingye-acceptance.ts`、`scripts/media-viewport-evidence.ts`
- `docs/architecture/media-asset-swap-executor-contract-2026-10-19.md`
- `tsconfig.node.json`：include 增加 `scripts/**/*.ts`（C PR#11 未触碰此文件，无冲突）

未迁移（共享核心，按任务边界留待 C+D 集成，见 §7 RFC）：

- `src/core/project.ts` `narrowMediaByReceiverType`（+42 行）及其 `project.test.ts` 用例

安全门保留核对（全部在移植测试中成立）：MEDIA/asset-swap 明确注册
（`mediaAssetSwapExecutors`）、未注册操作拒绝、暂存字节哈希验证（篡改/缺失 fail-closed）、
create-only 资产写入限制、sourceEdit 精确落在 target.location 区间、严格 Scope、
审批→应用→回滚正式生命周期、variants/JSX 新增属性显式 unsupported 未放宽。

## 3. 最新 SHA 与 CI

- 分支 HEAD：`d8b5b4d`（= 移植 + 四视口场景 + 两轮审查返工 + 终审返工 + Fixture 定向
  workflow Node 版本修复；基线 A `16e737c1`）
- 分支 CI（Linux，权威）：6a988e8 全量 [`39815985632`](https://github.com/Onesummer-D/Ripple/actions/runs/39815985632)、
  6c01714 全量 `39821448438`、6c01714 Fixture 首跑（Node 20 失败，环境问题见 §3.7）、
  d8b5b4d 全量 `39822455068` + Fixture 重跑 `39822445778` 全部 **success**
- Draft PR：[#26](https://github.com/Onesummer-D/Ripple/pull/26) → base `feat/project-first-core-20261018`（A），**保持 Draft 等 C+D 合同稳定**
- 本机门禁（Windows；Linux CI 为权威）：typecheck ✅、build ✅、MEDIA 用例零断言失败（EPERM teardown 为已知环境噪音）；终审返工后 asset-swap/staging 负例全绿、四视口 Fixture 端到端复跑（含产物核验与失败路径负例）✅

## 3.7 终审返工记录（协调人第三轮 · 最终复审，提交 `6c01714`，workflow 修复 `d8b5b4d`）

复审三项（细节见 PR #26 评论）及处理：

1. **P1 图片字节校验统一入口**：新增 `media-asset-staging.ts` `assertMediaSwapAsset(bytes,
   assetRef)`（格式头嗅探 + 扩展名一致性 + 必须有扩展名；PNG 全 8 字节签名、GIF 仅
   87a/89a、RIFF+WEBP、ftyp avif），执行器 plan 内调用——绕过验收脚本直接驱动
   执行器也无法写入未校验字节；青野验收脚本改走同一入口。已如实注释边界：头识别
   ≠完整有效性，真实解码由浏览器证据链兜底。新增负例：扩展名不一致 / 缺扩展名 /
   伪造头边界声明 / 执行器绕过（非图字节、PNG 字节配 .webp）。
2. **P2 证据信任边界注释**：青野脚本哈希回验处注明——哈希一致性 ≠ 来源真实性，
   候选身份四元组由 A 的 attest/Receipt 复核。
3. **P1 Fixture 纳入正式回归**：`run-scenario.ts` 正例后产物完整性核验（evidence/dual
   哈希回验、4 视口、8 截图 PNG 魔数、comparison 恰 24 条观测）+ 失败路径负例
   （tampered assetRef 必须非零退出）；新增定向 workflow
   `media-fixture-regression.yml`（paths 过滤 + dispatch，Node 22 与 ci.yml 对齐——
   首跑因误配 Node 20 报 `bad option: --experimental-transform-types`，`d8b5b4d` 修复）。
4. **真实工程形态 Lab（非本 PR）**：栖光 React/Vite 多页 Lab 独立分支
   `prep/qiguang-media-lab-20261023`，见 §6.5。

## 3.8 第四轮审查处理（协调人，2026-10-23，提交 `dd22676`）

1. **双端截图内容哈希回验**：`MediaViewportObservation` 新增可选 `screenshotSha256`
   （采集器登记候选端 `<viewport>.png` 哈希；基线端哈希原已在 `dual.json` 登记）。
   `run-scenario.ts` `verifyArtifacts()` 对 8 张截图重算 SHA-256 逐项比对，登记值
   缺失即 fail-closed；保持既有 evidence/dual 内容哈希与四视口检查不变。
2. **截图篡改负例**：翻转候选/基线 desktop 截图中段一字节（PNG 头保持有效），
   `verifyArtifacts` 必须拒绝；本机实测拒绝信息「候选端截图内容哈希不匹配」。
3. **栖光 Lab 口径修正**：截图总数为 **24 张**（3 页 × 4 视口 × 双端；此前口头表述
   48 张有误，48 是断言数 3 页 × 4 视口 × 4 项）；已入库文件统一表述并明示边界——
   现有断言不构成完整页面逐像素一致声明。
4. **栖光 Lab CI**：独立分支 workflow `qiguang-lab-ci.yml`（paths 过滤 + 真实
   Chromium）：双变体构建 → 共享组件源码字节恢复检查（git diff --exit-code）→
   三页四视口采集 → 证据哈希核验 → 非目标媒体字节一致 → 档案页零共享消费，
   并显式输出截图数（24）/断言数（48）与失败原因。不触发正式 Bolt 验收，
   Lab CI 通过 ≠ 真实 MEDIA 完整生命周期通过。

## 3.5 工程复审记录（协调人第二轮，2026-10-23，提交 `6a988e8`）

七项审查结论（细节见 PR #26 评论）：

1. **来源/路径/类型/身份**：SHA-256 全链 + assetRef 白名单 + 路径越界拒绝 + 截图 PNG 魔数 + dual 哈希回验原本齐备；**返工补齐文件类型验证**——`assertImageBytes` 魔数嗅探（jpeg/png/webp/gif/avif），青野验收下载入口接入，非图字节不再能以图片扩展名进入项目 public。
2. **生命周期**：暂存（临时文件+lstat 符号链接检查+原子 rename）、应用恢复三态、run 目录隔离、现场清单、成功路径清理均完备。已记录残留（不返工）：SIGKILL 可能遗留 `.tmp` 孤儿（内容寻址不受影响，手动清理即可）。
3. **多页面共享消费识别**：双端每视口消费实例计数恰为 1 的 URL 级唯一性证明，fail-closed；**真实边界如实声明**——多页面场景与 CSS 背景图消费未覆盖（CSS url 不进 A SourceGraph 媒体节点），属 C+D 联合集成项。
4. **CSS 背景图/组件属性/不同布局**：组件属性消费覆盖（fixture 三容器四视口实证）；CSS 背景图明确 unsupported；object-position 关键字/四值语法为已知边界（真实 Chromium computed style 序列化为百分比，不可达；沿用 B 既有登记）。
5. **路径遍历/符号链接/中断/部分写入**：服务层越界与出 root 符号链接拒绝有测试；**返工加固**——`resolveAssetRefToRelativePath` 显式拒绝反斜杠（Windows 分隔符重解释可逃逸 publicDir）；部分写入由树摘要比对兜底。已记录残留：run 目录分配的理论竞态（本地单运行器场景，P3）。
6. **四视口证据与资源版本一致性**：候选身份四元组绑定 + 四视口缺一即报错 + 基线截图内容哈希 + currentSrc 规范化匹配；**返工补齐** evidence.json 内容哈希回验（与 dual.json 对称）。
7. **重复代码/过度防御**：**返工清理**——提取 `attachPageErrorHooks`（保持候选/基线语义差异）、删除无效三元、evidence/dual 解析一次复用。原样保留的"防御"均有安全语义（哈希复核、计数恰为 1、场景保留），非过度。

## 4. 接口表（SourceGraph / Candidate / E / F）

| 接口 | 提供方 → 消费方 | 当前状态与约定 |
|------|----------------|----------------|
| 图片 sourceRef | C(SourceGraph, `project.ts`) → MEDIA 执行器 | A@2525092 已提取 JSX `src` 字面量为 `media` SourceNode（value=assetRef，location 精确区间）。B 需 receiver 类型收窄（§7 RFC） |
| 页面影响范围 | C/A `scope.ts` `sourceProvenPageImpact` → 候选门 | A 已实现：静态可证明→页面集合；不可证明→unknown，候选 fail-closed |
| 动态/不可证明消费降级 | `media-viewport-evidence.ts` `resolveSourceMappingAssertion` → 验收门 | 双端各视口消费实例计数必须恰为 1；>1→risk、0/未加载→unknown，均阻断 PASS |
| 已授权范围 → 执行器 | `session.stageOperations(executors=[mediaAssetSwapExecutors])` → `candidate.ts` → executor.validate/plan | `CandidateOperationExecutor` 合同自合并基 0 改动；plan 输出 sourceEdit（限区间）+ fileWrites（create-only）+ staged 字节 sha256，由 A 核心复核 |
| 截图与几何 → E | MEDIA `evidence.json` / `dual.json` / `<viewport>.png`（含 sha256）→ E `visual-evidence.ts` | MEDIA 侧产物齐备（青野 Run + 本 Fixture 实证）；与 E `ScreenshotInput`/`VisualComparisonRequest` 字节级对接可行；crop 几何（visibleSourceRect）↔ E `GeometryReport` 字段映射待联合验收对齐 |
| 前后对比 → F | MEDIA 截图对（`*-baseline.png`/`<viewport>.png` 命名成对）→ F `EvidencePanel`（`evidenceAssetHref(item.screenshotPath)`） | F 已能展示证据截图文件；before/after 对照视图是 F 侧工作，MEDIA 侧数据契约已满足 |

## 5. 与 C PR#11 的冲突文件清单

本分支 diff 相对 A 仅含：**全新文件 + `tsconfig.node.json` 一行 + `test/fixtures/` 新增**。
C PR#11 触碰 `model.ts / project.ts / scope.ts / verification-runner.ts / candidate-preview.ts /
verification-receipt.ts / ProjectWorkbench.tsx / e2e / ci.yml / bolt-acceptance.yml` 等。

**文本冲突：零。** `tsconfig.node.json` C 未改；双方无共同修改文件。

语义级关注（非文本冲突，需 C 合入后回归）：

1. C 改 `project.ts`（+110 行，含 data routes）——可能影响媒体节点提取行为，需重跑 MEDIA 集成测试批次；
2. C 改 `scope.ts`（+3 行）——需确认 `sourceProvenPageImpact` 语义未变；
3. C 改 `model.ts`（+8 行）——需确认 `MediaAssetSwapPayload` 未被波及（当前 A 侧为 B 超集，兼容已验证）。

## 6. 四视口素材案例测试及证据

`test/fixtures/media-orientation-swap/`：横版 1600×900 → 竖版 900×1600，同一素材被
首页 Hero（16:9 cover/center）、活动图区（4:3 cover/50% 20%）、商品卡片（240² cover/top）
三容器消费。真实 Chromium 一次采集（本机，2026-10-22）：

- 采集器（B 侧字节未改）四视口断言全 pass：`media-loaded / media-source-swapped /
  media-crop-geometry / media-browser-errors`，退出码 0；
  `evidence/evidence.json`、`dual.json` + 8 张截图已入库；
- 双端几何 24 条观测（`evidence/comparison.json`）：容器尺寸替换前后完全一致，
  可见源窗口剧变（桌面 Hero：横版纵向微裁 → 竖版仅见 ~21% 源高度，底部标签被裁，
  截图对 `desktop.png` vs `desktop-baseline.png` 肉眼可核）；
  object-position 方向差异逐容器可查（活动区上移 / 卡片置顶）；
- 复现：`node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs
  test/fixtures/media-orientation-swap/run-scenario.ts <outDir>`；
- Fixture 无交互声明，`dual.json` 中 `baselinePassed/candidatePassed=false` 为预期
  （未声明 navigateBy/interaction），不影响 pass 结论。

## 6.5 栖光 React/Vite 多页面 Lab（独立准备分支，不入本 PR）

分支 `prep/qiguang-media-lab-20261023`（`6b49156`，从 `d8b5b4d` 切出）：
真实工程形态的 MEDIA 集成准备 Lab——React 19 + Vite 6 扁平多页
（`test/qiguang-lab/`），共享媒体唯一编辑点 `SharedFestivalImage.tsx`
（`/media/qiguang-hero-wide.jpg`）被三页三个容器消费：首页 Hero（16:9 cover
center）、节目页展墙（4:3 cover 50% 20%）、购票卡片（3:4 cover top）；竖版候选
900×1125。本机真实 Chromium 采集（2026-10-23）：三页四视口采集器全 pass，
每页 evidence/dual 哈希 + 8 截图；非目标资源断言通过（档案图/首页本地图双端字节
一致、档案页双端渲染零共享消费）。`build-variants.mjs` 构建双变体并强制还原源
文件。定位与边界同 §6：消费关系由工程结构显式声明，非 SourceGraph 证明。

## 7. 尚未具备真实集成条件的部分

1. **RFC：`project.ts` `narrowMediaByReceiverType`（+42 行 + 测试）** —— 移植确需修改
   共享核心，而 C 正在改同一文件。建议 C PR#11 合入、A 核心稳定后，以最小 diff 重放
   B 已审查实现（fail-closed 语义不变），再跑 MEDIA 批次回归。冲突说明：B 实现基于
   5225fe3 时代 project.ts，C +110 行后需逐行核对插入点。
2. **C+D 联合实测未做**：本分支 Fixture 明确不依赖真实 SourceGraph 消费证明，
   不得引用为联合实测。真实消费证明驱动的 MEDIA 候选→四视口→Approval→Apply→Rollback
   全链需 C 合入后在青野固定 SHA 上重跑。
3. **E 接口映射未对齐**：MEDIA crop 几何 ↔ E `GeometryReport` 的字段级契约需
   联合验收时逐字段确认。
4. **正式验收环境**：青野专项 workflow 在 main（PR#8 已合入），复跑需
   `BOLT_REPO_TOKEN`（admin 确认存在性）+ 负责人 dispatch。
5. 动态商品图 / variants / SCSS Token 维持 B 既有 unsupported 结论。

## 8. 后续正式 MEDIA 联合验收步骤

1. C PR#11 合入 A，固定 A/C 双 SHA；确认 §5 语义关注点回归通过。
2. 按 §7-RFC 重放 `narrowMediaByReceiverType` 至最新 A；MEDIA 批次 + A 全量门双绿。
3. Actions dispatch 青野 MEDIA 验收（固定 d01604c4×f7e4998a 或更新审核 SHA），
   工件留存四视口截图与 acceptance.json。
4. 将本 Fixture 升级为 SourceGraph 驱动：真实消费证明 → 候选 → 四视口 → E 视觉判定。
5. C+D+E+F 联合验收会：SourceGraph 消费证明 → Scope 传播 → staging → 候选补丁 →
   四视口双端证据 → E 截图/几何判定 → F 前后对比 → Approval/Apply/Rollback，
   逐项签署，未运行环节不记 PASS。
