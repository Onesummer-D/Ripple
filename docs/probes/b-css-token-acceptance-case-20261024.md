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
| `.section-title` / `.section-title::after` | 普通/伪元素 | Home, About, Cert, Exp, Experience, Projects（页面节标题） |
| `.btn-primary` | 普通 | ContactForm 等 |
| `.nav-link:hover`、`.nav-link.active` | 伪类/状态 | Nav |
| `.skill-badge:hover` | 伪类 | Home（技能徽章） |
| `.stat-card::before`、`.stat-icon` | 伪元素/回退 `var(--accent-color,…)` | Home（统计卡） |
| `.footer .social-icon`、`.footer a:hover` | 页脚 | Footer |

**回退消费者须显式声明为预期副作用**：`--accent-color` 无定义，
`.stat-card` 系列 3 处的 computed 值跟随 `--accent`——改色后它们**必须**
随之变化，验证合同应把这列为"预期变化"而非"非目标保持"。

### 期望（computed-style 前后对照，AC-P6.f 证据形态）

验证流程需要一次**交互**（默认主题为暗色，`localStorage` 初始为空 →
`data-theme=dark`）：先记录暗色基线 → 触发主题切换（点击 `ThemeToggle`
或执行 `document.documentElement.setAttribute('data-theme','light')`）→
记录亮色 before/after。

| 断言 | 暗色主题（不受影响） | 亮色主题（目标作用域） |
| --- | --- | --- |
| `body` background | `rgba(20,28,45,0.92)` 不变 | 不变（`--background` 未改） |
| `.section-title` color | `rgb(255,85,85)` **不变** | before `rgb(230,57,70)` → after `rgb(124,58,237)` |
| `.btn-primary` background | 不变 | before `#e63946` → after `#7c3aed` |
| `.stat-icon` color（回退消费） | 不变 | 跟随 `--accent` 变化（预期副作用） |
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
6. **`--accent-color` 回退**：已定义为预期副作用；若 A 的合同选择
   "仅精确消费者"语义，则这 3 处必须显式列入 Scope 展示，由用户确认。

### 验收入口（A 实现 AC-P6 后）

`scripts/b-css-token-probe.mjs --acceptance` 已固化 5 项能力检查
（scoped identity / 声明集连边 / HashRouter 路由 / 元素级锚点 /
显式 unknown），当前 exit 1 为预期；A 落地后该命令 exit 0，
B 将 CI job 翻转为 required 并补本案例的真实候选正例。
