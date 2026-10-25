# Ripple UI 视觉版本交接 · ui-20261025-v2

> 交接范围：工作台视觉、布局与交互呈现。
> Scope / Candidate / Verification / Approval / Apply / Rollback 及安全门控由原工程团队维护；本文档只说明视觉层改动与需要工程侧（F）恢复真实功能的部分。
> v2 相对 v1 的差异：删除左栏「页面」标题右侧的页面计数徽章（其余视觉一致），并重新构建部署，使分支、云端、备份三者严格同版。

---

## 1. 版本标识与备份

| 项目 | 值 |
| --- | --- |
| 版本标识 | `ui-20261025-v2`（当前交付版本） |
| 上一版本 | `ui-20261025-v1`（`experience-Dt0KP3V9.js`，2026-10-25 23:08 部署，可作回滚点） |
| Git 分支 | `feat/ui-workbench-visual-20261025`（基线 `f71f3fd`，即 `feat/ui-workbench-visual-20261023`） |
| 分支提交链 | `1d4dea3` 视觉源码 → `7557f16` 部署/冒烟工具 → `9d85175` 交接文档+截图脚本 → `3f11851` 删除左栏标题计数徽章 |
| 分支 HEAD | 源码提交 `3f11851`（与本次部署产物逐字节对应）；其上有本次交接文档提交（`git log -1` 可查，不含运行时代码改动） |
| 部署时间 | 2026-10-25 23:31:23 (+0800，服务器时间) |
| 线上资产哈希 | `experience-BiAABMMG.js` / `experience-B9EsLEHV.css` |
| 云端访问地址 | http://81.70.40.146:8082/experience.html?adapter=demo |
| 本次回滚备份 | 服务器 `/var/www/ripple-demo.bak-ui-20261025-v2-BiAABMMG`（部署后 `cp -a` 完整快照） |
| 更早备份 | `ripple-demo.bak-ui-20261025-v1-Dt0KP3V9`、`ripple-demo-backup-v1`、`ripple-demo.bak-20261023`、`ripple-demo.bak-20261025-154644`、`ripple-demo-prev`（保留未动） |
| 源码包 | `ripple-source-ui-20261025-v2.zip`（`git archive` 导出，含 node_modules 以外的全部源码）+ `ripple-ui-20261025-v2.bundle`（git bundle，可离线还原分支提交链） |

回滚方式（如需回退到 v2）：`sudo cp -a /var/www/ripple-demo.bak-ui-20261025-v2-BiAABMMG/. /var/www/ripple-demo/`；
回退到 v1 则用 `ripple-demo.bak-ui-20261025-v1-Dt0KP3V9`。

## 2. 复现构建

```bash
npm ci
npm run build:demo-static          # 产出 dist-demo/（含 index.html + _headers）
node scripts/package-demo-static.mjs
```

- 验证：`npx tsc --noEmit -p tsconfig.app.json` 通过；`npx vitest run src/app/experience/experience-flow.test.tsx` 25/25（v2 部署前重跑同样通过）。
- 源码包：`ripple-source-ui-20261025-v2.zip`（`git archive` 导出，与分支 HEAD `3f11851` 一致）；`ripple-ui-20261025-v2.bundle`（`git bundle`，可 `git clone` 还原完整提交链，用于无推送权限时的交接）。
- 部署脚本：`scripts/deploy_tar.py`（tar over SSH；SSH_HOST/SSH_USER/SSH_PASS 走环境变量，凭据不入库）。
- 交接包目录：`../Ripple-ui-handoff/20261025-v2/`（`screens/` 双端截图 + 源码 ZIP + git bundle + 本文件副本）。

## 3. 改动文件清单（相对基线 f71f3fd）

**视觉源码（本轮核心改动）**
| 文件 | 改动摘要 |
| --- | --- |
| `src/app/experience/components/version-filmstrip.tsx` | 历史卡片等高 + 生命周期彩色角标（已应用/已回滚/已失效/候选/丢弃）+ 证据可用折叠角标；删除胶片滚动箭头与「收起」按钮 |
| `src/app/experience/components/scope-panel.tsx` | 四步检查清单改编号 ①②③，未完成项带「!」并可跳转（`precheck-jump-{key}`）；主按钮统一「确定生成」且 `disabled={!gate.allowed}`；删除「『首页』…会自动更新」提示 |
| `src/app/experience/components/page-rail.tsx` | 网站概览统计行改可展开按钮（`overview-toggle-{certainty}` / `overview-list-{certainty}`），点开显示该确定性下的页面明细；v2 删除「页面」标题右侧的计数徽章 |
| `src/app/experience/components/compare-strip.tsx` | 候选侧标题「修改后 · 候选」→「修改后」；「修改位置」标注去按钮化（虚线胶囊 → 纯文字） |
| `src/app/experience/components/top-bar.tsx` | 删除「演示数据 DEMO」徽章；「真实工程」徽章保留 |
| `src/app/experience/components/canvas-stage.tsx` | 页面标题注释同步（字号层级） |
| `src/app/experience/components/experience-workbench.tsx` | 随「收起」删除移除 `onClose` 传参 |
| `src/app/experience/ripple-xp.css` | 上述全部样式：卡片等高/角标/编号清单/概览展开/标题 30px/去胶囊边框 |
| `src/app/experience/view-model.ts` | `VersionItemXp.evidenceList?: string[]`（证据明细） |
| `src/app/experience/demo-adapter.ts` / `real-adapter.ts` | 适配 `evidenceList`（真实侧从 verification.evidence 推导；演示侧补两条明细） |
| `src/app/experience/experience-flow.test.tsx` | 单测同步与新增（概览展开/互斥、徽章移除、收起改 tab 切换等） |
| `e2e/experience.spec.ts` / `scripts/verify-demo-static.mjs` / `scripts/verify-demo-online.mjs` | 同步「收起」与 DEMO 徽章的验收点 |

**工具与配置（不影响运行时 UI）**
`.gitignore`、`Dockerfile`、`docker-compose.yml`、`.dockerignore`、`scripts/deploy_tar.py`、`scripts/ssh_exec.py`、`scripts/sftp_upload.py`、`scripts/debug_ssh.py`、`scripts/smoke-*.mjs`（8 个视觉冒烟脚本）、`scripts/capture-handoff-shots.mjs`（交接截图采集）。

## 4. 双端截图（screens/ 目录）

1440×900 桌面（7 张）：`desktop-01-初始`、`02-改内容`、`03-影响范围`、`04-检查并生成`、`05-前后对照`、`06-历史记录`、`07-证据与解释`。
390×844 窄屏（3 张）：`mobile-01-初始`、`02-前后对照`、`03-历史记录`。

- 采集对象：云端 `ui-20261025-v2` 实际页面（`experience-BiAABMMG.js`），deviceScaleFactor=2，10 张全部 0 console 错误（`ALL_CLEAN`）。
- 采集脚本：`scripts/capture-handoff-shots.mjs <BASE> <OUT_DIR> <TAG>`，可随时对任意环境复跑。
- 复跑命令示例：`node scripts/capture-handoff-shots.mjs http://81.70.40.146:8082 ../Ripple-ui-handoff/20261025-v2/screens ui-20261025-v2`。

## 5. 工程边界遵守情况

- 保留全部工程能力的入口与状态展示：范围决策（一起改/保持不动/与本次无关）、审批门控（`approvalGate`，未完成步骤「确定生成」不可点）、验证状态（截图不可用/截图已过期/尚无真实截图/无证据/影响未证实）全部可见，未隐藏、未用演示数据冒充真实状态。
- 演示模式入口带「演示对照：模拟内容，未经真实浏览器验证」标注；真实模式只接受带来源的真实 imageUrl。
- 未改动服务器上的 API 与数据记录；未改动 A 公共领域模型（CandidateRecord 等）。
- 每次部署均为当前分支源码重新构建后整目录覆盖 `dist-demo`，不存在用旧打包文件覆盖他人成果的情况（`assets/` 里历史哈希文件为历次部署累积，清理需你确认后再做）。
- 既有 testid 全部保留（`scope-*`、`demo-approve`、`create-candidate`、`compare-*`、`evidence-*`、`canvas-el-*`、`page-item-*` 等）；本轮新增 testid 见下表。

## 6. 本轮新增/调整的交互入口与 testid

| 入口 | testid | 说明 |
| --- | --- | --- |
| 四步标签 | `step-tab-1..4` | 选择元素 / 修改内容 / 影响范围 / 检查并生成 |
| 检查清单跳转 | `precheck-jump-{key}`、`precheck-miss-{key}` | 未完成项点击回到对应步骤补完 |
| 主按钮 | `demo-approve` / `create-candidate` | 文案「确定生成」，门控未过则 disabled |
| 概览统计展开 | `overview-toggle-{certainty}`、`overview-list-{certainty}` | 左栏「来源已证实/部分证明/未知」点开展示页面明细 |
| 工作区面板切换 | `tab-evidence` / `tab-compare` / `tab-history` | 证据与解释 / 前后对照 / 历史记录（原「收起」按钮已删） |
| 历史卡片 | `version-{id}`、`evidence-toggle-{id}` | 生命周期角标 + 证据明细折叠 |
| 修改位置标注 | `.ripple-xp-focus-ring` | 纯装饰（aria-hidden），不可点击 |

## 7. 需要 F 实现的真实交互（视觉版 → 工程功能映射）

| 视觉入口 | 对应功能 | F 需要做的事 | 当前视觉层行为 |
| --- | --- | --- | --- |
| 第 4 步「确定生成」 | Candidate 创建 + Approval | 真实模式接入候选创建与审批 API，回读审批状态替换 `real-approval-pending` 占位 | 演示模式走 `demo-approve`；真实模式显示「真实审批尚未接入」 |
| 前后对照两端 | 四视口验证 + 截图身份比对 | 产出 baseline/candidate 真实 `imageUrl` 与 state（ready/loading/failed/unavailable/stale），补齐 `viewport-match-note` 的可比性结论 | 真实侧已按 state 渲染，缺失即显示对应状态，不回退模拟图 |
| 历史记录卡片 | `/__ripple/api/history` | 已保存候选的生命周期（applied/rolled-back/stale/discarded）、`pageRef`（点卡片定位页面）、`evidenceAvailable` | 生命周期与证据角标已就绪，等真实数据填充 |
| 历史卡片操作 | Apply / Rollback | 卡片级「应用/回滚」按钮与门控（本轮未添加按钮，等核准后补入口） | 仅状态展示 |
| 证据与解释明细 | Verification 证据 | verification 响应提供逐条明细填充 `VersionItemXp.evidenceList` | 真实侧已从 verification.evidence 推导；缺失显示「无证据」 |
| 左栏确定性标注 | analyze/source 分析 | 页面 `relationCertainty`（source-proven/partial/unknown）真实产出 | 概览统计与展开明细已就绪 |
| 实例身份说明 | A② Runtime Identity | 稳定实例判定（stable-keyed-instance 等）与同源渲染计数 | 按要求不等待 A②，先以占位字段接入 |

## 8. 本轮各次反馈的最终视觉结论（便于 F 对照实现）

| 项 | 最终结论 |
| --- | --- |
| 页面一级标题（首页/商品专题/活动页/联系我们） | 30px / 700（原 20px） |
| 前后对照两侧标题 | 「修改前」/「修改后」（去掉「· 候选」后缀） |
| 「修改位置」标注 | 纯文字「⟶ 修改位置：XXX」，无边框、非按钮、aria-hidden |
| 版本历史面板 | 卡片等高；生命周期彩色角标压图片左上；证据为可折叠角标；无「← →」滚动箭头、无「收起」按钮（用底部三标签切换） |
| 修改前检查清单 | 编号 ①②③，未完成项带「!」并可点击跳转对应步骤 |
| 主按钮 | 统一「确定生成」，门控未过则 disabled |
| 顶栏 | 无 DEMO 徽章；真实模式保留「真实工程」徽章 |
| 左栏 | 无「页面」标题计数徽章；概览统计三行可点开看明细 |

## 9. 已知遗留

- REAL 链路 e2e（`e2e/experience-real-flow.spec.ts`）只能在原生 Linux Docker 宿主跑（`assertPreviewPlatform()` 限制），Windows 本机未执行。
- `docs/experience/PUBLIC-DEPLOY.md` 等历史文档仍描述保留 DEMO 徽章，属历史设计记录未改。
- Dockerfile/docker-compose 已入库但仅在 Linux 宿主验证过可用性。
- 分支已推送远端：`origin/feat/ui-workbench-visual-20261025`（GitHub `Onesummer-D/Ripple`）。开 PR 入口：https://github.com/Onesummer-D/Ripple/pull/new/feat/ui-workbench-visual-20261025 。源码 ZIP 与 git bundle 仍随交接包提供，供无 GitHub 权限时离线复现。
- 服务器 `assets/` 累积了历次部署的旧哈希文件（本次部署新增 `BiAABMMG`，旧文件仍保留），清理需负责人确认后再做。
