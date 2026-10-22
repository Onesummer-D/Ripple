# B 侧接力记录 v4（2026-10-21 上午）

接力分支：`feat/b-media-overnight-20261021`
- v4 当前：`d01604c4`（见「〇、v4 增量」；CI run 39510512023 success）
- 历史：v1 `8492aaf` → v2 `1f5ee58` → v3 `919d40d` → v4 `d01604c`（均基于 PR #7 HEAD `f51719d`）
- PR #8 分支：`chore/media-acceptance-workflow` `b438096 → 9b618b0`（ff，无强推）
- PR #9 分支：`d5764e7 → 8c1ae2b`（ff，CI #290 success，本轮无改动）
- A/B 集成分支：`integration/b-media-x-a-20261021` @ `5fd6e80`（按 A `caa2eaa` 快照；A 已推进至 `44e45887`，Bolt acceptance 在其 `73bb9bd0` 有已知失败，属 A 的 TEXT Run #11 并行 Scope 验证器问题，与 B 无关）

---

## 〇、v4 增量——独立审查 P0/P1 全部修复（以远端实际代码为准）

### 审查结论 → 修复映射

| 审查项 | 结论与修复 | 提交 |
|---|---|---|
| P0-1 PR #8 检出前提 | 确认属实：首个 checkout 无 `ref`，main 无 MEDIA 代码，合并后运行必失败。workflow 新增 `ripple_sha` dispatch 输入（默认 = 经审查的 `d01604c4`），检出与触发分支/默认分支无关；检出后校验 HEAD=输入 SHA、验收入口脚本存在；日志显式记录双端 SHA；凭据不持久化断言保留 | PR #8 `9b618b0` |
| P1-1 恢复状态误记 | 确认属实：外层 catch 按异常类型取反推导 `recovered`，显式回滚失败会被记 `recovered: true`。新增 `classifyRecoveryOutcome`（restored / recovery-failed / unknown 三态，仅摘要复核一致才记 restored），脚本 `steps.applyRecovery.recoveryState` 如实记录 | `ed973ee` |
| P1-2 现场与重试冲突 | 确认属实：启动时 `rmSync(project-src)` 会删除上轮保留现场；`removeCandidate` 无条件清审计证据。新增 `media-acceptance-run-dir`：每次验收独占 `run-<时间戳>-<随机>/` 目录，历史现场只警告绝不覆盖；保留现场写 `SCENE-PRESERVED.json` 清单（Candidate ID/patchHash/基线摘要/操作/失败状态）；候选清理改用 `preserveAudit`；成功路径清理重工件 | `0fb5873` |
| P1-3 source-mapping 宽松 | 确认属实：只查 `>1`，计数为 0 可错误 pass；无视口数量/身份校验；detail 夸大证明范围。现严格化：数量不一致→unknown、重复/错位→risk、计数必须恰为 1（0→unknown）、基线 imageFound=false→unknown；pass detail 如实声明"URL 级消费实例唯一性"证明边界 | `e3fb879` |
| P2-1 应用阶段写入边界 | `applyApprovedCandidateWithRecovery` 现先以树摘要判断真实写入：未写入直接抛错不回滚；无法确认时保守按可能写入处理并保留现场，绝不盲目逆向补丁（含 `919d40d` 之后的 `ed973ee` 内） | `ed973ee` |
| P2-2 裁切几何 | `computeCropGeometry` 已在真实 Chromium 核对过像素偏移语义（不钳制）；关键字/边缘偏移复合语法仍属已知边界，建议后续按真实 computed style 复核（未改动，如实记录为遗留项） | 无代码改动 |

### v4 新增/修改文件

- 新增 `src/core/media-acceptance-run-dir.ts`（运行目录分配 + 保留现场发现，发现阶段不跟随符号链接）
- 新增 `src/core/media-acceptance-run-dir.test.ts`（5 负例：唯一目录、保留现场重试不覆盖、成功目录不误报、旧布局避开、符号链接不跟随）
- 修改 `src/core/media-acceptance-apply.ts`（classifyRecoveryOutcome + 应用阶段写入判断）
- 修改 `src/core/media-acceptance-apply.test.ts`（+8 负例）
- 修改 `src/core/media-viewport-evidence.ts`（resolveSourceMappingAssertion 严格化）
- 修改 `src/core/media-viewport-evidence.test.ts`（+8 负例）
- 修改 `scripts/media-qingye-acceptance.ts`（run 目录接入、recoveryState 三态、SCENE-PRESERVED.json、preserveAudit、成功路径清理）
- 修改 `.github/workflows/media-acceptance.yml`（PR #8 分支，`9b618b0`）

### 负例与门结果

- Vitest：35 个文件全过（225 用例；本机 Windows 仅已知 EPERM teardown 噪音，零断言失败；Linux CI run 39510512023 success = typecheck + 33 测试文件 + build + Playwright 10 passed 1 skipped）
- 端到端真实验收（青野 f7e4998a，本机）：
  1. `rollback-failure` 注入 → 无 PASS，非零退出，`recoveryState: recovery-failed`，`SCENE-PRESERVED.json` 齐全（含 candidate id `candidate-c3987df7…`、patchHash、双端 SHA），副本处于应用后状态（products.ts M + public/ 未跟踪），审计工件（patch）保留；
  2. 同 workRoot 正常重试 → 警告检测到历史现场、使用新 `run-…-75c39c` 目录，**旧现场逐字节未被触碰**（P1-2 负例 e2e 成立），`PASS ripple=d01604c4 qingye=f7e4998a`，成功路径仅留 acceptance.json/evidence/runner-input/verification，副本与暂存字节已清；
  3. source-mapping 断言在真实 browser-execution.json 中输出新证明边界措辞。
- 事故现场证据位置：本机 `_scratch/media-acceptance/work/run-2026-10-20T22-48-41-7e55c4/`（含 SCENE-PRESERVED.json 与 project-src worktree）；处置后手动 `git -C <青野> worktree remove --force <projectSrc>`。

### 留给 B / 负责人的清单

1. PR #8 已具备安全可复现执行条件（固定双端 SHA + 检出校验 + 入口存在断言），**待负责人审批合并**；合并后 dispatch 默认值即指向 `d01604c4`，也可改输入（改动需重新审查）。
2. GitHub Actions 真实青野验收**尚未运行**（workflow 为 dispatch 且需 BOLT_REPO_TOKEN；secret 存在性需 admin 核查）。
3. A/B 最新集成未复验（A 已至 `44e45887`）；阶段 C 需按最新双方 SHA 重来，`5fd6e80` 仅是 `caa2eaa` 快照。
4. 与 B 原工作区可能冲突的文件：`scripts/media-qingye-acceptance.ts`、`src/core/media-viewport-evidence.ts`（若 B 本地有未提交改动，以本分支为准合并）。
5. P2-2 关键字 object-position、Issue #6 的 A 侧依赖（react-router 归属/catch-all）维持原结论不变。

---

## 历史版本（v3 及之前）

接力分支：`feat/b-media-overnight-20261021`
- v1 基线：`8492aaf`（基于 PR #7 HEAD `f51719d`）
- v2：`1f5ee58`（P1 代码 + 恢复保证/source-mapping）
- v3：`919d40d`（显式回滚注入修复）
- A/B 集成分支：`integration/b-media-x-a-20261021` @ `5fd6e80`
- PR #9 分支已更新：`d5764e7 → 8c1ae2b`（ff，无强推）

基线核对（v3 轮开始时）：PR #7 = `f51719d`、PR #8 = `b438096`（已固定青野 SHA
f7e4998a）、PR #9 = `d5764e7`、A 文档 HEAD `caa2eaa` / 代码基线 `3901dc6`（PR #2）。
A 此后仍在推进（CI #291 @ `73bb9bd0`），集成是按 `caa2eaa` 时间点的快照。

---

## 一、本轮新增代码

### v3 增量（`1f5ee58 → 919d40d`）

| 文件 | 性质 |
|---|---|
| `scripts/media-qingye-acceptance.ts` | **修改**：成功路径的显式 `rollbackAppliedCandidate` 纳入故障注入与现场保留——此前 `rollback-failure` 只挂在恢复路径 `beforeRollback` 钩子上，成功路径无故障点，注入会被 happy path 绕过直接 PASS（v2 交接中"双故障实测"的描述不准确，v3 已用真实负例复现并修复） |

### v2 增量（相对 v1 的 `8492aaf`）

| 文件 | 性质 |
|---|---|
| `src/core/media-acceptance-apply.ts` | **新增**：应用→应用后校验→（失败）自动回滚的恢复封装，含三个故障注入钩子；任何失败向外抛错，绝不写 PASS，不吞异常、不强制重置工程 |
| `src/core/media-acceptance-apply.test.ts` | **新增**：4 个真实注入用例（真实 Git fixture + 完整审批生命周期）：正常成功 / post-apply 故障恢复 / 摘要校验失败恢复 / 回滚失败双故障现场保留 |
| `scripts/media-qingye-acceptance.ts` | **修改**：① 应用/回滚迁移到 `workDir/project-src` 独立可丢弃副本（`-c core.autocrlf=false`），私有原工程全程只读，结尾 `steps.originalUntouched` 摘要自比对证明未被触碰；② 接入恢复封装 + `RIPPLE_MEDIA_ACCEPTANCE_FAULT` 故障注入；③ source-mapping 断言改用独立判定 |
| `src/core/media-viewport-evidence.ts` | **修改**：观测新增 `matchCount` / 基线新增 `imageMatchCount`（采集器真实计数）；新增 `resolveSourceMappingAssertion` 纯函数 |
| `scripts/media-viewport-evidence.ts` | **修改**：采集器填充上述两个计数字段 |
| `src/core/media-viewport-evidence.test.ts` | **修改**：工厂字段 + 4 个新负例（候选歧义 / 基线歧义 / 未加载 unknown / 篡改哈希） |

其余全部为审查/复现结论，无其他代码改动。未改 A 的 Candidate / Scope /
VerificationReceipt 公共契约（仅使用其既有 API）。

## 二、P1-1 Apply 失败恢复保证 — ✅ 完成并三场景实测

- 三类场景语义（脚本头注 + 恢复模块注释 + 文档）：正常成功 / 运行失败（自动回滚 +
  抛错退出）/ 进程中断（副本可弃，原工程只读）。
- 注入测试：4/4 用例体通过（本机 Windows teardown 有已知 EPERM 清理噪音，Linux CI 为准）。
- **真实端到端实测**（青野克隆，三次完整运行）：
  1. 正常路径：`QINGYE MEDIA ACCEPTANCE PASS ripple=8492aaf0 qingye=f7e4998a`，
     `steps.originalUntouched` 证明私有原工程只读未被触碰，worktree 全部清理。
  2. `post-apply` 注入：`MediaAcceptanceRecoveryError: 应用后校验失败，已自动回滚恢复
     原基线（1aee4f4207d1…）。原始错误：故障注入：post-apply`，退出码非零，
     无 PASS 产物，原工程干净。
  3. `rollback-failure` 注入：复跑真实验证通过（commit `919d40d` 修复后）。无 PASS 产物，
     报错 `AcceptanceError: 显式回滚失败，现场已保留于可丢弃副本 …：故障注入：
     rollback-failure`；保留副本中 `products.ts` 处于应用后状态（含
     `/media/qingye-category-swap.jpg` 引用，`public/` 为暂存资产），证明回滚确实未执行；
     青野克隆 `worktree list` 恢复原状、`status` 干净。⚠️ 教训：`919d40d` 之前该注入
     只挂在恢复路径的 `beforeRollback` 钩子上，成功路径的显式回滚之前无故障点，
     注入会被 happy path 绕过直接 PASS——真实负例抓住了这个缺口，请勿回退该修复。

## 三、P1-2 Source Mapping 独立证据 — ✅ 完成

- `source-mapping` 不再与 `target-change` 同构：独立要求双端各视口目标资源消费
  实例唯一（候选 `matchCount`、基线 `imageMatchCount` 真实浏览器计数）。
- 歧义（任一视口 >1 个消费实例）→ `risk`；覆盖不全 → `unknown`；两者均阻止 PASS。
- 负例入库：多 img 引用同一替换资源、基线多实例、未加载 fail-closed、哈希篡改。
- **narrowMediaByReceiverType 专项核查结论**（协调人关注点）：以真实代码 + 既有
  测试（project.test.ts 收窄/混合/seasonal 用例）核实——混合显式/推断绑定的漏边
  方向是**欠声明**（影响 unknown → 候选门拒绝），过声明方向只会增加验证负担、
  由浏览器证据兜底；fail-closed 注释与实际行为一致，**无安全缺陷**，不建议重构。

## 四、P1-4 A/B Verification 公共能力联合复验 — ✅ 无冲突集成

- `integration/b-media-x-a-20261021` @ `5fd6e80` = 过夜分支 `1f5ee58` **干净合并** A 的
  `caa2eaa`（含 3901dc6 的 verification 语义调整），**零文本冲突**。
- 语义验证（独立 npm ci 的集成树）：typecheck 全绿；MEDIA + 契约 + A 改动文件
  （candidate-preview / preview-resource-snapshot / bolt-workflow / app）批次全部通过；
  恢复注入测试 4 例体通过（teardown EPERM 为已知噪音）。
- 结论：B 的 MEDIA 专项与 A 最新 Verification 能力**兼容**，未把任何旧版文件复制
  进 A 主线；未动冻结 Session v1 / VerificationReceipt 门控。
- 遗留：A 分支继续推进中（CI #291 @ 73bb9bd0），最终 rebase 时建议以集成树重跑
  上面两个测试批次做回归。

## 五、PR #9 — ✅ CI #280 已修复（CI #290 全绿）

- 根因（同 v1）：合并 `2dc3273` 取了新 fail-closed `scope.ts` 却保留旧
  scope.test.ts 预期；非 SourceGraph 回归、非契约变化。
- 修复：`8c1ae2b` 仅同步 PR #7 版 scope.test.ts（收紧方向，未动 scope.ts），
  ff 推送到 PR #9 分支（无强推）。
- 验证：PR #9 树 typecheck 0 错误、build 通过、Vitest 相关批次 72 通过，
  其余失败与基线相同的 Windows EPERM teardown（零断言失败）；**CI #290 success**。
- Issue #6 后续项（react-router 归属公共能力、codescandy 复验、SCSS Token
  unsupported、第三方 TEXT 全生命周期）本轮未开展，留给 B 按优先级继续。

## 六、GitHub Actions 真实验收 — 准备就绪，等负责人审批 PR #8

- PR #8（workflow_dispatch 入口）已含青野 SHA 固定 `f7e4998a`；workflow_dispatch
  只在默认分支生效，**必须负责人先合并 PR #8 到 main**，接力方不能自行合并。
- Secret 存在性无法用当前凭据核查（需要 admin）；请负责人确认 `BOLT_REPO_TOKEN`
  对 Actions 可用。
- 获批后运行清单：dispatch → 核对双方 SHA → 全流程（SourceGraph → Scope →
  staging → CandidatePatch → 双构建 → 四视口 → Receipt → Approval → Apply →
  Rollback）→ 工件上传 → 未授权页面/源码清洁/回滚完整性检查。本机三次实测
  （§二）证明脚本在该路径上行为正确，可作为对拍基准。
- 当前验收目标仍是可静态证明的分类图媒体；动态商品列表图片替换未获支持，
  验收脚本对此 fail-closed 并在 steps.sourceLocation 如实标注。

## 七、验证结果汇总（v2，本机 Windows；Linux CI 为权威）

| 门 | 结果 |
|---|---|
| typecheck（app + node，含 scripts） | ✅ |
| build | ✅ |
| Vitest 核心批次（MEDIA/契约/恢复注入/app/A 改动文件） | ✅ 全过（4 个恢复用例体通过，teardown EPERM 为已知噪音） |
| 青野真实验收（正常路径，改后脚本） | ✅ PASS + originalUntouched 证据 |
| post-apply 故障注入端到端 | ✅ 自动回滚 + 非零退出 + 无 PASS 产物 |
| rollback-failure 双故障注入端到端 | ✅ 抛错 + 现场保留 + 原工程干净 |
| PR #9 树 gates + CI #290 | ✅ success |
| A/B 集成树（merge caa2eaa） | ✅ 零冲突，typecheck + 测试批次全绿 |
| 过夜分支自身 CI（#286 @ 8492aaf） | ✅ success |

## 八、交接注意

- **可能与 B 原工作区冲突的文件**：`scripts/media-qingye-acceptance.ts`、
  `scripts/media-viewport-evidence.ts`、`src/core/media-viewport-evidence.ts`（+test）、
  两个新增 `media-acceptance-apply.*`、`B_OVERNIGHT_HANDOFF.md`。若 B 本地在
  v1 后也改了这些文件，合并时优先保留双方差异；恢复模块与注入钩子是自包含新增。
- **本地证据位置**：三次验收运行日志与工件在 `_scratch/media-acceptance/`；
  PR #9 修复证据在 PR #9 CI #290；集成树为 `ripple-integration/`（已推送远端）。
- 未合并任何 PR 到 main 或 B 的正式开发分支（PR #9 的 ff 提交是按协调人指示
  对失败回归的最小修复）。等 B 本人审核。
