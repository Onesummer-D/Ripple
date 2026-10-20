# Ripple 跨 Agent 接力文档（A 主线）

> 更新时间：2026-10-21（Asia/Shanghai）。本文只记录已从 GitHub、当前工作区、测试输出或本次会话实际核对的状态。历史审查和旧 SHA 不作为当前能力证明。

## 1. 当前负责人、分支与远端基线

| 项目 | 当前已核实状态 |
| --- | --- |
| 仓库 | https://github.com/Onesummer-D/Ripple |
| A 负责分支 | feat/project-first-core-20261018 |
| PR | PR #2，https://github.com/Onesummer-D/Ripple/pull/2，Draft、未合并 |
| 最近已核查的业务代码基线 | 73bb9bd0be392d5e04ba3ad55b408da2f294c638 |
| 文档提交链 | 508821d → 10fe63c；均只更新本文件，最终文档提交 SHA 以 PR #2 页面为准 |
| PR #2 目标 | main；当前 PR 元数据标记 mergeable=false；不得自行合并或 rebase main |
| A/B 协作 Issue | Issue #6，https://github.com/Onesummer-D/Ripple/issues/6，open |
| B 文档契约 PR | PR #3，8696612cf76d7b29fa19118af40efb8bf0d4ca37 |
| B 来源分析 PR | PR #4，Draft，137ff5444895a4ec906c13e25d2168581afab7a5 |
| B MEDIA 执行器 PR | PR #7，Draft，f51719da56868c60b160bf1b9c20d81bf488012b |
| MEDIA workflow 入口 PR | PR #8，open、未合并，b438096eabe69373e8bac40195ad44a8e779dae0 |
| Issue #6 当前分工 | B 负责第三方工程泛化验收、MEDIA 执行器和 MEDIA/TOKEN 来源证据；A 负责统一 ProjectRunner、DOM→Source、Scope、Candidate、Verification、Approval、Apply/Rollback 及暂未分配的 CSS Token 执行器。 |

### 本地工作区与 GitHub 的差异

本次核查的 Windows checkout 是：

D:\Onesummer_D\Learning\Competitons\ShuMei_QG\Ripple涟漪\ripple-pr2-bolt-run6

本地分支仍停在 79de4b1，相对 origin/feat/project-first-core-20261018（已 fetch 到 73bb9bd）落后 5 个提交。工作区不干净，存在以下未提交或未追踪内容：

~~~text
MM DEV_HANDOFF.md
M  src/core/candidate-verification-runner.mjs
D  src/core/verification-runner.test.ts
MM src/core/verification-runner.ts
M  tsconfig.node.tsbuildinfo
?? _scratch/
?? src/core/browser-error-accumulator.mjs
?? src/core/browser-error-accumulator.test.ts
?? src/core/verification-runner-failure.test.ts
~~~

其中 tsconfig.node.tsbuildinfo、_scratch/ 和 staged 删除/修改不能由接班 Agent 擅自清理；它们可能是前一轮本地实验或诊断资产。远端 73bb9bd 已包含本轮正式推送的浏览器错误聚合器、失败诊断和验证器变更，508821d 与 10fe63c 只更新本文件；本地分支没有快进到远端。不要执行 git reset --hard、git clean 或 git stash。

当前仓库没有发现 AGENTS.md；长期规则以正式架构文档和仓库现有实现为准。

## 2. 技术目标与正式架构依据

Ripple 采用 Project-first，不再以固定 CaseFixture 作为业务中心。目标链路是：

~~~text
真实 Project → EditSession/意图 → SourceGraph 与 DOM/运行时来源 → Scope 决策
→ 隔离 CandidatePatch → 多视口浏览器预演与可信 Evidence
→ 用户 Approval → 应用同一份补丁 → 冲突保护回滚与历史恢复
~~~

TEXT、MEDIA、TOKEN 属于同一 EditSession/Candidate 生命周期，不得各自建立第二套状态机。用户看到的范围、来源、候选和验证状态必须来自真实工程和真实执行证据；UNKNOWN、RISK、NOT_RUN、STALE、FAILED_TO_RUN 不能伪装成 PASS。

下一位 Agent 必须先读：

- docs/strategy/Ripple_产品定位与架构复审_v2_2026-10-18.md
- docs/architecture/project-first-contract-rfc-2026-10-18.md
- docs/architecture/architecture-independent-audit-2026-10-18.md
- docs/architecture/structured-candidate-executors.md
- docs/architecture/project-runner-capabilities.md
- docs/integration/isolated-preview-platform.md
- src/core/model.ts
- src/core/session.ts

正式架构已明确：只支持受限 React/React DOM + Vite 风格 SPA 的固定预演适配器；不执行目标项目 lifecycle script、项目 Vite 配置、SSR 或任意自定义服务。TS references/extends 和 aliases 作为静态配置图解析；分析能力与实际预演能力分开声明。Docker worktree 不是完整执行沙箱。

## 3. 已实现且有证据的能力

### 领域与补丁生命周期

- ProjectRevision、SourceGraph、ScopeDecision、EditOperation、CandidatePatch、VerificationRun、Evidence、Approval、AppliedRevision 和 EditSession 已统一在 Project-first 契约中。
- TEXT payloadless 操作保持兼容；结构化操作必须通过显式注册的 CandidateOperationExecutor，未知、缺失、畸形或未实现 action fail-closed，不降级为字符串替换。
- Candidate 在隔离 Git worktree 生成真实源码 diff、patch SHA-256 和 candidate tree digest；多项操作在同一候选中合并。
- 路径越界、符号链接、源码漂移、protected/excluded Scope、候选哈希或字节篡改会拒绝。
- Approval、Apply、Rollback 使用同一已验证 CandidatePatch，不重新调用 Agent 生成另一份补丁；应用前检查原工程基线，回滚保护应用后用户新增修改。

### 来源、Scope、页面覆盖与浏览器执行

- src/core/project.ts 用 TypeScript AST 读取真实 React/Vite 工程；关系区分 imports 与实际 TEXT reads、TOKEN uses-token、MEDIA asset-consumer，无法证明的页面影响保留 UNKNOWN。
- src/core/source-annotation.ts 将 JSX 来源与运行时实例区分；React key 可形成稳定实例边界，无 key 的 map 实例标为 position-dependent/unknown，不能直接授权精准编辑。
- src/core/page-overrides.ts 使用 UUID 目标和 AST marker，支持重复分析、更新、移除和无冗余清理；不是基于源码字符 offset 的长期 ID。
- Candidate preview 使用受限 Docker、internal network、loopback relay、只读源码/依赖挂载、非 root、资源限制、CSP 和 sandbox iframe。原工程只读。
- VerificationRunner 使用固定 Playwright 镜像和四视口计划：1440×900、768×1024、375×812、390×844；Evidence 绑定 source digest、candidate/patch/tree hash、Scope 版本、runtime fingerprint、页面、视口、状态、截图和执行 JSON。
- 外部资源必须由用户明确授权并先做内容寻址快照；源码或注释中的 URL 不会自动获得信任。
- 工作台已有真实项目导入、分析、网页点选、意图/Scope、候选 diff、预演、Verification、Approval、同补丁 Apply、Rollback、历史入口。正式 UI/UX 重构当前暂停。

### Run #10 后的正式执行修复（远端 73bb9bd）

- src/core/candidate-verification-runner.mjs：复用根页面，声明页面 scope probe 并行执行，写入 candidate/baseline 导航、root、marker、probe、截图、interaction 等阶段计时；同一 page 不重复安装 route 和错误监听。
- src/core/browser-error-accumulator.mjs：保留精确总数和分类计数，样本去重并限制 25 条，消息和 URL 脱敏，样本带阶段/视口上下文。
- src/core/verification-runner.ts：失败时写 failed-to-run.json，保存 candidate/Scope/patch/tree/runtime 绑定、失败原因、已完成检查和最后 24 条 progress 记录。该文件是诊断工件，不是可审批 VerificationReceipt。
- 新增 src/core/browser-error-accumulator.test.ts 与 src/core/verification-runner-failure.test.ts，覆盖错误风暴、脱敏、样本边界、部分视口完成和失败诊断尾部。

## 4. 测试与真实工程验收状态

### 普通 Linux/Docker CI（远端已核实）

[CI #291 / run 39497518252](https://github.com/Onesummer-D/Ripple/actions/runs/39497518252) 对业务代码 73bb9bd 成功：

- 31 个测试文件通过，192 个单元/API 测试通过；
- TypeScript typecheck 通过；
- production build 通过；
- Docker runtime preparation/smoke 通过；
- Playwright 10 passed / 1 skipped，跳过项是需要私有 Bolt 凭据的专项；
- 工件：[artifact 12298593090](https://github.com/Onesummer-D/Ripple/actions/runs/39497518252/artifacts/12298593090)。

这证明合成 React/Vite 工程、隔离运行时和通用回归通过，不证明真实 Bolt 完整闭环。

交接文档提交 508821d 触发的 [CI #294 / run 39501643202](https://github.com/Onesummer-D/Ripple/actions/runs/39501643202) 在上一轮核查时为 in_progress；该工作流仅含文档变更，不能用来替代 73bb9bd 的业务 CI 证据。

### 本机 Windows 结果

- npm run typecheck：通过。
- npm run build：通过。
- 定向 Vitest（错误聚合器与失败诊断）：2 个文件、4 个测试通过。
- 完整 Windows npm test -- --run：未作为通过记录。执行遇到受限环境的临时 Git .git/config Permission denied、loopback relay EACCES 和 fetch 失败，随后中断。不能把本机结果写成全量通过。
- 本机没有可用 Docker/WSL2；不能据此声称 Windows/WSL2 预演已验收。

### 真实 Bolt Run #10

[Run #10](https://github.com/Onesummer-D/Ripple/actions/runs/39484983941)，运行 SHA 3901dc6，资源快照已真实成功：221 个外部资源、unavailable: []、约 12.4 MB。失败原因是隔离 Playwright 180 秒预算：desktop/tablet/mobile-375 完成，mobile-390 在预算到期前未完成，因 scope-probe 成本过高没有完整 VerificationReceipt。

### 真实 Bolt Run #11（当前最新，不能写成通过）

[Run #11](https://github.com/Onesummer-D/Ripple/actions/runs/39499078332)，运行 SHA 73bb9bd，结论 failure；job [118891647688](https://github.com/Onesummer-D/Ripple/actions/runs/39499078332/job/118891647688)，工件 [12300060206](https://github.com/Onesummer-D/Ripple/actions/runs/39499078332/artifacts/12300060206)。

前置步骤均成功：Bolt checkout、依赖安装、Chromium、Docker、Playwright 镜像和 smoke test。221 个资源快照成功，unavailableResources=0。失败发生在 e2e/project-workbench.spec.ts:971：

~~~text
FAILED TO RUN 隔离 Playwright 执行超过 180000ms；本次验证未产生可信证据
desktop: check-complete 13706ms
tablet: page:autumn scope-probe 166133ms
tablet: page:products scope-probe 166161ms
verification terminated at 180000ms
~~~

因此仍没有可审批的完整 Receipt，也没有真实 Bolt 的 Approval、Apply、Rollback、History Restore 通过证据。下一位 Agent 必须从这次日志的 progress.jsonl、failed-to-run.json、截图/trace 和容器/relay 状态继续归因；不能只重跑、加大预算、跳过 scope/interaction 或减少视口。

### 明确未验收或不支持

- 真实 Bolt 四页、四视口 TEXT 完整闭环：失败 / 未完成。
- 真实 Bolt Approval → Apply 同补丁 → 原工程检查 → Rollback → History Restore：NOT RUN/无完整 Receipt。
- Windows 原生 Node 直接运行 Docker 预演：unsupported；推荐 WSL2 + Docker Desktop + Linux 文件系统，当前本机未实测。
- MEDIA asset-swap 的真实资产字节、裁切、多尺寸 variants、媒体专属 Evidence：B 负责，未在 A 主线宣称完成。
- CSS Token 执行器、Scope 和 computed-style Evidence：A 未完成；B 只维护 Token 来源证据。
- 任意 Vite plugin/config、自定义 backend、SSR/Next/Remix、任意 lifecycle script：unsupported/ambiguous，不能按项目名称加特判。
- 运行时实例级编辑授权：DOM 点选可返回定位信息，但 iframe instance ID 仍需后端结合本次 Candidate、源码、页面、Scope 和运行环境重新核验，不能直接授权。

## 5. 关键文件与职责

| 文件 | 职责 / 当前注意点 |
| --- | --- |
| src/core/model.ts / session.ts | 统一 Project-first 领域对象与冻结的 ripple-edit-operation-session/v1 |
| src/core/project.ts / scope.ts | 真实工程 AST/SourceGraph、消费关系和 Scope 传播；不要把 imports 当作消费证明 |
| src/core/candidate.ts / candidate-operation-executors.ts | worktree、结构化执行器扩展点、源码/字节登记、patch/tree 完整性 |
| src/core/apply.ts | 同一候选补丁的审批后应用、基线冲突检查和安全回滚 |
| src/core/verification.ts / verification-receipt.ts | 可信 Evidence/Receipt 校验，不接受调用者伪造路径或哈希 |
| src/core/verification-runner.ts | 宿主编排、资源快照、候选/基线启动、progress/失败诊断和 Evidence 恢复 |
| src/core/candidate-verification-runner.mjs | Docker 内 Playwright 四视口执行、DOM/Scope/interaction/截图/浏览器错误 |
| src/core/candidate-preview.ts / candidate-preview-vite.config.mjs | Docker candidate preview、网络池、loopback relay、Vite 受限适配 |
| src/core/browser-error-accumulator.mjs | 有界错误样本和精确类别计数；不能让大数组恢复 |
| src/app/ProjectWorkbench.tsx / local-project-api.ts | 工作台 UI 与本地 API；保持真实工程状态，不添加 Fixture 专属路径 |
| e2e/project-workbench.spec.ts | 合成工作台闭环和私有 Bolt 手动专项；失败必须保持 FAILED/UNKNOWN |
| .github/workflows/ci.yml | typecheck、单测、build、Linux/Docker Playwright、工件 |
| .github/workflows/bolt-acceptance.yml | 手动 checkout 固定 Bolt commit、隔离安装和真实工作台专项；运行入口由负责人手动触发 |
| DEV_HANDOFF.md | 本交接状态；只记录证据，不替代正式架构文档 |

## 6. A/B 协作边界与冻结契约

- ripple-edit-operation-session/v1 的字段和 payloadless TEXT/MEDIA/TOKEN 兼容行为已冻结；结构化 action 只能走显式注册执行器。修改公共字段前必须先在 Issue #6/PR #3 对齐并补契约负例。
- A 负责公共 CandidateOperationExecutor seam、Session/Scope/Candidate/Verification/Approval/Apply/Rollback、ProjectRunner 能力声明、DOM→Source 与 CSS Token 执行器。
- B 负责 MEDIA 来源分析、asset-swap 处理器、资产准备/字节与图片裁切/variants、MEDIA Evidence，以及 Issue #6 第三方真实工程泛化验收。不要在 A 分支重写 B 的 project.ts/MEDIA 分析实现。
- B 的实现必须使用同一 EditSession、CandidatePatch、VerificationRun 和四视口计划；不能建立平行 MEDIA pipeline。
- 真实资产字节必须进入 candidate worktree、patchHash、candidateTreeDigest 和复验；未实现的结构化执行器必须 fail-closed。
- Issue #6 正文与评论都明确：第三方工程使用固定 commit、许可证和可复查记录；不按仓库名写分支。Issue 正文中的旧候选 commit 与评论中最新 b700bbd 存在偏差，接班 Agent 应先以 B 的最新可复验记录确认，不要把旧 SHA 当作完成证据。

## 7. 下一位 Agent 的第一项任务

### P0：继续处理 Bolt Run #11 的 scope-probe 超时

相关文件：

- src/core/candidate-verification-runner.mjs
- src/core/verification-runner.ts
- src/core/verification-receipt.ts
- src/core/candidate-preview.ts
- e2e/project-workbench.spec.ts
- .github/workflows/bolt-acceptance.yml

实施顺序：

1. 下载并检查 Run #11 工件中的 progress.jsonl、failed-to-run.json、execution.json（若存在）、截图、trace、resource-fetch-log.json 和 relay/container 诊断。
2. 按 request/page/viewport/baseline-candidate 统计 scope-probe，确认 tablet 两个 probe 为什么阻塞到约 166 秒；区分导航、等待 marker、网络、页面脚本错误、Playwright locator 或容器生命周期。
3. 在不减少四视口、双端页面/交互验证、不放宽断言的前提下，优化可证明重复的导航/页面访问；任何复用必须保留对应页面、视口、原工程/候选状态和结果绑定。
4. 保持 180 秒预算不变；为 timeout、错误风暴、部分视口成功、中途中断补确定性单测/E2E。failed-to-run.json 不能被 Receipt、Approval 或 Apply 接受。
5. 先运行 typecheck、定向单测、build、合成 Docker Playwright；再由负责人手动从当前 SHA 触发新的 Bolt workflow。真实 Bolt 未通过前，不更新为 TEXT 阶段完成。

### P1：错误风暴诊断

保留准确总数/分类、25 条有界样本、脱敏 URL/消息和阶段/视口。页面/浏览器异常、预算超时和部分视口失败都必须落独立诊断；不能在异常时写完整可审批 Receipt。不要用放宽浏览器错误断言换绿。

## 8. 开发与验收命令

在依赖已安装且使用支持的 Linux/Docker 环境执行：

~~~text
npm ci --ignore-scripts --no-audit --no-fund
npm run typecheck
npm test -- --run
npm run build
npm run test:browser
~~~

运行单个测试：

~~~text
npx vitest run src/core/browser-error-accumulator.test.ts src/core/verification-runner-failure.test.ts
npx playwright test e2e/project-workbench.spec.ts --grep "runs the Bolt shared TEXT workflow"
~~~

受限 Docker/Playwright 预演需要 Linux Docker、准备好的 Playwright 镜像和项目依赖；不能从 Windows 原生 node_modules 挂载 Linux 容器。真实 Bolt workflow 通过 workflow_dispatch 运行，使用固定 BOLT_REPO_REF 和负责人配置的私有仓库读取凭据；文档不记录任何凭据值。查看工件后才能报告真实验收状态。

## 9. 完成定义与报告纪律

每次交接或 PR 更新必须报告：

- 代码 SHA、分支、PR 状态；
- typecheck、单测、build、Playwright 的真实通过/失败/跳过数量；
- 是否为合成工程、Linux/Docker、Windows/WSL2 或真实 Bolt；
- 真实截图、执行 JSON、SHA-256、Scope/页面/视口/runtime 绑定是否存在；
- FAILED、UNKNOWN、NOT_RUN、STALE 和 RISK 不得写成 PASS；
- 本地未提交、未追踪或仅存在于工作环境的文件；
- 未完成的 MEDIA/TOKEN、第三方工程和实例授权边界。

接班 Agent 不应为了文档整洁删除本地实验，不应把本文件历史描述当作当前实现，不应绕过审计、保护范围、证据一致性、补丁完整性或回滚冲突检查。

