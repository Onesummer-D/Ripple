# Ripple 编辑器

统一领域契约、三案例 Fixture、候选编辑、影响范围预演、草稿应用和版本恢复。现已支持本地图片上传/资源库、三容器裁切对照、Token 色板和真实 Chrome 三视口验收。

## v0.5 RC1 当前能力与边界

冻结候选：`ed58cfdc2892acaa9b97363a3414b1c219d07053`，Tree `24de55f8bc1d8146b12b42b8bfdd4b24d5f41f6c`。
这是受控内部候选，不能视为已部署的公网真实工程工作台。

真实模式当前支持：

- React/Vite 工程分析、真实预演 iframe 和画布点选；
- SourceSelection、显式 ScopeDecision、Candidate 创建和候选预演；
- 四视口 Verification、正式七项断言、Approval、Apply、Rollback 和历史恢复；
- E③ Runtime Identity 单侧回执与只读配对 View；
- VersionFilmstrip 的真实证据 `archived / metadata / none` 三态，以及真实素材与 Demo 素材隔离；
- CSS SourceGraph 第一切片。AC6.2、AC6.4 仍为 PENDING，CSS 关系保持 `semantic-candidate / unknown`，不能自动授予 Token 授权。

当前不支持或不宣称：CSS Token 自动授权、最终 DOM/级联/computed-style 证明、多用户云端工作台、公开部署，以及真实 Bolt 专项通过。完整运行限制见 [`docs/experience/REAL-ADAPTER-CURRENT.md`](docs/experience/REAL-ADAPTER-CURRENT.md) 和 [`docs/releases/v0.5-rc1-manifest.md`](docs/releases/v0.5-rc1-manifest.md)。

## 启动

在本目录执行 npm install 和 npm run dev，然后打开 http://localhost:4173。依赖尚未恢复时可执行 `npm run preview:static`，打开 http://127.0.0.1:4174/preview.html 查看无依赖的录屏预览。

## 验证

npm run typecheck
npm run build
npm test -- --run
npm run smoke:static
npm run acceptance:phase4
npm run acceptance:phase5
npm run acceptance:runtime-node
npm run verify

`smoke:static`、`acceptance:phase4` 和 `acceptance:phase5` 不依赖 node_modules，可在依赖尚未恢复时先验证历史 Fixture、契约、adapter 交接边界、编辑器入口、响应式标识和交付文档。`acceptance:runtime-node` 使用 Node 内置实验性 TypeScript 转换，直接执行 domain、selector 和 adapter 的运行时冒烟；Vite、TypeScript、Vitest 和浏览器检查仍需恢复依赖。上方 RC1 能力说明是当前权威；下方 Fixture 和旧 Phase 说明保留为历史演示与兼容测试资料，不替代真实 Project API、Runtime Identity 或 SourceGraph 验收。

验收脚本默认按 Asia/Shanghai 写入 `docs/acceptance/YYYY-MM-DD/evidence/`；需要复现历史日期时可设置 `RIPPLE_ACCEPTANCE_DATE=YYYY-MM-DD`。

UI 只负责交互和渲染；草稿投影、影响范围、关系图节点和 Evidence 标签等纯派生逻辑集中在 `src/app/selectors.ts`，便于 B 的真实数据适配和独立测试。

`npm run verify` 顺序执行真正的 typecheck、build、Vitest 和 Playwright 三视口流程，写入日期化日志与 JSON。浏览器验收使用已安装的 Chrome；不需要另行下载 Chromium。报告包含源码摘要，代码变化后需重新验证。npm 的 package-lock.json 固定依赖解析，正常恢复可用 npm ci。

栖光先选中节目页 Slot，再上传 PNG/JPEG/WebP/GIF 或从本地海报库选图，生成候选并切换范围。图片保存于浏览器 IndexedDB，草稿 Snapshot 用 media://id 引用；资源保留用于恢复和刷新后复用，草稿历史目前保存在当前会话。裁切弹窗提供容器与完整原图对照，支持 Escape 关闭。浏览器本地资源库不随代码包迁移，正式离线导出将另行处理。

真实包格式与接入边界见 `docs/integration/real-evidence-package.md`。默认 `fixtureAdapter` 保持无真实包时的确定性演示，`createCaseAdapter` 可按 `CaseId` 替换单个案例。

## 页面与 Evidence

预览页面 tabs 只切换查看的路由；右侧 Slot 才会切换编辑位置，保留候选时可跨页面查看影响。设备按钮改变 iframe 的真实 375/768/1440 布局，缩放仅适配工作台。当前草稿、候选和重新预演独立于应用操作。

青野与栖光提供各四个本地页面，第三方保持明确标注的 Token 演示，待原站接入。Evidence 详情会读取可访问 JSON/TXT；资源缺失或未验证时显示对应状态。聚焦记录自动切到对应页面和已支持的视口。将 B 的文件放入 public 下对应路径，即可读取和跳转；缺少资源时不会把 Vite 的首页 HTML 当成证据文件。

本地 Fixture 的结构 JSON 来源于 src/cases/fixtures.ts，可使用 `node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/export-fixture-evidence.mjs` 同步生成 public/fixtures。它们明确标注 Fixture，不提供 B 检测或第三方仓库证明。Chrome 验收另外记录 A 本地活动页的 DOM 几何和共享/局部截图。

## 关系涟漪与实时观测

关系图沿 reads 边展开 Source 与实例；范围选择点亮实际受影响连线，About/Archive 独立来源保持可见。图下方路由按钮支持键盘导航，系统减少动态效果设置会停用涟漪动画。

预览下方实时显示当前页面标题/CTA 重叠、图片自然尺寸及容器裁切区域、Token 实际计算颜色。打开测量详情可查看 Evidence ID 和下载 JSON。每次切换文档、范围、设备或资源都会取得新样本；应用草稿会保存已完成且匹配当前预览的样本，版本历史提供独立证据详情。未完成测量时应用仍可保存草稿，该版本不附浏览器测量证据。当前所有这些实测来自 A 本地页面；第三方原站与 B 分析包仍待接入。

## 解释与处理

生成候选后，关系图下方说明共享来源与消费页面，并显示结构证据ID；可在右侧Evidence打开对应记录。来源卡上的“只改当前实例并重新预演”和“同步同源实例并重新预演”直接更新范围，保留当前查看的页面。

页面下方的“这次预演说明了什么”根据当前样本解释重叠面积、图片裁切和计算颜色。每个具体发现都引用Evidence ID，可打开原生详情、下载JSON或聚焦页面。它是本地规则解读；未知或尚未完成的测量显示待确认。切范围、路由、设备和候选时旧样本随即失效。
