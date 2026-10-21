# Run #13 前性能门控：受限依赖预构建实验记录（2026-10-22，复审第 2 轮修正版）

协调人批准实验（2026-10-22），复审第 2 轮（2026-10-22）关闭两个 P1 后的最终记录。
目标：在不放宽任何 Project-first 安全边界的前提下，消除 Bolt Run #12 中每次
导航接近 10 秒的模块加载成本。

## 变更（PR #17，性能优化保持独立可回退提交）

- `ac04bbf` `perf(preview): restricted optimizeDeps discovery for bare deps, reversible`
  （后经 `dab7eb3` 按复审修正，见下）
- `dab7eb3` `fix(preview): production-faithful restricted discovery + workspace annotation matrix`
- `83e374b` 伪造验证头安全边界测试；`1d5f26d` 合并 A@33791a2（D PR #18）。

回退方案：恢复 `noDiscovery: true` 并删除 `preview-optimize-deps-excludes.mjs`、
`preview-optimize-deps.test.ts`、`preview-workspace-annotation.test.ts`，无其它
代码依赖。

## 复审第 2 轮关闭的两个 P1

### P1-1 实验必须使用实际生产配置（已修正）

复审指出的问题属实且更严重：修正前，实验的对照腿**没有传任何 exclude**，
`linkedpkg` 实际被预构建（URL 日志出现 `deps/linkedpkg.js`），而测试断言
却声称 workspace 逐模块——bucket 按字符串 `linkedpkg` 匹配，两种 URL 形态
都计入同一桶，断言被静默绕过。

修正后：

- 测试工程镜像生产安装形态：react/react-dom/scheduler/lucide-react 是
  node_modules 里的**真实目录**；workspace 包是 realpath 落在项目内的
  symlink。restricted 对照使用与生产配置**完全相同的字段**（同一分类器、
  同一 include、同一 esbuild pins、holdUntilCrawlEnd）。
- 该工程上 `analyzeNodeModulesDeps(root)` 的实测分类：
  `thirdParty = [fakepkg, lucide-react, react, react-dom, scheduler]`，
  `excludes = [linked-ui, linkedpkg]`。第三方参与预构建，workspace 排除。

### 分类规则（realpath 语义，替代第 1 轮的"凡 symlink 即排除"）

- node_modules 内真实目录 → 确认的第三方，可预构建；
- symlink 且 realpath 仍含 `node_modules` 段（pnpm `.pnpm` store 布局）→ 确认
  的第三方，可预构建；
- symlink 且 realpath 无 `node_modules` 段 → workspace 源码，排除；
- realpath 无法解析 → 来源未知，保守排除；
- **node_modules 扫描失败 → `ok: false`，生产配置拒绝优化、回退
  noDiscovery**，绝不返回空列表放开全部依赖（`candidate-preview-vite.config.mjs`
  中三元选择；`preview-optimize-deps.test.ts` 第三个用例固定该行为）。
  项目根本没有 node_modules（ENOENT）是完整安全的答案，返回空列表。

### P1-2 workspace 注解语义矩阵（已钉死，不扩大支持范围）

`preview-workspace-annotation.test.ts` 记录五列事实（项目 TSX 正例 + workspace
TSX 反例，Linux CI 实测）：

| 列 | 项目 TSX（/src/Cmp.tsx） | workspace TSX（linked-ui/Panel.tsx） |
| --- | --- | --- |
| 是否被预构建 | 不适用（项目源码不在 node_modules） | 否（exclude 生效，Linux URL 证据：`/node_modules/linked-ui/Panel.tsx` 逐模块） |
| 经过 sourceAnnotationPlugin | 是 | **否**——transform 显式跳过 node_modules 路径且仅 tsx/jsx（source-annotation.ts） |
| DOM 可信来源注解 | `jsx:src/Cmp.tsx#31` | **无**（`data-ripple-source` 缺席） |
| Runtime Identity 可证明实例 | `stable-react-instance`，runtimeInstanceId 非 `:~` 结尾 | **无记录**（采集器查不到该 sourceRef） |
| SourceGraph 收录 | 收录 | **不支持**：A 主线 project.ts 的图排除 node_modules 路径；无 C 分支 SourceGraph |

结论：workspace 源码的运行时身份证明当前架构**不支持**，状态如实声明为
unknown/unsupported。未改动注解插件、未扩大支持范围。静态跨文件 hook 安全
索引（source-annotation.ts 的 linked-workspace 解析）仍覆盖 workspace 包，
但那只服务 hooks 落注决策，不产生运行时注解。

## 实测数据（Linux CI，真实 Chromium，真实 lucide-react@0.468 barrel）

应用形态：react 19.3 + lucide barrel（触发 3,100 次请求）+ 40 个项目组件 +
`@/` 别名 + symlink workspace JS 包 + symlink workspace TSX 包 + 项目动态导入 +
node_modules CSS 导入。第三方为真实目录（npm 安装形态）。

复审修正后 CI run 39667915489（job 日志 `A_bench/ci-round2-job.log`）：

| 指标 | noDiscovery 现状 | 受限 discovery（生产形态） |
| --- | --- | --- |
| DCL 第 1 次导航 | 3257 ms | 816 ms |
| DCL 第 2 次导航（稳态） | 2303 ms | 411 ms |
| lucide barrel 请求 | 3100 | 2（全部来自 `/.vite-cache-restricted-production/deps/`） |
| `/src/` 项目源码请求 | 10 | 10（完全相等） |
| workspace 请求（linkedpkg×2 + linked-ui Panel） | `/node_modules/...` 逐模块 | `/node_modules/...` 逐模块（无任何 `/deps/` URL） |
| dep CSS（fakepkg/style.css） | 2 | 2（CSS 管道不变） |
| late 动态依赖（扫描器不可见） | — | 1 次导航内完成渲染，无失控重载 |
| exclude 名单 | — | `[linked-ui, linkedpkg]`；第三方名单 `[fakepkg, lucide-react, react, react-dom, scheduler]` |

更早轮次（不同代码版本，仅供对照）：合并后 run 39661627222 曾测得稳态
3205→558 ms（当时对照无 exclude，数据作废）；run 39659560818 为合并前数据。

本地 Windows 对照（`dab7eb3`）：noDiscovery 10642/6169 ms vs restricted
2548/941 ms，结论一致。

## 字体授权边界（伪造验证头负例，第 1 轮已交付）

交互预览页面伪造 `x-ripple-verification-fonts` 发起 fetch：被严格文档 CSP 的
connect-src 在渲染器内拒绝（从未到达网络层）；`FontFace` 加载同 URL 被
font-src 拒绝。放宽形态只存在于验证执行器自身文档导航；未关 CSP、未放开
任意外部请求。`preview-csp.test.ts` 12/12。

## 联合回归（D PR #18 × B PR #17）

冲突文件仅 `candidate-preview-vite.config.mjs` import 块，双保留（D 的采集器/
安全 HTML 插入/点选桥 + B 的请求分形态 CSP/预构建），无任何整体覆盖。

复审修正后正式 CI（run 39667915489）：
- Vitest **426/426**（41 文件：D 的 runtime-identity 全量、B 的 CSP/导航/
  生命周期负例、本轮两个新实验文件）；
- Playwright **30 passed, 1 skipped**（D 的身份 E2E 与 stable-react-instance
  回归、B 的 CSP/导航 e2e）；
- typecheck、build 均绿；PR Draft、MERGEABLE。
- 本地 Windows 中 D 的 34 个测试因 `fs.symlinkSync` EPERM（非提权环境）失败，
  属本地环境限制，干净基线同样失败，Linux CI 为准。

## Run #13 门控结论

**已具备实际启动价值，建议负责人授权触发 Run #13，但以验证门对待：**

- Run #12 确切死因：每次导航 goto(DCL) 恒定 ~9.6–10.1 s（22,624 条字体 CSP
  console 错误已证实不是拖因）。本轮生产形态实验把 barrel 类依赖请求从
  3,100 降到 2，Linux 稳态 DCL 从 ~2.3 s 降到 ~0.41 s，与 Run #12 的 10 s
  缺口量级相符，且安全不变量全部以硬断言钉死。
- 按协调人规则：合成/Linux 数字**不**直接宣布真实 Bolt 180 秒预算达标。
  真实 Bolt 的依赖广度、容器内单请求延迟、以及 Bolt 若用 pnpm 时 exclude
  的实际覆盖面，必须由 Run #13 测定。Run #13 应逐阶段记录模块请求数、导航
  耗时、字体加载、消歧事件与四视口完成情况，与 Run #12 progress.jsonl 对照。

剩余风险（诚实清单）：
1. 真实 Bolt 工程未做请求级归因——Run #13 是唯一最终裁决；
2. Bolt 若为 pnpm 全 symlink 布局，realpath 规则会把 `.pnpm` store 内依赖
   判为第三方（收益保留），但 workspace 包依旧排除（安全优先，可能少一部分
   本可安全的预构建）；
3. workspace 源码的运行时身份/SourceGraph 证明**不支持**（本文档矩阵），
   若 Run #13 的真实 Bolt 工程依赖 workspace 包内的点选身份，相关检查将以
   unknown 落地——这是当前架构的事实，不是本轮回归；
4. late-dep 重载在 vite 6.4.4 上实测受控（1 次导航内完成），真实工程触发
   频率未知；
5. 回退路径无损：恢复 `noDiscovery: true` + 删三个新文件即可，CSP/消歧修复
   不受影响。
