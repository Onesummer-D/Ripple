# RIPPLE A HANDOFF — Run #12 前置工程修复（离线交付）

日期：2026-10-21（Asia/Shanghai）
交付方：B Agent 临时接管（跨任务授权，非 A/B 分支合并）
接收方建议：具有 GitHub 写权限的独立集成审查 Agent
状态：**离线开发者自检完成；P0/P1 独立审查与 GitHub 验证 NOT RUN。**

## 0. 交付物清单与校验和

以下文件位于交付目录（本文件随最终源码 ZIP 一并提供）：

| 文件 | 内容 | SHA-256 |
| --- | --- | --- |
| `run12-prep.patch` | `git diff --binary --full-index`，基线 680098f（== GitHub 10a808b 字节树）→ 最终 HEAD | 见 delivery 清单（交付时计算） |
| `ripple-a-run12-prep-final-20261021.zip` | 完整 A 最终源码（不含 .git / node_modules / dist） | 见 delivery 清单 |
| `RIPPLE_A_HANDOFF.md` | 本文件 | 见 delivery 清单 |
| `verify.log` | 补丁应用与树一致性验证日志 | — |
| `bench_current.json` / `bench_baseline.json` / `bench_*.log` | 阶段二 benchmark 原始统计 JSON 与日志 | — |

## 1. 唯一公共基线

- GitHub A 分支固定 commit：`10a808bb4845a0a947688080a7e97394095517a9`（已从 GitHub 直接拉取对象核验）。
- **更正（第四轮审查）**：早期本地导入基线 `680098f` 与 GitHub A **并非字节一致**——两树路径集合一致，但 177 个文件的 Blob 为纯 CRLF 差异（逐字节核验，0 真实内容差异），其中补丁触碰的 5 个文件（GitHub 为 LF）使旧补丁在真实 checkout 上 `does not apply`。本交付已废弃该导入基线：交付分支 `feat/a-run12-cleanup-review-20261021` 直接在 GitHub 精确字节树 `10a808b` 上重建，补丁即 `10a808b..HEAD`。
- 逐文件 Blob SHA 已核对：`verification-execution.mjs`、`verification-execution.test.ts`、`verification-lifecycle.mjs`、`verification-lifecycle.test.ts`、`candidate-verification-runner.mjs` 对齐 GitHub LF；`verification-runner.ts` 在 GitHub 上本身为 CRLF，本补丁保持 CRLF（仅 20 行语义 diff，无全文件格式化）。
- 在 `git archive 10a808b` 解包的真实字节树上 `git apply --check` 与 `git apply` 通过，应用结果与最终 HEAD 树逐字节一致（`diff -r` exit 0，仅排除 .git）。
- 补丁不含 node_modules、.env、凭据或临时调试文件；无删除或二进制文件变更。

## 2. 补丁内容（最终 12 个文件）

源码 5：

- `src/core/verification-execution.mjs` — cleanup fail-closed（closeFailures/pagesLeaked/**unsettled** 任一 > 0 即中止运行）+ 资源快照缺失断言（browser-errors 在 unavailableResources 非空时为 RISK）
- `src/core/verification-lifecycle.mjs` — `scope.fail` 终端语义（不标 late、first-error 携带 checkId）
- `src/core/candidate-verification-runner.mjs` — 入口重排：经 `runVerificationAndPublish` 发布门，先验证、先关浏览器、后原子发布
- `src/core/verification-publish.mjs` — 新增：最终发布门控（见 §3）
- `src/core/verification-runner.ts` — 基线清理失败不掩盖原始诊断；成功路径清理失败 fail-closed

测试 3：

- `src/core/verification-execution.test.ts` — 7 个确定性负例 + 1 个发布门集成测试（见 §3）
- `src/core/verification-lifecycle.test.ts` — 关闭失败/悬挂/迟到 newPage 计数的确定性单测
- `src/core/verification-publish.test.ts` — 发布门 8 项（假浏览器，本地可跑）

文档 4：三份阶段审查记录（`docs/acceptance/2026-10-21/run12-prep-phase{1,2,3}-*.md`）+ 本交接文档。

## 3. 核心不变量（独立审查重点）

**任何视口 cleanup 未证明完成（closeFailures > 0 或 pagesLeaked > 0 或 unsettled > 0）时：该视口结果丢弃、运行立即以 `RunnerAborted`（completed:false）中止、后续视口不启动、不生成 execution.json、不可能产生可审批 Receipt。**

调用链：`verifyViewport` 任务完成 → `scope.close()`（关闭全部页面、宽限排空全部已启动工作）→ 检查 `lifecycle.pagesLeaked/closeFailures/unsettled` → `scope.fail(..., { terminal: true })` 记录本视口终端 first-error（phase=`close-page`）→ 主循环抛出 `RunnerAborted`（`notStarted` 为剩余视口）→ 容器入口 catch 写 `runner-diagnostic.json`（completed:false），exit 3，不写 `execution.json` → 宿主 `docker()` 非零退出 → `writeFailedToRunDiagnostic` → 抛 `VerificationRunnerError`；`attestBrowserExecution` 只接受 completed:true 的 manifest，宿主另逐字段校验绑定。

unsettled 的语义（第三轮修订）：scope 的 summary 在返回后不可变，而 cleanup 的"安全取消证明"只能是 promise 已 settle——被页面关闭可靠取消的调用会 reject 并在宽限排空内 settle；宽限期结束后仍 pending 的工作没有任何取消证明，仍可能创建页面（迟到 newPage）、运行或修改运行状态，因此 `unsettled > 0` 与泄漏页面同等级处理。迟到 `newPage()` 由 `openPage` 的 closed 检查拦截并在到达时立即关闭；其到达后产生的关闭失败会计入 scope 计数器（不静默丢弃），但已返回的 summary 不回写——unsettled 中止条件正是把这个窗口 fail-closed。`inFlightAtClose` 仍仅诊断（写入 viewport-lifecycle 事件）。`scope.fail` 只记首个 firstError，错误清理不会覆盖原始 firstError。

**发布门（第三、四轮）**：`runVerificationAndPublish` 严格按序执行——(1) `runVerification()`（`RunnerAborted` 原样传播，什么都不写）；(2) **结构校验**（P0）：返回值必须内含合法 v4 manifest（`manifest` 对象、`schemaVersion === 4`、`executor === 'playwright'`、`completed === true`、非空 `runId`、`checks` 数组），否则拒绝发布——不接受任意对象作为执行记录；(3) 带 3 s 截止关闭浏览器，拒绝或挂起即抛（错误携带 `browserCloseAttempted: true`），抛出前写 `browser-close-failed` progress 事件，completed 记录此刻尚不存在于磁盘（不依赖进程退出码防止误用）；(4) 成功才序列化 **`summary.manifest` 本身**（顶层即宿主 attestation 读取的 ExecutionManifest，`viewportDiagnostics`/`status` 不泄漏），以同目录临时文件 + 硬链接原子发布，目标已存在则拒绝（保留原 `flag:'wx'` 语义）。**清理只删本运行自己的临时文件**（文件名含 pid+nonce）；任何失败路径都不删除 outputPath，预先存在的记录属于上一次尝试、原样保留（P1）。总预算与 reserve 不变（browser close ≤3 s 本就在 BUDGET_RESERVE_MS 内；execution.json 的写入移至关浏览器之后，为毫秒级）。

**入口 final-close 状态机（P1）**：`pending` / `closed` / `failed`。发布门成功关闭后置 `closed`，finally 不再关闭（成功关闭后绝无第二次关闭，避免"exit 3 但 execution.json 存在"的矛盾态）；发布门关闭失败时错误带 `browserCloseAttempted` 标记，catch 置 `failed`，不重试；验证/启动失败路径（`pending`）由 finally 执行唯一一次有界 3 s 关闭，关闭失败只追加证据与退出状态，首个错误始终是报告的错误。

确定性负例（真实 Chromium + 方法级故障注入，除注明外全部断言 RunnerAborted、notStarted、check-complete 清单、无 execution.json、completed:false 拒绝 attestation）：

1. `aborts the run when a viewport cannot close its pages: the next viewport never starts and no record is produced`
2. `counts a page close that hangs past its deadline, then aborts before the next viewport`
3. `aborts at the first viewport when no viewport can close its pages`
4. `aborts the run when a newPage() promise outlives the cleanup grace: no leak counted, no next viewport, no record`（unsettled 单独触发中止；summary `pagesLeaked:0, closeFailures:0, unsettled:1`）
5. `aborts the run when a timed-out task keeps running past the cleanup grace: the probe is not provably stopped`（底层探针不受页面关闭影响、deadline 后仍运行）
6. `keeps browser-errors at RISK when an authorized resource could not be snapshotted, even if the page never requests it`

发布门负例（`verification-publish.test.ts`，假浏览器）：真实 wrapper 结构序列化后顶层即 v4 manifest（wrapper 字段不泄漏）；无 manifest / completed:false → 拒绝发布且 close 未被调用；close 拒绝 → 抛原错误、错误带 `browserCloseAttempted` 标记、无文件、无残留临时文件、`browser-close-failed` 事件持久化；close 挂起超截止 → 同上；成功路径 close 恰好一次；**预先存在的记录 + 本次验证失败 → 原文件原样保留、传播同一原始错误对象、close 未被调用**；预先存在的记录 + 本次发布 → 拒绝覆盖且字节不变。

集成测试（`verification-execution.test.ts`，真实 Chromium）：`publishes the real executor output as a top-level v4 manifest through the publish gate, closing the browser exactly once`——真实 `executeVerification()` 输出经真实发布门，断言写出 JSON 顶层 `schemaVersion:4 / executor / completed:true / runId / candidateId / scopeDecisionId`、`checks` 数组、无 `viewportDiagnostics`/`status`、close 恰好一次、无残留临时文件。

生命周期单测（`verification-lifecycle.test.ts`，fake）：迟到 newPage 使 close 返回 `unsettled:1`（closeFailures/pagesLeaked 为 0）；迟到页面 close 拒绝在返回后才计入计数器（二次 close 可见 `closeFailures:1`，证明不静默丢弃、窗口由执行器堵死）；迟到页面 close 永久挂起命中关闭截止计数且保持 unsettled 可见。

既有负例复用（名称见 `verification-execution.test.ts` / `verification-lifecycle.test.ts`）：迟到 newPage 到达即关闭、未响应 task deadline（挂起探针被页面关闭取消后在宽限内 settle，视口失败但运行继续——候选级语义不变）、兄弟 Promise 一侧抛错、newPage 拒绝、route 安装失败、篡改快照拦截、错误风暴计数、无视口可运行、budget 中止且 completed:false 拒绝 Receipt、firstError.inFlight、cgroup 读取。

## 4. 验证状态（开发者自检，非独立审查）

- 本环境（Windows 10 / Node 24.21.0 / 真实 Chromium）：typecheck、build、`node --check`（容器入口 + 发布门）通过；Docker E2E 与 GitHub CI 见下条。
- 可运行测试：verification-execution **22/22**（约 146 s 全量回归，含真实结构发布门集成测试）、verification-lifecycle **9/9**、verification-publish **8/8**、verification-runner-failure 3/3、verification-contract 5/5、error-accumulator 4/4、session 25/25、scope 8/8、bolt-workflow 7/7、candidate-preview 27/27、preview-resource-snapshot 20+1、page-overrides 2/2、project-config-resolver 4/4、project-viewports 1/1。
- 补丁真实基线验证：在 `git archive 10a808b` 解包的 GitHub 精确字节树上 `git apply --check` / `git apply` 通过，应用结果与交付分支 HEAD 树逐字节一致（`diff -r` exit 0，仅排除 .git）；`verification-runner.ts` 在 GitHub 上本身为 CRLF，补丁按 GitHub 字节保持 CRLF（20 行语义 diff），其余 5 个触碰文件对齐 GitHub LF。
- 基线即失败的 Windows 环境项（非回归，与基线表现一致）：preview-resource-policy 2 项、local-project-api 7 项、project（临时目录 git/权限）。
- **Docker Playwright E2E：NOT RUN（本机无 Docker）。GitHub CI：由推送 `feat/a-run12-cleanup-review-20261021` 后 Actions 运行，结果见 PR 检查；bolt-acceptance 手动专项不触发。**
- 性能（两组同会话配对测量）：首轮 修改前 9 822 ms vs 修改后 9 817 ms（−5 ms）；重复配对 基线 4 714 ms vs 最终 4 445 ms（−269 ms）。两组差值均在运行间方差内且方向不一致——**只能说明合成测试无退化**；绝对值随机器背景负载波动约 2 倍，不可跨会话比较，更不可外推 Bolt。**真实 Bolt 预算未验证。** 沿用交接文档风险估计：真实 Bolt 四视口约 174 s 对 160 s 执行器预算（临界，很可能超）；真实页面加载、Scope、interaction、快照、pids、内存数据留待 Run #12。未延长预算、未减视口、未复用页面。

## 5. 分支与集成步骤（集成审查）

1. 分支 `feat/a-run12-cleanup-review-20261021` 已基于 GitHub 精确基线 `10a808b` 创建并随本交付推送；**不覆盖 A 分支，不合并 C PR #11，不触发真实 Bolt 工作流**。
2. 补丁 `run12-prep.patch` 即 `10a808b..HEAD`，在真实字节基线上的应用验证见 §4；亦可将 ZIP 内容直接作为分支树核对。
3. 创建目标为 A 分支（`feat/project-first-core-20261018`）的 **Draft PR**；推送后由 Actions 运行普通 Linux CI 与 Docker Playwright（bolt-acceptance 手动专项除外）。
4. 完整检查 diff（12 文件，`--stat` 见 delivery 清单）；不额外导入 B MEDIA 或 Agent C 的修改；PR #10 的 browser-errors/unavailableResources 单行语义已包含在本补丁中，合入前需与 PR #10 负责人确认顺序（本补丁先行则 PR #10 该语义冲突消解，其余 5 行重放）。
5. 独立检查 §3 不变量与失败工件（failed-to-run.json、runner-diagnostic.json、progress.jsonl 的 first-error/viewport-lifecycle/late 事件）。
6. 是否合入 A 与是否触发 Run #12 由负责人决定。

## 6. 遗留与边界

- F1：`closePreviewResources` 在容器删除失败时不释放网络池（保守 fail-closed，可能耗尽池、影响后续 Run），留待独立审查；本轮只记录，未改。
- F2：`viewport-lifecycle` 事件（含 cgroup 摘要）逐行在容器内 `progress.jsonl`；宿主 `exportRunDiagnostics` 在 `RIPPLE_BROWSER_ARTIFACT_DIR` 设置时把 progress.jsonl 拷入导出根（`runCandidateVerification` 的 finally，成功与失败路径都执行），故原始 cgroup 进度可从最终工件导出；但成功路径宿主不**读取**逐视口计数。Run #12 如需逐视口 cgroup/lifecycle 数据用于判断，建议入口额外落盘；本轮不改。
- F3（第三、四轮已解决原条目）：容器入口 browser.close 失败路径由发布门 + final-close 状态机覆盖——close 失败时 completed 记录根本不存在于磁盘，成功关闭后绝无第二次关闭；发布门负例与入口集成测试（见 §3）为本地可跑测试。剩余 NOT RUN：Docker E2E/CI（见 §4）。
- browser-close-failed 持久化：close 失败 → 发布门抛错前写 `browser-close-failed` progress 事件（错误带 `browserCloseAttempted` 标记）→ 入口 catch 写 `runner-diagnostic.json`（completed:false）与 `runner-failed` 事件；宿主非零退出 → failed-to-run。不依赖退出码单独成立。
- firstError 保留：`scope.fail` 只记首个；发布门在 runVerification 抛错时不执行 close、原错误对象原样传播；入口 finally 的关闭失败只追加证据不替换首个错误（测试锁定）。
- F4：`e2e/page-override-lifecycle.spec.ts` 的 ERR_NETWORK_CHANGED 恢复仅覆盖"文档加载成功但标题未出现"分支，文档级 goto 失败不重试（fail-closed，可能抖动）。
- 真实 Bolt Approval → Apply → Rollback → History Restore 闭环：仍无完整 Receipt，NOT RUN。
