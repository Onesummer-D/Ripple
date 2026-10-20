# Ripple 跨 Agent 开发交接（A 主线）

## 接班最新核查（2026-10-20，A 交给下一位 Agent）

**请优先阅读本节；后面的“前次独立审查记录”保留历史证据，涉及旧 SHA 的状态以本节为准。** 本次审查以 GitHub 远端代码、PR、Actions 和前任 Codex 留下的工作区说明为基础；**并没有直接读取前任本地未提交 Diff**。本文写入后分支 HEAD 会再前进一次，旧 SHA 是业务/文档对照点，不是写入后的 HEAD。

### 远端精确状态

| 事项 | 已核查结论 |
| --- | --- |
| A PR #2 | `feat/project-first-core-20261018`，交接前 HEAD `5cb8c743f76d22cda56ffe33d7653c491492b05c`；[CI #257 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39410503809)。从 `6b63f9455164e157b28269f75ef072c298fac69e` 至今**所有 A 远端新提交均只改本文档**，无新的已推送业务代码。 |
| A 真实项目验收 | 最近一次仍为 [Bolt Run #6](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574)，`6b63f94`，失败于预览 iframe 后续模块请求 `net::ERR_NETWORK_CHANGED` / Footer 90 秒等待；Run #6 的 Docker/Playwright 镜像预热、Tailwind 解析、Vite 启动成功。尚无真实 TEXT 全链路通过证据。 |
| B PR #7 | `feat/b-media-executor-20261019` @ `caeeb2224e83ce7a0545a70737367ed76138b218`；[CI #256 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39409500518)。新增来源探针 `scripts/debug-qingye-impact.ts`，确认商品图经过动态筛选时不能静态证明全链路，于是在 `scripts/media-qingye-acceptance.ts` 改选能够证明到商品页的分类图，并记录 certainty/unresolved；新增离线图片测试入口和浏览器 channel 调试选项。它**仍不是私有青野真实 MEDIA 工作流成功**。 |
| B PR #4 | 来源分析 `137ff5444895a4ec906c13e25d2168581afab7a5`，此前 CI 通过；尚未与 A 最新公共基线做完整集成验收。 |
| B 新 PR #8 | [启用 MEDIA 真实工作流入口](https://github.com/Onesummer-D/Ripple/pull/8)，HEAD `1576b54cdd865b94dc310b13a1ece26aaecd9dfa`，目标 main，当前**OPEN、未合并**，只增加 `.github/workflows/media-acceptance.yml`；需负责人先审查批准。未查到可宣称成功的 MEDIA workflow_dispatch 运行。 |
| A 当前工程能力 | 已推送的公共 Candidate executor/Scope/Verification/Apply-Rollback 和合成工程测试通过；TEXT 真实 Bolt 未通过；TOKEN 执行器、AI 意图校准、复杂运行时实例、完整视觉验证等仍需 A 开发。正式 UI/UX 暂缓。 |

### **最高优先级：前任本地未交付代码（不要误丢弃）**

前任 Codex 在本文第 8 节明确报告，在 Windows checkout `ripple-pr2-bolt-run6` 有**未提交且未推送**的业务实验：

1. `src/app/ProjectWorkbench.tsx`：原工程/候选 iframe 的“重新加载预演”，重载清空 selection，增加异步旧 iframe 来源响应的身份守卫。
2. `e2e/project-workbench.spec.ts`：合成工程预演重建测试，以及 Bolt E2E 中在 `ERR_NETWORK_CHANGED` 且原 relay 对失败模块确认为 HTTP 200 的情况下才允许一次 reload 恢复；不放宽后续 Footer、Scope、Evidence 检查。
3. `tsconfig.node.tsbuildinfo`：构建副产物，**不要当成目标代码提交**。

**这些本地改动并非 GitHub PR #2 的内容，不能假定新 Agent clone 后存在。** 本次只能看到前任写下的说明，未复核工作区现状，亦未检查本地实际 Diff。旧 worktree、忽略目录 trace、暂停 UI ref 见第 8 节；禁止 `git reset --hard`、`git clean -fd`、强推、误合并或删除这些资产。

接班人必须先确认其工作环境：

- **有权限访问原 checkout**：先记录 `git status --short`、`git rev-parse HEAD`、`git diff --stat`、两份源码的完整 diff；对差异先审查旧 iframe 异步请求、重载重入、选择状态过期、网络瞬断恢复范围及相关负例。以单独分支/补丁安全保存并提交；对照远端 PR #2 最新 HEAD，避免用旧本地文档历史覆盖新的远端文档。
- **不能访问原 checkout**：要求负责人/原机器通过安全方式提供两份未提交源码的 patch 或文件，**不要**宣称已恢复；若确实取不到，明确记录“旧本地实验未迁移”，并基于远端 `6b63f94` 的代码重新做诊断、实现和测试。
- 旧本地实验测试只包含部分受限 Windows 测试，且晚于测试又改过源码。不得把它列为 Linux CI 已通过或 Bolt 修复完成。

### 当前代码审查与协作风险

- **A 业务代码审查**：本次对比 `d2a429a → 5cb8c74` 的远端提交只改变 `DEV_HANDOFF.md`，无法对两份本地实验进行实际代码级质量认证。A 新近通过的 CI 也没有覆盖这些未提交改动。
- **B PR #7 当前仍有 P1（已核对最新 `caeeb22` 源码）**：`scripts/media-qingye-acceptance.ts` 中 `trustedRun()` 的七个 assertion 直接设为 `pass`，`interactionObservations` 为空，`baselineComparisons` 对基线与候选用同一个链接工件摘要。A `src/core/verification-receipt.ts` 会检查真实基线快照、交互观察和 evidence 对应版本；该验收脚本**按当前写法无法被视为统一 Receipt 的真实通过**。此外动态选择媒体节点应在 Scope 前核实要求的 `source-proven` 级别，不能把 `partial`/未解析关系默默升级；不应以 CI #256 代替私有 MEDIA 验收。**B 负责修复**，A 不能放宽通用门控来适配假 PASS。
- **B 其他 P2**：`currentSrc.includes(assetRef)` 子串匹配、`object-position` 的像素对齐、四视口截图证据哈希/文件映射仍需 B 的实际负例与浏览器复核，不能直接宣称成熟完整。
- **PR #8** 需在 main 暴露 workflow_dispatch 入口才能顺利从 GUI 调度，但它尚待审核；不要未经负责人批准合并。它只有 Workflow 文件，不代表 MEDIA 验收代码已经进入 main。
- PR #2、#4、#7 均属于 Draft/未合并开发线，不得让新 Agent 为了迅速开始而直接从 main 重建或将 B 的专项模块复制到 A 分支。公共接口确需变更时通过 Issue #6 协调。

### 接班人接下来的实际执行顺序

1. **先救未推送的本地成果（如果可访问）**：核对并保存两份代码的 diff，评估重载恢复能否安全迁移到 A 正式分支。不能访问就明确告知并选择复现/重做，不要等待无限期权限。
2. **完成 Run #6 根因分析及最小修复**：重点检查 iframe→relay/Vite 资源请求、Docker/服务生命周期、浏览器导航重载时序。重载可作为受控恢复手段，但不能把“重试偶尔通过”视为根因消失；必须补确定性回归、资源身份/旧回调作废、失败分类和清理负例。
3. 运行 `npm run typecheck`、`npm test -- --run`、`npm run build`、相关 `npm run test:browser`、Docker 受限回归和独立审查；推送到 A 独立 PR #2 分支并记录新业务 SHA。使用 [Bolt workflow](.github/workflows/bolt-acceptance.yml) 固定提交手动验证，一轮轮依据日志推进，**不凭旧 CI 说真实 Bolt 成功**。
4. Bolt TEXT 完整 `SourceGraph → Scope → Candidate → 四视口 Evidence → Approval → Apply → Rollback` 通过后，按第 5 节研发运行时精准关联、CSS TOKEN、AI 意图校准、通用视觉 Evidence、长期维护和第三方公共接口。
5. 更新本 handoff 的 SHA、Run、剩余风险、未提交状态；不要重写整篇设计文档。**本轮正式 UI/UX 仍然暂停，B 的 MEDIA/第三方主责不变。**

---

## 00. 本轮接班（2026-10-20 晚，新 Agent 接管，基线 `8ee5408`）

本节只记录本轮**实际做过的事、实际跑过的证据、以及仍然未证明的部分**。前面的核查与历史审查记录保持不动。

### 00.1 前任未提交资产：已取得、已审查、已并入

`ripple-pr2-bolt-run6` 工作区可访问，前任两项未提交业务修改**已完整取得并安全保存**（仓库外副本：`_handoff_assets/codex-uncommitted/20261020/`，含 `codex-local-uncommitted.diff` 与两份源文件快照）。审查结论：

| 资产 | 审查结论 |
| --- | --- |
| `src/app/ProjectWorkbench.tsx` | 「重新加载预演」按钮 + 重载清空 selection + **异步来源响应的 iframe 身份守卫**（`frameRef.current?.contentWindow !== event.source`）。守卫方向正确：它挡住了「旧 iframe 的 post 请求在重载后才返回、把过期 selection 写回新帧」。**已保留并加固**，见 00.3。 |
| `e2e/project-workbench.spec.ts` | 合成场景的 iframe 重建断言（旧帧 `isConnected === false`）；Bolt 场景在 `ERR_NETWORK_CHANGED` **且** relay 对失败路径逐项返回 200 时才允许一次 reload。条件约束合理，**已保留**。 |
| `tsconfig.node.tsbuildinfo` | 构建副产物，**不提交**。 |

另发现并取回一份**从未推送**的历史成果：`ripple-app` @ `44c396b`（基于 `9af557c`，非本分支），含 `PreviewRelayAccounting` 台账、`readProjectSourcePreviewDiagnostics` 与 `GET /__ripple/api/project/preview/report`。它不在远端，已移植到当前基线与本轮改动合并。

### 00.2 Run #6 根因：已证明的部分与未证明的部分

解析本机 Run #6 trace（`1-trace.network`，44 条记录）得到**请求级时序**，这是本节所有结论的依据：

~~~text
02:23:47.643   200  322ms  GET 127:45195/
02:23:48.008   200  115ms  GET 127:45195/src/main.tsx
02:23:48.150   200  ...    GET 127:45195/@fs/.../react*.js   （3 个，均 200）
02:23:48.150   200  195ms  GET 127:45195/src/App.tsx
02:23:48.150   200  438ms  GET 127:45195/src/index.css
02:23:48.216   200  473ms  GET 127:45195/@fs/.../chunk-3IBZQ52V.js
02:23:48.316   200  388ms  GET 127:45195/@fs/.../chunk-ZNGF2DDG.js
02:23:48.346    -1  338ms  GET 127:45195/src/pages/AutumnPage.tsx    ✗ ERR_NETWORK_CHANGED
02:23:48.346    -1  339ms  GET 127:45195/src/pages/ProductsPage.tsx  ✗
02:23:48.346    -1  340ms  GET 127:45195/src/pages/StoryPage.tsx     ✗
02:23:48.346   200  355ms  GET 127:45195/@id/__x00__ripple:identity  ✓
02:23:48.346   200  358ms  GET 127:45195/src/components/Navigation.tsx ✓
02:23:48.346   200  358ms  GET 127:45195/src/components/Footer.tsx    ✓
02:23:48.346   200  363ms  GET 127:45195/src/pages/HomePage.tsx       ✓
02:23:48.593    -1   96ms  GET 127:45195/@vite/client                 ✗
（此后约 88 秒零网络活动）
~~~

**已由 trace 证明：**

1. 失败是**浏览器侧**错误，不是 Vite/PostCSS/Tailwind 转换失败——容器日志只有 5 行启动信息，无转换错误，且同批 4 个请求正常返回。
2. `02:23:48.346` 同时发出的 7 个请求**出现干净分裂**：已分到 socket 的 4 个成功（355–363 ms），仍在 Chromium 每主机 socket 池里**排队**的 3 个全部失败（338–340 ms）。这正是 Chromium 网络变更时 `FlushSocketPoolsWithError(ERR_NETWORK_CHANGED)` 的行为特征——只冲掉排队中的 connect job，已建立的连接不受影响。
3. `/@vite/client` 失败导致 ES module 图整体中断（Vite 会给每个转换后的模块注入对它的 import），React 因此从未挂载，`footer` 不存在；之后 88 秒无重试、无恢复。
4. 上一节记载的「失败在浏览器 ↔ 宿主转发器传输层」判断与本轮时序一致。

**尚未证明（不得宣称已定位）：** 触发这次网络变更通知的**具体来源**。本机无 Docker、WSL 被安全策略拦截，**无法复现 Docker 预演路径**。最可能的候选是容器/网络生命周期产生的 netlink 接口与地址事件——`docker run --detach` 在创建容器后立即返回，bridge 端点、veth 与 IP 是异步附着的，而旧的就绪判定只证明「Vite 回答过一次 200」，**没有证明容器网络命名空间已稳定**。这一点只能由下一轮真实 Bolt 运行依据 relay 台账判定。

### 00.3 本轮改动（通用修复，非放宽断言）

未增大超时、未忽略浏览器错误、未关闭隔离、未为 Bolt 仓库写特判；Footer 与后续 Scope/Evidence/Approval/Apply/Rollback 检查全部保持原样。

1. **`src/core/candidate-preview.ts` — 就绪判定改为「观测到稳定」**：新增 `waitForPreviewReadiness`。它在首次 200 之后，要求**连续 N 次检查得到同一 IPv4 且端点探测成功**才把预览 URL 交给浏览器；地址变更或探测失败会**重置计数**——这正是要检测的那一类不稳定。原先「一次 200 即放行」无法区分「服务已就绪」与「网络仍在收敛」。
2. **`src/core/candidate-preview.ts` — 消除上游连接风暴**：relay 过去对上游固定发送 `connection: close`，16 个模块请求就是 16 次 TCP 握手，显著延长浏览器 socket 池被占满、请求排队的时间窗。改为按 relay 生命周期管理的 keep-alive agent（上限 8 socket），并在响应中断时销毁上游，避免半截响应污染连接池。
3. **`src/core/candidate-preview.ts` — 预演网络改为一次性建池复用**：原先每个预演都 `docker network create` / `docker network rm`，容器每次启动与清理都会改动宿主网络配置。现在改为一次性建池、用完归还，池建好后不再扩容——**网络只在容器启动之前创建，绝不会在页面加载期间新建**。Vite 插件在服务启动时预热池；`acquirePreviewNetwork()` 保留惰性兜底，供直接 import 本模块的入口（E2E helper）使用，此时创建同样发生在容器启动与 URL 下发之前。

   > **本轮自查出的回归（已修）**：初版把惰性兜底整个删掉，导致直接 import 本模块的 `e2e/page-override-lifecycle.spec.ts` 拿不到网络池而失败（CI #39424007567 `test:browser` 1 failed）。已修正并重新验证。
4. **`src/core/candidate-preview.ts` — relay 台账**（移植自 `44c396b`）：`PreviewRelayAccounting` 区分 `completed / denied / client-aborted / upstream-failed`，并单独报告 **unsettled**。这是下一轮判定「浏览器放弃请求」还是「预演侧失败」的决定性依据；新增 `readProjectSourcePreviewDiagnostics` 与只读端点 `GET /__ripple/api/project/preview/report`。

   > **判读口径更正（本轮独立审查发现，已修）**：初版把 `unsettled` 描述成「浏览器从没拿到响应」的那一类，这是**错的**。台账把 `client-aborted` 计入已结算，而浏览器中止时 relay 的 socket 依然会关闭并落入 `client-aborted`——也就是说 `ERR_NETWORK_CHANGED` 那批排队请求记的是 `client-aborted`，**不会**出现在 `unsettled` 里。`unsettled = started − 已结算` 衡量的是「接受了请求但从未产生任何终止事件」，非 0 反而指向缺了记账钩子或快照是在请求仍在途中取的。因此 Run #7 的**主判读字段是 `client-aborted`**，`unsettled` 只作为记账完整性的旁证。相关 docstring 已按此更正。
5. **`src/app/ProjectWorkbench.tsx` — 补上前任守卫的空窗**：前任用 `frameRef.current` 比对，但「点击重载 → React 提交重挂载」之间 ref 仍指向旧帧，此窗口内的返回会被误接受。新增 `previewGeneration` 计数器，在点击处理器里**同步递增**，并在预演被替换时递增，任一代次变化即在异步返回处丢弃。
6. **`e2e/project-workbench.spec.ts`**：失败信息附加 relay report；保留前任的受条件约束恢复逻辑，恢复事实写入 `sourcePreviewRecovery` 证据字段。

**reload 的定位（明确写入，避免误读）**：重新加载是**受条件约束的恢复手段**，仅在 relay 能逐项证明失败模块仍可服务时允许一次；它**不能替代根因诊断**，出现即记录进证据，下一轮不得因「重载后通过了」就认定根因消失。

### 00.4 本轮验证结果（区分证据等级）

Linux CI（[run #39425031601](https://github.com/Onesummer-D/Ripple/actions/runs/39425031601)，提交 `4bc58f9`）**全绿**：

| 步骤 | 结果 |
| --- | --- |
| `npm run typecheck`（app + node，含 e2e） | **通过** |
| `npm test -- --run` | **29 文件 / 174 passed**（基线 162，本轮新增 12） |
| `npm run build`（tsc -b + vite build） | **通过** |
| Docker 运行时准备、受限浏览器烟测 | **通过** |
| `npm run test:browser` | **10 passed / 1 skipped**（skipped 的是需要私有 Secret 的 Bolt 专项） |
| 其中回归项 `page-override-lifecycle.spec.ts:350` | **通过（1.1m）** |

本机（Windows）`local-project-api.test.ts` 有 4 个 30s 超时（`analyze` 路径），与上一轮记载的本机环境性超时一致；**Linux CI 全量 174 passed 已排除本轮引入问题**，本机结果不作为依据。

**仍然没有的证据**：真实 Bolt 验收（Run #7 及以后）、多视口 Evidence → Approval → Apply → Rollback 的真实工程闭环。这两项还没做，不能由 CI 全绿推断。

### 00.5 本轮环境事故（必须记录，影响后续操作）

执行 `git stash push` 时进程被 SIGTERM，**`.git/refs/` 目录被删除、原 packfile 被销毁**（自动 repack 未完成）。已恢复，无工作成果丢失：

- 工作区源码全量快照：`_handoff_assets/worktree-snapshot-20261020/`（210 文件）。
- 对象库由 `git fetch` 重建；分支 `feat/project-first-core-20261018` 重建于远端交接提交 **`8ee5408`**，`DEV_HANDOFF.md` 取远端权威版本（本地 533ef06 版为旧版，已弃用）。
- 本地提交 `41299c4` / `533ef06` 的**对象**已丢失，但两者**文件内容**都在工作区与快照中：`533ef06` 的网络池修复已在工作区，`41299c4`/`14f256a` 只改本文档。
- **结论：本环境禁止使用 `git stash`；带斜杠的分支名（`refs/heads/feat/...`）写入会被阻断**，分支 ref 现由 `.git/packed-refs` 承载，提交前需确认 HEAD 可解析。

### 00.7 独立交叉审查（两个视角，各自独立执行）

审查者未参与本轮改动，只拿到 diff 与仓库上下文。分「代码正确性」与「反模式红线合规」两个视角进行。

#### 视角一：代码正确性

| 等级 | 问题 | 处置 |
| --- | --- | --- |
| P1 | **非 Linux 主机收到误导性报错**：`preparePreviewNetworkPool` 在非 linux 静默 return，`acquirePreviewNetwork` 随后抛「网络池为空，请确认 Docker 可用」，而真实原因是主机平台不受支持（真正的平台守卫在 `launchProjectContainer` 里，但它在 acquire 之后才执行）。**CI 跑在 Linux 上抓不到这条**，直接影响 Windows/macOS 本地开发。 | **已修**：抽出 `assertPreviewPlatform()`，在 `acquirePreviewNetwork` 与 `launchProjectContainer` 两处复用，非 Linux 现在直接给出正确的平台提示。 |
| P1 | **`unsettled` 语义误导**：台账把 `client-aborted` 计入已结算，而浏览器中止时 socket 仍会关闭并落进 `client-aborted`，故 `ERR_NETWORK_CHANGED` 那批请求**不会**出现在 `unsettled` 中；它非 0 反而指向缺记账钩子。 | **已修**：更正 `summarizePreviewRelayAccounting` docstring 与 00.3 第 4 条、00.6 第 3 条的判读口径，Run #7 主判读字段改为 `client-aborted`。 |
| P1 | **就绪门过度承诺**：`PreviewReadiness.settled: true` 的字面类型易被读成「已确认安全」，而它实际只观测容器侧 IP 稳定性，宿主侧网络变更事件与它的相关性仍是**未证实的假设**。 | **已修**：为该类型补显式说明——`settled` 意为「观测到稳定」而非「已证明安全」，说明它缩小暴露窗口、但不证明不会再有变更事件。 |
| P2 | `stopPreviewNetworkPool` 在网络仍有容器附着时 `network rm` 会抛非 not-found 错误，可能打断关闭流程。 | **未修（已记录）**：属关闭期健壮性，不影响本轮根因；列为下一轮待办，不在本轮扩大改动面。 |
| P2 | 两个新断言过松：「地址附着前的检查不计入」只断言 `inspections > 3`；「永不 settle」只匹配错误正则、不校验计数。 | **已修**：前者改为断言 `probeFailures=2 / stableInspections=3 / inspections=5`；后者捕获错误对象并断言消息携带「地址变更 N 次」「需要连续 3 次」等证据字段。 |
| P2 | events 环形缓冲上限 64，长会话可能丢失早期 `client-aborted` 明细。 | **未修（已记录）**：64 条对单次预演足够；若 Run #7 需要更长归因再调整。 |

**审查者确认无问题的部分**：错误路径（`launchProjectSourcePreview` 的 catch）确实调用 `closeHostRelay` 并销毁 agent，无泄漏；relay 用 per-relay keep-alive agent + `request.once('aborted') → upstream.destroy()` 避免半截连接还池；`settled` 守卫防 finish/close 双记，账目一致；就绪门有 `timeoutMs` 上界，探测重试有界，循环体抛错在前不产生悬挂定时器。**惰性兜底未抵消核心意图**——`acquirePreviewNetwork` 在容器启动前完整 await 建池，网络仍早于 URL 下发创建。

#### 视角二：反模式红线合规（负责人下达的四条禁令）

| 红线 | 结论 | 依据 |
| --- | --- | --- |
| 禁止**增大超时**换绿 | **合规** | e2e 的 `footer`/heading 断言维持 90s 未动；新增的 `waitForPreviewReadiness` 默认 `timeoutMs=30s`，是 URL 下发**之前**的 fail-fast 门槛，不是给页面加载更多时间。 |
| 禁止**忽略错误** | **合规** | relay 上游 `error` 由原先静默 502 改为 `settle('upstream-failed', 502, cause)` 并透出原因头；`probeEndpoint().catch(() => false)` 的作用是**重置稳定性计数**，属主动判定不稳定而非忽略。 |
| 禁止**降低验证强度** | **合规（实为加强）** | e2e 新增断言：旧帧 `isConnected === false`、重载后 src 一致、失败请求切片 `toEqual([])`；原 `footer.toBeVisible` 未被放宽。relay report 仅**附加**进失败信息，未替换断言。 |
| 禁止**为 Bolt 写特判** | **合规** | 本轮 diff 未引入任何 `BOLT`/`isCI`/`GITHUB_ACTIONS` 分支。检索到的 `process.env.CI` 分支均为既有逻辑，作用是「CI 下强制走 Docker-backed 路径否则 throw」，方向与开后门相反。`test.skip(!boltProjectRoot)` 是缺私有 Secret 时的合理跳过。 |
| **证据分级**是否诚实 | **合规** | 文档明确区分「已由 trace 证明」与「尚未证明的触发来源」，并写明「真实 Bolt 验收不能由 CI 全绿推断」。 |

**审查者提的唯一存疑（非违规）**：`requiredStableInspections=3` 与 `timeoutMs=30_000` 是工程经验值，注释给了方向性理由但无定量依据。这正是 Run #7 要回答的问题之一——若门槛过严会拖慢每次预演，过松则拦不住故障。

### 00.6 下一动作

1. ✅ 提交本轮改动（业务代码 + 交接文档），排除 `tsconfig.node.tsbuildinfo`（`ccc7dfc` → `4bc58f9` → `1ea7230`）。
2. ✅ 推送 `refs/heads/feat/project-first-core-20261018` 并取得 CI 通过（`4bc58f9` / `1ea7230` 两次运行全绿，见 00.4）。
3. **待负责人决策**：请**一次**手动 `workflow_dispatch` 触发 Bolt acceptance。Run #7 判读以 relay report 的 **`client-aborted`** 为主字段（理由见 00.3 第 4 条更正）：
   - `client-aborted > 0` 且失败模块集中在排队中的那批 → 支持「容器网络未稳定触发 Chromium 网络变更」假设；
   - `client-aborted = 0` 且 `upstream-failed > 0` → 假设不成立，问题在预演侧，需重新归因；
   - `client-aborted = 0` 且全部 `completed` 但页面仍未渲染 → 与网络无关，转向 React 挂载路径排查。
4. ✅ Docker/Playwright 回归（Linux CI 步骤 10–13）与独立交叉审查已完成，结果见 00.4 / 00.7。

---

## 0. 前次独立审查记录（2026-10-20 14:51，UTC+8）

> 以下审查针对当时 A `d8d8b18` / B `b7a0306`。当前 A 文档基线已到 `d2a429a`（CI #254 成功），B 已到 `caeeb22`（CI #256 成功）；下列 B 问题是否在新提交修复，尚未逐项复审，不能直接沿用为最新代码结论。

> 此节是接班人优先读取的最新核查。A 分支最新 *文档* HEAD 为 `d8d8b185f65da6eaefa7e0c9e9b70b0df80ef311`；**最近真正变更的 A 业务代码仍是 `6b63f9455164e157b28269f75ef072c298fac69e`**。本节提交将再次推动 PR #2 HEAD 前进，请以 GitHub 远端为准。本文保留此前交接记录中另一 Codex 工作区观察，但本次只直接核实 GitHub 远端，不独立确认本地 Windows 工作区状态。

- **A PR #2**：[最新文档提交 `d8d8b18`](https://github.com/Onesummer-D/Ripple/pull/2) 是在 `9af557c` 后两次 `DEV_HANDOFF.md` 的文档修订，**没有新业务代码**；[CI #253 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39378653088)。原业务代码 `6b63f94` 的 [CI #244 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39358087997)：162 单测、Playwright 10 通过/1 跳过。**Bolt Run #6 仍是最近一次真实 Bolt 工作流，失败**；不存在后续真实 Bolt 成功记录。
- **B PR #7** 最新 `b7a0306aec78b71a1146f3922b96d2ffca306d0b`，[CI #251 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39364483748)。B 已提交 `mediaAssetSwapExecutor` 无副作用 `plan`、内容寻址资产暂存、`media-viewport-evidence.ts`、`scripts/media-viewport-evidence.ts`、`scripts/media-qingye-acceptance.ts` 和 `.github/workflows/media-acceptance.yml`。来源分析 PR #4 仍 `137ff54`。**B 的工作流目前只在 Draft PR #7，未发现真实青野 MEDIA 的 Actions 成功运行；CI #251 不是这条私有项目专项验收。**
- **B 验证脚本 P1（静态源码审查，尚未实机运行新专项）：** `scripts/media-qingye-acceptance.ts` 的 `trustedRun()`（约第 78–133 行）把七个必需断言全部写为 `pass`，但 `interactionObservations: []`；其 `baselineComparisons` 以同一摘要填写基线和候选、对应工件只是 `media-evidence-link.json`，不是真正的前后快照。A 的 `verification-receipt.ts` 会要求交互 PASS 必须有实际观测，以及快照工件包含 `baselineSnapshot`/`candidateSnapshot` 和一致摘要；这些记录**按当前形态无法满足受信验收**。另外 Evidence 真实文件位于 `<workDir>/evidence/evidence.json`，当前声明相对验证运行目录的工件路径，需核对是否能被 receipt 正确定位。**禁止通过降低 A 的门控、手工伪造 manifest 或自动填 PASS 解决。** B 应将 Playwright 的真实原站/候选浏览器观测映射为合同允许的逐项结果，无法检查的保持 UNKNOWN/NOT_RUN；若 MEDIA 必须新增独立 assertion 类型，应与 A 提交最小明确接口和负例。
- **B 媒体证据其他待核查项（P2）：** `currentSrc.includes(assetRef)` 仅是子串命中，可能产生错误资源匹配；`computeCropGeometry` 的 CSS `object-position: 100px` 处理采用不符合实际 CSS 对齐语义的裁剪限制；四视口截图文件目前未逐一作为带 SHA 的来源证据登记。应补真实浏览器负例、资源 URL 规范化匹配、截图哈希与版本绑定后再宣称完整视觉证据。
- **A/B 集成风险：** A 当前核心是 `6b63f94`；B PR #7 以较旧 A 基线开发，未证明和 A 最新 HEAD 共同构建、统一 Verification/Approval 通过。先在独立集成分支安全复验再合并；不要直接合并 Draft PR，也不要让 A 替 B 重做 MEDIA。
- **当前 A 接班第一动作不变：** 核对 [Bolt Run #6](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574) 的 trace/日志，定位 `ERR_NETWORK_CHANGED` 的可复现根因。A 完成真实 TEXT 后继续运行时关联、TOKEN 执行、AI 意图校准与视觉 Evidence 等技术主线；**暂缓正式 UI/UX 重构**。A 可向 B 通报上述证据门控 P1，但不必因此等待 MEDIA 才能修 Bolt。

> **核查快照：2026-10-20（UTC+8）**。交接更新前 GitHub PR #2 HEAD 为 `d2a429a33bbeda4702e194eb4d3ab67b402dd88e`；从 `6b63f94` 至该 HEAD 仅更新本文，被 CI 验证的**业务代码基线**仍为 `6b63f9455164e157b28269f75ef072c298fac69e`。本次文档提交会使 HEAD 再次前进，最终 SHA 以 PR 最新提交为准。另有**未提交**的本地预演恢复实验，见第 8 节，不能算作远端能力。

## 1. 任务、分支与协作入口

| 项目 | 已核实状态 |
| --- | --- |
| 主仓库 | https://github.com/Onesummer-D/Ripple |
| A 负责内容 | Project-first 统一核心、TEXT 真实 Bolt 闭环、DOM/运行时来源与精确授权、TOKEN 执行器、AI 意图校准、通用浏览器 Evidence、公共运行适配 |
| A 开发分支 | `feat/project-first-core-20261018`，PR [#2](https://github.com/Onesummer-D/Ripple/pull/2)（Draft，**未合并**） |
| A 业务基线 | `6b63f9455164e157b28269f75ef072c298fac69e`；交接前 PR HEAD `d2a429a33bbeda4702e194eb4d3ab67b402dd88e`（业务基线之后仅文档） |
| A 常规 CI | [最新 CI #254 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39383267875)，对应 `d2a429a`。此前已逐项读取 [#253 日志](https://github.com/Onesummer-D/Ripple/actions/runs/39378653088)：29 测试文件、162 单测通过、typecheck/build 通过，Playwright 10 passed / 1 skipped / 0 failed（跳过的是真实 Bolt 专项）。新交接提交的 CI 须另核对，不能预先算通过 |
| 真实 Bolt | [Run #6 失败](https://github.com/Onesummer-D/Ripple/actions/runs/39358539574)，同一 A SHA，失败诊断见第 4 节 |
| B 契约对齐 | [PR #3](https://github.com/Onesummer-D/Ripple/pull/3) open，`8696612cf76d7b29fa19118af40efb8bf0d4ca37`；冻结最小 `ripple-edit-operation-session/v1`，不等于 MEDIA 执行器完成 |
| B 来源分析 | [PR #4](https://github.com/Onesummer-D/Ripple/pull/4) Draft，`feat/b-media-provenance-20261018` @ `137ff5444895a4ec906c13e25d2168581afab7a5`；[CI #232 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39249092355) |
| B MEDIA 执行器 | [PR #7](https://github.com/Onesummer-D/Ripple/pull/7) Draft，`feat/b-media-executor-20261019` @ `caeeb2224e83ce7a0545a70737367ed76138b218`；同一 SHA 的 [CI #256 成功](https://github.com/Onesummer-D/Ripple/actions/runs/39409500518)。第 0 节为旧 `b7a0306` 审查；新提交的 Receipt 集成及与 A 当前 HEAD 的联合/真实 Bolt MEDIA 验收仍待复审 |
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

本次会话重新下载并解析 Run #6 trace：iframe `GET /`、`/src/main.tsx`、`/src/App.tsx`、`/src/index.css` 均为 200；随后 `/src/pages/AutumnPage.tsx`、`ProductsPage.tsx`、`StoryPage.tsx` 和 `/@vite/client` 记录 `net::ERR_NETWORK_CHANGED`，失败资源在余下等待期未重试。失败截图显示空白预演。Vite ready/这些 200 只能证明服务曾可用，不能证明浏览器最终渲染成功。下载的 trace/截图仅在本机忽略目录中另有副本（第 8 节）。

**前几轮已尝试与结论：**

- Run #3：`/deps` 挂载导致 Tailwind 依赖 `@alloc/quick-lru` 解析失败；之后采用标准 `/work/node_modules`，Run #4 首屏/资源已能够加载。
- [Run #4](https://github.com/Onesummer-D/Ripple/actions/runs/39297763450)：旧按钮 accessible name 的 Playwright 选择器过期，之后修正。
- [Run #5](https://github.com/Onesummer-D/Ripple/actions/runs/39304045573)：真实预演及 Candidate 已到达验证阶段，但 Playwright Docker 镜像首次拉取导致失败；在 `6b63f94` 已加预热及 smoke，Run #6 前置检查确实通过。
- **Run #6**：变成新的 iframe 模块加载 `ERR_NETWORK_CHANGED`；应重新诊断而不是继续重复修已解决的问题。

**接班 Agent 的第一任务：**

1. 先核对本地**未提交**的 `src/app/ProjectWorkbench.tsx` 与 `e2e/project-workbench.spec.ts`（第 8 节）：它们增加用户可见的 iframe 重新加载和仅在 `ERR_NETWORK_CHANGED` 且原 relay 对失败路径返回 200 时的一次恢复尝试。检查旧 iframe 异步点选响应不能在重载后恢复过期 selection，补确定性回归；不要把“恢复可用”写成已证明底层根因消失。
2. 重点审查 `e2e/project-workbench.spec.ts`、`src/core/candidate-preview.ts`、`src/core/candidate-preview-runner.mjs`、`src/core/candidate-preview-vite.config.mjs`、`src/core/local-project-api.ts`、`.github/workflows/bolt-acceptance.yml`；依据 trace/容器/浏览器时序给出最小通用修复或明确剩余未知。
3. 不得放宽 `footer`、跳过页面资源、无限延时、关闭隔离、忽略失败请求或按 Bolt 仓库名特判来换绿色。完成 Linux/Docker CI 后，固定新 SHA 请求一次真实 Bolt 运行；Run #6 本身不提供四视口闭环结果。
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
- B PR #7 当前 `caeeb22` 的 CI #256 已绿；其 PR 正文部分仍引用旧交付 HEAD。正式整合前须复审第 0 节 Receipt 风险，在最新 A 基线上复验 handler、公共 registry seam、文件写入及补丁完整性；分支 CI 不代表联合集成或真实青野验收完成。
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

当前任务 checkout 是 `D:\Onesummer_D\Learning\Competitons\ShuMei_QG\Ripple涟漪\ripple-pr2-bolt-run6`，本地分支 `feat/project-first-core-20261018` 从远端 `d8d8b18` 独立克隆。**除本交接文件外，`git status` 还显示三项未提交改动；此次只提交/推送本文件，不得误带业务实验：**

本地文档提交 `41299c4` 未能经 Git 推送（`Failed to connect to github.com port 443`）；期间远端由其他文档提交前进到 `d2a429a`。本文已保留该远端新增审查，并通过 GitHub Contents API 发布合并后的文档；**本地 Git 历史尚未与该远端提交同步**。下一 Agent 应先 fetch/比较祖先关系，保留未提交实验后安全同步，不能强推本地文档历史覆盖远端。

| 仅本地文件 | 当前内容与状态 |
| --- | --- |
| `src/app/ProjectWorkbench.tsx` | 为原工程/候选 iframe 添加“重新加载预演”按钮，并在重载时清空点选；近期又加了异步来源响应的 iframe 身份检查。**未提交，未运行 Docker/Bolt 复验**。 |
| `e2e/project-workbench.spec.ts` | 合成场景检查 iframe 重建；私有 Bolt 场景仅在 `net::ERR_NETWORK_CHANGED` 且 relay 逐项返回 200 时尝试一次重载，仍要求 Footer、后续资源/Scope/Evidence 完整通过，并留资源审计。**未提交，未运行真实 Bolt；旧 iframe 异步点选的确定性回归尚欠**。 |
| `tsconfig.node.tsbuildinfo` | 本机 `npm run build` 生成的已跟踪增量编译记录；不是有意代码修改，不要纳入文档提交。 |

此 clone 已完成本地 `npm run typecheck`、聚焦 `ProjectWorkbench.test.tsx` 1/1 和 `npm run build`，但这些运行早于最后一处 iframe 身份检查；不能据此称未提交实验已验收。全量 Windows `npm test -- --run` **失败**：29 文件中 26 passed/3 failed，153 passed/8 failed/1 skipped，另有 1 个 Vitest worker timeout；主要出现 `connect EACCES 127.0.0.1:10454` 和临时 Git `.git/config: Permission denied`。这些是本机受限环境结果，不能替代 Linux CI；不能写成全绿。`git ls-files --others --exclude-standard` 无未追踪文件，`node_modules` 是忽略文件。

旧 checkout `...\ripple-app-pr2-6c6e-previewfix` 仍在 `codex/core-runtime-pr2` @ `e16e786`；其忽略目录 `node_modules/.tmp/bolt-run6-artifact.zip`、解包 trace/截图是**仅本机副本**，不在 GitHub。旧工作树另有未推送的暂停 UI ref `codex/ui-selection-card-paused` @ `35b6955`；不要清理、重置、误并入。仓库外 `.planning/`、私有 Bolt 源码、Secrets、Docker 缓存都不随本文迁移。其他机器/B 的本地状态未查。**交接提交推送后此新 clone 仍不干净，原因是上述三项有意保留的改动。**

## 9. 交接执行协议与完成定义

1. 新 Agent 首先读本文件、产品复审 v2、有关结构化合同、Issue #6 和 PR #2/#4/#7，核对远端 HEAD 与 CI，并验证本地工作区；**项目进度以实际源码/测试为准**。
2. 若 Run #6 仍为最新阻塞，先从第 4 节开始；若仓库已新增成功 Run/修复 SHA，则据最新证据更新本文件，不要继续执行过期任务。
3. 遵守安全/权限/哈希/Scope 等必要保护，避免冗余 fallback、过度防御性包装、仓库名特判和为兼容旧结构无限叠加覆盖规则。可在有证据时重构错误抽象，不能为了保留旧代码妥协。
4. 每个可审核单元提交测试、SHA、真实/合成证据区分、独立代码审查和 P0/P1/P2 处理；不虚称“独立审查”已由同一 Agent 完成。未经负责人确认不合并 main、不代替 B 写 MEDIA 业务代码。
5. 接力前更新本文件的**代码基线 SHA、失败 Run、已通过 CI、下一实际动作、未提交工作项**。本文件更新造成 HEAD 前进，记录“所审查业务代码 SHA”和“交接提交 SHA”时须避免自引用错误；最终提交 SHA 以 GitHub 提交记录为准。

**接班的第一项实际开发任务：分析 Bolt Run #6 的 iframe `ERR_NETWORK_CHANGED`，形成可复现的通用根因及测试，再继续真实 TEXT 验收；无论成功或失败均记录对应准确 SHA 和 Evidence。**
