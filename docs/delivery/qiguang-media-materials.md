# 栖光媒体案例 · 素材与验收清单

> 日期：2026-10-22。性质：本轮只准备案例与验收材料，**不虚构 MEDIA 实际运行结果**。
> 核心情境：同一张横版素材替换为竖版素材，在首页 Hero、节目页展墙、购票卡片三个共享消费位置产生不同裁切或布局变化；`/archive` 使用独立来源不受波及。

## 1. 素材规格清单

| 素材 | 规格 | 来源与状态 | 文件位置 |
| --- | --- | --- | --- |
| 原图（横版主视觉） | 16:9 概念海报，靛紫山谷夜景 | C 概念设计（标注「概念设计 · 视觉参考素材，非真实品牌资产」） | `docs/design/c/source/栖光新旧海报/栖光旧海报_16x9/media/qiguang_old_visual.png` |
| 替换图（竖版主视觉） | 4:5 概念海报，流体高光主视觉 | C 概念设计（同上标注） | `docs/design/c/source/栖光新旧海报/栖光新海报_4x5/media/qiguang_new_visual.png` |
| Fixture 演示原图 | SVG `/assets/qiguang-original.svg`（工作台三案例 Fixture） | A 本地 Fixture（非品牌资产） | `public/assets/`（由 `src/cases/fixtures.ts` 引用） |
| 工作台上传格式 | PNG / JPEG / WebP / GIF，本地图片上传或海报库选图 | A 工作台【已验证·本地】；保存于浏览器 IndexedDB，草稿 Snapshot 用 `media://id` 引用 | README「栖光」节 |
| 候选元数据 | mediaResource{id, name, mimeType, bytes, width, height} | A CandidateEdit.newValue=media://<resourceId> | `docs/integration/real-evidence-package.md` |

素材红线：浏览器本地资源库不随代码包迁移，正式离线导出另行处理；跨浏览器交付需连同 IndexedDB 资源数据导出，`media://` 引用不能直接当网络地址加载。

## 2. 各页面消费关系（Fixture 定义 `src/cases/fixtures.ts`）

| Slot | 实例 | 来源 | 页面 | 共享 |
| --- | --- | --- | --- | --- |
| qiguang-home-poster-slot（首页横幅海报） | qiguang-home-hero | qiguang-shared-poster | `/` | 是 |
| qiguang-program-poster-slot（节目展墙海报） | qiguang-program-wall | qiguang-shared-poster | `/program` | 是 |
| qiguang-tickets-poster-slot（购票卡海报） | qiguang-ticket-card | qiguang-shared-poster | `/tickets` | 是 |
| qiguang-archive-poster-slot（往届回顾海报） | qiguang-archive | qiguang-archive-poster | `/archive` | 否（独立保留旧图） |

范围决策演示点：只改节目页（3→1）与同步三个共享位置（3→3）两种 Scope 卡；C 三容器展示稿已给出走位（概念示意，非实测）。

## 3. 四视口展示要求

| 视口 | 工作台层 | 验收层 |
| --- | --- | --- |
| 1440×900 | Fixture 证据存在（本地页面 QA） | 待 E 接入后真实四视口截图 |
| 768×1024 | 同上 | 同上 |
| 375×812 | Fixture 证据存在 | 同上 |
| 390×844 | F 体验层标注「验证中」 | VerificationRunner 固定计划含 390×844。Run #18 的 mobile-390 截图（890 KB，SHA-256 绑定，归档 `evidence/run18/`）**仅证明青野 TEXT 案例与公共验证器在该视口的能力**，不构成栖光 MEDIA 横竖版替换的验收证据；栖光需在自身工程或对应媒体测试工程接入真实管线后另行采集（同 B1） |

## 4. 视觉检查项（裁切 / 遮挡 / 溢出）

| 检查项 | 适用位置 | 当前判定手段 | 状态 |
| --- | --- | --- | --- |
| 容器裁切区域可见（裁切弹窗：容器 vs 完整原图对照，Escape 关闭） | Hero / 展墙 / 购票卡 | A 工作台【已验证·本地】 | PASS【演示】 |
| 横→竖替换后 cover 裁切差异 | 三容器 | C 概念稿走位；E `new-clip-overflow` 规则可判 | UNKNOWN（真实） |
| 遮挡（文本/按钮被海报遮挡） | Hero、购票卡 | E `new-overlap` 规则 | UNKNOWN（真实，E 未接入） |
| 溢出（元素新超出视口/裁剪祖先） | 三容器 + 文档级 | E `new-viewport-overflow` / `new-clip-overflow` / `new-document-horizontal-overflow` | UNKNOWN（真实，E 未接入） |
| 布局回流 | 节目页 | E 变化掩码 + 区域归类（target/non-target/mixed） | UNKNOWN（真实） |

## 5. E Visual Evidence 预期证据格式（`ripple-visual-difference/v1`）

- 结果语义：**从不 PASS**。stale / failed-to-run / not-run / unknown / risk 五态；「有变化」≠ RISK（目标区外变化记 change-outside-target·review），「无变化」≠ PASS。
- 关键字段：id、checkId、result、subject/expected 身份（candidateId、patchHash、sourceDigest、treeDigest、runtimeFingerprint、scopeDecisionId、scopeVersion 逐项比对）、inputs（descriptor + 双 SHA-256 截图哈希）、observation（changedPixels、changedRatio、regions、diffImage）、geometry（匹配/位移/显式几何风险）、findings、coverage、parameters。
- 主结果 `risk` 的严格前提：身份 consistent + 至少一条显式几何规则触发 + 两侧生产者哈希匹配 + DOM 样本以实际截图哈希绑定 + 完成/稳定/动画禁用/字体就绪全 true。
- 几何规则容差：geometryToleranceCssPx 默认 1；像素阈值 0.03（pixelmatch 8，OKLab HyAB + AA 检测）。
- 已知局限（如实引用）：fixed/sticky 全页截图位置近似；>16384 px Chromium 截图不可靠；归因是包围盒级；页面脚本可伪造几何（与「只预演受信任工程」边界一致）。

## 6. 不支持 / 尚未验收部分的真实说明

1. **E 视觉差异模块未接入 VerificationRunner**（截至 2026-10-22）：模块在分支 `feat/agent-e-visual-evidence-20261021`，未合入 A 主线；真实 run 目前只截 candidate 侧，**没有可比较的 baseline 截图**，接入顺序见 `docs/architecture/visual-difference-evidence.md` §7（均未实施）。
2. **真实工程 MEDIA 验收只在青野分类图一条线上通过**（Run 39536064634：四视口双端 7 断言 + Approval/Apply/Rollback + 原工程未改动）；栖光工程本身未接入真实验收管线。
3. **明确不支持**：动态商品列表图（类别筛选三元表达式 + 共享 ProductCard，静态不可证明）、复杂 variants、SCSS Token；验收脚本对此 fail-closed 并在 `steps.sourceLocation` 如实标注。
4. Fixture 证据 `E-VIEW-QIGUANG-001`（/program 裁切结果 768x1024）仍是占位语义，待 B 的真实浏览器结果替换；替换前相关画面不进正式录屏（C 的 E-REF/E-VIEW 占位纪律）。

## 7. 验收材料清单（本轮已备 vs 待补）

| 材料 | 状态 |
| --- | --- |
| 素材规格与原图/替换图清单 | ✅ 本文 §1 |
| 各页面消费关系 | ✅ 本文 §2（Fixture 定义） |
| 四视口展示要求 | ✅ 本文 §3 |
| 视觉检查项 | ✅ 本文 §4 |
| E 证据格式预期 | ✅ 本文 §5（格式确定；真实样本待接入后采集） |
| 不支持/未验收说明 | ✅ 本文 §6 |
| 真实四视口 MEDIA 截图（栖光工程） | ⬜ 待 B/A 接入真实管线后采集 |
| E 接入后的 risk/unknown 证据样本 | ⬜ 待 E §7 接入顺序实施 |
