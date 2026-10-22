# 横版→竖版素材替换 · 四视口可复现场景（独立模块验证 Fixture）

本目录是 D 侧集成准备的**独立验证场景**：同一媒体素材被三个不同尺寸容器消费
（首页 Hero / 活动页面图片区域 / 商品卡片），将横版主视觉（1600×900）替换为
竖版主视觉（900×1600）后，在四视口（桌面 1440×900 / 平板 768×1024 / 375 / 390）
下对比真实裁切、object-fit、object-position 与容器尺寸变化。

**定位声明**：本场景不依赖真实工程的 SourceGraph 消费证明，仅用于验证已移植的
MEDIA 独立模块（staging / asset-swap 执行器 / 四视口证据采集）在最新 A 基线上
行为正确。结果**不得**作为 C+D 联合实测或真实 MEDIA 验收 PASS 引用。

## 目录

- `assets/` — 生成脚本产出的原始横/竖版测试图（四象限色块 + 边缘标尺，肉眼可核对裁切窗口）
- `baseline/` — 基线站点（三容器引用 `/media/hero-landscape.jpg`）
- `candidate/` — 候选站点（三容器引用 `/media/hero-portrait.jpg`，其余字节与基线一致）
- `input.json` — 四视口证据采集器输入（候选/基线 URL、assetRef、originalValue、marker 等）
- `run-scenario.ts` — 场景驱动：受限静态服务双端托管 + 驱动 `scripts/media-viewport-evidence.ts` + 追加三容器双端几何测量
- `evidence/` — 一次真实 Chromium 采集产物（evidence.json / dual.json / comparison.json / 四视口截图 × 双端）

## 复现

```bash
npm ci   # 首次
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
  test/fixtures/media-orientation-swap/run-scenario.ts test/fixtures/media-orientation-swap/evidence
```

`run-scenario.ts` 在采集之外执行三项回归加固（D 最终复审 P1 + 协调人第四轮 P1）：

1. **产物完整性核验**：evidence/dual 内容哈希回验、四视口缺一即败、8 张截图存在且
   魔数确为 PNG、comparison.json 必须恰有 24 条观测（3 容器 × 4 视口 × 双端）；
2. **双端截图内容哈希回验**（协调人第四轮 P1）：采集器现登记候选端截图
   sha256（`evidence.json` 观测字段）与基线端截图 sha256（`dual.json`），
   核验时对 8 张截图重新计算哈希逐项比对；登记值缺失即 fail-closed；
3. **两项负例**：① 截图字节被篡改但 PNG 头仍有效（翻转文件中段一字节）→
   verifyArtifacts 必须拒绝；② 以指向缺失资源的 assetRef 重跑采集器必须非零退出——
   任一对意外通过即判定断言链失效，场景整体失败。

## 正式回归入口

定向 workflow [`media-fixture-regression.yml`](../../../.github/workflows/media-fixture-regression.yml)：
MEDIA 模块 / 本 Fixture / 工作流自身变更时自动触发（paths 过滤），也可手动 dispatch；
不在每次 push 的常规 CI 中重复跑 Chromium。注意：**Fixture 验收通过 ≠ 真实工程
MEDIA 生命周期通过**——后者以青野专项 workflow（双端构建 + 完整生命周期）为准。

## 观测结论（2026-10-22 本机 Chromium 一次采集，evidence/ 为证）

四视口断言 `media-loaded / media-source-swapped / media-crop-geometry / media-browser-errors`
全部 pass（采集器退出码 0）；双端几何测量 24 条观测（3 容器 × 4 视口 × 2 端）：

- **容器尺寸不变、源窗口剧变**：替换前后所有容器 renderedBox 完全一致（布局由 CSS 决定），
  但 cover 裁切的可见源窗口从「横向全宽、纵向微裁」（1600×900 进 1408×520，纵向裁 ~17%）
  变为「横向全宽、纵向深裁」（900×1600 进同一盒子，纵向仅可见 ~21% 源高度，
  桌面 Hero 可见源窗口 ≈900×332px，底部标签文字被完全裁掉——见 desktop.png 与
  desktop-baseline.png 对照）。
- **object-position 生效方向可证**：活动区（`50% 20%`）与商品卡片（`top`）在竖版源下
  可见窗口分别上移/置顶，comparison.json 中逐容器逐视口可查。
- **单页 Fixture 无交互声明**：dual.json 中 `baselinePassed/candidatePassed=false` 为
  预期行为（未声明 navigateBy/interaction，探测不适用），不影响采集器 pass 结论。

## 边界

- 未使用未经证明的页面消费关系作为自动传播授权：三容器的消费关系由本 Fixture
  显式声明（`data-consumer` + 双端同字节布局），仅证明采集与几何推导链路。
- 动态消费（运行时筛选切换图源）不在本场景范围，按 B 既有结论 fail-closed。
