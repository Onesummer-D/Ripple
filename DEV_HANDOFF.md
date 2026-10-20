# Ripple 跨 Agent 开发交接（A 主线）

## 0. 最新增量核查（2026-10-20 14:51，UTC+8）

> 此节是接班人优先读取的最新核查。A 分支最新 *文档* HEAD 为 `d8d8b185f65da6eaefa7e0c9e9b70b0df80ef311`；**最近真正变更的 A 业务代码仍是 `6b63f9455164e157b28269f75ef072c298fac69e`**。本节提交将再次推动 PR #2 HEAD 前进，请以 GitHub 远端为准。本文保留此前交接记录中另一 Codex 工作区观察，但本次只直接核实 GitHub 远端，不独立确认本地 Windows 工作区状态。

- **A PR #2**：[最新文档提交 `d8d8b18`](https://github.com/Onesummer-D/Ripple/pull/2) 是在 `9af557c` 后两次 `DEV_HANDOFF.md` 的文档修订，**没有新业务代码**；[CI #253 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39378653088)。原业务代码 `6b63f94` 的 [CI #244 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39358087997)：162 单测、Playwright 10 通过/1 跳过。**Bolt Run #6 仍是最近一次真实 Bolt 工作流，失败**；不存在后续真实 Bolt 成功记录。
- **B PR #7** 最新 `b7a0306aec78b71a1146f3922b96d2ffca306d0b`，[CI #251 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39364483748)。B 已提交 `mediaAssetSwapExecutor` 无副作用 `plan`、内容寻址资产暂存、`media-viewport-evidence.ts`、`scripts/media-viewport-evidence.ts`、`scripts/media-qingye-acceptance.ts` 和 `.github/workflows/media-acceptance.yml`。来源分析 PR #4 仍 `137ff54`。**B 的工作流目前只在 Draft PR #7，未发现真实青野 MEDIA 的 Actions 成功运行；CI #251 不是这条私有项目专项验收。**
- **B 验证脚本 P1（静态源码审查，尚未实机运行新专项）：** `scripts/media-qingye-acceptance.ts` 的 `trustedRun()`（约第 78–133 行）把七个必需断言全部写为 `pass`，但 `interactionObservations: []`；其 `baselineComparisons` 以同一摘要填写基线和候选、对应工件只是 `media-evidence-link.json`，不是真正的前后快照。A 的 `verification-receipt.ts` 会要求交互 PASS 必须有实际观测，以及快照工件包含 `baselineSnapshot`/`candidateSnapshot` 和一致摘要；这些记录**按当前形态无法满足受信验收**。另外 Evidence 真实文件位于 `<workDir>/evidence/evidence.json`，当前声明相对验证运行目录的工件路径，需核对是否能被 receipt 正确定位。**禁止通过降低 A 的门控、手工伪造 manifest 或自动填 PASS 解决。** B 应将 Playwright 的真实原站/候选浏览器观测映射为合同允许的逐项结果，无法检查的保持 UNKNOWN/NOT_RUN；若 MEDIA 必须新增独立 assertion 类型，应与 A 提交最小明确接口和负例。
- **B 媒体证据其他待核查项（P2）：** `currentSrc.includes(assetRef)` 仅是子串命中，可能产生错误资源匹配；`computeCropGeometry` 的 CSS `object-position: 100px` 处理采用不符合实际 CSS 对齐语义的裁剪限制；四视口截图文件目前未逐一作为带 SHA 的来源证据登记。应补真实浏览器负例、资源 URL 规范化匹配、截图哈希与版本绑定后再宣称完整视觉证据。
- **A/B 集成风险：** A 当前核心是 `6b63f94`；B PR #7 以较旧 A 基线开发，未证明和 A 最新 HEAD 共同构建、统一 Verification/Approval 通过。先在独立集成分支安全复验再合并；不要直接合并 Draft PR，也不要让 A 替 B 重做 MEDIA。
- **当前 A 接班第一动作不变：** 核对 [Bolt Run #6](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574) 的 trace/日志，定位 `ERR_NETWORK_CHANGED` 的可复现根因。A 完成真实 TEXT 后继续运行时关联、TOKEN 执行、AI 意图校准与视觉 Evidence 等技术主线；**暂缓正式 UI/UX 重构**。A 可向 B 通报上述证据门控 P1，但不必因此等待 MEDIA 才能修 Bolt。

> **核查快照：2026-10-20（UTC+8）**。GitHub PR #2 的交接前 HEAD 为 `9af557c42a8c9298ac0fe63fefed88b47cc79b1d`（只新增本文件），被审查的**业务代码基线**仍为 `6b63f9455164e157b28269f75ef072c298fac69e`。本次文档提交还会使分支 HEAD 前进；最终 SHA 以 PR 的最新提交为准。接班人须重新核对远端分支、CI 与工作区。

## 1. 任务、分支与协作入口

| 项目 | 已核实状态 |
| --- | --- |
| 主仓库 | https://github.com/Onesummer-D/Ripple |
| A 负责内容 | Project-first 统一核心、TEXT 真实 Bolt 闭环、DOM/运行时来源与精确授权、TOKEN 执行器、AI 意图校准、通用浏览器 Evidence、公共运行适配 |
| A 开发分支 | `feat/project-first-core-20261018`，PR [#2](https://github.com/Onesummer-D/Ripple/pull/2)（Draft，**未合并**） |
| A 业务基线 | `6b63f9455164e157b28269f75ef072c298fac69e`；交接前 PR HEAD `9af557c42a8c9298ac0fe63fefed88b47cc79b1d`（仅文档） |
| A 常规 CI | 业务基线 [#244 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39358087997)；交接前文档 HEAD 的 [#245 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39359710518)：29 测试文件、162 单测通过、typecheck/build 通过，Playwright 10 passed / 1 skipped / 0 failed（跳过的是真实 Bolt 专项） |
| 真实 Bolt | [Run #6 失败](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574)，同一 A SHA，失败诊断见第 4 节 |
| B 契约对齐 | [PR #3](https://github.com/Onesummer-D/Ripple/pull/3) open，`8696612cf76d7b29fa19118af40efb8bf0d4ca37`；冻结最小 `ripple-edit-operation-session/v1`，不等于 MEDIA 执行器完成 |
| B 来源分析 | [PR #4](https://github.com/Onesummer-D/Ripple/pull/4) Draft，`feat/b-media-provenance-20261018` @ `137ff5444895a4ec906c13e25d2168581afab7a5`；[CI #232 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39249092355) |
| B MEDIA 执行器 | [PR #7](https://github.com/Onesummer-D/Ripple/pull/7) Draft，`feat/b-media-executor-20261019` @ `b7a0306aec78b71a1146f3922b96d2ffca306d0b`；[CI #251 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39364483748)。新增四视口 Evidence、真实青野验收脚本与独立工作流；**无已证实的真实青野专项通过，验证记录集成存在 P1，详见第 0 节** |
| 第三方适配 | [Issue #6](https://github.com/Onesummer-D/Ripple/issues/6)：**B 牵头**真实第三方接入/泛化，A 提供通用 ProjectRunner / Candidate / DOM→Source 核心；Issue 评论为最新分工参考 |
| 主干 | `main` 仍与 A/B Draft 开发分支不同；不得把 main 当作最新开发基线 |

**最新负责人决策（优先于历史任务指令）**：A **先完成底层技术系统**，暂缓正式 UI/UX 重构。现有工作台只作为 API、技术调试和 E2E 入口；视觉架构由负责人后续统一设计。此前要求 A 立即主攻 UI/UX 的提示词已经被后续决策覆盖。

## 2. 长期产品与架构依据（只引用，不全文重复）

必读的真实仓库文件：

- [产品定位与架构复审 v2](docs/strategy/Ripple_产品定位与架构复审_v2_2026-10-18.md)
- [Codex 架构审计与重构决策任务书 v2](docs/strategy/Codex_架构审计与重构决策任务书_v2_2026-10-18.md)
- [Project-first 合同 RFC](docs/architecture/project-first-contract-rfc-2026-10-18.md)
- [结构化 Candidate 执行器合同](docs/architecture/structured-candidate-executors.md)
- [运行适配能力与安全边界](docs/architecture/project-runner-capabilities.md)
- [隔离预演平台](docs/integration/isolated-preview-platform.md)
- [Issue #6 A/B 接口回复](https://github.com/Onesummer-D/Ripple/issues/6#issuecomment-6267170299)
- 仓库现有 [README.md](README.md) 及相关竞品调研 [docs/research/competitors](docs/research/competitors)。

**检查发现**：当前 A 仓库扫描未发现 `AGENTS.md`；不要谎称已读。`DEV_HANDOFF.md` 首版由 `9af557c` 加入；本文是在该文件上校正现状。README 部分仍描述早期 Fixture/案例工作台，不能仅凭 README 宣称真实项目完全验收。

产品技术目标：**真实 Project → 编辑意图校准 → SourceGraph + 实际 DOM/运行时来源 → Scope 授权 → 统一 CandidatePatch → 隔离预演 → 多视口真实 Evidence → 审批 → 同补丁应用与回滚**。TEXT、MEDIA、TOKEN 是同一次 CandidateEdit 的资源类型，不得建立三套生命周期。可参考成熟技术/开源实现，但复用代码或资产前核对许可证、来源和兼容性。

## 3. 已有实现 vs 未完成能力

**已实现且有对应合成/CI 验证：**

- Project-first 项目静态分析、基础 SourceGraph/Scope/项目能力声明；SourceGraph 与有界 Vite 预演共用 TS 配置图解析；不能把静态 supported 当成实际运行成功。
- TEXT 目标、Candidate、Session、Scope、Verification、Approval、Apply/Rollback 的统一核心及合成项目浏览器 E2E；页面级 TEXT 覆盖、连续维护相关合成验收已覆盖部分情景。
- 显式注册的 `CandidateOperationExecutor` 和 `CandidateOperationPlan`（`sourceEdits` + **create-only** 二进制 `fileWrites`）、资源 SHA 校验、真实 binary patch、`patchHash`/`candidateTreeDigest`、保护范围、源码漂移和应用/回滚完整性测试。**默认没有生产 MEDIA/TOKEN handler**。
- Node/Vite/Tailwind/PostCSS 受限预演基本能力；依赖挂载改为 `/work/node_modules`，非 Bolt Tailwind computed-style 真实浏览器回归已通过。
- 匹配版本 Playwright Docker 镜像的**预拉取、离线运行前检查和受限烟测**已经实现并在 Run #6 前置步骤成功；Run #5 的“首次隐式镜像拉取”不再是当前首先需要修的问题。
- B 的 MEDIA SourceGraph 与独立执行器模块在各自 PR 上通过 CI，**不能据此宣布 B handler 已与 A 核心联合集成，或青野真实 MEDIA 闭环已通过**。

**尚未通过真实项目验收/尚待研发：**

1. 原始 Bolt 工程的完整 TEXT 浏览器 Evidence → 审批 → 应用 → 回滚（Run #6 尚在预览加载阶段失败）。
2. 生产 MEDIA asset-swap 与 A 统一执行器集成、真实青野数据图像消费、四视口图片加载/裁切 Evidence、回滚（B 主责）。
3. 真实 CSS Token 修改执行器及级联/局部覆盖/computed-style 验证（A 主责；消费来源部分复用 B）。
4. 用户自然语言意图的真正模型调用、目标定位、歧义澄清和 Scope 校准。当前输入框和手动 `targetRef` 流程**不等于**这项能力完成（A）。
5. React 组件实例、动态 state/props/key、路由、异步 API 与浏览器 DOM 的可靠来源关联及精准授权；无法确定必须 UNKNOWN（A）。
6. 视觉差异引擎：基线/候选状态对齐、截图/DOM 几何/computed-style/文本/资源联合判定、动态动画误报控制、按风险扩展验证及覆盖率（A 统合，B 提供媒体专项证据）。
7. 第三方真实工程的运行泛化。固定 codescandy 项目别名 `* → src/*` 目前 devPreview 为 ambiguous；不能用 Vite 通配符别名直接劫持外部 package，也不能硬编码仓库名（B 牵头实证，A 提供通用 resolver）。
8. TanStack Start、Next.js、SSR、服务端/API、任意 `vite.config` 插件或运行脚本等**未获支持证据**，不能暗示普遍兼容。
9. 多次维护的覆盖规则冲突、失效规则、来源追踪、版本证据失效、性能与安全验收；以及真实用户对照实验。它们不能由一次合成测试替代。

## 4. 当前最高优先级阻塞：Bolt Run #6

固定本轮来源：

- A 代码：`6b63f9455164e157b28269f75ef072c298fac69e`
- Bolt 测试项目：`Onesummer-D/ripple-qingye-bolt` @ `f7e4998a5c77ab4aeb3232dbc31e61196e9051a6`（私有仓库；CI 用受限 Secret 检出）
- Workflow：[Bolt acceptance #6](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574)
- 失败 job：`bolt-acceptance`，Step **Verify the real Bolt project through the Ripple workbench**
- 诊断附件：[Run #6 artifact](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574/artifacts/12236930061)，含失败截图、trace、浏览器上下文。下载材料有时限，请尽早核查。

**已通过的前置步骤：** 两次 checkout、npm ci、Chromium 安装、Docker 运行时镜像准备、Playwright 隔离容器预拉和烟测、宿主和容器 Tailwind/`@alloc/quick-lru` 解析。Vite 容器日志显示已 `ready`。

**真实错误，不能改写成猜测：**

~~~text
e2e/project-workbench.spec.ts:757
expect(projectFrame.locator('footer')).toBeVisible({ timeout: 90_000 })
Expected: visible; element(s) not found

requestfailed: /src/pages/AutumnPage.tsx (net::ERR_NETWORK_CHANGED)
requestfailed: /src/pages/ProductsPage.tsx (net::ERR_NETWORK_CHANGED)
requestfailed: /src/pages/StoryPage.tsx (net::ERR_NETWORK_CHANGED)
requestfailed: /@vite/client (net::ERR_NETWORK_CHANGED)

Vite preview transform responses: none recorded
Preview container logs: Vite server configured; preview server ready
~~~

**目前只能确认浏览器 iframe 资源请求因网络状态改变失败，不能证明是 PostCSS、Docker 网络路由、代理、预览重建、浏览器上下文还是服务生命周期的单一根因。** 该 run 未到 Candidate 四视口 Evidence/Approval/Apply/Rollback；本轮失败不能当成产品修改算法错误，也不能冒称通过。

**前几轮已尝试与结论：**

- Run #3：`/deps` 挂载导致 Tailwind 依赖 `@alloc/quick-lru` 解析失败；之后采用标准 `/work/node_modules`，Run #4 首屏/资源已能够加载。
- [Run #4](https://github.com/Onesummer-D/Ripple/actions/runs/39297763450)：旧按钮 accessible name 的 Playwright 选择器过期，之后修正。
- [Run #5](https://github.com/Onesummer-D/Ripple/actions/runs/39304045573)：真实预演及 Candidate 已到达验证阶段，但 Playwright Docker 镜像首次拉取导致失败；在 `6b63f94` 已加预热及 smoke，Run #6 前置检查确实通过。
- **Run #6**：变成新的 iframe 模块加载 `ERR_NETWORK_CHANGED`；应重新诊断而不是继续重复修已解决的问题。

**接班 Agent 的第一任务：**

1. 在不改业务文件的前提下核对上述 Run #6 job log、trace、error-context、截图和准确的 previewId/sourceDigest；确认真实 iframe 导航时序、模块请求时间线、容器进程/端口存活、浏览器网络上下文、网络中断是否可重现。
2. 重点审查 `e2e/project-workbench.spec.ts`、`src/core/candidate-preview.ts`、`src/core/candidate-preview-runner.mjs`、`src/core/candidate-preview-vite.config.mjs`、`src/core/local-project-api.ts`、`.github/workflows/bolt-acceptance.yml`；添加能区分启动成功但资源网络中断的诊断及最小复现。
3. 找到证据支持的根因后才作最小通用修复，不能靠放宽 `footer` 断言、无限延时、关闭隔离、忽略请求失败或 Bolt 仓库名特判来换绿色。
4. 完成 `typecheck`、`test`、`build`、相关 Playwright/Docker 回归与独立代码审查；提交新 SHA 后再请求负责人**一次**手动触发下一轮需要私有仓库的 workflow。无需让负责人重复创建 Token。
5. 真正通过原始 Bolt 的分析 → 目标/Scope → Candidate → Evidence → Approval → **同补丁应用** → Rollback 后，才能宣称 TEXT 真实闭环完成。

### 最近已提交的公共运行时修复（业务基线 `6b63f94`）

- `src/core/verification-runner.ts`：先检查匹配的 Playwright 镜像，验证时禁止隐式拉取，并明确区分镜像缺失/超时；避免首次拉取占尽验证窗口。
- `scripts/prepare-browser-verification.sh`：预拉镜像并在隔离容器中运行 Chromium 烟测；`.github/workflows/ci.yml` 与 `.github/workflows/bolt-acceptance.yml` 均在浏览器验收前调用。
- `src/core/bolt-workflow.test.ts`：锁定工作流准备步骤；`docs/architecture/project-runner-capabilities.md`：记录运行能力和限制。本次交接更新**不修改业务代码**。

## 5. 之后的 A 技术路线（不含正式 UI/UX）

依赖优先次序：

1. **Bolt TEXT 真实项目闭环**与证据。
2. **运行时实例来源与精准授权**：共享组件 vs 消费实例、React state/props/key、路由/API、语义不确定关系，确保 SourceGraph → DOM 关系有证据；保护未授权位置。
3. **CSS Token 执行器**：共享变量与独立颜色区分、级联/局部覆盖、真实 computed style、文字对比度、同一 Candidate 生命周期。
4. **AI 意图校准服务**：保留原话、可核查的结构化 Intent/Scope、最少必要澄清、明确保留范围、不擅自补全业务决策；可插拔受支持的模型调用，而非仅靠固定规则。
5. **完整 Verification/Evidence**：多页面与 1440×900 / 768×1024 / 375×812 / 390×844 四视口、运行状态、DOM 几何、视觉差异与动态内容抑制、可访问性风险、证据 SHA/生成时间/覆盖率/过期判断。
6. **长期维护/复杂工程公共能力**：框架适配器、TypeScript wildcard fallback、持续编辑与覆盖规则整理、冲突与漂移检查、隔离安全；对 B 的 Issue #6 提供公共修复而非另建管线。
7. **系统级联合验收**：青野 TEXT/MEDIA/TOKEN、真实外部代码、重复维护与用户基线对照的可复核技术记录。

支持边界依具体证据拓展。不要为赶进度降低正确性，不要因为重用成熟技术而过度宣称独创，也不要把不存在的 UI 功能写成已完成。**正式 UI/UX 由负责人后续设计，目前仅维护技术调试入口。**

## 6. A/B 合同与文件所有权

- 冻结领域合同：`ripple-edit-operation-session/v1`。若变更 schema，需双方复审、迁移和负例，不可单方面改字段。
- A 公共核心：`src/core/model.ts`、`session.ts`、`scope.ts`、`candidate.ts`、`candidate-operation-executors.ts`、`local-project-api.ts`、运行/验证适配器。A 处理共享接口与安全边界。
- B 专项：`src/core/project.ts` 中 B 负责的 MEDIA/TOKEN 来源逻辑、`src/core/media-asset-staging.ts`、`media-asset-swap.ts`、媒体测试与 Evidence、第三方真实泛化报告。A 不无协调改 B 模块；B 不自行另建 Session/Candidate/Approval/Rollback。
- 结构化 handler 必须显式注册；`plan` **同步、无副作用**返回 `sourceEdits` 与 **只允许创建新文件**的 `fileWrites`，实际写入由核心负责。未知 action、无注册、畸形操作、protected/excluded、源码位置漂移均 fail-closed；页面级 MEDIA override 当前不得默认放行。
- `srcSet` 新增 JSX 属性可能超出已证明的属性文字区间；未经新 AST 授权不可放宽 Scope。先支持确切的 src/已有 srcSet 字面量，其他返回 unsupported 并提供最小真实复现供双方协商。
- B PR #7 在当前 `b7a0306` 的 CI #251 已绿；其 PR 正文部分仍引用旧交付 HEAD。正式整合前须在最新 A 基线上复验 handler 与公共 registry seam、文件写入及补丁完整性，不能把 B 分支 CI 通过自动解释成联合集成已完成。
- PR #4/#7 都基于 A 较早分支基线；合并/联合复验前须明确 base HEAD 并解决演进冲突。任何人都不得自行合并 Draft PR 到 main。

## 7. 代码入口与复现命令

原生依赖和执行脚本以根目录 [package.json](package.json) 为准；已核实命令：

~~~bash
npm ci
npm run dev              # README: http://localhost:4173
npm run typecheck        # tsconfig.app + tsconfig.node
npm test -- --run         # Vitest 一次性
npm run build            # tsc -b + vite build
npx playwright install --with-deps chromium
npm run test:browser     # Playwright
npm run verify           # 项目内综合验证（可能产生日期化验收记录）
npm run smoke:static
npm run acceptance:phase4
npm run acceptance:phase5
npm run acceptance:runtime-node
~~~

CI 还有固定 React/Vite/Tailwind fixture 依赖准备：
`npm ci --ignore-scripts --no-audit --no-fund --prefix test/fixtures/react-vite-tailwind`，
Linux/Docker 下需运行 `bash scripts/prepare-browser-verification.sh`。参考 [CI workflow](.github/workflows/ci.yml) 及 [Bolt workflow](.github/workflows/bolt-acceptance.yml)。

真实私有 Bolt 测试需 GitHub Actions Secrets 中已经配置的 `BOLT_REPO_TOKEN`（**仅写 Secret 名称，不记录值**），固定 Bolt commit，手动运行 `workflow_dispatch`。没有该私有项目与权限时，测试会 **skip**，不可写作真实 Bolt 已通过。不要在不可信的 fork PR 或日志中暴露 Secret。

核心位置：`src/core/project.ts`、`project-capabilities.ts`、`project-config-resolver.mjs`、`scope.ts`、`session.ts`、`candidate.ts`、`candidate-operation-executors.ts`、`candidate-preview.ts`、`candidate-verification-runner.mjs`、`verification.ts`、`local-project-api.ts`；工作台与路由在 `src/app/`；真实 E2E 在 `e2e/project-workbench.spec.ts`。

## 8. 本地工作区与不可迁移资产（2026-10-20 实查）

本次可读的 A 本地 checkout：`D:\Onesummer_D\Learning\Competitons\ShuMei_QG\Ripple涟漪\ripple-app-pr2-6c6e-previewfix`。当前检出 `codex/core-runtime-pr2` @ `e16e78696f98edf4c099544d89cadbd9dbda2e81`（同一运行时修复的本地提交），**不是** GitHub PR #2 最新分支 HEAD。由于本环境 `git fetch origin feat/project-first-core-20261018` 两次均失败（先是 `getaddrinfo() thread failed to start`，提升网络权限后是 `Recv failure: Connection was reset`），本次文档通过 GitHub 已授权接口更新远端 PR 分支，未改变本地 checkout 指针；下一 Agent 切勿把该本地分支名误认成远端开发分支。GitHub 的当前分支 SHA 应以 PR #2 再核对。

本地 `git status --porcelain=v1` 与 `git ls-files --others --exclude-standard` 均为空：**没有已发现的未提交或未追踪文件**。但 `node_modules/.tmp/` 下有被 `.gitignore` 排除的 Run #4/#5 下载 artifact、trace、临时工程与 UI 截图；它们**只在本机，不在 PR 分支**，不能作为 Run #6 的证据。另有本地 `codex/ui-selection-card-paused` ref @ `35b6955417d0c76228a7696ae78e22871d247807`，GitHub 当前 API 查不到该提交；属暂停的 UI 实验，不得因交接而丢弃或误并入 PR #2。仓库外父目录的 `.planning/` 也不是本 PR 的交接来源。其他机器或 B 的工作区状态未查，不能推断其干净。

远端提交后，本地 checkout 虽无未提交文件，但会**落后于** PR #2；待网络恢复，先 `git fetch` 并检查分支/工作树，再在适当的工作树续开发。不得 `reset --hard`、`clean -fd`、强推或自动删除上述本地资产。私有 Bolt 源码、GitHub Secret、Docker 缓存与日期化运行记录也不会随交接文档自动迁移。

## 9. 交接执行协议与完成定义

1. 新 Agent 首先读本文件、产品复审 v2、有关结构化合同、Issue #6 和 PR #2/#4/#7，核对远端 HEAD 与 CI，并验证本地工作区；**项目进度以实际源码/测试为准**。
2. 若 Run #6 仍为最新阻塞，先从第 4 节开始；若仓库已新增成功 Run/修复 SHA，则据最新证据更新本文件，不要继续执行过期任务。
3. 遵守安全/权限/哈希/Scope 等必要保护，避免冗余 fallback、过度防御性包装、仓库名特判和为兼容旧结构无限叠加覆盖规则。可在有证据时重构错误抽象，不能为了保留旧代码妥协。
4. 每个可审核单元提交测试、SHA、真实/合成证据区分、独立代码审查和 P0/P1/P2 处理；不虚称“独立审查”已由同一 Agent 完成。未经负责人确认不合并 main、不代替 B 写 MEDIA 业务代码。
5. 接力前更新本文件的**代码基线 SHA、失败 Run、已通过 CI、下一实际动作、未提交工作项**。本文件更新造成 HEAD 前进，记录“所审查业务代码 SHA”和“交接提交 SHA”时须避免自引用错误；最终提交 SHA 以 GitHub 提交记录为准。

**接班的第一项实际开发任务：分析 Bolt Run #6 的 iframe `ERR_NETWORK_CHANGED`，形成可复现的通用根因及测试，再继续真实 TEXT 验收；无论成功或失败均记录对应准确 SHA 和 Evidence。**
