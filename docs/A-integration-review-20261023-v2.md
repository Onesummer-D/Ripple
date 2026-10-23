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

## 附：CI 链接

- #28 checks（1dbaa539，success）：https://github.com/Onesummer-D/Ripple/actions/runs/39828686217
- #28 codescandy 探针（BLOCKED/exit 2）：https://github.com/Onesummer-D/Ripple/actions/runs/39828676169
- A 基线 checks（16e737c）：commit check-runs 页

---

# v3 增补（2026-10-23 第二批任务）

## P1 别名链复核（独立审查发现属实）

- 未修复代码（a71dd73）实测复现：`const alias = selected; alias.Component = Home` 与两种 `let` 重绑定变体**均误返回 source-proven**；二级链元素写入 `alias2['Component']=…` 被既有逻辑拦截。
- 修复改为写入点重推导谓词 `fuzzyWriteTarget`：别名链传播、`let` 重绑定保守降级、循环链有界遍历（环=无法证明=fail-closed），移除原符号缓存式登记。提交：`a08ba86`（预演分支）/ `43f2ea2`（#28 分支，内容相同）。
- 路由反例测试 62/62（新增 5 个负例：别名转发、二级链、let 重绑定×2、循环链），数值下标正例全部保留。

## CI 记录

- 预演 CI #39843573062（HEAD `1485439`）：**SUCCESS**（2026-10-22 19:50→20:01 UTC，单 checks 作业含 typecheck/Vitest/build/Docker/test:browser 全部步骤）。
- #28 同步后 CI（HEAD `43f2ea2`）：运行 39850415100。
- 预演分支同步后 CI（HEAD `a08ba86`）：运行 39850441832。
- codescandy 探针在新 HEAD 上仍 BLOCKED（exit 2 语义，如实登记，不改报）。

## Windows 遗留 e2e 失败（独立待办，未登记为通过）

1. `source-identity.spec.ts:588`：稳定复现条件 = Windows 本机 + Playwright；基线 A 同样失败（被 afterAll EPERM 掩盖），预演上去掩蔽后表现为 staleObservations=0。嫌疑根因：CRLF 行尾下前缀偏移的节点 id 匹配差异。Linux CI 通过（test:browser 含全部 e2e），不影响正式验收。
2. `project-workbench.spec.ts:814`：EPERM 临时目录清理（afterEach），基线同源。Linux CI 通过。
两案均单独立项修复，不阻断 Linux 集成。

## 下一批顺序与依赖

1. **F #25（01ca7a1）**：CI 通过后第一批并行并入；新增 d4e1264（清理诊断按会话隔离）+ 两个公网 demo 验收文档，DEMO/REAL 隔离口径未变。F 第二阶段真实 TEXT 工作台复用 A 核心 Bolt Run #18 生命周期。
2. **E**：独立接入最新 `91dd54d`（双侧 sourceRef 已对齐）。**注意**：独立审查认定其 `instance-proven` 标签强于采集信息可支持的证明等级，A 不得将其等价于 `instanceIdentityProven=true`；待 E 修复证明等级后，再经只读接口进正式 VerificationRun。
3. **MEDIA #26（b468f34a）**：C+D 合入后做消费来源证明的最小差异接入，不重复实现 SourceGraph；双证据格式走版本化适配器。

## 稳定基线 SHA（供 F 第二阶段 / B 第三方工程验收）

- A 稳定核心：`16e737c16d95a26879d1aee813b85fb472fd8215`
- A + C+D（含 P1 别名链修复与合同文档，待负责人确认正式合并）：`43f2ea24…`（#28 分支）/ 等价 merge 预演 `a08ba86`（`feat/a-cd-rehearsal-20261023`）

---

# v4 增补（2026-10-23）｜B 第三方复验 P2 登记与 C+D 协调计划

## 背景

B 在预演基线 `1485439`（含 #28）上对 codescandy 固定 SHA `b700bbd` 完成复验：37 个 route 节点；Profile → ProfileHeader → Overview 路径部分来源证明；探针仍 exit 2 BLOCKED；createCandidate 被正确拒绝；DOM 点选/四视口验证/Approval/Apply/Rollback 未执行。

## 登记项（独立 P2，不扩大第一批范围）

### AC-P2a：composite JSX 子代来源证明（C+D 负责实现）
- 对象：`<Link …>Overview</Link>`（ProfileHeader.tsx L71–73）目前仅有 semantic-candidate 边。
- 方向：优先研究可审计、限定库版本的组件语义映射（react-router Link/NavLink children→DOM 传播）；静态不可证则保留 semantic-candidate 或研究运行时证据补全。
- 红线：禁止仅凭组件名或浏览器文字相同提升为 source-proven；必须正反例齐备（真实 Link/NavLink 行为已支持、未知复合组件不升级、组件封装改变语义时自动降级）。

### AC-P2b：data-router 回退与条件消费者（C+D 负责实现）
- 对象：根路由 `errorElement: <NotFound />` 当前报 `conditional route fallback consumer is not modeled` + `route-coverage`。
- 方向：研究 errorElement 的保守建模；lazy、动态路由、条件回退不可静证时保持阻断完整页面影响声明。
- 红线：不得删除 route-coverage 或屏蔽 graph.unresolved 使候选通过。

### 两项共同验收（C+D 交付时必须满足）
1. 修复前复现 BLOCKED；2. 修复后重跑 codescandy 固定 SHA 探针；3. 证明目标 PageImpact 是否真正 source-proven；4. 其他未知消费者仍 partial/unknown；5. 完整来源证明成立前 B 不执行候选成功路径；6. 提供新 SHA、Linux CI、接口变更说明。

### B-ENV-1：Windows CRLF/LF 检出的源码范围偏移与字节一致性差异
- 先要求最小复现（与 v3 登记的 source-identity.spec.ts:588 Windows 失败同源），不直接改变安全哈希语义。

## 协调计划

1. **当前优先**：完成 #28 正式集成（条件见 v3 检查表，同步后 CI 39850415100 待转 SUCCESS），P2 不重开已完成的 C+D 集成。
2. #28 稳定合入 A 后：向 C+D Agent 派发 AC-P2a/AC-P2b（独立分支、独立 PR、正反例齐备、codescandy 探针前后对照），A 负责审查与合并。
3. P2 完成后：向 B 返回可复验新基线 SHA，B 继续第三方真实 TEXT 生命周期（DOM 点选 → 四视口验证 → Approval/Apply/Rollback）。


---

# v5 总审更新（2026-10-23 晚间，A 总集成）

## 0. 最新状态表（各线远端 HEAD，均已 git ls-remote 核实）

| 线 | 分支 / PR | 远端 HEAD | CI 状态 | 下一步 |
|---|---|---|---|---|
| A 基线 | feat/project-first-core-20261018 | 16e737c16 | 稳定（Run #18 基准） | 等 #28 合并产生新 A HEAD |
| C+D | feat/integration-cd-sourcegraph-20261022（PR #28） | 43f2ea24 | **重跑 run 39854058676 in_progress**（受控 dispatch） | CI 绿 → 负责人确认 → merge 进 A |
| E 接入 | feat/e-visual-verification-integration-20261023 | d822819 | 39850834367 / 39850834496 均 SUCCESS | 自修 pairCrossVersion 双端 sourceVersion 校验 P1；接 VerificationRunner 待 RFC 答复 |
| F #25 | feat/…real-adapter（PR #25） | 4c40694（另有 d4e1264 诊断+验收文档） | PR run 39851026342 SUCCESS | 等 #28 合并后并入统一工作台 |
| B | feat/…media-text（PR #26 关联） | 79fb61d | — | 等 C+D P2 新基线后复验第三方 TEXT |
| MEDIA | PR #26 | 12d992f | — | 最小差异接入，最后批次 |

## 1. #28 CI 取消原因结论（本轮核实）

- `ci.yml` concurrency group 为 `ripple-ci-${{ github.event.pull_request.head.sha || github.sha }}`。对挂 PR 的分支，push 事件与 pull_request 事件算出**同一 group key**，`cancel-in-progress` 互踩（43f2ea2 的 push run 39850410234 被同 group PR run 取消，属设计内行为）。
- 但 43f2ea2 的 PR run 39850415100 与无 PR 的预演 push run 39850441832 是被**外部同时批量取消**，非 concurrency（当时无同 group 新 run 产生）。结论：取消非代码原因。
- 早前 43f2ea2 push run 39850410128 唯一失败作业为 `codescandy-sourcegraph`（exit 2 BLOCKED），即已接受的 codescandy 支持边界，其余作业通过。
- **处置**：对 43f2ea2 以 `workflow_dispatch` 触发完整重跑（run **39854058676**，in_progress）。未修改、未跳过任何浏览器断言，未触发 Bolt。最终结论以该 run 终态为准；预演分支 0f1b361 的 CI 作等价旁证。

## 2. E 段落纠正（替代 v3/v4 中 E 待办）

- v3 中"instance-proven 标签过强"待办已由 E 自行修复并复核（91dd54d → d822819）：配对等级全部改用弱语义命名（`instance-candidate` / `same-sourceRef-observed` / `unproven`），`scope.strictInstanceProofAvailable` 恒 false，F 只读消费并有逐字中文文案合同。
- **新 P1（E 自修，A 跟踪验收）**：`pairCrossVersionElements()` 不应以"双侧 sourceVersion 哈希相等"为条件——baseline/candidate 本就是不同构建，预期不同；应各自对各自 SourceGraph 修订校验，且单 sourceVersion 不足以表示多文件页面。
- E 视觉验收 run 39850834367 SUCCESS；Ripple CI 39850834496 SUCCESS（629 Vitest + 50 Playwright）。

## 3. E 三份 RFC 已接收（d822819），C+D 待确认 5 点

1. **版本校验口径**：`source-version-mismatch` 仅在能证明 candidate 的 sourceVersion 不属于其自身当前图谱修订时才升级为硬矛盾；两侧不同本身不矛盾。C+D 确认"各自修订摘要"比对逻辑的合同归属（A/C+D）。
2. **sourceVersion 粒度**：单文件 sha256 不足以表示多文件页面；C+D 确认页面级修订摘要形态。
3. **RuntimePageContext 只读传递**：C+D 在冻结路由合同时给出 `RuntimePageContext` 序列化形态与命名空间规则（建议沿用 `ripple-runtime-identity/v1` registry 命名空间，E 只读不写）。
4. **采集期 reasons 语义**：确认 `RuntimeIdentityReason` 词表对 E 只读冻结；非 blocking 采集期 reason 是否允许进入视觉证据 reasons 展示字段（当前 E 只消费 blocking 交集）。
5. **跨版本 offset 漂移映射**：提供（a）纳入版本指纹的稳定 sourceRef 锚（节点路径哈希）或（b）构建期 baseline→candidate 映射表（哈希绑定）。答复前 E 配对到 `instance-candidate` 即停止。

E 采样合同字段（sourceVersion、identityReasons、pageContext 守卫）均已实现并有测试；运行时接线（从 C+D registry 读数）待 C+D 路由合同冻结后由 A 总集成接入。

## 4. F #25（4c40694）集成评估

- 真实项目数据接入已具备合并条件（PR+push 双 CI，PR run 39851026342 SUCCESS；push run 被 concurrency 取消属预期行为）。
- 新提交 d4e1264（会话级清理诊断 + 两个公网 demo 验收文档，腾讯云 81.70.40.146:8082 仅静态 DEMO）不改变运行时行为，可随下一批一并评估。
- 下一批顺序：#28 合并进 A → C+D P2 独立分支 → E 修正后进 VerificationRunner → F #25 并入 → MEDIA 最小差异接入。
- F 二阶段统一接入正式候选/验证/审批/应用/回滚链路的稳定基线 SHA = 43f2ea2（CI 绿后）或正式 merge 后新 A HEAD。

## 5. B / MEDIA 待验收项

- **AC-P2a**（composite JSX 子代来源证明，codescandy `ProfileHeader.tsx` L71–73 `<Link>Overview</Link>`）：C+D 在 #28 稳定后独立分支修复，正反例齐备（Link/NavLink 真实行为通过、未知复合组件不升级、封装语义变化自动降级），禁止仅凭组件名/浏览器文字升级 source-proven。
- **AC-P2b**（data-router `errorElement: <NotFound />` 回退消费者 + route-coverage）：保守建模或保持 partial/unknown；不得删除 route-coverage 或屏蔽 graph.unresolved。
- **B-ENV-1**（Windows CRLF/LF 检出导致源码范围偏移与字节一致性差异）：先要求字节级最小复现，不直接改安全哈希语义。
- B 自修 `b-thirdparty-candidate-gate.mjs` 异常误当拒绝的 P1；A 集成时核验门控严格性。
- MEDIA #26（12d992f）：真实素材替换及范围决策为最后批次，依赖统一工作台稳定。

## 6. Windows 遗留（不阻塞 Linux 验收）

- `source-identity.spec.ts:588`：staleObservations=0；已用 debug 脚本证明两分支图输出一致（224/224 节点、107 重叠），非合并回归，CRLF 偏移嫌疑（与 B-ENV-1 同源）。
- `project-workbench.spec.ts:814`：EPERM 临时目录清理，环境性。

## 7. 本批不变纪律

- 不自行解除 PR #28 Draft、不合并 main、不触发 Bolt；codescandy 探针 exit 2 维持已知边界语义（不写成 PASS）。
- Run #18 证据仅属 16e737c；#28 合并后新 A HEAD 需按合并检查表重新验证相关功能，昂贵真实 Bolt 验收仅在负责人授权后安排。


---

# v6 第一批正式合并完成（2026-10-23，A 总集成）

## 0. 合并结果

- PR #28 已正式合并（merge 提交 `3cc37c24`，PR 状态 closed/merged，merge_commit_sha 核对一致）。
- **新 A 集成分支 HEAD：`3cc37c2408caad6d3b8fd65d6c36a07980aeb94e`**（`feat/project-first-core-20261018` = 16e737c + merge 43f2ea24）。
- 合并方式：本地 `--no-ff` merge（GitHub `ready_for_review` 端点经多次尝试返回 404，改用授权的 git merge+push 路径，合并语义与 PR merge 完全等价，PR 已被 GitHub 自动标记 merged）。
- PR 正文已更新终审状态段（覆盖旧 HEAD 1dbaa53 与旧 CI 记录）。

## 1. 合并后回归（全部通过）

| 门 | 结果 |
|---|---|
| A 分支 push CI run 39857778018（3cc37c24） | **SUCCESS** |
| 本地 typecheck（wt-base） | 通过 |
| 定向 Vitest：sourcegraph-runtime-identity / project-data-routes / runtime-identity | **222/222 通过** |
| F #25 最新 HEAD 403ca81b PR CI run 39856043046 | **SUCCESS**（合并就绪度评估通过，可进入主线集成） |

## 2. 新稳定基线分发

| 线 | 新基线 | 说明 |
|---|---|---|
| A（全集成主线） | `3cc37c2` | C+D 已并入；后续 F/E/MEDIA 均以此 rebase/merge |
| F（主线下一棒） | `3cc37c2` | 在 A 上集成 #25（403ca81b）→ 真实 TEXT 第二阶段 → 统一工作台联调 |
| C+D | `3cc37c2`（A 内）+ 独立分支 `feat/integration-cd-sourcegraph-20261022`（43f2ea2） | AC-P2a/AC-P2b 从 3cc37c2 切独立分支修复，不覆盖 43f2ea2 历史 |
| B | `3cc37c2`（待 C+D P2 修复后再切新基线复验 TEXT） | 先自修 b-thirdparty-candidate-gate.mjs 门控 P1 |
| E | `3cc37c2` | 双端 sourceVersion 校验 P1 自修 + 等待 C+D 答复 5 项 RFC 口径 |
| D | `3cc37c2` | 栖光 SourceGraph 证明 harness 修复后重跑 + narrowMediaByReceiverType 最小重放 + 青野固定 SHA MEDIA 正式验收（Lab 通过不代替正式验收） |

## 3. 下一批主线启动条件（F #25 集成）

1. 以 `3cc37c2` 为基线建独立集成工作树（merge F #25 403ca81b）。
2. 全量 Vitest + Playwright + typecheck + build。
3. F 对未知来源遵循既有 fail-closed/降级合同——AC-P2a/b 与 E 完整身份 RFC 不构成 F 第一阶段接入前置。
4. CI 绿后向负责人提交正式合并建议；不自行合并、不触发 Bolt。


---

# v7 第二批启动 + B-ENV-1 登记（2026-10-23）

## 0. 主线状态

- A 基线 `3cc37c2`（#28 已合并，合并后 CI SUCCESS）。
- F #25 集成预演完成：工作树 `_scratch/wt-f25`，分支 `feat/a-f25-integration-20261023` = merge(3cc37c2, F 403ca81b)。typecheck ✓、build ✓、定向 Vitest 239/239 ✓（real-adapter + 三个身份/路由文件）。集成分支已推送，CI 为权威全量门。
- E：457c0f9 双 CI 通过；新 P1（offset 漂移同侧版本失效负例）待补；PR #29 已要求改指 A 集成分支、保持 Draft、同步 3cc37c2。**暂缓 E 正式合并**。
- D：Lab 5f60666，SourceGraph Proof CI #39857023106 与 MPA Lab CI #39857097577 均成功，栖光三页共享媒体 source-proven 已纳入独立 CI。D 将以 3cc37c2 重跑证明 + narrowMediaByReceiverType 最小重放；青野正式 MEDIA 全链回归由 A 协调安排（Lab 通过 ≠ 正式验收）。
- B：4372873 完成门控加固与 CRLF/LF 固定复现；两处文件安全问题（候选门控自测可能递归删除非自有路径、EOL 复现脚本原地重置仓库）要求 B 优先修复，暂不列为可复用正式验收工具。

## 1. B-ENV-1 登记：Windows Git 换行转换与候选副本字节一致性冲突

- **编号**：B-ENV-1（独立兼容性问题，与 Issue #6 的 AC-P2a/AC-P2b 分开排期）。
- **负责人**：A 协调；实现交 C+D 或协调人指定的工程 Agent。
- **优先级**：P2。不阻塞 Linux 已验证 TEXT 闭环；**禁止**通过归一化安全哈希、忽略字节差异或放宽 Candidate 门控解决。
- **最小复现**（B 已固定证据）：codescandy @ b700bbd；Git blob = LF 3517 B，Windows/autocrlf 工作树 = CRLF 3624 B；同一 Overview JSX 来源偏移 #2620 vs #2691；两种 git 状态均可视为 clean；Ripple 原项目按 CRLF 字节生成摘要，候选隔离 worktree 按 LF 字节检出 → 摘要不同 → 正确拒绝；autocrlf=true 的新 worktree 摘要与原 CRLF 快照仍不同（需逐文件差异定位）。

### 代码事实（基线 3cc37c2 已核实）

1. `src/core/candidate.ts:497`：隔离 worktree 以 `-c core.autocrlf=false git worktree add --detach <rev>` 检出。
2. `candidate.ts:499`：`digestTrackedTree(candidateRoot) !== snapshot.revision.sourceDigest` 即抛 `CandidateError`（fail-closed，语义正确，保留）。
3. 仓库根**无 `.gitattributes`**；`readProjectSnapshot` 的 `sourceDigest` 基于原工程**工作树实际字节**——Windows autocrlf 检出下即 CRLF 字节，与候选检出（LF）必然不一致。
4. 源码范围 / sourceRef 偏移 / CandidatePatch 的绑定字节 = SourceGraph 解析所用文件内容的字节；解析基于工作树字节时，偏移随平台换行口径漂移。

### 修复方向（待评审，不改安全语义）

- 统一字节基准为 **git blob 字节（canonical）**：`sourceDigest` 改为对 revision tracked blob 的摘要（`git ls-files -s` / `cat-file --batch` 口径）；SourceGraph 解析输入与 sourceRef 偏移基于同一份 blob 字节采集；候选 worktree 维持 `autocrlf=false` 检出（其字节天然等于 blob 字节，除 smudge filter/LFS 例外）。快照与候选同源同字节，跨平台可复现。
- 错误提示分级：摘要不匹配时逐文件比对 blob 字节与工作树字节，检出 EOL 签名差异则明确提示「EOL 不一致（CRLF/LF）」并给出建议操作（`core.autocrlf=false` 重新检出 / `.gitattributes` eol 固定 / 以规范字节重建快照），不再笼统报「摘要不匹配」。
- 待确认：smudge/clean filter、LFS、既有 `.gitattributes` 项目的兼容口径；多文件页面快照粒度与 sourceVersion 粒度的关系（与 E RFC 第 2 点联动）。

## 2. TEXT 工作台启动基线

- 正式 TEXT 工作台开发基线 = `3cc37c2`；F 集成验证基线 = `feat/a-f25-integration-20261023`（merge 提交以推送后 CI 绿为准）。
- 启动条件：F 集成 CI 绿 → 负责人批准 → F #25 以 merge 方式进 A（新 A HEAD 分发各线）→ F 第二阶段真实操作链路（统一接入正式候选、验证、审批、应用、回滚）开工。


---

# v8 D MEDIA 授权登记 + E 联合接线启动（2026-10-23）

## 0. 主线不变

F #25 集成（`feat/a-f25-integration-20261023` @ af936884，CI 39864728226 SUCCESS）待负责人批准并入 A；E 接线与 D MEDIA 复验均并行，不扩大 F 第一阶段合并范围。

## 1. D MEDIA：协调决策

1. **授权**：D 在独立 MEDIA 协调分支（不从 A 基线直接改）实施 209cf4f `narrowMediaByReceiverType` 最小重放 + N4–N10 负例；**禁止**将原补丁直接合入公共核心。PR #26（78a5484）在新 A 基线完成代码与负例审查通过前，不决定 rebase/merge 时机。
2. **重点审查项（D 交付后由 A 执行）**：
   - **P1-a**：`narrowMediaByReceiverType` 返回空数组时，project.ts 的 for 循环不产生消费者边且无显式 unresolved 记录——若真实消费者被过滤，`sourceProvenPageImpact` 可能因只看到剩余关系而误判影响完整。必须实证：负例（过滤后空）下来源完整性探针仍 exit 2 BLOCKED 或等价显式拒绝；不得依赖未经实证的"assertScope 一定拦截"。
   - **P1-b**：以类型名称文本查找声明范围，跨模块同名类型/别名/数据流不完整时的排除正确性——需负例覆盖。
3. **字段级合同**：MEDIA 候选复用现有 CandidatePatch/ScopeDecision/Approval/Receipt/Apply/Rollback 字段，不新增旁路；媒体类候选的 gate 与 TEXT 同一 fail-closed 门控；D 交付时逐字段对照 `run.*` 合同清单。
4. **排期**：MEDIA 正式批次安排在 F #25 集成稳定之后；D 第七轮已通过的栖光复验部分（ee49e55/688ae0a，CI #39859399071）不再返工。
5. **青野固定 SHA**：真实工程 `github.com/Onesummer-D/ripple-qingye-bolt` @ **`f7e4998a5c77ab4aeb3232dbc31e61196e9051a6`**（"Initial Bolt website baseline"，工作区干净）。正式验收覆盖：素材暂存 → 候选 → 四视口 → 视觉证据 → Approval/Apply/Rollback → 工件留存；Lab 通过不代替正式验收。

## 2. E 联合接线

- **E 独立模块状态**：终审通过，冻结候选。最终 HEAD `0dd2e912`；Ripple CI #39862685555 SUCCESS（706 Vitest / 57 Playwright）；Agent E Visual Acceptance #39862678940 SUCCESS；六项 P1 全部修复。PR #29 base 已改指 `feat/project-first-core-20261018`，mergeable=true。**待办：PR #29 需转为 Draft——GitHub REST API 无转 Draft 端点（ready_for_review 类端点此前亦 404），须由负责人在 PR 页面点击 Convert to draft；当前不合并。**
- **接线负责人**：A（本 Agent）。**协调分支**：`feat/a-e-visual-wiring-20261023`（merge 3cc37c2 + E 0dd2e91，merge 提交 `c3158c6`，已推送，CI 运行中；本地 typecheck ✓ / build ✓ / 快速 Vitest 40/40）。
- **接口验收清单（接线必查）**：
  1. baseline/candidate 各自 sourceFileVersions（或等价来源摘要）取自 C+D SourceGraph/Runtime Identity，按文件核验，与各自真实工程修订绑定。
  2. RuntimePageContext 与采集期 identityReasons 只读传入 E 采样与报告（命名空间沿用 `ripple-runtime-identity/v1` registry）。
  3. 正式视觉证据分析按合同提供 expectedSourceVersions；identityAssessment 必须来自 C+D 真实评估，禁止合成成功结果。
  4. 未完成证据保持 annotation-pairing / missingEvidence 呈现，不升级严格实例证明。
  5. VerificationRunner 真实采样挂载后联合回归：证明只读视觉证据不改变 Approval、Receipt、Apply 结论。
- **两道验收**：第一道 = 现有视觉证据以只读降级方式接入统一 VerificationRun；第二道 = C+D 版本/页面上下文/实例身份完整接线后的严格身份联合验收。每道交付固定 SHA、CI、真实浏览器工件与剩余缺口；独立模块 CI 不代替真实集成验收。
- **预计合并顺序**：F #25 并入 A → E 接线第一道随下一批集成评估 → C+D P2（AC-P2a/b）与 B-ENV-1 修复期间并行推进 E 第二道 → 严格身份联合验收。
- 接口文档以 E 已交付三份为准（visual-sampler-identity-rfc / source-ref-dual-alignment / visual-evidence-f-consumption），不要求另行冻结说明。


---

# v9 B-ENV-1 双检出复现确认 + A 核心登记（2026-10-23）

## 0. A 基线更新

- B-ENV-1 已以独立问题文档登记进 A 公共核心：`docs/integration/B-ENV-1-windows-eol-byte-consistency.md`（纯文档提交）。
- **新 A HEAD：`8dbfc0cade803e24f3e8acbaafb3d4df2713ebca`**（3cc37c2 + 文档）。代码零改动；此 SHA 起为各线文档同步基线，功能基线仍为 3cc37c2。

## 1. B-ENV-1 复现结论（B @ 0bbe057，双 CI #39864653358/#39864653362 SUCCESS）

- P0 文件删除问题已修复。
- 双检出策略复现可信：LF 树偏移 #2620、CRLF 树偏移 #2691；各自匹配 autocrlf 策略时快照与新建 worktree 摘要一致；根因 = Ripple 候选隔离检出策略与输入快照 EOL 不一致；v1 手工转换的额外摘要为实验伪影。
- A 核心文档已按此更新（方向 A 统一 blob 字节 / 方向 B 检出跟随快照口径，含非 git 工程降级路径与三项禁止）。

## 2. B 工具后续（B 自行最小修复，不属 A 核心）

- `--expect accepted` 在成功候选字节验收前提前删除 worktree。
- 全局 `git worktree prune` 可能修改调用者 Git 元数据。
- 修复前 B 测试工具不作为可复用正式验收工具；不阻挡 Linux TEXT 核心与 F 第一阶段。

## 3. 不变项

AC-P2a/AC-P2b 继续由 C+D 在新基线处理，之后 B 复验第三方完整生命周期；F #25 并入 A 的批准仍待负责人签发。


---

# v10 F #25 正式并入 A + 新正式基线（2026-10-23）

## 0. 合并结果

- **F #25 已正式并入 A**：merge 提交 `ac0da9993dcc5bf559bfba624ab1a11c7702f330`，PR #25 状态 merged（GitHub 检出合并）。
- 路径：预演分支对齐最新 A 8dbfc0c（merge `8afee59`，零冲突，B-ENV-1 文档保留）→ 集成分支 CI 39869995411 SUCCESS → A 上 `--no-ff` 正式 merge。
- **新 A 正式基线 HEAD：`ac0da99`**；A 分支完整 CI [39872273138](https://github.com/Onesummer-D/Ripple/actions/runs/39872273138) **SUCCESS**。
- 合并前核验记录：PR #25 head 403ca81b 与授权一致；mergeable 曾短暂 false 为 GitHub 缓存，复核已恢复 true；未覆盖 8dbfc0c；无冲突、无源码回退。

## 1. 各线新基线分发

| 线 | 基线 | 任务 |
|---|---|---|
| F（主线） | `ac0da99` | 第二阶段真实 TEXT 工作台开发 |
| E | `ac0da99` | 联合接线必须基于新 HEAD 重新核验（c3158c6 仅预演，不登记完整接线 PASS）；E 旧 457c0f9 待修状态作废（已由 0dd2e91 终审取代） |
| C+D | `ac0da99` | AC-P2a/b 独立分支起点 |
| B | `ac0da99` | 两项工具修复后，待 C+D P2 新基线复验 |
| D | `ac0da99` | MEDIA 独立分支 N4–N10 负例实证 |

## 2. F 第二阶段（真实 TEXT 工作台）

- 开发分支（F Agent）：自 `ac0da99` 切 `feat/f-real-text-workbench-20261023`（建议名，F 可调整）。
- 第一批 UI 任务（逐项验收，缺一不可）：真实 DOM 点选 → Scope 决策 → Candidate 创建 → 四视口 Verify → Approval → Apply → Rollback。
- 验收口径：每步真实浏览器工件 + run 记录；DEMO/REAL 隔离合同持续有效；未触发 Bolt。

## 3. E 与 F 下一批联合集成

- E 接线在新基线 `ac0da99` 上重新 merge E（0dd2e91）→ 新协调分支，替代 c3158c6；不得用两个各自基于旧 A 的预演成功代替 F+E 联合集成。
- 接线验收清单与两道验收安排不变（见 v8 §2）。

## 4. B-ENV-1 设计验证安排（先验证后编码，暂不批准 blob canonical 直接实施）

负责人：实现交 C+D 或指定工程 Agent，A 审查；设计验证为实施前置门：

1. 原工作树 CRLF 与候选 LF 的实际源码编辑与 Apply 行为差异（含 CandidatePatch 字节绑定影响面）。
2. clean/smudge filter、LFS、`.gitattributes`、`symlink` 的兼容矩阵。
3. 快照摘要、SourceGraph 解析内容、AST 偏移、候选应用四者同一版本的一致性证明。
4. 术语与设计修正：TypeScript AST 偏移是 **UTF-16 文本偏移**，不得称为原始字节偏移；B-ENV-1 文档据此修订。
5. 旧候选 / 已有 Revision 与新字节口径的兼容策略（迁移或双口径并存，需明确取舍）。
6. 以上验证以最小实验脚本 + 设计文档交付，A 审查通过后才允许动公共核心；Candidate 字节一致性检查不得放宽。

## 5. 并行任务不变

D N4–N10 负例（P1-a 空数组无 unresolved / P1-b 文本类型名查找）；C+D AC-P2a/b 准备；B 两项工具修复——均不阻塞 F 第二阶段。


---

# v11 D 第八轮 + B b96a421 审查登记（2026-10-23）

## 0. A 基线

- 功能基线 `ac0da99`（F #25 并入，CI 绿）；文档 HEAD `fdf4a07`（+AC-P3 登记，纯文档）。
- AC-P3 已独立登记进 A 核心：`docs/integration/AC-P3-windows-path-containment.md`（与 B-ENV-1、AC-P2a/b 分开排期；candidate.ts 目录包含判断缺 `path.isAbsolute`，含 6 组正反例与禁止项）。

## 1. D MEDIA（feat/media-narrow-replay-20261023 @ 635339c，CI #39868691047 SUCCESS）

- 认可：类型符号身份 + 数据流闭包 + 不确定边保留修复了 209cf4f 文本区间方案的真实漏洞（别名/展开流消费者被静默删除 → PageImpact 误升级 → 缺页 Scope 误放行）；旧 209cf4f 方案废弃，不同时保留两套收窄逻辑。
- **N4–N10 覆盖范围如实登记**：部分用例覆盖图计算而非完整候选链路，验收口径按图计算级登记，不夸大。
- **待 N11**：未标注返回类型的工厂函数（返回结构兼容 Product[]）经函数返回值流入目标页面 + 同媒体另有可证明直接消费者——验证类型收窄是否静默删除函数返回链；无法证明排除安全性时必须保留 semantic-candidate / unresolved；PageImpact 与 createCandidate 均需 fail-closed 拒绝实证。
- N11 通过后由 A 审查决定 narrowMediaByReceiverType（安全化版）是否合入公共核心。青野正式全链验收未完成，PR #26 保持 Draft，不触发 Bolt。

## 2. B（b96a421，双 CI SUCCESS）

- 认可：真实 createCandidate 成功正例（最小 data-router fixture）；B-ENV-1 结论修正；两项工具缺陷已修复。
- **P0 待修**：negative-caller-repo-proposal selftest 仍将调用者 repo/.gate-inside 作为 candidateRoot 传入真实 createCandidate——先建 worktree 后 assertScope，路径不存在不能证明过程只读。B 已接收 harness 所有权前置拦截任务；修复前该工具**不列为可用于任意用户仓库的验收脚本**。
- codescandy 仍 BLOCKED，复验等待公共接口修复。

## 3. F 第二阶段分支核验 ⚠️

- `feat/f-real-text-phase2-20261023 @ 6cfa807` 已存在（docs：第二阶段集成计划），CI SUCCESS，**但基线为旧 A 16e737c（PR #28 之前）**——缺少 C+D 联合身份、F #25 适配器与全部文档登记。
- **处置**：F 第二阶段真实开发开工前必须将分支同步至 `ac0da99`（merge 方式）；其集成计划文档需按新基线复核（PR #28 已合入，非"冻结待合"状态）。

## 4. 优先级（主线）

1. F 第二阶段真实 TEXT 工作台（分支同步 ac0da99 后开发，交付真实用户操作闭环，不以独立测试/文档代替）。
2. E 只读视觉证据接线（新基线重 merge E 0dd2e91）。
3. D N11 → A 审查 → MEDIA 公共核心合并决定。
4. B P0 修复 + AC-P3 最小修复；C+D AC-P2a/b；均独立推进，互不为前置。


---

# v12 AC-P3 修订 + E 新基线预演 + D N11 审查（2026-10-23）

## 0. A 文档 HEAD

- `d08a8f0`：AC-P3 设计修订——盘符不同**不直接等于不相交**；规则改为经规范化 + realpath 物理归属检查、**能证明相互不包含才允许**，无法确认的 subst/UNC/符号链接别名关系一律 fail-closed；正常跨盘不相关目录必须可创建。正反例表同步更新。

## 1. E 新基线接线预演

- 分支 `feat/a-e-visual-wiring-20261023` 更新至 `2acf7ea` = merge(E 0dd2e91, A d08a8f0 含 F #25 + AC-P3)。
- 合并冲突一处（package.json scripts）已解：两侧脚本并存。
- **只读合同代码核验**：`visualEvidence(s)` 仅出现在 `model.ts`（类型）、`visual-verification-attach.ts` 及其测试；`verification-runner.ts` / `apply.ts` / `session.ts` 零引用——视觉证据当前不进入 Approval/Receipt/Apply 链路。第一阶段接线实现时必须保持该隔离。
- 本地门：typecheck ✓ / build ✓ / Vitest 77/77 ✓；CI 运行中（推送触发）。
- PR #29 保持非 Draft 状态、暂缓直接合并（待负责人 Convert to draft）。

## 2. D N11 审查（3bda2b7 + CI retrigger d7b358f，CI #39874712688 SUCCESS）

- N11 修复方向认可：工厂函数推断返回类型结构兼容目标类型（含联合成员/typeArguments 递归，经 `isTypeAssignableTo` 判定）时同样覆盖函数体——与"宁可过度保留"的安全方向一致；负例 + 证据脚本（scripts/evidence-n11.ts）+ 55 行测试在提交内。
- **残留审查点（要求 D 最小加固后再进合并预演）**：`isAssignableSafe` 在内部 API 不可用时返回 false，此时未标注工厂体回退为仅 `typeMatches`——若该环境下推断类型不文本匹配，函数体仍会被静默排除，恰为 N11 要堵的失效模式。要求：API 不可用时**覆盖函数体**（过度保留方向），或显式记录 unresolved；不接受静默排除。
- 另维持 v11 口径：N11 场景需补完整候选链路验证（不止图计算级）。

## 3. F 第二阶段

- 已由协调人直接通知 F 同步 `fdf4a07` 后开发；A 不建重复分支，职责为接口协调与后续集成验收。第一批：真实 DOM 点选 / source-selection / Scope / Candidate。

## 4. 下一次主线交付重点

F 第二阶段真实 UI 与浏览器验收、E 接线进度（CI + 第一道验收）、D 残留点修复后的公共核心合并预演、AC-P3 实现排期。


---

# v13 D MEDIA 公共核心合并预演（2026-10-23）

## 0. 预演设置

- A 远端最新 HEAD 核对：`d08a8f0`（不固定旧 SHA）。D 补丁：`d7b358f`。
- 独立工作树 `_scratch/wt-media`，分支 `feat/a-media-core-integration-20261023`。
- merge(d08a8f0, d7b358f) **零冲突**；A 的 F #25、C+D 身份链、B-ENV-1 / AC-P3 文档全部保留（差异仅 4 文件：project.ts +120、project.test.ts +324、scripts/evidence-n11.ts、scripts/evidence-n8-prefix.ts）。

## 1. 差异与旧逻辑核查

- 仅一套收窄实现（`narrowMediaByReceiverType`，符号身份 + 数据流闭包 + 不确定边保留）；**未带入** 209cf4f 文本区间方案，不存在两套并存逻辑。

## 2. 三边界审查结果

1. `relatedToTarget()` 仅用于 `cover(body)` 扩大闭包（保留不确定边），路径上无 semantic-candidate → source-proven 升级通道；收窄返回子集只发生在 `pool` 过滤（`?? pool` 兜底不收窄）。**通过**。
2. `checker.isTypeAssignableTo` 在锁定 TS 5.9.3 下实测存在（运行期验证）。
   **发现并修复一项**：原实现 API 不可用时静默排除工厂体——已最小加固为过度保留方向（返回 true 覆盖函数体，含 catch 分支）；改后 N11 测试通过。
3. N11 真实 CandidateError 拒绝原因与 PageImpact 不完整的一致性：
   **发现并修复一项**：原测试仅断言 `toThrow(CandidateError)`，可因其他原因假通过——已改为断言 `/无法证明目标的完整页面影响/`（candidate.ts:94 唯一来源），改后测试通过。

## 3. 本地门与回归

- typecheck ✓；build ✓；N11 定向测试（16.4s）✓；narrow 相关测试 2/2 ✓。
- 完整 Vitest / Playwright 由集成 CI 执行（Windows 本地单文件超时限制，Linux CI 为权威门）。
- **A/F/C+D 不回退证据**：merge 差异仅触及 `src/core/project.ts`（纯新增收窄函数与 N11 分支）；`candidate.ts` / `runtime-identity.ts` / `project-data-routes.ts` / `real-adapter.ts` 零改动；C+D 三文件定向测试在本树待 CI 覆盖。

## 4. 待办

- 集成 CI（09e4c075）终态；绿后提交正式合并建议。
- scripts/evidence-n11.ts 临时目录清理为 P2 整理项，不重开算法开发。
- PR #26（78a5484）仍为另一条 MEDIA 准备线，不等于本次 d7b358f 补丁；青野全链验收待公共核心稳定后由 D 整理。


---

# v14 B 第三方工具冻结确认（2026-10-23）

- **B 第三方探针与候选安全验收工具冻结通过（功能冻结 SHA `cf44193`，文档提交 eb7c328；B CI #39876679876、Ripple CI #39876679859 均 SUCCESS）。B 本阶段工作结束，无需返工。**
- B 下一步：等待 AC-P2a/b 公共 SourceGraph 修复后，在固定 codescandy SHA（b700bbd）上执行真实候选成功验收。
- AC-P3、B-ENV-1 按 Windows 兼容性支线推进，不阻塞 Linux 第三方复验。
- B 在其独立分支上编辑的旧版 v2 审查表段落（含 PR #28 / F #25 过期状态）**不合入** A 主线，状态以本表为准。
- 主线不变：F 第二阶段、E 真实接线、D MEDIA 核心集成（预演 CI 已绿，待合并授权）。


---

# v15 F 第二阶段第一批审查登记（2026-10-23）

## F 第二阶段第一批（HEAD `1201a6a`，CI #39879624586 SUCCESS）

- 状态：**代码已提交、CI 全绿；真实候选创建合同 P0 待修，尚未通过端到端正式验收。**
- **P0-a**：`strategy='shared'` 同时携带 `localPageRef`——A `assertScope` 明确拒绝（合同违反）。
- **P0-b**：`includedRefs` 只含页面、遗漏 `operation.targetRef`——A `assertScope` 明确拒绝（合同违反）。
- 新增测试主要使用 mock fetch，**未执行**真实浏览器到 createCandidate 成功的联合验收。
- 已登记另两个 P1：点选异步 nonce 失效检查、退出 iframe 点选模式未通知。
- **处置**：F 最小返工 + 真实 E2E（协调人已直接派工，A 不重复派工）。**A 不放宽 Candidate/Scope 校验**；由 F 构造符合现有合同的请求。
- F 修复并交付真实候选成功证据后，由 A 审查并决定进入**第二批：四视口 Verification 联合集成**。


---

# v16 MEDIA 安全补丁正式并入 A（2026-10-23）

## 0. 合并记录

- 授权核验：A 远端 HEAD = d08a8f0（与授权一致）；`--no-ff` merge 09e4c075，未用 reset/force push/squash。
- **新 A HEAD：`dc8269f871c543ff30c200641a9e253cd68b53f2`**；合并提交即集成差异（4 文件，无 A/F/C+D 回退）。
- 正式 A 分支完整 CI [39882489628](https://github.com/Onesummer-D/Ripple/actions/runs/39882489628) **SUCCESS**。未合并 main，未触发 Bolt；PR #26 继续保持 Draft（另一条完整集成线）。

## 1. 新基线分发

| 线 | 基线 | 任务 |
|---|---|---|
| D | `dc8269f` | 停止 N 系列扩展；PR #26 适配新基线；青野固定 SHA（f7e4998a）真实 MEDIA 全链验收 |
| F | `dc8269f` | 修复第二批第一批 P0 合同阻断（shared Scope 不携带 localPageRef；includedRefs 必含 operation.targetRef）+ 真实浏览器 E2E 候选成功证据；A 不放宽门控 |
| E | `dc8269f` | 视觉证据接线按新基线重新核对，保持 Approval/Receipt/Apply 只读隔离 |
| B | `dc8269f` | 冻结待命，等 AC-P2a/b 后 codescandy 复验 |
| C+D | `dc8269f` | AC-P2a/b 继续；AC-P3 / B-ENV-1 独立兼容性任务（先设计验证后编码） |

## 2. E / F 联合验收安排

- F 交付真实候选成功证据（真实 DOM 点选 → 合同合规 Scope → Candidate 成功）后，A 审查并决定进入第二批四视口 Verification 联合集成。
- E 接线在新基线上重新 merge E（0dd2e91）产新协调分支（替代 2acf7ea），完成 VerificationRunner 只读挂载后做联合回归。


---

# v17 E / C+D 并行开发线恢复（2026-10-23）

## 状态：已恢复开发（等待实际提交，不提前登记完成）

- **E**：E Agent 已接收视觉证据真实挂载 + C+D 身份版本接线任务；起点 = 现有 `2acf7ea` 协调成果 + 最新 A HEAD `dc8269f`；不重复开发已有视觉挂载器。A 负责接口协调、审查、联合回归与正式合并。
- **C+D**：C+D Agent 已接收 AC-P2a（composite JSX 子代消费证明）与 AC-P2b（data-router 条件消费者修复）；从最新 A HEAD `dc8269f` 建独立分支。A 负责审查与合并。
- 其他线不变：F 修复真实候选 Scope 合同（P0）并推进 TEXT UI；D 准备青野 `f7e4998a` 正式 MEDIA 全链验收；B 冻结待命（等 AC-P2a/b 后 codescandy 复验）。


---

# v18 MEDIA 合并任务关闭 + 并行职责划分（2026-10-23）

## 0. 正式基线

- **A 正式 HEAD：`dc8269f871c543ff30c200641a9e253cd68b53f2`**（MEDIA 安全补丁已入主线，CI #39882489628 SUCCESS，586/586 Vitest、61 Playwright 过 1 跳、typecheck/build 通过、N11 在正式 CI 执行通过）。
- 本轮 MEDIA 合并任务关闭；PR #26 保持 Draft；未合并 main、未触发 Bolt。

## 1. 并行职责划分（避免双 Agent 重复开发）

| Agent | 职责 |
|---|---|
| E | 视觉证据真实接线（VerificationRunner 已有 `attachVisualEvidenceSafely` 挂载调用，A **不重复实现**）、双侧 sourceFileVersions / RuntimePageContext / identityReasons / expectedSourceVersions 证据绑定、联合测试 |
| C+D | AC-P2a / AC-P2b 第三方 SourceGraph 修复 |
| F | 第一批 Scope 合同 P0 修复 + 真实浏览器端到端成功候选 |
| D | 基于 dc8269f 准备青野（f7e4998a）MEDIA 正式全链验收 |
| A（本线） | 维护公共核心与接口合同、审查各 Agent 提交、集成回归、正式合并；**不重复建设视觉挂载器、不改写 E 接线文件、不扩展 N 系列算法** |
| B | 冻结待命（等 AC-P2a/b 后 codescandy 复验） |

## 2. A 侧 E 协调安排

- E 实现分支 = `feat/e-visual-verification-integration-20261023`（0dd2e91 冻结候选）；A 协调分支 `feat/a-e-visual-wiring-20261023`（2acf7ea）保留为预演基线。
- **A 不新建第二条 E 开发分支**；等 E 提交真实接线代码后，A 在 `dc8269f` 上重新做合并预演与联合回归。
- 已开发独立分支同步基线一律用 merge（禁用强制覆盖）。

## 3. 当前优先级

1. F 真实 TEXT 候选成功验收；
2. E 视觉证据接线；
3. C+D AC-P2a/b 并行；
4. D 青野 MEDIA 全链准备同步进行。


---

# v19 E PR #30 接线审查入口 + 身份合同接口协调（2026-10-23）

## 0. PR #30 接收

- **正式审查入口：PR #30**（`feat/e-visual-wiring-20261023` @ `750baed`，base = `feat/project-first-core-20261018`，Draft，mergeable=true）。
- 第一批 `ac307ae`（真实 Docker VerificationRun → run.visualEvidences → API 只读 View）已独立验收通过。
- 第二批 `750baed`（C+D registry 版本采集 / RuntimePageContext 形态 / identityReasons / 双侧 sourceFileDigest 核验）已实现；**legacy sourceVersion 多文件判断 P1 已交 E 最小修复（不重复派工）**。
- A 处置：等 E 修复 P1、最新 CI 全绿后，在 `dc8269f` 上建立正式集成预演；冲突或安全门控变化先报告。不合并 main，不触发 Bolt；注意 PR #29 与 #30 重叠代码不得合入两次。

## 1. 身份合同接口协调项（交 C+D 确认，A 汇总；不打断 AC-P2a/b 主线）

以下以 A 核心现状（`dc8269f`）为基准：

### 1.1 identityAssessment（`src/core/runtime-identity.ts:195`）

现有 `RuntimeIdentityAssessment` 字段：`sourceRef / runtimeInstanceId? / certainty / page / locatable / instanceIdentityProven / sameSourceCount / reasons`。

- `instanceIdentityProven` 的通过条件（代码注释已明确，需 C+D 确认对外冻结）：stable certainty + 非空 id + 无采集期 reason + `fileDigest` 读数等于页面注册版本 + 显式 `expectedPage` 且匹配。**E 侧判定严格实例证明不得以 `identityAssessment != null` 代替 `instanceIdentityProven === true`**；`locatable` 仅授权导航，不授权实例级结论。
- 需 C+D 确认：阻断原因词表（`RuntimeIdentityReason`）对 E 只读冻结范围；`fileDigest` 的项目/候选/来源版本绑定口径（应读"与 SourceGraph 同一修订"的文件摘要，candidate 场景即候选 worktree）。

### 1.2 Runtime observations（`selectableRuntimeObservations`，runtime-identity.ts:170）

- 现有规则：仅收集有 `runtimeInstanceId`、certainty ≠ unknown/unmapped、且无降级 reason 的记录进 source map；position-dependent 保留可导航但 `resolveRuntimeElement` 拒绝作为实例目标。
- 需 C+D 确认：E 验证容器（Docker 四视口）采集哪些观测值进入 snapshot、如何与当前 VerificationRun 绑定（runId / revision 写入观测工件），以及 `createRuntimeSourceMap` / `resolveRuntimeElement` 的对接边界是否允许 E 只读消费 observation 级数据（不允许 E 侧重评估身份）。

### 1.3 RuntimePageContext（`src/core/model.ts:57`）

- 现有形态仅 `pathname / search / hash`（"Browser location … client routing may use any of the parts"）。
- 需 C+D 确认：pathname/search/hash 之外是否存在路由树位置、命名空间或实例定位的验证依据；在仅有三元组的现状下，**page-context 从 E `missingEvidence` 中安全移除的最低条件**（候选：双侧 snapshot.page 三元组一致 + 该页面属于 SourceGraph 路由证明集合）。

### 1.4 联合验收红线（E + C+D 合并前后均须成立）

- 视觉证据只读辅助，`view.state` 无 `pass`；
- `missingEvidence` 不被无依据清空（每项移除需对应证据来源说明）；
- 严格实例证明必经 C+D `assessRuntimeIdentity()` 完整评估；
- Approval / Receipt / Apply 安全合同不变；
- PR #29 与 #30 重叠代码只合入一次。

## 2. 新增公共字段纪律

若接线必须新增公共字段：先给出精确类型 + 最小样例（字段名、取值域、生产者/消费者、版本化策略），交 A 登记、C+D 确认后 E 再接入。


---

# v20 接口需求实际交付 + 两阶段执行确认（2026-10-23）

## 0. 交付方式确认

三项接口需求**已实际交付**：独立合同文档 `docs/architecture/e-visual-identity-interface-requests.md` 合入 A 公共核心（新 A 文档 HEAD `fa21af9`，纯文档）。C+D Agent 自 A HEAD 切独立分支即接收；协调人亦已认可三项要求（instanceIdentityProven === true / locatable 仅导航 / missingEvidence 保留）。

## 1. 两阶段执行（按协调人调整）

- **阶段一（不以 C+D 书面确认为前置）**：E 修复 legacy sourceVersion 多文件 P1 + 最新 CI 全绿 → A 立即启动 PR #30 只读视觉证据集成预演（基线 `dc8269f` 系）。验收范围：真实 VerificationRun、`run.visualEvidences` API 只读 View、证据隔离、原审批门控不变。此阶段 `strictInstanceProofAvailable` 保持 false（E 当前保留 page-context / collection-reasons / graph-membership 缺失项），完整严格实例证明继续禁用。
- **阶段二（C+D 合同到位后单独验收）**：严格实例证明接线与升级验收；必须验证 `instanceIdentityProven`、版本一致与运行身份匹配，不得仅检查对象非空。

## 2. 纪律不变

不直接合并 PR #30；不合并 main；不触发 Bolt；PR #29/#30 重叠代码只合一次。


---

# v21 E PR #30 阶段一集成预演（2026-10-23）

## 0. 预演设置

- E P1 终审通过（fdd9ee0，双 CI SUCCESS，742/742 Vitest，Docker 视觉 E2E 过）。
- 集成树 `_scratch/wt-e30`，分支 `feat/a-e30-integration-20261023` = merge(fa21af9, fdd9ee0)，merge 提交 `b10ee9da`，零冲突。

## 1. 七项验收点核验结果

1. **#29/#30 重叠**：#29 tip 非 #30 祖先；改动文件交集 104 个 → **#30 取代 #29**，#29 关闭不合入（合 #30 后 #29 永久 Draft/关闭，杜绝双合）。
2. VerificationRunner Docker 采集 / manifest / 视觉挂载 / API 只读 View：随 E 批次一/二进入，集成 CI 全量验证中。
3. 双侧版本摘要各自匹配对应修订：sourceFileVersions 逐文件映射（第二批实现）在差异内，定向测试 39/39 过。
4. sourceVersion 多文件 P1 修复未回退：集成树含 fdd9ee0 修复，无相关回退。
5. **strictInstanceProofAvailable 阶段一恒 false**：接线层（visual-verification-attach / verification-runner）不传递 identityAssessment → availability 公式短路为 false；missingEvidence 默认从空列表按缺失项逐项填充（source-version 等）。
6. **审批链路零引用**：visualEvidence 在 verification-runner / apply / session / candidate 零引用；VerificationRun 通过条件、Approval、Receipt、Apply 文件零改动。
7. **A/F/C+D/MEDIA 不回退**：diff fa21af9→集成树仅 E 模块、E 文档、fixture 与 workflow；candidate/apply/session/scope/project/runtime-identity/project-data-routes/real-adapter 零改动。

## 2. 本地门

typecheck ✓ / build ✓ / 定向 Vitest 39/39 ✓；正式 CI（39895283491，b10ee9da）运行中。

## 3. 遗留观察（阶段二，不阻塞阶段一）

- `visual-geometry.ts:640` availability 公式含 `identityAssessment != null` 项——阶段一因接线层不传递而恒 false，可用；**阶段二 C+D 合同到位后必须改为以 `instanceIdentityProven === true` 为准**（已写入 v19/v20 合同文档红线）。


---

# v22 C+D AC-P2a/b 进展登记 + P0（2026-10-23）

## 0. 状态

- C+D 提交：AC-P2a `bd321d8` / AC-P2b `6359ccb` / E 身份合同 `a1b2a24`；CI #39893117386 SUCCESS。
- AC-P2a（Link/NavLink 来源传播）与 AC-P2b（fallback 建模）方向均获认可。
- **P0（交 C+D 最小修复 + 正反例回归）**：`resolveLazyComponent()` 将 `route.lazy(() => import('./Page'))` 的 **default 导出**直接认定为页面组件并升级 source-proven——React Router route.lazy 加载的是路由属性对象，default 不是合法的 route.lazy 页面组件键，会产生错误页面消费证明。

## 1. 五项附带登记

1. AC-P2a 版本白名单需补 **SemVer 边界检查**。
2. B 冻结 candidate-gate 脚本与 `cf44193` 完全一致 ✓；当前 codescandy "PROVEN" 为 C+D 实测报告口径，正式 Candidate 仍被缺页 Scope 正确拒绝。
3. AC-P2a/b 修复合入 A 后，通知 B 在固定 SHA（b700bbd）上构造**含目标及受影响页面的显式 Scope** 执行 `--expect accepted`。
4. C+D 分支含 B 旧探针报告与脚本——**集成时限定公共代码、测试及必要文档**，过期报告不作为最新状态合入。
5. E 身份合同文档（a1b2a24）可接收；但 **VerificationRun.runtimeIdentity 新字段与 page-context 缺失项清除规则暂不冻结**——同 pathname 仍可能对应不同路由匹配或错误边界状态，需补可信路由身份（C+D 后续合同项）。

## 2. 处置

- **不批准 C+D 全分支直接合并**。等 P0 修复后，从当时最新 A HEAD 建独立 AC-P2a/b 集成预演，核查差异（按 §1.4 口径）与正式 CI。
- E PR #30 阶段一预演 CI 已绿（v21），待合入授权；F 真实 TEXT 并行推进。
- 不合并 main，不触发 Bolt。


---

# v23 E 阶段一正式并入 A（2026-10-23）

## 0. 合并记录

- **新 A HEAD：`71dc6c7a91b64eb5a66a2932b1f5409938f698a0`**（fa21af9 + merge b10ee9da，`--no-ff`，无 reset/force push）。
- A 分支完整 CI [39897930197](https://github.com/Onesummer-D/Ripple/actions/runs/39897930197) **SUCCESS**。
- PR #30：GitHub 检出合并（自动关闭），已评论记录 A merge SHA 71dc6c7 与阶段一验收摘要。
- PR #29：已关闭不合并，评论注明由 #30 取代及防止双合的原因。

## 1. 新基线分发（71dc6c7）

| 线 | 任务 |
|---|---|
| E | 阶段一完成转冻结待命；阶段二等 C+D 正式合同（必须 instanceIdentityProven === true，不允许非空检查） |
| F | 真实候选合同 P0 修复 + 浏览器 E2E（继续） |
| D | 青野 f7e4998a MEDIA 全链准备（继续） |
| C+D | route.lazy default P0 最小修复 → 修复后从最新 A HEAD 建 AC-P2a/b 集成预演 |
| B | 冻结待命（AC-P2a/b 入 A 后显式 Scope 复验） |

## 2. 纪律

不合并 main，不触发 Bolt；E 阶段二与 C+D 合同并行协调，不随本次进入 A。


---

# v24 离开期间复核与下一轮总集成安排（2026-10-23 16:47）

## 0. 总览

| 线 | 当前提交 | CI | 状态 | 待办 / 下一次集成入口 |
|---|---|---|---|---|
| A 主线 | `71dc6c7` | 39897930197 SUCCESS | 基线（E #30 已并入，#29 已关闭） | 等 F / C+D 预演 |
| F 第一批 | `feat/f-real-text-phase2-20261023 @ da94ab7` | #39897848604 SUCCESS（596/66+1 跳） | **真实 TEXT 候选与预演闭环验收通过，待 A 集成**（旧 P0/nonce/iframe 三项全修复，Docker E2E 实证） | F 从 71dc6c7 merge 同步 → 回归 → 冻结集成提交供 A 审查；A 建独立预演；F 并行开发第二批 |
| C+D | `27d4bd6` | #39900833633 SUCCESS（602/61+1 跳） | route.lazy default + SemVer 白名单已修；**新 P0：resolveLazyComponent() 以 `components.filter(c.name === 'Component')` 判断消费者，未验证 Component 是否为目标模块真实命名导出**（内部函数可能被误证 source-proven）→ C+D 最小修复中 | P0 修复 + 真实负例 + CI 后，A 从最新 A HEAD 建独立预演，**只选公共代码/测试/必要合同文档**（分支落后 A 22 提交且混有 B 历史报告，不整支合入）；PR #28 为历史 merged PR，不作新补丁入口 |
| E | 阶段一已入 A | — | 冻结待命 | 阶段二待 C+D 合同（instanceIdentityProven === true） |
| D | 基于 71dc6c7 | — | 青野 f7e4998a 全链准备 | 继续 |
| B | 冻结 cf44193 | — | 待命 | C+D 公共补丁入 A 后恢复 codescandy `--expect accepted`（显式完整 Scope） |

## 1. 集成顺序（按协调人安排）

1. F 从 `71dc6c7` 同步、回归、冻结集成提交 → A 独立预演；
2. C+D P0 修复 → 真实负例 + CI → A 独立预演（两线**不混合**，各过联合 CI）；
3. C+D 补丁入 A 后通知 B 恢复复验；
4. E 阶段一不重复合并；阶段二独立规划。

纪律不变：不合并 main、不触发 Bolt、不 force push 覆盖 Agent 成果。


---

# v25 AC-P2a/b 精简集成预演（2026-10-23 17:xx）

## 0. 预演设置

- A 实际基线：`71dc6c7`（ls-remote 复核一致）；C+D `98029cb`（一致；P0 命名导出修复已含）。
- 集成树 `_scratch/wt-acp2`，分支 `feat/a-acp2-slim-integration-20261023`，集成提交 `f804c7e`，**Draft PR #31**（base=A，head=精简分支）。
- 方式：路径白名单引入（非整分支 merge、非盲目 cherry-pick）。

## 1. 文件白名单与排除

- **白名单（4 文件）**：`project-data-routes.ts`（+83，AC-P2b fallback/条件消费者）、`project-data-routes.test.ts`（+295）、`project.ts`（+120，AC-P2a Link/NavLink 审计白名单 SemVer 三段式 v6/v7 + route.lazy Component 命名导出验证）、`docs/architecture/e-pr30-identity-contract-confirmation.md`（必要合同文档）。
- **排除（13 项 B 历史文件）**：`docs/probes/*` 全部 12 项（含 codescandy 证据图）+ `scripts/b-thirdparty-candidate-gate.mjs`（B 冻结线 cf44193 自行维护）。

## 2. 联合回归证据（三类证据分明）

| 证据层 | 结果 |
|---|---|
| C+D 独立 CI | #39930329395 SUCCESS（98029cb） |
| **A+C+D 集成 CI** | [39934358811](https://github.com/Onesummer-D/Ripple/actions/runs/39934358811)（f804c7e）**SUCCESS** |
| F/E 兼容 | F real-adapter 17/17 ✓；E visual-verification-attach + scope + 双身份文件 182/182 ✓ |

- 本地门：typecheck ✓ / build ✓ / routes 81/81（含 lazy 正反例、fallback 建模用例）✓。
- **codescandy 固定 SHA b700bbd 来源探针：exit 0，source proof satisfied，danglingSourceProven=0**——AC-P2a/b 目标达成（原 exit 2 BLOCKED 边界解除）。
- 安全门控：PageImpact/Scope/createCandidate 相关测试 182/182 无回退；Candidate 缺页拒绝路径未动。

## 3. 剩余 P0/P1

- **P1（C+D 交付中）**：`export type` 运行时导出边界测试——正式验收前不宣布 C+D 最终集成通过；交付后把增量补入同一精简分支（PR #31）。
- 备注：本地 routes 测试 81/81 通过但进程退出码 1，为 vitest Windows RPC teardown 超时（非测试失败），Linux CI 权威绿。

## 4. 结论

- 预演通过；是否正式纳入 A 待协调人决定（在 C+D export-type 测试验收前不建议宣布最终通过）。
- **暂不唤醒 B**：待 C+D 公共补丁正式入 A + export-type 测试验收后，再通知 B 恢复 `--expect accepted`。


---

# v26 F 第二批结论 + 第三批 passed fixture 测试条件确认（2026-10-23 18:xx）

## 0. F 第二批登记

- F `3105fc1`，CI #39929160168 SUCCESS：真实候选调用 `/candidate/verify`，展示 runId / 哈希 / 四视口证据 / incomplete 状态。
- **F 侧 P0（协调人已派工）**：候选替换后旧验证证据可能残留；E 视觉 view 展示与运行中状态补齐。A 不改 F 界面代码。

## 1. 五问答复（基于 A 核心 `71dc6c7` 代码核实）

1. **是否有固定可重复的 passed 真实 TEXT fixture？——没有。** 现有证据：`page-override-lifecycle.spec.ts` 的 approve 全链是合成 `registerVerification`（手工构造 checks 全过 + 断言），非真实 Docker 运行器产出；真实运行器的 7 断言从未在固定 fixture 上全 pass（F 实测 4/7 incomplete 是首例真实数据）。
2. **最小合法成功 fixture 规格**（断言级要求，摘自 `verification-execution.mjs:960-1030`，正式断言与身份校验不变）：
   - target-change / source-mapping：编辑目标需唯一 source→渲染绑定（单实例、带运行时身份标注），全部 4 视口渲染成功；
   - scope-propagation：需 supportedScopeContract——纯 TEXT 操作、Scope 覆盖**全部**合同页面、每操作绑定单 sourceRef + 每页 pageExpectations（baseline/candidate 文本），且页面带声明式 route marker、双侧 route identity 'verified' → 即**多页共享文本源 + 显式标记**场景；
   - interaction：声明可访问交互（按钮/链接）+ 预期可见状态，全部视口双侧通过且 route identity verified；
   - responsive-layout：桌面/平板/移动三档无横向文档溢出；
   - browser-errors：零 console/页面错误且授权资源零不可用（任一 blocked 资源即 risk，永不 pass）。
3. **incomplete fixture 保留为审批阻断负例**：`session.ts:201` passed = 无 risks ∧ 强制证据全过 ∧ 七断言全 pass；4/7 必为 incomplete，`approve()`（session.ts:272）正确拒绝。**不得放宽**。
4. **Approval → Apply → Rollback 合同**（`apply.ts:58/120`、`session.ts:272/285`）：Apply 要求 session.status='approved' + approval 记录 + **run.status='passed'** + runId/patchHash 与 approval 绑定一致 + 最新可信（非 stale）；Rollback 要求"原始 passed 验证运行"的 runId/patchHash 在回滚记录中且工程版本未漂移；历史核对 = 服务端 run 记录、patchHash、工程 revision 三者一致。
5. **测试证据交付 F**：A 下一步构建最小成功 fixture（多页共享 footer 文本 + 声明交互 + route marker + 身份标注，走真实 Docker 运行器）并实测 7/7 pass 后，将 fixture + input.json + run 工件交 F 做第三批 E2E。未完成前 F 不得自行放宽断言凑 passed。

## 2. 纪律

不将 incomplete 放宽为 passed；不直接批准不完整验证；不触发 Bolt；C+D 精简集成按独立流程推进，F 不必等待。

---

## v27（2026-10-23 19:5x）｜AC-P2a/b 正式纳入 A；新基线 45a2d7c

### 1. AC-P2a/b 最终集成（已完成）

- **新 A HEAD：`45a2d7cda2271ea5c212c8e0f3a469eb62dded31`**（`feat/project-first-core-core-20261018`，由 71dc6c7 merge `--no-ff` 集成分支 eba4660 得到）。
- 集成内容（白名单 5 文件）：`src/core/project.ts`、`src/core/project-data-routes.ts`、`src/core/project-data-routes.test.ts`、`docs/architecture/e-pr30-identity-contract-confirmation.md`、`.github/workflows/ci.yml`（checks 超时 20→30 min，理由：GitHub Azure apt 镜像当日两次限速至 ~24 kB/s，playwright `--with-deps` 一步耗尽 20 min 预算导致两次 job 超时取消；测试门控零变化）。
- C+D 最终增量：`8f177b6` over `98029cb`（route.lazy 两种 type-only 导出 `export type {X as Component}` / `export {type X as Component}` 保持 unresolved；普通命名导出正例未回退）。
- 三类证据分明：
  1. C+D 独立 CI #39935048872 SUCCESS（607 Vitest / 61 Playwright）。
  2. A+C+D 集成 CI #39944961968 SUCCESS（761 Vitest / 62 Playwright / typecheck / build / Docker 浏览器链）。
  3. F·E 兼容：本地 199 测试（scope / visual-attach / runtime-identity×2 / real-adapter）通过；codescandy 固定 `b700bbd` 探针复跑 exit 0 source proof satisfied。
- **AC-P2a/b 无剩余 P0。** route.lazy 命名导出 + type-only 导出负例均在正式 A CI 中执行。
- PR #31 已评论并关闭（内容经直接 merge 进入 A，不经 PR 二次合并）。REST API 无法转 Draft（PATCH draft 被静默忽略），以关闭代替。
- 本地新增提交对应路由测试 83/83（含 2 个新 type-only 导出负例）。

### 2. B 恢复通知（有效）

**B 可恢复 codescandy `--expect accepted` 验收**：以 A 新基线 `45a2d7c` 为准，固定 codescandy SHA `b700bbd`，构造包含目标及全部受影响页面的显式 Scope（includedRefs = 全部 pageRefs + targetRef，不携带 localPageRef），执行真实 Candidate ACCEPTED 路径。B-ENV-1 / AC-P3 仍按 Windows 兼容性支线推进，不混入本次验收。

### 3. 环境异常登记（非代码问题）

- 主仓库 `ripple-app` 本地对象库损坏：46 个 broken link（缺失提交/树），`git fetch origin` 因 17 个未解析 delta 失败；部分缺失对象 GitHub 返回 not our ref，无法按 SHA 补取。**Git 写操作已切换到全新克隆 `_scratch/merge-fresh`。** 影响：主仓库 fetch 不可用直至重建对象库；各 worktree 的本地提交/推送不受影响。待办：择机用 merge-fresh 全量对象重建主仓库 `.git/objects`（或重新 clone 并挂接 worktree）。

### 4. 当前主线

1. **F 第二批 P0**（候选替换后旧验证证据残留）由 F 修复中；F 第一批（da94ab7）验收通过状态不变。
2. **passed fixture**：构建多页 data-router fixture（共享 footer 文本 + 声明交互 + 唯一 marker），真实 Docker 运行器跑 7/7 passed，交 F 第三批。开发分支 `feat/a-passed-fixture-20261023`（待建，基于 45a2d7c）。
3. E 阶段二严格实例证明接线等待 C+D 三项合同冻结（instanceIdentityProven === true）。
4. D 青野 MEDIA 全链准备基于 45a2d7c。

---

## v28（2026-10-23 20:3x）｜7/7 passed fixture 全链路实跑成功

### 1. 交付物

- 分支：`feat/a-passed-fixture-20261023` @ `d83adb5`（基于 A `45a2d7c`）。
- 测试工程：`test/fixtures/passed-text-lifecycle/`（两页 createBrowserRouter：/ + /about；SiteFooter 共享文本源；每页唯一 h1 marker；首页声明式按钮交互；零外部资源；`.gitattributes` 锁 LF）。
- 驱动脚本：`scripts/a-passed-fixture-e2e.mjs`（正式公共 API 全程，无模拟）。
- 工作流：`.github/workflows/a-passed-fixture.yml`（Linux + Docker，`workflow_dispatch` 或推送触发）。

### 2. 验收证据（CI run [#39953345840](https://github.com/Onesummer-D/Ripple/actions/runs/39953345840) SUCCESS）

- **fixture 固定源码 SHA：`ffa54331dd5437b5497f3a46e6d1b6fc66042fa2`**（固定作者时间，可复现）。
- 修改前 PageImpact 即 source-proven 覆盖 `page:/` + `page:/about`，unresolved=[]（analyze 输出实测）。
- 显式完整 Scope 候选创建成功；**缺页 Scope 负例被 409 拒绝**（门控有效）。
- 真实 Docker VerificationRunner（mcr playwright v1.64.0-noble）：
  - **cycle 1：7/7 pass**（target-change / non-target-preserved / scope-propagation / interaction / responsive-layout / source-mapping / browser-errors），4 视口 × 双侧观察齐备（scopeObservations 8、interactionObservations 4、baselineComparisons 4、不可用资源 0）。
  - **cycle 2：7/7 pass**（重复运行稳定）。
  - runIds：`verification-17fda0db-…`、`verification-11a531df-…`；patchHash 两轮一致 `f38c99e9c596c3ff…`；recordHash 各 `0d319766…` / `d0ffcc46…`。
- **同一候选连续生命周期**：两 cycle 均 candidate → verify(passed) → approve → apply（磁盘字节断言为候选文案）→ rollback（磁盘字节还原基线），同一 candidateId 链完整。
- 证据工件：`passed-fixture-evidence-39953345840`（summary.json、两轮 record.json、workflow 各步、运行工件含 16 张截图），保留 30 天。
- 可重复命令：`node scripts/a-passed-fixture-e2e.mjs --out test-results/passed-fixture`（需 Linux + Docker + 预热镜像）。

### 3. 衔接

- F 第三批可直接以该 fixture + 驱动脚本为输入做统一工作台完整生命周期 E2E。
- 未改动任何审批门控/验证断言；fixture 无任何特殊放行。

### 4. 状态总表

| 线 | 状态 |
|---|---|
| A 公共核心 | `45a2d7c`，AC-P2a/b 已收束，主线 CI 绿 |
| passed fixture | ✅ 7/7 × 2 cycle 全链路通过，待 F 消费 |
| F | 第二批 P0 修复中（协调人直派） |
| B | 工具 P0 修复后再恢复 codescandy 验收 |
| D / E / C+D | 按 19:38 协调人安排推进 |

---

## v29（2026-10-23 21:0x）｜passed fixture 证据加固后重跑通过，移交 F

- 分支 `feat/a-passed-fixture-20261023` @ `7a3ec43`，独立保持，待集成审查后再定合并。
- 加固内容（仅测试证据层，核心合同零改动）：
  1. verify 必须提供 recordUrl，执行记录 GET 必须 200，七断言任一缺失即失败。
  2. Apply/Rollback 改为 SiteFooter.tsx 整文件逐字节校验（Buffer.compare + sha256）。
  3. sameCandidateChain 按各步实际响应 candidateId 计算；显式断言两轮 patchHash 一致。
- 重跑 CI [#39955423994 SUCCESS](https://github.com/Onesummer-D/Ripple/actions/runs/39955423994)：47 项检查全过；两轮 7/7 pass；chainOk=true（create/verify/approve/apply/rollback 同一 candidateId）；patchHash 两轮一致 `f38c99e9c596c3ff…`；回滚后文件 sha256=`84c008f89fc10e5d`，与 git 基线 blob sha 完全一致（独立核验）；应用后 sha=`235ff991b984e906`。
- fixture SHA 不变：`ffa54331dd5437b5497f3a46e6d1b6fc66042fa2`。
- 证据工件 `passed-fixture-evidence-39955423994`（30 天保留），本地副本 `_scratch/fixture-evidence3/`。
- 已具备移交 F 条件：测试工程 + 驱动脚本 + 固定输入契约 + 全套连续证据。

## v30（2026-10-23 22:5x）｜codescandy 兼容性边界修复完成，独立分支 CI 绿

- 分支 `feat/a-codescandy-compat-20261023` @ `6f22551`（基于 A `45a2d7c`），8 文件改动，**未合并 A/main，未触发 Bolt**。
- 正式 CI [#39972195615 SUCCESS](https://github.com/Onesummer-D/Ripple/actions/runs/39972195615)：typecheck ✓、build ✓、**765/765 Vitest**（+2 新增）、**62/62 Playwright**。

### 一、P0 通配别名：根因与修复

- 根因：`project-config-resolver.mjs` 的 `aliasRules()` 对 `pattern.startsWith('*')` 一律判 ambiguous，codescandy 的 `"paths": { "*": ["./src/*"] }`（合法 TypeScript/Bundler 语义 = 裸 specifier 本地文件存在则映射、否则回退 npm 包）被误杀，预览拒绝启动。
- 修复：裸 `*` + 单目的地 `./dir/*` 建模为 `kind: 'existence-fallback'` 规则；预览适配器新增 `existenceFallback` 插件按前缀做真实文件探测（先词法包含校验、后存在性探测，`..` 逃逸永不命中），未命中回退正常 node_modules 解析。**未删除任何拒绝规则，未放行 `*` 通配捕获**。
- fail-closed 负例（全部回归通过）：`*/x`、`*a*`、目标 `*/*`、裸 `*` 双目的地、裸 `*` 无目标 `*` 仍 ambiguous；`probeExistenceFallback` 对相对/绝对/URL/`node:` specifier 一律不捕获，`../outside`、`pages/../../outside`、`..` 恒真存在性下仍拒绝。

### 二、来源证明一致性：根因与修复

- 根因（三条实证）：`routerHostBasis()` 用 `ts.resolveModuleName(..., ts.sys)` 解析 react-router；`ts.sys` 会**向上逃逸项目根**——无依赖检出解析到父目录 `Ripple涟漪/node_modules/react-router-dom@7.18.4`（未审计 major），旧代码对根外解析直接 definitive 拒绝并抑制声明回退 → semantic-candidate/BLOCKED；有依赖时解析到项目内 6.27.0 → source-proven。**同一源码树因依赖存在与否得到相反裁决**。
- 修复：根外解析不再抑制声明回退，分析建模与 Docker 预览相同的世界边界（容器只挂项目根，父目录安装永远不可能影响运行时）；声明回退仍只接受精确 x.y.z 或 ^/~ 钉在 major 6/7（宽松范围/预发/部分版本全部拒绝，原有负例未回归）。
- 候选门：`createCandidate` 新增 `declaredHostProofsDiverged` 检查——声明基座采集后项目内出现（或消失）实际安装时，拒绝候选并强制重新分析，防止信任异态依赖状态下采集的图。
- 改写负例：根逃逸场景现断言基座为 `(declared)` 且永不出现 `(installed)`；补充分叉门控断言（项目内后装 6.27.0 → `declaredHostProofsDiverged` 返回该 specifier）。

### 三、codescandy 固定工程双状态回归（b700bbd）

| 状态 | 修复前 | 修复后 |
|-|-|-|
| 有依赖（6.27.0 项目内安装） | PROVEN（exit 0） | PROVEN（exit 0），edges/nodes/srcProven/routes 与修复前**逐字段一致**（5352/4957/4340/37） |
| 无依赖（干净克隆） | **BLOCKED（exit 2，非确定）** | **PROVEN（exit 0），与有依赖状态字段完全一致** |

- 唯一 unresolved 保持 `src/main.tsx → ./styles/theme.scss`（既有已知边界），danglingSourceProven=0。
- 结论：依赖状态不再翻转 PageImpact 裁决，双态结果稳定且与真实容器语义一致。

### 四、未解决风险

1. esbuild dep-scan 对裸 specifier 的预打包分类可能与运行时回退存在差异，需在 B 的真实候选验收中观察（已在预览插件注释层面接受，不影响门控）。
2. `(declared)` 基座在验证前安装依赖会触发候选门强制重分析——属设计内行为，但需在 B 的验收脚本中显式处理（先装依赖再分析，或分析后勿动依赖）。
3. 本地 `_scratch` junction 环境下 `project.test.ts` 的 configPath 大小写路径用例有 1 项环境性失败（干净 HEAD 同样失败，Linux CI 通过），与本次改动无关。

### 五、结论

- P0 修复**允许 B 恢复 codescandy 真实候选验收**（B 仍需先修其工具侧 SHA 校验问题，见协调人 20:08 意见）。
- 根边界解析与候选门**建议合入 A**（走正式集成审查流程，不自行合并）。
