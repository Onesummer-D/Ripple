# Handoff：Ripple A 总集成 Agent（2026-10-23 午后交接）

> 本文面向对项目与本角色零上下文的新接手 Agent。读完即可续接，不需要回溯对话。
> 同名副本已提交至 `feat/a-cd-rehearsal-20261023` 分支 docs/ 下。

## 一、我是谁：角色与分工

**Ripple A 总集成 Agent**（协调人下辖多 Agent 并行开发中的 A 线）。产品 = Ripple 编辑器工作台（真实工程项目内做 TEXT/MEDIA 候选编辑，带 SourceGraph 来源证明、运行时身份、视觉证据、审批/应用/回滚全链路）。

A 的职责（只做这些，不越界）：

1. **工程质量与接口合同**：维护公共核心（`feat/project-first-core-20261018`）的一致性，审查各 Agent 提交；
2. **集成顺序与合并执行**：所有代码进 A 必须经 A 建独立工作树预演（merge 方式，禁用 reset/force push/squash 替代）→ 本地门 → 推送集成分支 → 全量 CI → 向协调人报告 → **拿到书面授权后**才正式 merge 进 A；
3. **CI 运营**：CI 被外部批量取消时做受控重跑（`workflow_dispatch`），从不改测试来"修绿"；
4. **基线分发**：每次 A HEAD 变化后向 E/F/D/C+D/B 各线分发新 SHA 与任务口径；
5. **纪律红线**：不合并 main、不触发真实 Bolt 验收、不放宽 Candidate/Scope 安全门控、不过度派工（各线 P 级修复由协调人直接派给对应 Agent，A 只登记与验收）。

## 二、当前全局状态（截至 2026-10-23 ~12:20）

### A 主线（唯一权威基线）

- 分支：`feat/project-first-core-20261018`
- **当前 HEAD：`71dc6c7a91b64eb5a66a2932b1f5409938f698a0`**（CI run 39897930197 SUCCESS）
- 已正式并入（按序）：C+D PR #28（SourceGraph×Runtime Identity）→ F #25（Real Adapter 第一阶段）→ MEDIA 安全补丁（D N8–N11 媒体来源收窄）→ E PR #30 阶段一（只读视觉证据接线）。
- Run #18 基准 SHA `16e737c` 仅作历史回归参照。

### 各并行线

| 线 | 分支 / HEAD | 状态 | 下一步 |
|---|---|---|---|
| E 视觉证据 | `feat/e-visual-wiring-20261023` @ fdd9ee0（PR #30 已合入 A 并关闭） | **阶段一完成，E 冻结待命** | 阶段二（严格实例证明接线）等 C+D 正式合同；必须 `instanceIdentityProven === true`，禁止仅查对象非空 |
| C+D | AC-P2a/b 工作分支 @ `27d4bd6`（CI #39900833633 绿：602/61+1 跳） | route.lazy default 误证明与 SemVer 白名单**已修复**；**新 P0 待修**：`resolveLazyComponent()` 用 `components.filter(c.name === 'Component')` 判断消费者，未验证 Component 是否目标模块的真实命名导出（内部函数可能被误证 source-proven） | C+D 最小修复 + 真实负例 + CI → A 从最新 A HEAD 建独立预演，**只选公共代码/测试/必要合同文档**（分支落后 A 22 提交且混 B 历史报告，不整支合入；PR #28 为历史 merged PR，不作新入口）；E 身份合同文档可接收但 runtimeIdentity 字段与 page-context 清除规则暂不冻结 |
| F | `feat/f-real-text-phase2-20261023` @ `da94ab7`（CI #39897848604 绿：596/66+1 跳） | **第一批正式验收通过**：真实 Docker E2E 闭环（iframe 点选→source-selection→显式 Scope→createCandidate→preview→历史核对/原工程不变/会话关闭）；原两项 Scope P0 + nonce 竞态 + iframe 退出均已修复；**待 A 集成** | F 从 `71dc6c7` merge 同步 → 回归 → 冻结集成提交供 A 审查；A 独立预演；F 并行开发第二批 |
| D MEDIA | 安全补丁已在 A；PR #26 @ 78a5484 仍 Draft | 预演与正式合并均完成 | D 基于 71dc6c7 做 PR #26 新基线适配 + 青野固定 SHA **`f7e4998a`**（github.com/Onesummer-D/Ripple 的真实工程仓库 Onesummer-D/ripple-qingye-bolt）MEDIA 全链验收（素材暂存→候选→四视口→视觉证据→Approval/Apply/Rollback→工件留存；Lab 通过 ≠ 正式验收） |
| B | 冻结 SHA `cf44193`（工具冻结通过） | 待命 | 等 AC-P2a/b 入 A 后，在 codescandy 固定 SHA `b700bbd` 上构造**含目标及受影响页面的显式 Scope** 执行 `--expect accepted` 真实候选复验；codescandy 探针 exit 2 BLOCKED 是已接受边界，不写成 PASS |

### 已登记独立问题（文档在 A 主线 docs/）

- `docs/integration/B-ENV-1-windows-eol-byte-consistency.md`（P2）：Windows EOL/字节一致性；**先设计验证（6 项，见文档）后编码**，禁止归一化哈希/忽略字节差异/放宽门控；sourceRef 偏移是 UTF-16 文本偏移。
- `docs/integration/AC-P3-windows-path-containment.md`（P2）：candidate.ts 目录包含判断缺物理归属证明；规则 = realpath 证明不相交才允许，盘符不同 ≠ 不相交，subst/UNC/符号链接 fail-closed。
- `docs/architecture/e-visual-identity-interface-requests.md`：E×C+D 三项身份合同接口需求（identityAssessment / runtime observations / RuntimePageContext），已交付 C+D，等待书面确认。
- AC-P2a / AC-P2b：codescandy composite JSX 子代传播 + data-router errorElement 条件消费者（C+D 负责，A 审查）。

## 三、工作基础设施（接手即用）

### 仓库与目录

- Git 仓库根：`D:\Onesummer_D\Learning\Competitons\ShuMei_QG\Ripple涟漪\ripple-app`（注意嵌套层级，工作区根是其上一级）。
- **`ripple-app` 主检出绝不可操作**——常被 F Agent 并行占用。一切在 `_scratch/wt-*` 工作树做。
- 现有工作树（`git worktree list` 可查）：
  | 工作树 | 分支 | 用途 |
  |---|---|---|
  | `_scratch/wt-base` | feat/project-first-core-20261018 | A 主线操作树（merge 进 A 都用它） |
  | `_scratch/wt-cd-rehearsal` | feat/a-cd-rehearsal-20261023 | **审查表维护树**（`docs/A-integration-review-20261023-v2.md`，v3→v23 追加式） |
  | `_scratch/wt-f25` | feat/a-f25-integration-20261023 | F #25 集成树（已合并，历史保留） |
  | `_scratch/wt-e-wire` | feat/a-e-visual-wiring-20261023 | E 旧接线预演树（已被 #30 取代，历史保留） |
  | `_scratch/wt-media` | feat/a-media-core-integration-20261023 | MEDIA 集成树（已合并，历史保留） |
  | `_scratch/wt-e30` | feat/a-e30-integration-20261023 | E #30 集成树（已合并，历史保留） |
  | `_scratch/wt-cd-sync` / `wt-pr27` / `wt-pr28` | 各历史分支 | 历史保留 |
- 新工作树节点依赖：Git Bash 无符号链接权限、cmd 对中文路径会乱码——用
  `powershell -NoProfile -Command "New-Item -ItemType Junction -Path '<wt路径>\node_modules' -Target 'D:\...\ripple-app\node_modules'"` 挂接。

### GitHub API 访问

- 令牌：`TOKEN=$(printf "protocol=https\nhost=github.com\n\n" | git credential fill | grep "^password=" | cut -d= -f2)`（协调人的 PAT，user=Onesummer-D，可 push、可发 API）。
- git push 直推可用；**已知限制**：`ready_for_review` 端点 404、`Convert to draft` 无 API——解 Draft/转 Draft 需协调人在网页操作，或走本地 merge+push 路径（GitHub 会自动检出 PR 已合并）。
- 中文 JSON body 走 curl `-d` 会 400——一律 `python -c "import json; print(json.dumps({...}))" > /tmp/x.json && curl -d @/tmp/x.json`。

### CI 运营经验

- `ci.yml` concurrency group = `ripple-ci-${{ github.event.pull_request.head.sha || github.sha }}`：挂 PR 分支的 push/PR 事件同 key 互踩（设计内）；**外部批量取消也多次出现**（表现为无同组新 run 却被 cancelled）→ 处置 = `POST /repos/Onesummer-D/Ripple/actions/workflows/ci.yml/dispatches`（204 无 body）受控重跑，终态以重跑 run 为准。
- 完整 CI 约 12–15 分钟；轮询间隔 4–5 分钟。
- Windows 本地跑全量 Vitest 会超 300s 工具上限 → 本地只做定向测试（`-t "用例名"` 或指定文件），全量以 Linux CI 为权威门。

### Docker / Playwright

- Docker 可用：PATH 加 `/c/Users/Deng/AppData/Local/Programs/DockerDesktop/resources/bin`，Git Bash 下 `MSYS_NO_PATHCONV=1`，WSL2 后端已验证。
- Windows 两个已知遗留 e2e 失败（非回归，勿当作新问题）：`source-identity.spec.ts:588`（staleObservations=0，CRLF 偏移嫌疑，与 B-ENV-1 同源）、`project-workbench.spec.ts:814`（EPERM 临时目录清理）。

## 四、标准集成流程（每个批次照此执行）

1. 协调人书面授权（列明源 SHA、目标基线、验收条件）；
2. `git ls-remote` 核对 A 远端 HEAD 与源分支 HEAD 未漂移；
3. 新建 `_scratch/wt-<name>` 工作树（基于最新 A HEAD）+ PowerShell junction 挂 node_modules；
4. `git merge --no-ff <源SHA>`——出现真实冲突即停，整理冲突清单报协调人，不强制覆盖；
5. 差异核查（diff A→集成树）：确认无旧逻辑混入、无其他线文件改动；
6. 代码审查点按协调人清单逐项核验并留证据；
7. 本地门：typecheck、build、定向 Vitest（核心相关文件）；
8. push 集成分支 → 等全量 CI SUCCESS（被取消则 dispatch 受控重跑）；
9. 向协调人提交预演报告（集成 SHA / 冲突 / CI URL / 安全门控不变证据 / 是否满足合入条件）；
10. 拿到 merge 授权后：wt-base 里 `--no-ff` merge 集成 SHA → push A → 等新 A HEAD 全量 CI SUCCESS → 分发基线 → 处理 PR（关闭被取代者并评论说明、在合入 PR 上记录 A merge SHA）。

## 五、下一步规划（按优先级，2026-10-23 16:47 协调人复核后更新）

1. **F 第一批集成**：F 从 `71dc6c7` merge 同步并冻结集成提交 → A 建独立工作树预演（merge da94ab7 系）→ 本地门 + 全量 CI → 报告 → 授权后合入；F 并行开发第二批。
2. **C+D 命名导出 P0 修复到达**（resolveLazyComponent 验证 Component 为真实命名导出 + 真实负例 + CI）→ A 从最新 A HEAD 建 AC-P2a/b 独立预演，**只选公共代码/测试/必要合同文档**（不整支合入、不混 F 线，两线各过联合 CI）→ 授权后合入 → 通知 B 恢复 codescandy `--expect accepted`（显式完整 Scope @ b700bbd）。
3. **C+D 三项身份合同书面确认** → E 阶段二启动（严格实例证明接线，instanceIdentityProven === true 口径）。
4. **D 青野 MEDIA 全链验收**（f7e4998a，正式验收非 Lab）。
5. P2 支线（不阻塞主线）：B-ENV-1 设计验证 6 项 → 批准后才动公共核心；AC-P3 最小修复 + 6 组正反例。
6. 终局目标：三案例（青野、栖光、第三方 codescandy）在同一 A 版本下完成真实操作闭环与回归，向协调人交付联合验收报告。

## 六、审查表维护

- 文件：`_scratch/wt-cd-rehearsal/docs/A-integration-review-20261023-v2.md`（追加式，每批集成/审查追加一个 `vN` 节，不要改写历史节）。
- 推送分支：`feat/a-cd-rehearsal-20261023`（当前 @ 0c8e4cd）。
- 协调人以审查表为状态权威来源；旧版文档（如 B 分支上的 v2 旧段）明确不合入。

## 七、禁忌清单（违反会被协调人打回）

- 不合并 main；不触发真实 Bolt 验收；不解除未经点名授权的 Draft；不 force push / reset 公共分支。
- 不放宽 Candidate/Scope 字节与门控校验；不归一化安全哈希；不删除 route-coverage 或屏蔽 graph.unresolved。
- 不把 mock 测试当联合验收；不把独立模块 CI 当集成验收；不把 Lab 通过当正式验收。
- 不替其他 Agent 写其实现代码（A 只在自己被明确指派时做最小修复，且需在报告中显式声明）；不重复派工。
- 不在 `ripple-app` 主检出操作。
