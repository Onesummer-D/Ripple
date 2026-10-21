# Run #12 前置工程修复 · 阶段一审查记录（生命周期 P1）

日期：2026-10-21（Asia/Shanghai）
执行：B Agent 临时接管（跨任务授权，非分支合并）
性质：**开发者自检 / 内部复核**。独立代码审查由后续 Agent 基于补丁、修改前后源码与测试工件进行。GitHub CI、私有 Bolt 真实验收和 Run #12 均不在本地完成范围内，状态一律记为 NOT RUN。

## 1. 基线

- 预期基线：`10a808bb4845a0a947688080a7e97394095517a9`（GitHub 只读核对通过）。
- **更正（第四轮审查）**：本节早前"附件 ZIP 与上述 commit 逐一无 CRLF 归一化比对全部一致"的表述不实——本地导入基线 `680098f` 与 GitHub 树路径集合一致，但 177 个文件 Blob 为纯 CRLF 差异（0 真实内容差异），其中 5 个补丁触碰文件导致旧补丁无法在真实 checkout 应用。交付分支与补丁已在 GitHub 精确字节树 `10a808b` 上重建（详见阶段三记录 §7）。
- 本地基线 commit `680098f` 为导入提交，**不是**原始 A GitHub SHA，且**并非**与 GitHub 字节一致（见上条更正）。
- 工作区隔离：全部工作在 `A_workspace/A_baseline`（A 专用目录）；未触碰 B 的 MEDIA / codescandy / 既有集成分支与任何本地工件。

## 2. 修复内容（commit `ac3f56c`）

| 文件 | 改动 | 动机 |
| --- | --- | --- |
| `src/core/verification-execution.mjs` | 视口 `scope.close()` 报告 `closeFailures > 0` 或 `pagesLeaked > 0` 时，丢弃该视口全部结果，按 `failed-to-run` 收尾，产生 phase=`close-page` 的终端 first-error，并**立即中止本次运行**：后续视口不再启动，抛出 `RunnerAborted`（completed:false 诊断）；`close-page` 加入基础设施 phase 集合 | Run #11 级联前提：关不掉的页面存活于共享浏览器并继续占用 pids / 对 relay 运行脚本；此前清理失败只写入会被成功路径丢弃的 `viewportDiagnostics`，执行记录完全不可见（fail-open）。不变量：任何 earlier 视口页面未被证明关闭之前，不得启动下一个视口 |
| `src/core/verification-lifecycle.mjs` | `scope.fail` 增加 `terminal` 选项：视口自身收尾阶段的失败不标 `late`；终端 first-error 直发 progress 时携带 `checkId` | 清理失败是视口的终结状态，不是“跨视口存活的迟到工作”，不能误标 late；事件必须可按 checkId 归属 |
| `src/core/candidate-verification-runner.mjs` | `browser.close()` 失败（成功路径）写 `browser-close-failed` progress 事件并以 exit 3 结束 | 病态运行不得报成功 |
| `src/core/verification-runner.ts` | finally 中 `stopCandidateBaseline` 失败不再直接抛出：运行已失败时追加到原失败消息（不掩盖原始诊断）；运行成功时以清理失败收尾（fail-closed） | 清理失败此前会覆盖原始验证失败，丢失失败归因 |

有意不改（首两轮）：`unsettled > 0`（无页面泄漏的悬挂 promise）保持仅诊断——每个探测对使用独立浏览器上下文，悬挂 promise 不再持有任何页面或可观察通道；`closePreviewResources` 在容器删除失败时不释放网络池，记录为审查发现（见第 5 节），不在本阶段扩大范围。

> 修订（2026-10-21 独立交付审查轮）：清理失败的首版语义为"单视口 failed-to-run、运行继续"。审查判定其违反"cleanup 未完成不得启动下一视口"的不变量，已按 P1 修正为"立即中止运行"（`RunnerAborted`，后续视口不启动）。测试与本记录已同步更新。
>
> 修订三（2026-10-21 最终审查回流）：审查在实际代码中复现"迟到 newPage 跨过 cleanup grace"——`scope.close()` 返回时 `pending` 非空（unsettled≥1）而 closeFailures/pagesLeaked 均为 0，迟到页面的关闭失败不会回写已返回的 summary。据此废止上文"unsettled 仅诊断"的决定，理由：被页面关闭可靠取消的 promise 会 reject 即在宽限内 settle，宽限后仍 pending 者没有任何安全取消证明，仍可能创建页面、运行或修改运行状态。修复：`verification-execution.mjs` 的 cleanup 中止条件扩为 `closeFailures > 0 || pagesLeaked > 0 || unsettled > 0`。同时修复"最终 browser.close 失败后残留 execution.json"：新建 `verification-publish.mjs` 发布门，先 `runVerification()`，再带 3 s 截止关闭浏览器（失败即抛、completed 记录不落盘并先发出 `browser-close-failed` progress 事件），成功才以临时文件 + 硬链接原子发布且拒绝覆盖；入口 catch 增加防御性 `rmSync(outputPath)`，finally 对幂等的 `browser.close()` 再关一次并吞错。预算与 reserve 边界不变。详见 §3 修订三新增负例。

## 3. 确定性负例（新增测试）

`verification-execution.test.ts`（真实 Chromium + 仪器化浏览器，方法级故障注入）：

1. 单视口（tablet）全部页面 `close` 拒绝 → 运行在该视口后**立即中止**：`RunnerAborted`（completed:false），`notStarted: ['mobile-375','mobile-390']`，仅 desktop/tablet 发出过 check-complete（断言清单逐条相等），first-error 归属本视口 phase=`close-page`，无 `execution.json`，伪装成 v4 且身份匹配的 completed:false 记录仍被 attestation 拒绝，泄漏页面确实仍存活。
2. 单视口 `close` 永不结算 → 命中 5 s 关闭截止计入 `closeFailures`，悬挂 promise 在宽限排空后如实报 `unsettled`，随后同样中止于该视口。
3. 全部视口 `close` 拒绝 → 第一个视口即中止，`notStarted` 为其余三个视口。

`verification-lifecycle.test.ts`（确定性 fake，无浏览器）：拒绝的关闭与悬挂的关闭分别计数，`pagesLeaked` 不重复计数，悬挂关闭在宽限后保持 `unsettled`。

修订三新增（2026-10-21 最终审查回流）：

`verification-lifecycle.test.ts`：

1. newPage 未解析时 `close({graceMs:50})` 返回 → summary `closeFailures:0, pagesLeaked:0, unsettled:1`（无泄漏计数但 pending 仍可创建页面）。
2. close 返回后迟到页面到达且其 `close()` 拒绝 → 已返回 summary 不变，但 scope 计数器随后增长（二次 close 观察到 `closeFailures:1`），证明迟到失败不被静默丢弃、而其"已判定安全后不计入"的窗口由执行器的 unsettled 中止堵死。
3. 迟到页面 `close()` 永久挂起 → 命中 200 ms 关闭截止计入 `closeFailures:1`，底层 promise 永不 settle 保持 `unsettled` 可见。

`verification-execution.test.ts`（真实 Chromium，断言 RunnerAborted、notStarted、check-complete 清单、无 execution.json）：

4. `aborts the run when a newPage() promise outlives the cleanup grace`：tablet 首个 candidate newPage 延迟 7.5 s（open 截止 1 s），5 s 清理宽限后仍 pending → 中止；summary 当时 `pagesLeaked:0, closeFailures:0, unsettled:1`；`endedBy.message` 含 unsettled。
5. `aborts the run when a timed-out task keeps running past the cleanup grace`：candidate products 标记探针被替换为不受页面关闭影响的永不结算 promise，task deadline 2 s 已判超时，但底层工作宽限后仍运行 → 中止；summary `pagesLeaked:0, closeFailures:0, unsettled:1`，firstError 为 `DeadlineError`（phase `scope-probe`，inFlight 指向 `scope-marker`）。

`verification-publish.test.ts`（新增文件，@vitest-environment node，假浏览器，全部本地可跑）：

6. close 成功 → 顺序为 verify→close，记录发布且返回 summary，目录无残留临时文件。
7. close 拒绝 → 抛原错误，`execution.json` 不存在，目录为空，`browser-close-failed` progress 事件先于诊断写入。
8. close 挂起超截止（50 ms 加速）→ 同上，不依赖退出码。
9. runVerification 先抛（RunnerAborted 模拟）→ 传播的是**同一个**原始错误对象，close 未被调用（首个错误不被覆盖）。
10. outputPath 已存在 → 拒绝覆盖，原文件内容不变。

## 4. 失败诊断与 Receipt 门控核查结论

- `execution.json`（completed:true 才可）与 `failed-to-run.json` / `runner-diagnostic.json`（completed:false）分离，入口与宿主均双写保护；宿主逐字段校验 manifest v4 绑定（候选/Scope/补丁/树/运行时/视口计划/资源快照）。
- `validateRunRecord` 拒绝 `completed !== true`（含伪装成 v4 且身份匹配的 completed:false 记录，已有测试锁定）；`buildFailedToRunDiagnostic` 强制 `completed:false` 并把 runner 诊断降级为纯数据。
- 部分覆盖的 completed 记录可 attestation（它是真实证据），但 `registerVerification` 对 failed-to-run/unknown/risk 一律不给 `passed`，Approval 无法形成。门控链条完整，未发现缺口。

## 5. 审查发现（供独立复核）

- F1（记录，不改）：`candidate-preview.ts` `closePreviewResources` 在 `removeContainer` 失败时网络池不释放、注册表保留不一致条目；调用方会收到抛出，属保守的 fail-closed，但长期运行可能耗尽网络池。
- F2（记录，不改）：执行器成功路径下 `viewportDiagnostics`（含 lifecycle）在容器内计算后随进程丢弃；清理失败现已上提为 first-error / endedBy，其余计数仅在 progress.jsonl 可见（成功时宿主不读取）。若 Run #12 需要每视口 cgroup/lifecycle 数据，需在入口把摘要写入 execution.json 之外的工件。
- F3：容器入口 `browser.close` 失败路径（exit 3）本地无法执行（依赖 `/ripple/node_modules` 容器布局），仅语法检查与人工走查；Docker E2E / CI 状态 NOT RUN。
- 修订三回答（2026-10-21 最终审查回流的四项风险复核，均只记录、不在本轮扩大改动）：
  - 网络池（F1 关联）：`closePreviewResources` 容器删除失败不释放网络池，保守 fail-closed，长期运行可能耗尽池、影响后续 Run；维持记录。
  - cgroup 导出（F2 关联）：`viewport-lifecycle` 事件（含 cgroup 摘要）逐行写入容器内 `progress.jsonl`；宿主侧 `exportRunDiagnostics` 仅在 `RIPPLE_BROWSER_ARTIFACT_DIR` 设置时把 progress.jsonl 拷入导出根（成功与失败路径均在 docker 包装层执行），故原始 cgroup 进度可从最终工件导出；但成功路径宿主不**读取**逐视口计数。Run #12 若需逐视口 cgroup/lifecycle 数据用于判断，建议入口额外落盘，本轮不改。
  - browser-close-failed 持久化：重排后 close 失败由发布门抛给入口 catch → `runner-diagnostic.json`（completed:false）+ `runner-failed` progress 事件；发布门在抛出前另写 `browser-close-failed` progress 事件，finally 的二次关闭若再失败同样记录。宿主见 docker 非零退出 → failed-to-run。可持久化，不依赖退出码单独成立。
  - firstError 保留：`scope.fail` 只记首个 firstError（verification-lifecycle.mjs），cleanup 类失败通过 `terminal:true` 直发 progress 但不覆盖已记录的 firstError；发布门在 runVerification 抛错时不执行 close、原错误对象原样传播，均有测试锁定。

## 6. 本地验证结果（Windows 10，Node 24.21.0，真实 Chromium）

- `npm run typecheck`：通过。
- `npm run build`：通过。
- `npm run acceptance:runtime-node`：通过。
- `verification-execution.test.ts`：18/18 通过（原 15 + 新 3，约 181 s）。
- `verification-lifecycle.test.ts` 7/7、`verification-runner-failure.test.ts` 3/3、`browser-error-accumulator.test.ts` 4/4、`session.test.ts` 25/25、`scope.test.ts` 8/8、`verification-contract.test.ts` 5/5：通过。
- 基线即失败的 Windows 环境项（非本次回归）：`preview-resource-policy.test.ts` 2 项（临时目录 rmSync EPERM）、`local-project-api.test.ts` 7 项与 `project.test.ts`（临时目录 git 操作挂起/权限），与 10a808b 基线表现一致，记为环境限制。

## 7. 与任务描述的偏差

无功能性偏差。补充说明：预期基线 commit 信息为 “test(e2e): recover baseline hydration after observed network-change failure”，ERR_NETWORK_CHANGED 重试边界属阶段三审查项，本阶段未触碰。
