# CSS Custom Properties 来源证据研究（2026-10-24，A 集成核心 2f2e5a7）

> 任务书 P1：调查第三方真实 React/Vite 工程中 CSS Token 的来源证据，
> 产出"Token 定义 → 引用关系 → 消费元素 → 受影响页面 → 未决关系"链条，
> 并基于实证向 A 输出 CSS 执行器最小合同建议（→ AC-P6，
> 见 `a-interface-requirements-issue6.md`）。
> 探针：`scripts/b-css-token-probe.mjs`（可在任意 A-core 检出运行，`--assert`
> 编码当前边界为回归基线）；本报告全部数据由其产出，可复跑。

## 结论先行

1. **真实正例成立**：在一个纯 CSS Custom Properties 的真实 React/Vite 工程中
   （MIT 许可），A core **能够提取全部 token 定义**（11 个不同变量名，值与
   文件/偏移位置精确捕获），"token → 声明"链是真实且 source-proven 的。
2. **但消费侧几乎整体缺失**：全工程 **212 处** `var(--x)` 消费（独立重算
   ground truth），图中仅有 **1 条** uses-token 边——且这一条是指向
   **上游提交进仓库的 dist/ 构建产物**的 per-file 顺序伪影
   （`file:dist/assets/index-hJgMd1dF.css → token:dist/…css#10508`）。
3. **缺口根因（实证）**：每个品牌变量在 `:root`（暗色基准）与
   `[data-theme="light"]`（亮色覆盖）**两个作用域**各声明一次，core 的
   "恰好唯一定义才连边"门控因此丢弃**全部**真实源码级消费；core 不捕获
   选择器/作用域，无法区分"改亮色主题"与"改全部主题"。上游又把 `dist/`
   构建产物提交进仓库，定义再翻一倍（每个 token 4 处定义）。
4. **页面影响无法计算**：该工程 0 个 page/route 节点（HashRouter + `<Route
   element>` 未被识别，codescandy 的 data-router 识别不覆盖此形态），
   即便 file 级边存在也无路径传播到页面；B 已核实图中不存在任何
   触及 page 节点的边。
5. **codescandy 不充当 CSS Token 案例**：codescandy 为 SCSS 变量体系
   （30 个 `$` 变量，`--` 定义 0 处），SCSS ≠ CSS Custom Properties，
   此结论与阻断矩阵 v3 一致，本轮独立复核无变化。

## 实验对象（固定）

| 项 | 值 |
| --- | --- |
| 工程 | allanhue/webportflio（React 18 + Vite，HashRouter 6 路由） |
| 固定 SHA | `b244f857457d2a07f118155602eef9097fd322bd` |
| 许可证 | MIT（仓库内 `License` 文件，2026 版权行） |
| A 核心 | `2f2e5a708bff554775bea539fb659974203e67b8`（与 P0 验证同一基线） |
| 图统计 | 398 节点 / 253 边 / unresolved 1（`src/pages/About.jsx → ../assets/passport allan.jpg`，带空格资源导入） |

## Token 定义（正例，source-proven）

`src/css/style.css`（dist 为逐字构建副本，不重复列举）：

| Token | `:root`（暗色基准） | `[data-theme="light"]`（覆盖） |
| --- | --- | --- |
| `--accent` | `#ff5555` | `#e63946` |
| `--accent-secondary` | `#ff8c42` | `#f77f00` |
| `--background` | `rgba(20,28,45,0.92)` | `#f5f7fa` |
| `--text-primary` | `#f0f4f8` | `#1a1f2e` |
| `--text-secondary` | `#b0b8c8` | `#5a6b7f` |
| `--card-bg` | `rgba(28,40,65,0.85)` | `#ffffff` |
| `--border-color` | `#4a5f7f` | `#d8dfe8` |
| `--success` / `--warning` / `--info` | 仅 `:root` 声明（无亮色覆盖） | — |
| `--skill-color` | 在 `.skill-badge` 规则内声明，值为 `var(--accent)`（**链式别名**） | — |

- 定义提取：11 个标签全部捕获，值精确到字节与偏移（`--accent` 4 处定义
  = 2 作用域 × src+dist）。✅ source-proven
- 同名片段在两个作用域语义不同（暗色 vs 亮色品牌色），core 无法表达。❌

## 引用与消费关系（负例 / 未决）

| # | 关系 | Ground truth | 图中证据 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | `--accent` 消费 | 72 处 `var(--accent)`（src+dist） | **0 条边**（4 处定义 > 1，门控丢弃） | unknown |
| 2 | `--text-primary` 消费 | 31 处 | 0 条边 | unknown |
| 3 | 其余 7 个已定义 token 消费 | 合计 103 处 | 0 条边 | unknown |
| 4 | `--skill-color → var(--accent)` 链式别名 | 定义值即 `var(--accent)`，消费 2 处 | 无 token→token 边；唯一 1 条 file 边是 dist 自指伪影 | unknown |
| 5 | `var(--accent-color, var(--accent))` 回退 | `--accent-color` **全工程无定义**，6 处消费 | 0 条边（无定义可连） | unknown（静态不可判） |
| 6 | 媒体查询内消费 | `src/css/nav.css` L86 `@media (max-width:768px)` 内 `var(--border-color)` | file 级边（若有）不携带媒体上下文 | unknown |
| 7 | 伪类消费 | `.skill-badge:hover`、`a:hover` 等多处 | file 级边不区分状态 | unknown |
| 8 | tailwind 风格 className 消费 | 本工程为普通 class，0 处 | component→token 边 0 条 | 不适用（真实形态差异） |
| 9 | 页面影响 | 6 条 HashRouter 路由 | **0 page 节点，0 条触及 page 的边** | 不可计算 |

## 动态关系（静态分析不可证明）

- **运行时主题**：`ThemeContext.jsx` 在 `useEffect` 中执行
  `document.documentElement.setAttribute('data-theme', theme)`，初始值读
  `localStorage`——哪个作用域生效是**运行时状态**，静态无法判定；
  修改 `--accent`（`:root`）与修改 `[data-theme="light"] --accent` 的
  浏览器可见差异必须靠 computed-style 证据区分。
- **`--accent-color` 未定义消费**：6 处 `var(--accent-color, var(--accent))`
  的回退分支行为取决于运行时该变量是否被注入（当前工程从不注入，
  永远走回退）——静态分析无法证明。

## 与"页面影响"的差距

当前 core 的 CSS 模型是 file 级节点 + label 级 token，二者都不携带
页面语义；路由识别仅覆盖 data-router 形态（AC-P2b）而漏掉 HashRouter。
结论：**CSS Token 的"受影响页面"在现图上不可计算**——这是 AC-P6 的
核心需求，B 不自行扩展核心管线。

## 交付物

- `scripts/b-css-token-probe.mjs`：来源探针，`--assert` 将上述 9 项边界
  固化为回归基线（A 修复 scoped token identity / HashRouter 识别 /
  dist 产物过滤后翻转预期）。
- 向 A 的最小合同建议：见 `a-interface-requirements-issue6.md` AC-P6。
- 复跑：`node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/b-css-token-probe.mjs <project> --assert`
