# MEDIA `narrowMediaByReceiverType` 最小重放方案 + 负例矩阵

日期：2026-10-23 ｜ 作者：D（MEDIA / PR #26）｜ 基线：A 稳定 HEAD `3cc37c2408caad6d3b8fd65d6c36a07980aeb94e`（PR #28 已合入 A）

本方案回答协调人第七轮：新基线下 project.ts / scope.ts 与 `narrowMediaByReceiverType` 的实际接口差异、最小重放 diff、负例矩阵、哪些代码需 A 总集成协调修改。

## 0. 事实核对（全部实测）

| 核对项 | 结果 |
|---|---|
| `git diff 43f2ea2 3cc37c2 -- src/` | **零差异**（src 树逐字节一致；仅 e2e 三文件有 A 侧调整） |
| A HEAD `project.ts` `if (!linked)` 候选池循环 | 存在（L401–405），与 B 原版调用点逐字兼容 |
| A HEAD `scope.ts` `sourceProvenPageImpact(graph, sourceRef)` | 存在（L83），media 特设遍历 `mediaConsumerRelations`（L11）不变 |
| A HEAD `project.ts` `annotationNamesType` | **不存在**——随重放引入（+9 行） |
| 重放补丁 `git apply --check`（`209cf4f` project.ts +36/−2 与 project.test.ts +69）对 `3cc37c2` | 两段均 **exit 0，零适配** |
| 栖光证明 harness 对 `3cc37c2` 复跑 | CI run [39859399071](https://github.com/Onesummer-D/Ripple/actions/runs/39859399071) PASS（双 PageImpact 集合相等 + 5 负例全拒） |
| `3cc37c2` 自身全量 CI | success（run 39857778018） |

## 1. 最小重放 diff（B 已审查实现原样，105 行）

来源提交 `209cf4f`（feat/b-media-overnight-20261021 分支，青野真实集成的修复，fail-closed 语义经 B 侧审查）：

1. `src/core/project.ts`（+36/−2）：
   - `annotationNamesType`（+9 行，辅助：array / type-reference / union 递归匹配类型名）；
   - `narrowMediaByReceiverType`（+29 行，置于 `tokenNodes`/`mediaNodes` 声明之前）；
   - 调用点一行：`const pool = mediaNodes.get(node.name.text) ?? []` +
     `for (const media of narrowMediaByReceiverType(node, pool) ?? pool)`。
2. `src/core/project.test.ts`（+69 行）：1 个测试，3 组断言（见 §3 现有负例）。

语义（不变）：`product.image` 类成员访问解析不到字面量声明时，先用接收方声明类型
（interface / type alias）把候选池收窄到声明为该类型的绑定初始化区间；类型解析不到
或未命中任何区间 → 返回 `undefined` 走原名级候选回退（fail-closed 不降级）；池 ≤1
原样返回；收窄后为空数组如实使用（边变少 → unresolved 如实增加，由 candidate.ts
`assertScope` 拦截）。

## 2. 负例矩阵

### 2.1 随补丁已有（重放即恢复，必须保持通过）

| # | 负例 | 预期 |
|---|---|---|
| N1 | 未标注接收方（内联类型字面量 / any） | 走原名级候选回退，不 panic、不产生空池 |
| N2 | `categories[].image` 与商品图同属性名 | categories 图可证明到首页且 certainty 如实；商品图不被误提升 |
| N3 | 收窄命中类型声明区间 | 池内非本类型媒体（含同名）被滤除 |

### 2.2 重放时新增（协调人要求，A 侧合入前补入 project.test.ts）

| # | 负例 | 预期 | 拦截点 |
|---|---|---|---|
| N4 | 来源不完整：收窄依赖的 interface/type alias 声明落在受影响子图外（未解析导入） | unresolved 如实增加，候选生成被拒 | `candidate.ts assertScope`（零未解析硬门） |
| N5 | 动态资源：运行时拼接 / 变量 src | 不产生 media 字面量节点，MEDIA 候选 fail-closed | media-asset-swap 既有 unsupported 路径（不新开口子） |
| N6 | 非目标页面出现在 PageImpact.pageRefs | 集合不相等即拒绝 | 复用栖光 harness `assertStrictProof` 的集合相等断言模式 |
| N7 | 跨页 Scope 传播混入 certainty ≠ source-proven 的边 | 不得进入传播结果 | `scope.ts sourceProvenPageImpact`（非 source-proven 一律 unresolved） |
| N8 | 收窄把候选池滤空 | 生成 0 条 semantic-candidate 边（**不得回退全池**），候选被拒并给出可读原因 | `assertScope` + 测试断言边数 |

禁止通过方式：删除 unresolved、跳过异常、按页面名称猜测、回退全池。

## 3. 需 A 总集成协调修改的代码（D 不自行改）

| 项 | 说明 | 建议承担方 |
|---|---|---|
| `src/core/project.ts` 接受 §1 补丁（+36/−2） | 共享核心，按边界由 A 合入或授权 D 在 A 协调分支提交；合入后跑 MEDIA 批次 + A 全量门双绿 | A 合入 / A 授权 |
| `src/core/project.test.ts` §2.2 新增负例（N4–N8） | 与补丁同 PR 或紧随其后，由 A 确认测试落点 | A 合入 / A 授权 |
| Approval / Apply / Rollback 生命周期接入 MEDIA 候选 | MEDIA 批次（staging / swap / 四视口证据，PR #26）已具备执行器与证据模块；把媒体候选纳入 A Approval 门涉及 Receipt / Approval 接口，需 A 确认字段级契约；D 只提供证据 JSON 与四视口截图，不改门控 | A 定接口，D 供证据 |
| 青野正式 MEDIA 全链验收 dispatch | 固定工程 SHA（d01604c4×f7e4998a 或更新审核 SHA）+ `BOLT_REPO_TOKEN` + 负责人在 A 排期 | A 排期 |
| PR #26 rebase 至 `3cc37c2` 的时机 | MEDIA 批次与 A 基线对齐由 A 决定，D 不自行 rebase 制造噪音 | A 定时机 |

## 4. D 侧已完成（本方案交付前）

- `PINNED_CD_SHA` → `3cc37c2`，来源证明 CI 复跑 PASS（run 39859399071）。
- Lab README 口径更新为 A 基线复验（Lab 分支 `688ae0a`）。
- 重放补丁对 `3cc37c2` 干净套用验证（`git apply --check` exit 0 ×2）。

## 5. 验收门（按序）

1. A 接受 §1 补丁 + §2.2 负例 → MEDIA 批次 vitest 全绿 + A 全量门绿。
2. 栖光 harness 对含补丁的新基线复跑 PASS（集合相等 + 5 负例）。
3. 青野固定 SHA 全链回归：暂存 → 候选（含收窄）→ 四视口双端证据 → Approval → Apply → Rollback → 工件留存；逐项签署，未运行环节不记 PASS。
4. 回归通过前，PR #26 保持 Draft；不宣称 A+C+D+MEDIA 最终联合验收完成。
