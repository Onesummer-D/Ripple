# AC-P6 CSS Token SourceGraph 第一切片

本切片在固定第三方 React/Vite 工程验收前，先定义 SourceGraph 能记录的源码事实与保守边界。它不修改冻结的 Runtime Identity v1.2 合同，也不授权 TOKEN Candidate、Scope、Verification、Approval、Apply 或 Rollback。

## 记录的源码事实

- `token` 节点对应每一条真实 CSS 自定义属性声明。`location.offset` 是 CSS 源码中属性名的 JavaScript 字符偏移，`byteOffset` 是 UTF-8 字节偏移；`location.start/end` 保持原有声明值位置及 Token ID 兼容。
- 同名声明按文件和源码偏移分别建节点，并附 `selectorScope`。`:root`、主题选择器及各自的值不会被折叠为单一声明。
- `token-use` 节点对应每一次 `var(--name)` 调用，包括 fallback 内层调用；节点及边同时保留字符偏移、UTF-8 字节偏移和来源 CSS 文件。
- `token-reference` 候选边从声明连到精确 `var()` 使用位置。`css-cascade` 候选边从使用位置连到静态 className 可能匹配的 JSX 元素。直接 `uses-token` 候选边保留消费者到声明的索引，便于现有图查询和 AC-P6 验收器读取。
- 静态 HashRouter/BrowserRouter `<Route path="…" element={…}>` 路径生成独立 route 节点；可定位的 JSX host 节点附带其静态页面集合。无法解析的路径或组件继续记入 `unresolved`。

## 置信度与 unknown

CSS 声明、`var()` 调用及它们在文件中的位置来自 PostCSS 解析后的源码锚点。声明到引用、引用到 JSX、消费者到声明的关系均为 `semantic-candidate`，不是级联或浏览器证明。每个静态候选仍附带 `css-token-use-unknown` unresolved 项与 `unknown` 关系，说明最终 DOM 消费、主题状态、继承、级联、媒体激活及 computed style 尚未证明。

同名多作用域声明全部保留为独立节点；引用边只枚举候选声明，不选择最终生效者。未定义变量（含 fallback 外层）、未匹配或动态 JSX className、复杂/转义 selector、CSS 解析错误都降为 unknown；解析器提供行列位置时，错误记录携带该位置。fallback 中每个 `var()` 都独立记录，因此已定义的内层 fallback 引用不会抹掉外层未定义状态。

媒体条件保存在 `mediaContext` 中供检查，不参与激活判断。当前 class 匹配只做静态候选：它不计算 compound selector 的完整布尔语义、伪类/伪元素状态、Shadow DOM、运行时注入样式或完整 CSS cascade。主题切换和这些条件下的最终样式需要真实浏览器与 A 所属的正式 Verification 证据。

## 接口归属

- C+D 生产 CSS 声明、引用位置、静态 selector/class 候选及页面来源节点。
- A 继续拥有 Token Candidate 执行合同、Scope 决策持久化、computed-style VerificationRun 及正式证据结构。
- E 只读取已形成的正式运行证据，不生产 CSS 来源关系。
- 任何 SourceGraph 侧候选边均不能单独进入精准编辑授权。`sourceProvenPageImpact` 对 Token 仍应保持 `unknown`，直到正式的运行时消费者证据和后续合同明确其升级条件。

## 目标样本与验收

第三方样本固定为 `allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`。B 的验收器动态检查 AC6.1–AC6.5：作用域声明身份、完整声明集与 `var()` 引用连接、七条 HashRouter 路径、带源码位置的静态消费者锚点、未定义 fallback 的逐位置 unknown。此文件不预设通过项；结果以固定 SHA 上实际运行的验收报告及 CI 工件为准。
