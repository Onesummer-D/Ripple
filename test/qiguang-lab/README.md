# 栖光艺术节 · 媒体素材替换 Lab（React/Vite 多页面工程）

本目录是 D 侧集成准备的**真实工程形态 Lab**：以 React/Vite 扁平多页工程模拟栖光艺术节
站点，验证同一共享媒体源被**三个不同页面、三种不同容器**消费时，横版→竖版素材替换在
四视口下的真实裁切几何，以及替换范围的收窄正确性（非目标资源不受影响）。

**定位声明**：本 Lab 的消费关系（三页共享同一媒体源）由工程结构显式声明，不依赖真实
工程的 SourceGraph 消费证明；结果**不得**作为 C+D 联合实测或真实 MEDIA 验收 PASS 引用。
真实工程的 MEDIA 生命周期验收仍以青野专项 workflow 为准。

## 工程结构

```
index.html / program.html / tickets.html / archive.html   扁平多页（.html 入口）
src/main.tsx                    共享入口：按 <body data-page> 渲染对应页组件
src/components/SharedFestivalImage.tsx   共享媒体唯一编辑点（唯一 img src 字面量）
src/pages/{Home,Program,Tickets,Archive}.tsx
public/media/                   四象限标尺素材（scripts/generate-assets.py 可复现）
scripts/build-variants.mjs      dist-wide（基线）/ dist-tall（候选）构建 + 源文件强制还原
scripts/collect-evidence.ts    双端受限静态服务 + 驱动 B 的四视口采集器 + 非目标资源断言
evidence/                     一次真实 Chromium 采集产物（本目录，可复现覆盖）
```

**扁平多页的原因**：验收受限静态服务（`src/core/media-acceptance-server.ts`）对无扩展名
路径做 SPA 回退到根 index.html，目录式 MPA（`/program/`）不可用。

## 测试意图矩阵

| 意图 | 位置 | 消费容器 | 断言 |
| --- | --- | --- | --- |
| 共享媒体 · 三容器同步替换 | 首页 Hero / 节目页展墙 / 购票卡片 | 16:9 cover center / 4:3 cover 50% 20% / 3:4 cover top | 三页各自四视口断言（loaded/source-swapped/crop-geometry/browser-errors）全部 pass |
| 单页本地媒体不受共享替换影响 | 首页 `/media/qiguang-home-local.jpg` | — | 双端 HTTP 字节相等 |
| 独立页面媒体不受共享替换影响 | 档案页 `/media/qiguang-archive.jpg` | — | 双端 HTTP 字节相等 + 双端渲染一致（零共享消费、自然尺寸 1600×900、marker「往届档案」） |

## 复现

```bash
# 仓库根（依赖解析自仓库根 node_modules，本目录不跑 npm ci）
python test/qiguang-lab/scripts/generate-assets.py
node test/qiguang-lab/scripts/build-variants.mjs
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
  test/qiguang-lab/scripts/collect-evidence.ts
```

`build-variants.mjs` 在 finally 中强制还原 `SharedFestivalImage.tsx` 并做还原后字节校验，
若共享媒体 src 不处于 wide 基线则拒绝构建——模拟"替换意图只作用于唯一编辑点"。

## 观测结论（2026-10-23 本机 Chromium 一次采集，evidence/ 为证）

- 三页四视口采集器退出码均为 0，`evidence.json` 四项断言全 pass；每页
  `evidence.json` / `dual.json` 带内容哈希，8 张截图（4 视口 × 双端）齐备——
  **三页共 24 张截图**（3 页 × 4 视口 × 基线/候选双端），字节与 evidence/dual 登记的
  截图 sha256 一一对应。
- 口径边界（如实）：上述断言证明的是**目标图加载/换源/裁切几何/无浏览器错误**与
  **非目标媒体字节一致**、档案页**关键 DOM 与媒体状态一致**；不构成完整页面逐像素
  一致声明，也不构成 SourceGraph 自动证明或 A 正式 MEDIA 生命周期验收。
- 候选端统一加载 900×1125 竖版源，进入三个不同容器：
  首页 Hero 1048×590（16:9）、节目展墙 720×540（4:3）、购票卡片 298×397（约 3:4）；
  object-position 分别 center / 50% 20% / top，裁切窗口逐页逐视口可查（`evidence.json`）。
- 与基线端（1600×900 横版源进同一盒子）相比，购票卡片这类窄高容器差异最大：
  横版源被深度放大（可见源宽度约 50%），竖版源几乎完整可见（`tickets/desktop*.png` 对照）。
- 非目标资源断言通过：档案图与首页本地图双端字节一致；档案页双端渲染一致且零共享消费。

## 边界

- 动态消费（运行时切换图源）不在本 Lab 范围，按 B 既有结论 fail-closed。
- 本 Lab 证明的是「真实 React/Vite 多页工程形态下的采集与几何推导链路」，
  消费关系授权仍待 C+D 联合集成时由 SourceGraph 真实证明接管。

## data-router 联合验证变体（router-variant/）

协调人第五轮授权的先行交付：在 A 集成基线就绪前，独立提交 data-router 形态变体与
证明 harness（不触碰共享 SourceGraph 文件，不覆盖 A 工作树）。

- **形态**：对齐 PR #28 已验证夹具——命名导出 `App` 组件 + `createBrowserRouter`
  路由表（`{ path, Component }` 平铺四项），`main.tsx` 无条件 `createRoot(<App />)`。
  共享媒体消费容器与 MPA 主 Lab 完全一致（Hero 16:9 / 展墙 4:3 / 卡片 3:4）。
- **harness**（`router-variant/scripts/verify-sourcegraph-proof.ts --core <宿主checkout>`）：
  变体复制为临时干净 git 工程（含 react-router 依赖），用宿主的
  `analyzeProject` / `sourceProvenPageImpact` 断言——共享媒体影响恰含
  `/` `/program` `/tickets` 且 source-proven；档案独立媒体恰含 `/archive`；
  任一不满足即非零退出。
- **严格断言（2026-10-23 返工）**：`assertStrictProof` 纯函数执行 pageRefs **集合相等**
  （共享恰为 `page:/, page:/program, page:/tickets`，档案恰为 `page:/archive`，
  多页/缺页均拒绝）、certainty 必须 source-proven、两个 PageImpact 的 unresolved 必须
  为空、`graph.unresolved` 为空为显式断言；共享/档案媒体节点匹配数 ≠1 即拒绝。
  内置 5 个突变体负例（多出意外页面、缺少预期页面、certainty 降级、impact unresolved 增加、
  graph unresolved 增加），任一通过即 harness 自败；不得靠删除 unresolved、跳过异常或
  按页面名称猜测通过。
- **实测结果（2026-10-23，宿主 = A 稳定基线 `3cc37c2`（PR #28 已合入 A），CI run
  [39859399071](https://github.com/Onesummer-D/Ripple/actions/runs/39859399071) PASS）**——
  共享媒体 `media:src/components/SharedFestivalImage.tsx#430`
  → source-proven `[page:/, page:/program, page:/tickets]`，unresolved 空；档案媒体
  `media:src/pages/Archive.tsx#204` → source-proven `[page:/archive]`；
  `graph.unresolved` 为空；5 个负例全部按预期拒绝。证明 PR #28 合同下 SourceGraph
  **能够**自动证明三页共享媒体消费——前提是路由形态对齐其识别模式（MPA 形态仍不可证明）。
  （`1dbaa53` / `43f2ea2` 上的历史 PASS 保留为历史证据；src 树与 PR #28 HEAD
  零差异，当前口径为 A 基线 `3cc37c2` 复验。）
- **CI 分工**：浏览器截图证据仍属原 MPA Lab CI（`qiguang-lab-ci.yml`，24 张截图 /
  48 项断言）；来源证明由独立 workflow `qiguang-sourcegraph-proof.yml` 执行——
  固定 `PINNED_CD_SHA`（当前 `3cc37c2`，A 稳定基线）checkout C+D 宿主，实际调用 `analyzeProject()`
  与 `sourceProvenPageImpact()`，任一来源证明失败即非零退出，并输出双端 SHA、
  媒体节点、页面集合、certainty、unresolved 与最终 verdict。24 张截图**不归**本变体
  （该变体本轮仅做 SourceGraph 静态证明 + 构建验证）。
- **构建加固（P2）**：`build-variants.mjs` 现断言 package.json / package-lock.json
  构建前后字节不变、双 dist 各含 4 个素材文件、共享媒体源文件还原后字节一致；
  依赖安装使用 `--no-save --no-package-lock`。
- **边界**：此为合同形态验证；A 稳定基线 `3cc37c2` 发布后已更新 `PINNED_CD_SHA`
  并复跑同一 harness（CI run 39859399071 PASS）。路由形态要求（命名导出 App、
  `Component` 路由属性、无条件挂载）记入本文档，联合集成时若真实工程形态不符将如实
  fail-closed；青野正式 MEDIA 全链验收仍待 A 确定接入时机、固定工程 SHA 与资源安排。
