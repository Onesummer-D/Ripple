# PR #61 AC-P6 固定样本独立复核

日期：2026-10-27

## 固定输入

- B 验收基线：`0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
- 评估提交：`1a2ec305bba0caa3877e4773feabe06c0605115c`
- 最新修复提交：`28d76e8cb44c5f697ce868ce44bfa8b5287b6273`
- 固定工程：`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- 固定工程 `src/css/style.css` SHA-256：`8de0b6c59beb8538534adcbd5bb20906bda6b6ca7b9e3998702a229a2506a920`
- 固定工程工作树：clean
- 探针：B 基线 `scripts/b-css-token-probe.mjs` v5
- 匹配器：B 基线 `scripts/b-acp6-matching.mjs`
- 运行环境：Windows workspace、Node v24.15.0、PostCSS 8.5.30、TypeScript 5.9.3；运行时按脚本要求使用 TypeScript loader。

## 结果

| SHA | status | PASS | PENDING | ERROR | exit |
| --- | --- | ---: | ---: | ---: | ---: |
| 1a2ec305bba0caa3877e4773feabe06c0605115c | PENDING | 2 | 3 | 0 | 2 |
| 28d76e8cb44c5f697ce868ce44bfa8b5287b6273 | PENDING | 2 | 3 | 0 | 2 |

两次报告的工程 SHA、源码字节哈希、图节点/边/未决数和 AC6.1–AC6.5 结论完全相同：

- Graph：650 nodes、4656 edges、253 unresolved。
- AC6.1：PASS。
- AC6.2：PENDING。
- AC6.3：PENDING。
- AC6.4：PENDING。
- AC6.5：PASS。

## 逐项证据

### AC6.1 — PASS

真实 CSS 声明按 `{file, byteOffset, selectorScope}` 唯一匹配。

- 源 CSS：18 个声明、11 个 token label。
- `:root` 与 `[data-theme="light"]` 的同名声明保持独立。
- 每个匹配节点均记录 `tokenOrigin`、`selectorScope`、`byteOffset`、`mediaContext`。
- 例如 `--accent`：
  - `:root`：byteOffset 287，graph node `token:src/css/style.css#297`
  - `[data-theme="light"]`：byteOffset 830，graph node `token:src/css/style.css#840`

### AC6.2 — PENDING

SourceGraph 已建立严格格式的候选消费者边，但真实 `var()` 覆盖仍不完整。

- 源使用 token：8 个。
- 完整覆盖：仅 `--skill-color`。
- 未覆盖：`--text-primary`、`--border-color`、`--accent`、`--text-secondary`、`--background`、`--card-bg`、`--accent-secondary`。
- 许多声明节点已经有严格边，但仍有真实 source use 的 `linkedStrictEdges=0`，例如：
  - `src/css/nav.css:681`，`.nav-logo:hover`
  - `src/css/nav.css:890`，`.nav-link`
  - `src/css/style.css:1998`，`.section-title`
  - `src/css/style.css:2232`，`.section-title::after`
- 因此不能把“存在部分 strict consumer anchors”升级成 AC6.2 PASS。

### AC6.3 — PENDING

七条目标路由已进入精确身份合同，但图中没有可匹配的 page/route 节点。

目标路径：

`/`, `/about`, `/experience`, `/projects`, `/certifications`, `/education`, `/interests`

实际结果：

- `pageNodes=[]`
- 七条 `matchedRoutes` 的 `graphNodeIds=[])
- 每条 `matched=false)
- `routeIdentityConflicts=[])

因此这不是“路由冲突误匹配”，而是当前图没有可证明的 route identity。匹配器保守地保持 PENDING。

### AC6.4 — PENDING

静态 class 证据有一部分成功，但动态 class 和未形成边的消费者仍未闭合。

- 147 个 source-positioned consumer pair 被收集。
- 147 个 anchored consumer records 被记录；仍有 53 个 uncovered pairs。
- `componentLevelEdgesTotal=0)。
- 动态 className 文件：
  - `src/layouts/Nav.jsx`
  - `src/pages/Home.jsx`（3 条记录）
- 动态 class gate：`PENDING: dynamic className expressions may produce additional consumers without exact static source evidence`。
- 这与“静态候选不等于 proven consumer”的合同一致，不能升绿。

### AC6.5 — PASS

未定义变量 `--accent-color` 的三个真实 fallback 使用都保留为显式 unknown，且带源位置：

- `src/css/style.css:12715`，`.stat-card::before`
- `src/css/style.css:12991`，`.stat-card:hover`
- `src/css/style.css:13078`，`.stat-icon`

结果：3 条 unknown edges、3 条记录，未把 fallback 当作成功消费证明。

## PR CI 归因

PR #61 的最新通用 CI：[run #880](https://github.com/Onesummer-D/Ripple/actions/runs/40370552947)。

- Typecheck：通过。
- CSS token source 单元测试：3/3 通过。
- 全量 Vitest：失败，`src/core/project.test.ts` 有 3 项旧期望不匹配：
  - `expected 31 to be 8`
  - route page 期望 `['/']`，实际为 undefined
  - `expected 40 to be 70`
- 因此 PR CI 当前不能标为全绿。该失败发生在项目图既有测试的期望值，不是固定样本探针把 PENDING 改成 PASS 的问题。
- 早期提交 `1a2ec305` 的 CI 还在 TypeScript 编译阶段失败，具体为 `src/core/css-token-source.ts` 的 `sourceStart` 可能为 undefined；`28d76e8` 正是对此加 guard。guard 修复后，探针指标不变，但全量测试暴露上述 3 个图期望更新问题。

## 结论

PR #61 在固定第三方 SHA 上确实落地了来源图字段、UTF-8 byteOffset、selectorScope、strict consumer anchor、路由精确匹配和 fallback unknown 保留；但按 B v5 正式验收合同，当前能力仍为：

**AC6.1 PASS、AC6.2 PENDING、AC6.3 PENDING、AC6.4 PENDING、AC6.5 PASS；总计 2/5 PASS。**

未修改 A 的 Candidate、Verification、Approval、Apply 或 Rollback 接口；未把静态候选提升为 proven；PR #61 继续保持 Draft。

