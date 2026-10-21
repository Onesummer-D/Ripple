# Run #12 前置工程修复 · 阶段三审查记录（P2 审查与最终交付）

日期：2026-10-21（Asia/Shanghai）
性质：**开发者自检 / 内部复核**。独立审查、GitHub CI、私有 Bolt 真实验收与 Run #12：NOT RUN。

## 1. 资源快照缺失时的断言（已修复，commit `05c0851`）

- 审查结论：缺失资源被请求时，runner 记 blocked-* 浏览器错误 → browser-errors 为 RISK，receipt 另拒绝“PASS 含 blocked URL”，链路完整。
- 确认的缺口：页面**未**请求缺失资源时，无 blocked、无错误，browser-errors 会随全视口通过而 PASS——资源降级的运行声称了干净的浏览器运行。
- 修复：移植 DEV_HANDOFF 0.6 指定的 PR #10 单行语义——`unavailableResources` 非空时 browser-errors 一律 RISK 并在 detail 中点名降级。未改任何冻结契约字段（manifest v4 结构不变，仅断言结果语义）。
- 测试：新增确定性执行器用例（运行完成、证据诚实、browser-errors 为 RISK 且点名降级、无迟到事件、页面账目干净）。19/19 通过。

## 2. ERR_NETWORK_CHANGED 重试边界（审查结论：无确认问题，不改）

两处恢复路径均为**有界单次重试、前置门控、失败闭合**：

- `e2e/page-override-lifecycle.spec.ts` `loadBaselineHome`：仅当观测到 `net::ERR_NETWORK_CHANGED` 的 requestfailed 时重试一次；第二次必须出现 Home 标题，否则 expect 抛出；监听器 finally 移除；重试不再计数（第三次不可能）。
- `e2e/project-workbench.spec.ts`：恢复前对**同一 relay** 逐路径探测必须全部 200，否则禁止 reload；reload 后页脚必须可见且不得出现新的失败请求；恢复证据写入 `bolt-resource-load-audit.json`；失败时附 Vite 转换诊断、浏览器错误、relay 账本与容器日志。

记录发现 F4（不改）：`loadBaselineHome` 的恢复只覆盖“文档加载成功但标题未出现”分支；文档请求本身被 ERR_NETWORK_CHANGED 打挂时 `goto` 直接拒绝、不重试。结果仍是 fail-closed（测试失败），属测试路径的健壮性而非产品缺陷；修改无法本地执行的 Docker E2E 收益不足，留待独立审查与 CI 证据决定。

## 3. 回归与自检

- `npm run typecheck`：通过。`npm run build`：通过。`npm run acceptance:runtime-node`：通过。
- 本环境可运行测试全绿：verification-execution 19/19、lifecycle 7/7、failure-diagnostics 3/3、error-accumulator 4/4、session 25/25、scope 8/8、verification-contract 5/5、bolt-workflow 7/7、candidate-preview 27/27、preview-resource-snapshot 20+1 跳过、page-overrides 2/2、project-config-resolver 4/4、project-viewports 1/1（合计 131 通过、2 跳过）。
- 基线即失败的 Windows 环境项（非回归）：preview-resource-policy 2 项（临时目录 rmSync EPERM）、local-project-api 7 项、project（临时目录 git 挂起）——与基线表现一致，记为环境限制。
- Docker Playwright E2E（含 project-workbench 合成闭环）：**NOT RUN**（本机无 Docker）。
- 阶段一性能结论未被本阶段改动影响（仅断言求值多一次数组长度判断）。

## 5. 独立交付审查轮修订（2026-10-21 晚间）

- **P1 修正**：cleanup 失败语义由"单视口 failed-to-run、运行继续"改为"cleanup 未完成即中止运行"——`RunnerAborted` 在主循环内抛出，后续视口不启动。三个 close 类负例已改写并断言 `notStarted`、check-complete 清单与 completed:false 拒绝；执行器测试 19/19 通过（全量回归 124 s）。
- 交付物与最终补丁文件清单以 `RIPPLE_A_HANDOFF.md` 与 `delivery/verify.log` 为准（此前报告中的文件数表述有误，更正：最终补丁为 10 个文件 = 4 源码 + 2 测试 + 3 份阶段记录 + 1 份交接文档，见交付清单）。

## 6. 最终审查回流修订（2026-10-21 夜间，第三轮）

阻断项两项，均已修复并新增确定性负例（详见阶段一记录 §2/§3 修订三）：

- **P1 迟到 newPage 跨过 cleanup grace**：cleanup 中止条件扩为 `closeFailures > 0 || pagesLeaked > 0 || unsettled > 0`。宽限后仍 pending 的 promise 没有安全取消证明（被页面关闭可靠取消者会 reject 并在宽限内 settle），可能创建页面、运行或修改运行状态，一律 fail-closed。既有"继续运行"语义不受影响：`run-slow-open` 的慢 newPage 在 5 s 宽限内 settle（unsettled 0），hung 探针被页面关闭取消（grace 内 settle），均回归锁定。
- **P1 最终 browser.close 失败后残留 execution.json**：新建 `verification-publish.mjs` 发布门（先验证 → 3 s 截止关闭浏览器 → 失败即抛且 completed 记录不落盘 → 原子硬链接发布且拒绝覆盖）；入口 catch 防御性 `rmSync`，finally 二次关闭吞错。不依赖进程退出码保证文件不被误用。总预算与 reserve（≤3 s browser close 本就在 reserve 内）不变。
- 回归：verification-execution 21/21（约 138 s）、lifecycle 9/9、publish 5/5、contract 5/5、runner-failure 3/3，typecheck / build 通过。
- 文件清单更正：最终补丁 12 个文件 = 5 源码 + 3 测试 + 3 份阶段记录 + 1 份交接文档（新增 `verification-publish.mjs` 与 `verification-publish.test.ts`）。
- 性能结论维持保守口径，本轮改动不影响阶段二结论（发布门只是把 execution.json 的写入从"browser.close 之前"移到"之后"，JSON 序列化与硬链接为毫秒级，且发生在 reserve 内的 cleanup 时段）。

## 4. 交付验证（补丁完整性）

- 补丁基线：本地导入提交 `680098f`（== GitHub 10a808b 字节树）。
- 导出：`git diff --binary 680098f..HEAD`（含新增/删除/二进制，文本补丁二进制安全）。
- 在未改动的原始源码副本上验证：补丁完整应用（`git apply --check` 与应用均通过），应用后文件树与最终源码逐文件一致（diff -r 无差异）。
- 补丁内容核验：不含 node_modules、.env、凭据或临时调试文件；新增文件（两份审查记录）包含在交付内；本阶段无删除或二进制文件变更。
- 详见交付目录 `A_workspace/delivery/` 中的验证日志。
