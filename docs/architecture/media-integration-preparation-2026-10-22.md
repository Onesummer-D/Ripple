# D 任务交付：B MEDIA 独立成果集成准备与素材替换验收（2026-10-22）

分支：`feat/integration-media-preparation-20261022`（基线 = 最新 A `25250925`）
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

- 分支 HEAD：`eef726e`（= 09e8713 移植 + 5452406 四视口场景 + 本文档）；基线 `25250925`（A 分支最新，其 CI run 39780812421 success）
- 分支 CI（Linux，权威）：run [`39794609650`](https://github.com/Onesummer-D/Ripple/actions/runs/39794609650)（09e8713）**success**、run [`39795652882`](https://github.com/Onesummer-D/Ripple/actions/runs/39795652882)（5452406）**success**、run [`39796791980`](https://github.com/Onesummer-D/Ripple/actions/runs/39796791980)（eef726e HEAD）**success**
- Draft PR：[#26](https://github.com/Onesummer-D/Ripple/pull/26) → base `feat/project-first-core-20261018`（A）
- 本机门禁（Windows；Linux CI 为权威）：typecheck ✅、build ✅、MEDIA 6 文件 62 用例**零断言失败**（14 个失败全部是 `node_modules/.tmp` 临时目录删除的已知 EPERM teardown 噪音，已用独立探针证明重试即成功，用例体全过）；candidate/session/scope 回归 33/33 ✅

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
