# CSS Custom Properties 来源证据研究（2026-10-24 实验数据，2026-10-25 B 接管复审）

> 任务书 P1：调查第三方真实 React/Vite 工程中 CSS Token 的来源证据，
> 产出"Token 定义 → 引用关系 → 消费元素 → 受影响页面 → 未决关系"链条，
> 并基于实证向 A 输出 CSS 执行器最小合同建议（→ AC-P6，
> 见 `a-interface-requirements-issue6.md`，已正式递交 A/C+D 评审）。
> 探针：`scripts/b-css-token-probe.mjs` v2（可在任意 A-core 检出运行）：
> `--assert` 编码当前不支持边界为回归基线（冻结）；`--acceptance` 为
> AC-P6 能力验收模式（当前 exit 2 = 预期待实现，CI 按"exit 2 预期 /
> exit 0 能力落地需翻转 job"语义执行，exit 1 表示执行/解析异常；
> **未把 --assert 改成期待全通过**）。
> 本报告全部数据由其产出，可复跑。v2 变更：ground truth 覆盖**全部**被跟踪
> CSS 文件（含无定义的消费型样式表 footer/nav/interests）、src/dist 分离
> 统计、规则上下文（选择器/媒体查询/伪类）与静态消费元素映射、六项独立
> 正反例。
> 2026-10-25 接管修订为 v4：AC6.1–AC6.5 均从运行时 SourceGraph 动态判定，
> 以源路径、字节偏移、作用域、实际边与真实路由作为证据；status 区分
> PASS/PENDING/ERROR，exit `0/2/1` 分别表示全部通过/能力待实现/执行异常。
> 下方 2026-10-24 的 v2 实测数据保持为历史观察，不冒充本次能力验收结果。

## 结论先行

1. **真实正例成立**：在一个纯 CSS Custom Properties 的真实 React/Vite 工程中
   （MIT 许可），A core **能够提取全部 token 定义**（11 个不同变量名，值与
   文件/偏移位置精确捕获），"token → 声明"链是真实且 source-proven 的。
2. **但消费侧几乎整体缺失**：全工程 **252 处** `var(--x)` 消费（v2 ground
   truth：src 126 + dist 126，覆盖全部 9 个被跟踪 CSS 文件），图中仅有
   **1 条** uses-token 边——且这一条是指向**上游提交进仓库的 dist/
   构建产物**的 per-file 顺序伪影
   （`file:dist/assets/index-hJgMd1dF.css → token:dist/…css#10508`）。
   src 级图边为 **0**。
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
6. **v2 补充（src/dist 分离，探针 splitStats 实测）**：

   | 侧 | CSS 文件 | 定义 | 原始 var() 消费 | 图 uses-token 边 |
   | --- | --- | --- | --- | --- |
   | src | 7（style/footer/nav/interests/layout + App/index 空文件） | 18（11 标签） | **126** | **0** |
   | dist | 2（上游提交的构建产物） | 18（11 标签，压缩后值字节不同） | 126 | 1（自指伪影） |

   注意：早期 v1 统计（212）只扫描了含定义的 2 个文件；v2 按 `git ls-files
   *.css` 覆盖全部文件，footer/nav/interests 三个纯消费样式表贡献 38 处
   src 级消费——**从图派生文件列表会静默漏掉 30% 的真实消费**。

## 实验对象（固定）

| 项 | 值 |
| --- | --- |
| 工程 | allanhue/webportflio（React 18 + Vite，HashRouter 6 路由） |
| 固定 SHA | `b244f857457d2a07f118155602eef9097fd322bd` |
| 许可证 | MIT（仓库内 `License` 文件，2026 版权行） |
| A 核心 | `2f2e5a708bff554775bea539fb659974203e67b8`（与 P0 验证同一基线） |
| 图统计 | 398 节点 / 253 边 / unresolved 1（`src/pages/About.jsx → ../assets/passport allan.jpg`，带空格资源导入） |

## P0-1 当前验收快照（2026-10-25）

本次机器报告位于 `evidence/b-css-token-probe-20261025/current-acceptance.json`，
绑定 A 公共基线 `1373ca2e20c56f59cf633a005100c2aa1d2a1bc0` 和第三方 SHA
`b244f857457d2a07f118155602eef9097fd322bd`。结果为 `0/5 PASS, 5 PENDING,
0 ERROR`，退出码 `2`。每项都保留了对应 SourceGraph 节点/边/路由证据；未把
静态 ground truth 当成图通过，也未写死 `false` 验收值。

CI 将两类目的拆开：历史 unsupported-boundary regression 仅检出旧 A SHA
`2f2e5a708bff554775bea539fb659974203e67b8`，当前能力验收每次检出 A 公共分支
最新 SHA 并记录下来。前者通过只说明历史边界未漂移，后者的 `PENDING` 才说明
当前 A 能力尚未落地；两种结果不能相互替代。

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

| # | 关系 | Ground truth（v2，src 级） | 图中证据 | 判定 |
| --- | --- | --- | --- | --- |
| 1 | `--accent` 消费 | 43 处 `var(--accent)`（另含 3 处回退内层引用） | **0 条边**（4 处定义 > 1，门控丢弃） | unknown |
| 2 | `--text-primary` 消费 | 18 处 | 0 条边 | unknown |
| 3 | `--border-color` 消费 | 17 处（含媒体查询内 1 处） | 0 条边 | unknown |
| 4 | `--background` / `--card-bg` / `--text-secondary` / `--accent-secondary` | 14 / 14 / 13 / 3 处 | 0 条边 | unknown |
| 5 | `--skill-color → var(--accent)` 链式别名 | 定义值即 `var(--accent)`，消费 1 处（`:hover` 兄弟规则另有 `.skill-icon` 消费） | 无 token→token 边；唯一 1 条 file 边是 dist 自指伪影 | unknown |
| 6 | `var(--accent-color, var(--accent))` 回退 | `--accent-color` **全工程无定义**，3 处消费 | 0 条边（无定义可连） | unknown（静态不可判） |
| 7 | 媒体查询内消费 | `src/css/nav.css` `@media screen and (max-width:768px)` 内 `var(--border-color)` | file 级边（若有）不携带媒体上下文 | unknown |
| 8 | 伪类消费 | `.skill-badge:hover`、`a:hover`、`.section-title::after` 等多处 | file 级边不区分状态 | unknown |
| 9 | tailwind 风格 className 消费 | 本工程为普通 class，0 处 | component→token 边 0 条 | 不适用（真实形态差异） |
| 10 | 页面影响 | 6 条 HashRouter 路由 | **0 page 节点，0 条触及 page 的边** | 不可计算 |

**消费元素静态映射（v2，semantic-candidate）**：探针对每处 src 级消费解析
其所在规则的**选择器 + 媒体上下文 + 伪类**，并把选择器类名映射到引用它们的
JSX 组件（`className` 静态字符串匹配；`Nav.jsx`/`Home.jsx` 存在动态
className 无法静态覆盖，已单列）。123 个消费组触及 10 个组件：
Cert / ContactForm / Exp / Experience / Footer / Home / Intrests / Nav /
Projects / ThemeToggle。此映射是**静态语义候选**（certainty=
semantic-candidate-static-classname），真实 DOM 消费证明必须经浏览器
computed-style（见验收案例文档）。

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


## AC-P6 handoff contract — strict matcher revision (2026-10-25)

This revision hardens B's acceptance checker only; it does not change A's SourceGraph or introduce a CSS Token executor. The executable contract is in scripts/b-acp6-matching.mjs, with adversarial cases in scripts/b-acp6-matching.test.mjs. CI runs those tests independently of the historical boundary and current capability jobs.

### AC6.2 — token use edge provenance

A uses-token relation is accepted only when all of the following match the pinned source evidence:

- One endpoint is the exact token declaration node: token label, source path, UTF-8 byte offset (the graph must expose byteOffset/byteStart explicitly), and selector scope all match one parsed declaration. Generic offset/start fields are not assumed to be byte offsets.
- The other endpoint is a real source-positioned element node (jsx-element, host-element, or element), at the exact JSX element source offset and source path for a static consumer candidate.
- The relation carries a source-use reference matching the CSS file and exact var() source offset (an explicit byteOffset, charOffset/codeUnitOffset, an offset annotated as code-unit/utf16, or a stable css-token-use:<path>:<offset> evidence reference).
- Any scope carried by the edge agrees with the declaration node's scope.

A file edge, unrelated consumer, wrong source offset, wrong scope, dynamic-only candidate, or missing consumer cannot cover a declaration or use. AC6.2 checks each source declaration and every source use with such strict evidence. Missing graph evidence remains PENDING; malformed checkout/graph/report input remains ERROR.

### AC6.3 — exact route identity

Route identity authority and fallback priority are routePath > path > page > label > id. Path-shaped values in all five fields are normalized and compared; every valid identity on one node must agree. A routePath conflict with path, page, label, or id leaves AC6.3 PENDING, and lower-priority label/id values cannot hide it. If the higher-priority field is absent or not path-shaped, the next path-shaped field is the fallback. Each of the seven fixture paths must map to exactly one distinct route node. For example, /about cannot match /about-us; duplicate identities and reusing one graph node for two paths fail the check.

### AC6.4 — exact class and element identity

className values are compared as whitespace-separated class tokens, not substrings. The CSS selector parser ignores class-like text inside attribute selectors. A class pair is anchored only when the graph endpoint's source path and JSX element offset identify the exact parsed source element; explicit matchedClass, className, classes, or selector class hints must agree exactly. Repeated classes do not create ambiguous partial matches. Dynamic className candidates remain unresolved without exact static evidence and keep the check PENDING. A file-only component edge or an absent element node is insufficient.

### Adversarial CI cases

The AC6.2–AC6.4 adversarial matcher tests job compares the strict matcher against the prior permissive conditions and covers:

| Check | Rejected counterexample |
| --- | --- |
| AC6.2 | An unrelated edge that merely touches a token node |
| AC6.2 | A wrong consumer endpoint, missing source-use position, or mismatched declaration scope |
| AC6.2/6.4 | A missing real consumer even if another consumer is linked |
| AC6.3 | /about incorrectly matching /about-us |
| AC6.3 | Duplicate route identity or one node reused for multiple route paths |
| AC6.4 | btn incorrectly matching btn-primary; only exact class tokens match |
| AC6.4 | Dynamic or absent element consumers with no source-position proof |

These tests validate B's matcher contract. They do not alter the fixed project's existing A result: the current public A baseline remains 0/5 PASS, 5 PENDING, 0 ERROR until its graph supplies the required evidence.
