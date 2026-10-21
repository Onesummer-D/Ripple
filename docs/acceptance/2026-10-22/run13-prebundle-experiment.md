# Run #13 前性能门控：受限依赖预构建实验记录（2026-10-22）

协调人批准实验（2026-10-22）。目标：在不放宽任何 Project-first 安全边界的前提下，
消除 Bolt Run #12 中每次导航接近 10 秒的模块加载成本。

## 变更（PR #17，独立可回退提交）

- `ac04bbf` `perf(preview): restricted optimizeDeps discovery for bare deps, reversible`
  - `src/core/candidate-preview-vite.config.mjs`：`noDiscovery: true` → 受限 discovery
    （`include: ['react', 'react-dom/client']` + `holdUntilCrawlEnd: true`）。
    `configFile: false`、固定插件集、`fs.strict`、四视口、180 秒预算、Receipt
    授权规则全部不变。
  - `src/core/preview-optimize-deps-excludes.mjs`（新）：见下方安全发现。
  - `src/core/preview-optimize-deps.test.ts`（新）：可复现实验，Linux CI 真实
    Chromium 上运行，数字可从提交单独复现。
- `83e374b` `test(preview): forged verification header gains no font capability`
  - 伪造验证请求头的真实浏览器负例（见下方安全边界）。
- `1d5f26d` 合并 A@33791a2（含 D PR #18 Runtime Identity）后的联合分支。

回退方案：恢复 `noDiscovery: true` 并删除两个新文件，无其它代码依赖。

## 关键安全发现：workspace 链接包会被预构建吞掉

实验第一版配置下，symlink 进 `node_modules` 的 workspace 包（pnpm/workspace
布局的典型形态）被 vite 优化器当作普通第三方依赖预构建——`/.vite-cache/deps/`
直接出现 `linkedpkg.js`。这意味着用户自己的 workspace 源码会绕过
sourceAnnotationPlugin，SourceGraph 绑定和 Runtime Identity 被静默丢弃。

根因：`preserveSymlinks: true` 下优化器按解析路径分类，无法区分 symlink 包与
真实依赖；去掉 `esbuildOptions.preserveSymlinks` 也无效（已实测排除）。

修复：`symlinkedWorkspaceExcludes(root)` 在配置构建期确定性地 lstat
`root/node_modules`（含 `@scope` 一层），凡是符号链接的包一律加入
`optimizeDeps.exclude`（vite 的 exclude 前缀匹配自动覆盖子路径导入，已对
vite 6.4.4 `moduleListContains` 源码核实）。真实第三方依赖（node_modules 内
真实目录）不受影响，仍会被预构建。

## 实测数据（Linux CI，真实 Chromium，真实 lucide-react@0.468 barrel）

应用形态：react 19.3 + react-dom + lucide barrel（3,496 个 ESM 图标模块，测试
中触发 3,100 次请求）+ 40 个项目组件 + `@/` 别名 + symlink 的 workspace 包
`linkedpkg` + 项目动态 `import('./boot')` + node_modules CSS 导入。

合并后 CI run 39661627222（job 119435832771）：

| 指标 | noDiscovery 现状 | 受限 discovery + exclude |
| --- | --- | --- |
| DCL 第 1 次导航 | 4450 ms（含 esbuild 冷启动） | 578 ms |
| DCL 第 2 次导航（稳态） | 3205 ms | 558 ms |
| lucide barrel 请求 | 3100 | 2 |
| `/src/` 项目源码请求（注解路径） | 12 | 12（完全相等） |
| workspace 包 `linkedpkg` 请求 | 2（逐模块） | 2（逐模块，未被预构建） |
| dep CSS（fakepkg/style.css） | 2 | 2（CSS 管道不变） |
| late 动态依赖（扫描器不可见） | — | 1 次导航内完成渲染，无失控重载 |

更早的 push run 39659560818 独立复现：noDiscovery 2234/1639 ms vs restricted
368/102 ms，数量级一致。

安全不变量断言（测试硬断言，非日志）：
- 两侧 `/src/` 请求数完全相等 —— 注解路径从未被预构建吞掉；
- `linkedpkg` 逐模块服务 —— workspace 源码身份保持；
- 渲染文本含 `home-helper-value` 与懒加载 chunk —— React 树与动态导入行为不变；
- restricted 各次导航 DCL 不慢于 noDiscovery 的 1.5×+500ms 软门槛；
- late-dep 导航次数 ≤3 且最终渲染成功 —— 首次依赖发现是受控行为，可观测，
  不是静默状态。

## 字体授权边界（伪造验证头负例）

真实浏览器测试（`preview-csp.test.ts`，12/12 本地、CI 均绿）：

- 交互预览页面自行伪造 `x-ripple-verification-fonts: verified-font-dependencies`
  发起 fetch：被**严格文档 CSP 的 connect-src 在渲染器内拒绝**，请求从未到达
  网络层；
- 同一 URL 经 `FontFace` API 加载：被 font-src 拒绝；
- 结论：放宽形态只存在于验证执行器自身的文档导航上，子资源响应头对 CSP
  执行无效力，伪造头在任何路径下都拿不到字体能力。未关闭 CSP、未放开任一
  外部请求。

## 联合回归（D PR #18 × B PR #17）

冲突文件仅 `candidate-preview-vite.config.mjs`，冲突段只有 import 块。解法为
双保留（非整体覆盖任一方）：

- D 保留：`collectRuntimeIdentitySnapshot` 采集器、`insertCandidateSelectionBridge`
  安全 HTML 注入与真实点选桥；
- B 保留：`requestCsp()` 请求分形态 CSP 中间件、`symlinkedWorkspaceExcludes`
  受限预构建。

合并后正式 CI（run 39661627222）：
- Vitest **424/424**（40 文件，含 D 的 runtime-identity 全量与 B 的
  CSP/导航/生命周期负例）；
- Playwright **30 passed, 1 skipped**（含 D 的身份 E2E 与 stable-react-instance
  回归、B 的 CSP/导航 e2e）；
- typecheck、build 均绿；PR 状态 Draft、MERGEABLE。

本地 Windows 有 34 个 runtime-identity 测试因 `fs.symlinkSync` EPERM（非管理员/
无开发者模式）无法建链而失败——纯本地环境限制，A 分支干净基线同样失败，
Linux CI 全绿为准。

## Run #13 门控结论

**已具备实际启动价值，建议负责人授权触发 Run #13，但应以验证门对待而非
达标宣告：**

- Run #12 的确切死因为：每次导航 goto(DCL) 恒定 ~9.6–10.1 秒（22,624 条字体
  CSP console 错误已证实不是拖因），合成对照与本次实验均指向深模块图逐模块
  请求瀑布。受限预构建把 240 宽的依赖 barrel 请求从 3,100 降到 2，Linux
  稳态导航从 ~3.2 s 降到 ~0.56 s，量级与 Run #12 的 10 s 缺口相符。
- 但按协调人规则：合成/Linux 数字**不能**直接宣布真实 Bolt 180 秒预算已满足。
  真实 Bolt 的依赖广度、容器内单请求延迟、pnpm 布局下 exclude 的覆盖面
  （若 Bolt 的顶层依赖全是 symlink，预构建收益会缩水）都必须由真实 Run 测定。
- 本次交付把可观测性补齐了：消歧事件在点击成功后记录并带 checkId/viewport/
  baseline/candidate；字体事件可区分形态；Run #13 应逐阶段记录模块请求数、
  导航耗时、字体加载、消歧事件与四视口完成情况，与 Run #12 的
  progress.jsonl 逐事件对照。

剩余风险（诚实清单）：
1. 真实 Bolt 工程未做请求级归因——Run #13 是唯一的最终裁决；
2. Bolt 若用 pnpm 且源码与依赖混布，exclude 粒度的实际收益未知；
3. late-dep 重载在 vite 6.4.4 上实测为 1 次导航内完成（未触发整页重载），
   但首次依赖发现路径在真实工程上的触发频率未知；
4. 若 Run #13 仍超预算，回退提交 `ac04bbf` 即可无损恢复 noDiscovery 现状，
   CSP/消歧修复（PR #17 前半部分）不受影响。

PR 保持 Draft，未合并 A/main，未触发真实 Bolt 工作流。交回独立审查。
