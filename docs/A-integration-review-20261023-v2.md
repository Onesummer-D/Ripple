# Ripple A 多模块集成审查表 v2（接收 C+D 冻结合同后）

> 2026-10-23 · A 总集成 · 基线 A `16e737c16d95a26879d1aee813b85fb472fd8215`（远端 HEAD，checks + bolt-acceptance 均 success）
> 本审查只做集成验证与顺序裁决；未解除任何 Draft、未合并 main、未触发真实 Bolt 验收。
> v1：`docs/A-integration-review-20261023.md`（本地工作区）。

## 一、最新分支核验（fetch 后以新 HEAD 为准）

| 项 | HEAD | 基线 | CI（最新 HEAD） |
|----|------|------|------------------|
| A 稳定核心 | `16e737c1` | — | checks ✅ + bolt-acceptance ✅ |
| #28 C+D（冻结） | `1dbaa539` | 2525092（merge 对齐，见 §三） | checks ✅；codescandy 探针 = **BLOCKED（exit 2，已核实语义，非 PASS）** |
| #25 F | `951b3942` | 16e737c ✅ | checks ⏳（推送后新运行中） |
| #27 E Visual 独立模块 | `55fdf9d7` | 2525092 | checks ✅ + acceptance ✅ |
| E 正式验证接入 | `5fe46bc` | 2525092（含 #27 全部提交 + 3 个接入提交） | checks ⏳ |
| #26 MEDIA | `b468f34a`（已推进，晚于任务书所列 c832e102） | 16e737c ✅ | checks ⏳ |

冲突判断修正（相对 v1）：#27 ∩ #28 的直接文件重叠为 `.gitignore` 与 `package.json`；v1 所列三个 e2e 文件属于 A 基线差异（#28 最新提交已将 e2e 改动落位到新夹具文件，不再触碰 A 的三个浏览器验收文件）。

## 二、接收的 C+D 冻结合同与边界（负责人确认）

1. codescandy 外部 pinned 工程探针 = **BLOCKED**，是第一阶段已知支持边界：exit 2 = 报告完整但来源证明目标未满足（`candidateGate` 携带原因），**不得改报 PASS**。
2. RouterProvider 实例链：当前已验证场景下确定性为 `unknown`、`instanceIdentityProven=false`，fail-closed 语义全部保留。
3. 非确定路由别名与条件返回保持保守降级（`route-coverage` unresolved → PageImpact 封顶 partial/unknown）。

## 三、第一批：PR #28 集成预演结果（交付核心）

**预演分支**：`integration/cd-rehearsal-20261023`（本地工作树 `_scratch/wt-cd-rehearsal`，未覆盖 C+D Agent 活动分支）

| 提交 | 内容 |
|------|------|
| `a71dd73` | merge：`feat/integration-cd-sourcegraph-20261022 @1dbaa53` → A `16e737c`，**自动合并零冲突**；A 的 Run #15–#17 浏览器验收改动（applied-preview-navigation.spec/navigation helper/project-workbench.spec）经逐项 diff 核实全部保留 |
| `39df4cd` | P1 动态下标反例修复 + 合同文档入库（见 §四、§五） |

**冲突解决记录**：无文本冲突。合并带入 `.gitignore`（+`.tmp/`）与 `package.json`（+`acceptance:codescandy` 脚本、+`react-router-dom@^7.18.4` devDep，供 e2e 夹具使用），均为新增无冲突。

**测试记录**：

| 项 | 结果 | 说明 |
|----|------|------|
| typecheck | ✅ | tsc app + node 双配置 |
| build | ✅ | |
| 全量 Vitest | 553 项：513 过 / 37 跳过 / **3 失败全部归因环境** | C+D 的跨平台夹具整改（`test-fixture-dir.ts`）把基线 57 项 Windows EPERM 降到 3：local-project-api×2（loopback 环境，单独重跑 21/21 通过）、project.test×1（本工作树 node_modules 为 junction，realpath 路径断言偏差，CI/真实安装无此问题）；3 个套件级错误为 hook 超时与 5173 端口瞬时占用 |
| C+D 联合身份测试 | ✅ 12/12 | sourcegraph-runtime-identity（共享 Footer 跨页消费、实例不合并、stale 失效、严格实例门） |
| 路由反例测试 | ✅ 57/57（含新增 P1 反例） | 见 §四 |
| 完整 Playwright | **51 过 / 5 跳过 / 2 失败** | 2 个失败均为 Windows 本机既有问题且基线 A 同样失败（§六），非合并回归；其中 C+D 新增 data-router e2e 在补齐 react-router-dom 依赖后通过 |
| Docker 隔离运行时 | ✅ | 见 §七 |

**身份链/合同核验**（合并后逐项）：`project.ts` 符号级解析、data-router 路由检查、`scope.ts` 的 route-coverage fail-closed、Runtime Identity 负例、候选生命周期与验证合同均保持 #28 冻结语义；未通过放松身份规则解决任何冲突（本合并无冲突）。

## 四、P1 动态下标别名反例（任务书 §二）

**反例**（按要求最小形式）：
```ts
const routes = [{ path: '/profile', Component: Profile }];
declare const key: number;
const selected = routes[key];
selected.Component = Home;
const router = createBrowserRouter(routes);
export const App = () => <RouterProvider router={router} />;
```

**实测结果：确认误证明**。修复前 `sourceProvenPageImpact()` 对该反例返回 `source-proven`——`resolveAlias` 只对数值下标解引用，`selected` 解析为 undefined，属性写入无法归属，fail-closed 检查整体漏检，运行期 `/profile` 实际渲染 Home 但静态证明仍称 Profile。

**修复**（`src/core/project-data-routes.ts`，最小改动三处）：
1. 新增 `fuzzyElementSymbols` 集合：标识符初始化器为"已访问路由表上的非数值下标元素访问"时登记该符号；
2. `walkMutations` 修改赋值分支：属性写入（`selected.Component = X` 及 `selected['Component'] = X`）命中模糊选元符号即 `fail('route table member mutated through a non-numeric index selection')`。

**验证**：新反例测试通过（PageImpact 降级、Home 不被证明为 /profile 消费者、出现 route-coverage unresolved）；数值下标既有正/反例（`routes[0]` 解引用、`alias[0]=` 写入检测）全部不回归，全文件 57/57。

## 五、合同文档入库

- 文件：`docs/architecture/sourcegraph-runtime-identity-contract.md`（原 C+D Agent 本地生成，#28 分支未包含，本次接收入库）。
- 入库 SHA：预演分支 `39df4cd`（blob 可在该提交检索）。
- 已落实负责人三处修订：① PageImpact 来源证明与实例身份证明为**独立校验**，`assessRuntimeIdentity()` 不检查 `PageImpact.certainty`，删除"函数层面必要条件"的错误表述；② `source-version-unavailable/ambiguous` 采集/评估双侧均可产生，仅不属六项 `BLOCKING_RUNTIME_IDENTITY_REASONS`；③ RouterProvider unknown 限定为"已验证场景的结论"。

## 六、两个 Windows 本机 e2e 失败归因（如实记录，不改报）

1. `source-identity.spec.ts:588`（源码偏移失效身份）：基线 A 上同样失败（被 afterAll EPERM 掩盖），两分支图计算输出逐项一致（224/224 节点、107 重叠，调试脚本核验）；C+D 的跨平台清理修复只是**去掩蔽**了该既有失败。CI 不因此红（Linux 通过）。
2. `project-workbench.spec.ts:814`（Bolt TEXT 工作流 e2e）：基线 A 同样失败（EPERM 清理），非合并回归。

两项建议单独立项修复（前者疑似 Windows CRLF 行尾下的偏移语义差异），不阻断 #28 集成——判定依据是基线同源失败 + 图输出一致，而非测试通过。

## 七、Docker 核验（任务书 §五）

- Docker Desktop 29.9.2 已安装于用户目录（`%LOCALAPPDATA%\Programs\DockerDesktop`），引擎 **linux/amd64**，**WSL2 后端**（内核 6.18.54.1-microsoft-standard-WSL2）真实可用：`node:22-bookworm-slim` 拉取并运行成功。
- 仓库自带隔离浏览器冒烟 `scripts/prepare-browser-verification.sh`（playwright:v1.64.0-noble 容器、network none、只读根、cap-drop ALL 等完整隔离参数）**本机通过（exit 0）**。两个调用注意：Git Bash 下需 `MSYS_NO_PATHCONV=1`（否则 `/ripple` 被路径转换破坏），且需将 `resources/bin` 加入 PATH（docker-credential-desktop）。
- 结论：本机已具备 Docker 隔离运行条件；正式验收仍以 Linux CI 容器为权威。

## 八、F #25 并行审查要点（951b3942，第一批并行对象）

- 状态处理/竞态：generation 守卫 + 终态优先 + 过期响应不回写 UI；openProject 停止挂起竞态已修（0c15750/879f0ff）；stopPreview 失败保留会话身份可验证重试（8b7f7d5）。
- DEMO/REAL 隔离：默认 demo；`?adapter=real` 显式开启；新增 demo-static 静态公网构建（默认体验页 + DEMO 标识 + 屏蔽真实入口），双视点验收 26/26。
- 真实性纪律：第一阶段仅为真实数据接入与意向预演，**不具备** Approval/Apply/Rollback；UI 对来源不确定性展示与禁用规则保持"不臆造"口径。
- 与 #28 联合风险：低。#25 零 core 改动，仅经 `attachSourceRelations`/`attachRuntimeIdentity` 挂点消费 #28 数据；CI ⏳ 通过后即可并行。
- 注意：951b3942 含较大体积提交（静态构建 + 部署方案文档），合并时关注 dist 产物是否入库。

## 九、第二、三批接入方案

**E（两分层，顺序明确）**：
1. 先 #27 独立视觉证据模块（55fdf9d7）：只读消费、结果永不为 pass、资源预算齐全；接入前同步 16e737c（或 #28 合并后的新 A）。
2. 后 E 正式验证接入（5fe46bc = #27 栈 + 3 提交：capture-only 证据接入正式 runner → 真实 Vite/React 试验 → Docker 端到端验收）。依赖 #27 先入库；接入时复核三项待处理：异常隔离（证据失败不拖垮验证运行）、证据哈希绑定（projectId 已绑，需复核 candidateId 链）、sourceRef 双侧映射（页面↔源码几何对齐）。
- E 的 `toVerificationEvidence` 与 #28 身份链字段已对齐，无身份体系冲突。

**MEDIA #26（b468f34a）**：保持独立模块边界，#28 合入后接入真实媒体消费者关系；与 E 的双证据格式**先经版本化适配器接入**（`ripple-media-viewport-evidence/v1` ↔ `ripple-visual-difference/v1`），本轮不强制重构两套验收实现。新提交 dd22676 已加候选截图 sha256 登记与双端哈希重验（篡改负例），方向正确。

## 十、PR #28 解除 Draft / 正式合并条件评估

| 条件 | 状态 |
|------|------|
| 合并预演零冲突、A 验收改动保留 | ✅（§三） |
| typecheck / build / 全量 Vitest | ✅（本机 + Linux CI checks） |
| C+D 联合身份与路由反例 | ✅ 12/12 + 57/57（含新 P1 反例） |
| 完整 Playwright | ✅ 51/53（2 个失败为 Windows 本机既有、基线同源，§六） |
| Docker 隔离运行时 | ✅（§七） |
| codescandy 外部探针 | ⚠️ BLOCKED（已知支持边界，负责人已确认接受，**非合并阻断**） |
| 待办 | ① 将 §四修复 + §五文档合入 #28 源分支（需确认 C+D Agent 无并行写入且远端 HEAD 未变）；② 修复后触发最新 CI；③ CI 绿后建议解除 Draft，按 merge 方式进 A（不覆盖并行工作树）；④ 保持 Draft 期间不合并 main |

**最终建议：#28 具备解除 Draft 条件**，前提是 P1 修复 + 合同文档入库后新 CI 通过；codescandy BLOCKED 作为已接受的边界记录在案。

## 十一、B 第三方验收工具状态（A 审查结论，2026-10-23 更新）

| 项 | 状态 |
|----|------|
| B 分支 / HEAD | `feat/b-thirdparty-reprobe-20261023` @ `cf44193` |
| B 专项 CI | ✅ #39874184628 |
| Ripple 全量 CI | ✅ #39874184669 |
| **审查结论** | **第三方验收工具冻结通过，等待公共 SourceGraph 接口更新**（不再标记"P0 待修"） |

冻结依据（A 独立审查确认）：非自有 candidateRoot/artifactRoot 由 harness 前置拒绝（unsafe-proposal，
不进入真实 createCandidate）；自有 clone 内非法位置继续以真实 CandidateError 验证公共合同；六项
selftest 与调用者仓库完整性检查通过；独立最小 data-router 工程的真实候选成功正例通过（补丁哈希、
精确编辑字节、树摘要、清理合同）；codescandy 固定 SHA 真实候选仍 BLOCKED，原阻断语义未变。

待 A/C+D 处理（B 侧已登记接口需求/复现，见 `docs/probes/a-interface-requirements-issue6.md` v3）：
**AC-P2a**（composite JSX 子代传播）、**AC-P2b**（data-router 条件回退消费者）、**AC-P3**
（Windows 跨盘目录兼容性）、**B-ENV-1**（Git EOL 与源码字节一致性）。

后续衔接：AC-P2a/b 修复并经 A 合并后，通知 B 在固定 codescandy SHA 上把门控切到
`--expect accepted`，随后执行真实候选预演与完整 TEXT 生命周期验收（当前 NOT RUN，不触发 Bolt）。

## 附：CI 链接

- #28 checks（1dbaa539，success）：https://github.com/Onesummer-D/Ripple/actions/runs/39828686217
- #28 codescandy 探针（BLOCKED/exit 2）：https://github.com/Onesummer-D/Ripple/actions/runs/39828676169
- A 基线 checks（16e737c）：commit check-runs 页
