# Ripple 编辑器架构边界

## 数据流

```text
CaseFixture / real package
        │
        ▼
adapter ──► CaseFixture ViewModel
        │
        ▼
domain state machine ──► CaseRuntime
        │                       │
        │                       ▼
        └──────────────► app selectors ──► UI projection
```

`domain` 只处理状态转换和契约校验，不依赖 React。`adapters` 负责把 Fixture 或 B 的真实包映射到同一套 `CaseFixture` 边界。`app/selectors.ts` 只做纯派生计算，不修改输入对象；它集中处理草稿值、INSTANCE/SHARED 影响范围、图节点/边和 Evidence 标签。`App.tsx` 负责事件绑定、局部输入状态和渲染。

新增真实数据时，优先在 adapter 或 selector 增加可测试的纯函数，再把结果接到 UI。不要在 JSX 中重新实现 source、instance、Evidence 的推导规则。所有跨案例验收应引用 `src/cases/truthMatrix.ts` 的稳定 Fixture ID。

MEDIA 的文件 I/O、解码和 IndexedDB 归 `adapters/mediaLibrary.ts`；`useMediaLibrary` 保持 App 级资源索引。domain 中 CandidateEdit 只携带资源元数据及 media:// 引用，不依赖浏览器 API。CandidateEditor 管理输入和异步请求生命周期，ContentPreview 渲染文字、图片或 Token 并提供原生裁切 dialog。candidatePreviewValues 负责候选投影，取消、应用与恢复仍通过领域状态机执行。

`preview/pageDocument.tsx` 将纯 Slot 投影渲染为独立页面文档，保留身份属性供浏览器验收与 B 分析使用；页面 CSS 不继承编辑器外壳。`PagePreview` 管理真实 iframe 设备尺寸和可视缩放。`previewRoute` 是查看状态，不改变 CandidateEdit 或 ScopeDecision；编辑 Slot、页面切换与 Evidence 聚焦拥有清楚的独立职责。

`EvidencePanel` 管理原生详情 dialog 与文件读取。只有成功响应且类型为 JSON/纯文本的来源才显示证据链接；记录更换/关闭会 abort 旧请求。截图使用显式 screenshotPath。unknown/loading 状态不会被 metadata 完整度升级，缺失资源保持不可用。A 自有页面浏览器测量与 B 原站分析结果在验收记录中分别注明来源。

`preview/relationship.ts` 从真实 reads 边派生来源与实例关系，`RelationshipMap` 提供 SVG 动效和键盘路由入口。图布局与测量计算均为纯函数。`preview/measurementBridge.ts` 在隔离 iframe 内等待图片解码与字体，再读取 DOM 矩形、自然尺寸和 computed style；几何读取刷新布局，因此离屏 iframe 也能完成测量。

`usePreviewMeasurement` 管理请求 nonce、当前 frame/source、超时和样本生命周期；`preview/measurement.ts` 核对身份及视口并生成带 `producer: A-preview` 的内联 Evidence。完整文档、资源、范围、候选、视口或重演变化均更换 iframe generation。App 只传递当前 previewKey 对应的 proof；domain 再按候选值及范围筛选，深拷贝到 Snapshot，历史详情可独立查看和下载。测量样本更新本身不会触发 iframe 重建。

## 验证顺序

解释层位于 `preview/explanations.ts`：`sourceExplanation` 投影 reads 消费关系与范围，`previewExplanations` 投影当前样本的观察、风险及建议。`SourceExplanation` 绑定已有范围命令并触发重新预演；`ExplanationPanel` 渲染当前样本与可追溯详情。来源结构记录保留 Fixture/unknown 标签，测量解读仅描述当前路由、设备和样本。组件不请求LLM，也不在渲染中推导领域规则。

```text
npm run smoke:static
npm run acceptance:phase4
npm run acceptance:phase5
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/runtime-smoke.mjs
pnpm typecheck
pnpm build
pnpm test -- --run
npm run verify
```

三个静态命令不需要安装依赖，适合先检查边界。Node 冒烟直接执行 domain、selector 和 adapter。依赖恢复后 npm run verify 运行正式类型、构建、Vitest 和 Chrome 三视口验收并存储日志；报告的源码摘要必须匹配当前文件，才能解除技术验收待办。真实 B 数据的阶段门独立核验。
