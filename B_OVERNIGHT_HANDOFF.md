# B 侧过夜接力记录（2026-10-21 凌晨）

接力分支：`feat/b-media-overnight-20261021`（从 PR #7 准确 HEAD `f51719d` 建立）
基线核对：PR #7 HEAD = `f51719da56868c60b160bf1b9c20d81bf488012b`（= 任务给出的 f51719d，与远端一致）；
PR #4 HEAD = `137ff54`；PR #9 HEAD = `d5764e7`；`origin/main`（`73a4edc`）**不是** B 的最新基线，未采用。

本分支未合并任何 PR、未推送强推、未改 A 的 Candidate / Scope / VerificationReceipt 安全契约。
与 B 原工作区（`ripple-app` 等目录）完全隔离，所有工作在独立克隆 `ripple-overnight` 内完成。

---

## 一、MEDIA 验收质量复核（任务一）——结论：验收链真实、可信，本机已真实跑通

在 PR #7 HEAD 上完整运行 `scripts/media-qingye-acceptance.ts`（青野工程用隔离克隆
`_scratch/qingye-acceptance-src`，commit `f7e4998a`，即 CI 同款 BOLT_REPO_REF），结果：

```
QINGYE MEDIA ACCEPTANCE PASS ripple=f51719da qingye=f7e4998a patch=5da0b4ab3e08 evidence=fcbfe0e2a7fa dual=56f1fed02ad8
```

七项 Verification 断言全部 `pass`（target-change / non-target-preserved / scope-propagation /
interaction / responsive-layout / source-mapping / browser-errors），四视口双端 DOM 对照
全部 matched，审批门控、apply 树摘要匹配、rollback 恢复原摘要均通过。

逐项核对结论：

1. **baseline 与 candidate 独立构建** ✔ 候选 = createCandidate 的隔离 worktree 打补丁后
   `npm ci + vite build`；基线 = `git worktree add --detach <qingyeCommit>` 独立检出后独立构建；
   两端分别由 `serveStatic` 在 4619/4620 端口服务，构建产物互不共享。
2. **七项断言对应真实执行结果** ✔ 断言全部由 dual.json / evidence.json 真实数据计算；
   `attestBrowserExecution` 会回读 browser-execution.json 逐字段比对 run，硬编码 PASS 无法通过。
   备注（P2）：`source-mapping` 的判定条件与 `target-change` 完全同构，是后者的逻辑推论，
   并非独立观测，建议后续给它加独立证据（如 SourceGraph 定位节点 ↔ 渲染元素的映射计数）。
3. **未运行/未知阻止审批** ✔ 任一视口未渲染 → run.status='incomplete'；任何断言非 pass →
   'risks'；脚本只在 status==='passed' 时调 `approve()`，而 `approve()` 本身又强制
   `run.status==='passed'` + `assertTrustedBrowserExecution`。双保险，fail-closed。
4. **双端 DOM 比较的保证范围** ✔ 遮蔽目标图 src 后的 #root outerHTML digest 对比 +
   `data-ripple-*` 属性剥离。保证：除目标图外 DOM 结构/文本/属性一致。
   漏检边界（如实记录，非缺陷）：CSS 视觉差异、canvas、目标图以外的像素级渲染、
   基线端横向溢出未对照（仅观测候选端）、快照 >2 MiB 时记 reason 并阻断（fail-closed）。
5. **证据互相对应** ✔ evidence.json / dual.json 的 sha256 已用 JS 兼容序列化独立复核一致；
   四张视口 PNG 魔数与哈希有效；VerificationRun 绑定 candidateId / patchHash /
   candidateTreeDigest / runtimeFingerprint / contractHash；截图复制进 artifactRoot 时重新校验魔数。
6. **失败清理** ✔ 本次运行后 qingye 克隆 `git status` 干净、`git worktree list` 只剩主检出
   （baseline/candidate worktree 均已移除）；SIGKILL 残留场景由 112b706 引入的
   `rmSync` 自愈 + 启动时 `worktree prune` 覆盖。临时服务器在 finally 中关闭。
7. **本机 vs GitHub 私有验收区分** ✔ media-acceptance.yml 仅 `workflow_dispatch`，
   用 BOLT_REPO_TOKEN 检出私有青野库并上传工件；本机验收显式标注 file:// 字节为
   "非 CI 验收路径"。两者不混用。

**新增代码（唯一改动）**：`src/core/media-viewport-evidence.test.ts` 追加 40 行——
`mediaDualEndpointSha256` 的篡改负例（对应验收脚本对 dual.json 的哈希回验门，原先无直接测试）。
该文件 18/18 通过。

## 二、PR #9 CI #280 失败（任务二）——根因已定位，最小修复已验证，**待 B 应用到 PR #9 分支**

- CI：run 39455710555（run #280，分支 feat/thirdparty-dash-ui-20261019 @ d5764e78），
  失败步骤 `npm test -- --run`。
- **本机复现**（PR #9 HEAD 独立 worktree）：`src/core/scope.test.ts` 唯一失败
  `does not treat imported media definitions as consumption and follows concrete TEXT reads
  and imported CSS token use` —— 期望 `pageRefs` 全页面 + `source-proven`，实际 `[]` + `unknown`。
- **根因**：不是 SourceGraph 回归，也不是冻结契约变化。PR #9 的合并提交 `2dc3273`
  （merge a60364d into c3904b9）取了**新**的 fail-closed `scope.ts`（需页面级 css-cascade
  证据才证明 Token 影响，来自 f0e8769/c6c9c99 一系），却保留了**旧**的 scope.test.ts
  期望（imports 即足以证明 → source-proven）。实现与测试版本错位。
- **证据**：PR #9 的 scope.ts 与 PR #7/PR #4 HEAD 逐字节一致（`git diff` 为空），
  只有 scope.test.ts 落后；main 上根本不存在 scope.test.ts，无第三方参照系，
  新期望（fail-closed）是 PR #4 自身后续提交确立的冻结契约。
- **最小修复（已验证，未擅自应用）**：把 PR #7 版的 `src/core/scope.test.ts` 覆盖到
  PR #9 树后该文件 8/8 通过。即：恢复 fail-closed 期望（这是**收紧**而非放水，
  不是"把 proven 改成 unknown 让 CI 通过"——恰恰相反，旧期望才是放水的那个）。
  建议 B 在 PR #9 分支上执行：`git checkout origin/feat/b-media-executor-20261019 -- src/core/scope.test.ts`。
- PR #9 全量套件本机另有 ~19 个失败，逐一核对全部为已知 Windows EPERM 临时目录
  清理噪音（与 PR #7 树同机对照完全一致，零断言失败；Linux CI #279 同代码全绿）。
- 未触碰 PR #4 的解析器，无重构。

## 三、代码质量审查（任务三）

- **P0**：无。审批门控、fail-closed、哈希绑定、符号链接/路径安全（serveStatic
  realpath 校验、暂存区哈希路径、assetRef 段校验）均有测试覆盖且逻辑正确。
- **P1**：即第二节 PR #9 根因（属流程缺口而非代码缺陷）。
- **P2**（仅记录，未改代码）：
  1. Windows 本机全量测试存在系统性 EPERM 清理噪音（project / local-project-api /
     preview-resource-policy / media-asset-swap / e2e teardown 均中招，PR7 与 PR9 树同机
     表现一致）。建议后续在各 afterEach 的 `rmSync` 上加有限重试（如 3 次 × 200ms），
     仅测试夹具，不动断言。Linux CI 仍为权威。
  2. `media-qingye-acceptance.ts` 在 Windows 要求青野检出为 LF（candidate worktree 以
     `-c core.autocrlf=false` 检出后做字节 digest 比对，CRLF 工作树必然 fail-closed）。
     建议把"Windows 需 `core.autocrlf=false` 克隆"写进验收脚本用法注释或契约文档。
  3. `source-mapping` 断言与 `target-change` 同构（见任务一第 2 条）。
  4. 基线端 `<viewport>-baseline.png` 截图哈希已采集进 dual.json，但未复制进
     VerificationRun 的 artifactRoot 绑定（可追溯性小缺口）。

## 四、验证结果汇总（本机，Windows；Linux CI 为权威）

| 门 | 结果 |
|---|---|
| `npm run typecheck` | ✅ 通过（app + node 两配置） |
| `npm run build` | ✅ 通过 |
| Vitest 核心批次（media-server / viewport-evidence 18/18 / scope / session / contract 等 12 文件） | ✅ 全过（media-asset-swap 7 个用例体全过，仅 teardown EPERM） |
| Vitest app 层 10 文件 | ✅ 26/26 |
| Vitest project / local-project-api / preview-resource-policy | ⚠ 断言零失败，teardown EPERM（与基线相同的已知噪音） |
| 青野真实 MEDIA 验收（脚本全流程） | ✅ PASS（见第一节） |
| Playwright `four-viewport evidence` 用例 | ✅ 用例体通过，afterAll teardown EPERM（同上） |
| Playwright `candidate-preview`（Docker 隔离） | ⏭ 本机无 Docker，按 spec 设计跳过（CI 跑） |

## 五、交接注意

- **可能与 B 原工作区冲突的文件**：`src/core/media-viewport-evidence.test.ts`（本分支唯一改动）；
  `B_OVERNIGHT_HANDOFF.md`（新增）。若 B 本地也改了该测试文件，合并时以本分支的
  新增 describe 块（`mediaDualEndpointSha256（dual.json 篡改回验门）`）为准插入即可。
- **未解决的问题**：PR #9 的 scope.test.ts 同步（第二节，等 B 决定）；P2 四条均为可选改进。
- **新增 vs 审查结论**：新增代码只有 media-viewport-evidence.test.ts 的 40 行测试 +
  本文档；其余全部为审查/复现结论，无其他代码改动。
- 分支推送后不会合并；等 B 本人审核。青野验收本机证据（acceptance.json /
  dual.json / verification 工件）在本机 `_scratch/media-acceptance/work/`，可随时复核。
