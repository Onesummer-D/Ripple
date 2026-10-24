# CSS Token 最小品牌色验收案例（webportflio，递交 A 实现执行合同）

> 任务书 P1：以 allanhue/webportflio @ `b244f857457d2a07f118155602eef9097fd322bd`
> （MIT）为首个目标，提出最小品牌色案例。B 交付**真实输入、期望与不确定性
> 边界**；Candidate 执行器、补丁生成、Scope/Override 保护与 computed-style
> 验证由 A 按 AC-P6 实现。B 不自行实现执行器。

## 案例选择：`[data-theme="light"]` 作用域的 `--accent`

**选择理由**：单作用域编辑是最小决策单元；亮色主题替换后暗色基准不受影响，
天然提供"目标变更 + 非目标保持"两类断言，无需多文件补丁。

### 真实输入（source-proven）

| 项 | 值 |
| --- | --- |
| 目标文件 | `src/css/style.css` |
| 所在规则 | `[data-theme="light"]`（L30-38 块内 L34） |
| 当前字节 | `--accent: #e63946;`（亮红） |
| 候选值 | `#7c3aed`（紫，与暗色基准 `#ff5555` 及次强调 `#f77f00` 可区分） |
| 定义偏移 | 探针 `token:src/css/style.css#…`（graph 捕获，值字节精确） |
| Scope 决策 | **仅亮色作用域**（变体 B：同时改 `:root` 作用域 = 全品牌重定义，作为第二案例） |

### 作用域消费者（探针静态映射，semantic-candidate）

`--accent` 在 src 级有 43 处直接消费 + 3 处回退内层引用（
`var(--accent-color, var(--accent))` 的 fallback 解析到 `--accent`）。
按规则聚合的主要消费组（选择器 → 组件）：

| 消费规则（样例） | 上下文 | 静态映射组件 |
| --- | --- | --- |
| `.section-title` / `.section-title::after` | 普通/伪元素 | CSS 有规则；固定 SHA 的七个 HashRouter 页面都没有实际 host 元素，保留 UNKNOWN |
| `.btn-primary` | 普通 | ContactForm 等 |
| `.nav-link:hover`、`.nav-link.active` | 伪类/状态 | Nav |
| `.skill-badge:hover` | 伪类 | Home（技能徽章） |
| `.stat-card::before`、`.stat-icon` | 伪元素/回退 `var(--accent-color,…)` | Home（统计卡） |
| `.footer .social-icon`、`.footer a:hover` | 页脚 | Footer |

**覆盖消费者须按真实 computed-style 记录**：CSS 写有
`var(--accent-color, var(--accent))`，但 `Home.jsx` 为每张 `.stat-card`
内联设置了 `--accent-color: stat.color`。因此 `.stat-icon` 与
`.stat-card::before` 实际采用卡片颜色，候选改 `--accent` 后必须保持；不能
只依据 CSS fallback 语法就推断它们会跟随品牌色。

### 期望（computed-style 前后对照，AC-P6.f 证据形态）

验证流程需要一次**交互**（默认主题为暗色，`localStorage` 初始为空 →
`data-theme=dark`）：先记录暗色基线 → 触发主题切换（点击 `ThemeToggle`
或执行 `document.documentElement.setAttribute('data-theme','light')`）→
记录亮色 before/after。

| 断言 | 暗色主题（不受影响） | 亮色主题（目标作用域） |
| --- | --- | --- |
| `body` background | `rgba(20,28,45,0.92)` 不变 | 不变（`--background` 未改） |
| `.section-title` color | 当前七条真实路由都没有 host 元素，保留 UNKNOWN | 当前七条真实路由都没有 host 元素，保留 UNKNOWN |
| `.btn-primary` background | 不变 | before `#e63946` → after `#7c3aed` |
| `.stat-icon` color（逐卡 inline 覆盖） | 不变 | 每张卡片保持自己的 `--accent-color` |
| `--accent-secondary` 消费元素 | 全部不变 | 全部不变（非目标变量） |
| 媒体查询规则（nav 768px） | 布局照常 | 布局照常（变量值变化不影响断点） |

### 不确定性边界（验证合同必须处理或显式声明）

1. **运行时主题状态**：生效作用域由 `ThemeContext` + `localStorage` 决定，
   静态不可知；验证必须显式设置主题并声明所用路径（UI 点击 vs 直接
   setAttribute——两者证据力不同，建议优先真实 UI 交互，同时回退
   到脚本设置并标注）。
2. **动态 className**：`Nav.jsx` / `Home.jsx` 存在动态 className 拼接，
   静态映射可能漏元素——computed-style 采样点应覆盖这两页，漏检即
   unknown，不得当作通过。
3. **伪类/伪元素**：`:hover`、`::after`、`::before` 需要 interaction 或
   强制状态（`element.hover()` / 注入 class），与 AC-P4 的
   interaction=unknown 问题同源——**样式验收依赖交互能力**。
4. **dist/ 构建产物**：上游提交了 dist。候选只能补丁 `src/css/style.css`；
   预览管线若直接伺服 dist 则变更不可见（必须走 dev server 或重建）。
   需要 A 明确：Candidate Preview 对该工程形态使用何种伺服基座。
5. **同名变量多作用域**：本案例刻意单作用域；变体 B（双作用域全品牌
   替换）用于验证 Scope 决策持久化与"全部主题生效"断言。
6. **`--accent-color` 回退**：CSS 中有 3 处 fallback 引用，但 Home 的统计卡
   在宿主上逐卡设置内联 `--accent-color`，因此它们在本固定页面中不跟随
   `--accent`。探针仍要求 SourceGraph 在各自源码位置保留未定义 fallback
   的明确 unknown；浏览器验收逐个检查 `.stat-icon` 与 `.stat-card::before`
   的 computed style，合同预期是保留原卡片颜色。只有确认某个实际消费元素
   没有覆盖后，才把 fallback 联动列为用户可确认的候选影响。

### 验收入口（A 实现 AC-P6 后）

`scripts/b-css-token-probe.mjs --acceptance` 从传入的实际 SourceGraph 动态计算 5 项能力检查
（scoped identity / 声明集连边 / HashRouter 路由 / 元素级锚点 /
显式 unknown）。exit `0=PASS`、`2=PENDING`、`1=ERROR`；固定工程缺失、Git/解析异常或 JSON 写入错误不能归为 PENDING。历史边界回归固定使用 A SHA `2f2e5a708bff554775bea539fb659974203e67b8`，当前能力验收则检出 A 公共分支的最新 SHA，两个 CI job 独立运行并各自记录 SHA。

### 2026-10-25 固定 SHA 浏览器基线校正

真实四视口 Chromium 对照与逐样本矩阵在
`b-css-token-browser-baseline-20261025.md` 及
`evidence/b-css-token-browser-baseline-20261025-review/` 留档。浏览器会实际导航到七个 HashRouter 路由，并在原版/候选、四视口、双主题下逐项记录 selector、computed property、expected/actual 与原因；原有 `.section-title` 及 `::after` UNKNOWN 断言继续保留。

另外，`ThemeToggle.jsx` 在该 SHA 未接入 App/布局，本轮通过 `ThemeContext` 所用的 `data-theme` / localStorage 机制脚本设主题，并如实标注 `script-fallback`。统计卡片在 JSX 上有逐卡的内联 `--accent-color`，实测 `.stat-icon` 与 `::before` 保持各卡颜色，不随 `--accent` 改变；这一覆盖边界取代旧案例中“必随 `--accent` 变化”的预期。外部 Google Fonts 样式表为隔离网络波动而替换成空 CSS 响应，字体排版不在这次证据范围内。
