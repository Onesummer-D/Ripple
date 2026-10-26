# Ripple UI RC1 补正交接 · ui-20261026-rc1

> 审查对象：`feat/ui-workbench-visual-20261025` @ `4c2c835`（视觉方案有条件通过）。
> 本文档对应补正提交 **`9473ac4`**（P1 五项全部处理）。
> **本分支不是针对 RC0 的可合并结果**：仅供审查与视觉迁移取材，正式合流由 F 在核准的 Ripple 工程基线上执行。

---

## 1. P1 问题处理对照

| # | 审查要求 | 处理 | 证据 |
| --- | --- | --- | --- |
| P1-1 | 历史条目外层 button 与内部 role="button" 嵌套 | 卡片改 `<article>`（不可聚焦）；「选中该版本」`version-{id}` 与「证据展开」`evidence-toggle-{id}` 为两个独立原生 button，各自 Tab 聚焦、响应 Enter/Space，点证据不触发选中 | `version-filmstrip.tsx`；单测 2 项 + 浏览器实测 6 项（见 §5） |
| P1-2 | Demo 与 Real 缩略图区分；Real 无截图诚实占位 | ViewModel 新增 `evidenceState: 'archived' \| 'metadata' \| 'none'` 与 `thumbnail?: { url, source: 'demo-art' \| 'real-artifact' }`；real-adapter 只接受服务端归档 artifactUrl，metadata-only 时 thumbnail 必为 undefined；组件对 `demo-art` 图强制「演示素材图」角标，真实模式缺失时渲染「未归档真实截图」占位，**禁止回退 Demo 图** | `view-model.ts` / `real-adapter.ts` / `version-filmstrip.tsx`；real-adapter 诚实边界单测 4 项 + 组件级单测 3 项 |
| P1-3 | 演示来源简洁文字说明 | 顶栏右侧改为纯文字「演示预览，内容为模拟数据」（`demo-note`），不恢复 DEMO 徽章；`real-badge` 保留 | `top-bar.tsx`；浏览器正向断言 |
| P1-4 | 冒烟脚本 Demo 正向 + Real 反向断言 | `verify-demo-online.mjs`：正向断言 `demo-note` 可见且无 `real-badge`；反向断言 `?adapter=real` 被屏蔽后仍无 `real-badge`、无真实工程入口、不出现 Demo 标识错乱 | `scripts/verify-demo-online.mjs` |
| P1-5 | testid 交接说明（删除/更名/新增） | 见 §4 完整清单，不再笼统声明「全部保留」 | §4 |

## 2. 集成边界（可移植性分类）

### A 类：纯视觉与样式，可选择性移植
| 文件 | 说明 |
| --- | --- |
| `src/app/experience/ripple-xp.css` | 全部样式：卡片等高、生命周期角标、来源角标、precheck 编号圆圈、页面标题 30px、概览展开、演示来源文字等 |

### B 类：组件 + ViewModel 同时变化，需 F 适配 RC0 合同
| 文件 | 变化 | F 需确认的合同点 |
| --- | --- | --- |
| `src/app/experience/view-model.ts` | `VersionItemXp` 新增 `evidenceState`、`thumbnail`；`evidenceAvailable` 语义收窄为「有证据记录」（≠ 有截图） | RC0 历史接口是否提供归档截图 artifactUrl；若不能提供，真实历史全部走 metadata/none 占位 |
| `src/app/experience/components/version-filmstrip.tsx` | 结构重写：article + 双独立 button；来源强制区分渲染 | 见 §6 交互-功能映射 |
| `src/app/experience/real-adapter.ts` | 历史缩略图/证据状态产出规则 | 同上 |
| `src/app/experience/demo-adapter.ts` | 演示版本补 `thumbnail.source='demo-art'` 与 `evidenceState` | 无（演示侧自闭环） |
| `src/app/experience/components/top-bar.tsx` | 演示来源文字说明 | 无（纯展示，依赖既有 `dataProvenance`） |
| `src/app/experience/components/scope-panel.tsx` | precheck 编号/跳转/「确定生成」门控按钮 | 门控仍走 `approvalGate`（未改动）；跳转仅 `setStep` |
| `src/app/experience/components/page-rail.tsx` | 概览统计可展开明细；删除标题计数徽章 | 依赖既有 `relationCertainty` 字段 |
| `src/app/experience/components/compare-strip.tsx` | 候选侧标题「修改后」；「修改位置」纯文字标注 | 无 |

### C 类：不进入 UI-RC1 视觉迁移
| 文件 | 说明 |
| --- | --- |
| `Dockerfile` / `docker-compose.yml` / `.dockerignore` | 仅供原生 Linux Docker 宿主跑 REAL 链路 e2e。**安全风险见 §3** |
| `scripts/deploy_tar.py` / `ssh_exec.py` / `sftp_upload.py` / `debug_ssh.py` | SSH 部署工具。**安全风险见 §3；不得用其自行再次部署公网** |
| `scripts/smoke-*.mjs` / `verify-demo-*.mjs` / `capture-handoff-shots.mjs` | 演示验收/截图脚本，可参考断言写法，不属于视觉资产 |
| `docs/experience/UI-VISUAL-HANDOFF-20261025.md` / 本文档 | 交接文档本身 |

### ⚠️ 安全风险单独标注（审查强制项）
1. **不得要求启用无 TLS 的 Docker 2375 TCP**。Dockerfile/docker-compose 只用本地 socket；此前本机 Windows 上尝试过的 2375 暴露方案已废弃，禁止写入任何部署文档或环境要求。
2. **SSH 部署脚本以 `SSH_PASS` 环境变量传密码**（paramiko），不落盘、不入库；脚本仅用于经授权的云端演示环境维护，**不得用于生产部署**，不得在其中硬编码任何凭据。
3. 本分支不包含、也不应新增任何公网部署动作；云端演示环境已有的部署与备份由负责人在授权下管理。

## 3. 工程边界遵守确认
- 修改前后对照：底部标签栏常驻「前后对照」，候选侧标题「修改后」+「修改位置」标注，易发现 ✓
- 缺失/过期/失败/过期状态：「无证据」（红）、「仅有证据元数据 · 截图未归档」、「已失效」全部可见未隐藏；门控禁止时「确定生成」禁用且未决项带「! 未完成」跳转 ✓
- 真实网页画布：中间画布保持主视觉地位，右侧面板为辅助 ✓
- 未直接修改服务器正式 API 与数据记录；未使用旧打包覆盖他人成果 ✓

## 4. testid 交接清单（基线 `f71f3fd` → 本提交）

### 已删除
| testid | 原因 |
| --- | --- |
| `demo-badge` | DEMO 徽章移除，改为 `demo-note` 文字说明（P1-3） |
| `close-filmstrip` | 「收起」按钮移除，面板切换由底部标签栏承担 |

### 结构变更（testid 名保留，元素/语义变化——引用方需复核）
| testid | 变化 |
| --- | --- |
| `version-{id}` | 原为包裹整张卡片的 `<button>`（内含 role="button" 嵌套）；现为卡片内「选中该版本」独立 button。卡片本身改为 `version-card-{id}`（`<article>`） |
| `evidence-toggle-{id}` | 原为 span role="button" 嵌套；现为 meta 区独立 `<button>`，新增 `aria-expanded`/`aria-controls` |

### 新增
| testid | 用途 |
| --- | --- |
| `demo-note` | 演示来源文字说明（P1-3） |
| `version-card-{id}` | 历史卡片容器（article） |
| `evidence-list-{id}` | 证据明细展开列表（id 与 aria-controls 对应） |
| `film-shot-real-{id}` / `film-src-real-{id}` | 真实归档截图及其「真实截图」来源角标 |
| `film-shot-demo-{id}` / `film-src-demo-{id}` | 演示素材图及其「演示素材图」来源角标（仅演示模式） |
| `film-shot-none-{id}` | 无截图占位（「未归档真实截图」/「无演示素材图」） |
| `precheck-jump-{key}` / `precheck-miss-{key}` | 第 4 步检查清单跳转按钮 / 未完成标记 |
| `overview-toggle-{certainty}` / `overview-list-{certainty}` | 网站概览统计展开按钮 / 明细列表 |

既有 testid（`xp-topbar`、`page-item-{id}`、`step-tab-{id}`、`tab-{id}`、`demo-approve`、`create-candidate`、`real-badge`、`open-history`、`canvas-el-{id}`、`draft-text-input`、`compare-candidate` 等）全部原样保留。

## 5. 验证证据（真实命令与结果）

### TypeScript / Build
```
$ ./node_modules/.bin/tsc --noEmit -p tsconfig.app.json   → TSC=0（通过）
$ ./node_modules/.bin/vite build --mode demo-static       → ✓ built in 1.58s
  产物：experience-Cu_EBz1F.js (274.92 kB) / experience-DwGNXWz7.css (36.27 kB)
```

### 单元测试（vitest）
```
$ ./node_modules/.bin/vitest run src/app/experience
  Test Files  6 passed (6)
  Tests       101 passed (101)   失败 0
```
- 其中本次新增：`version-filmstrip.test.tsx` 4 项（嵌套结构 1、诚实占位/来源 3）、`real-adapter.test.ts` 诚实边界 4 项、`experience-flow.test.tsx` 键盘/焦点/不触发选中 1 项 + 演示来源说明 1 项。

### 浏览器级验证（本地静态预览，**未部署公网**）
```
$ ./node_modules/.bin/vite preview --mode demo-static --port 4310
$ node scripts/verify-rc1-local.mjs http://127.0.0.1:4310 scripts/smoke-out/rc1
  → 22/22 PASS，0 FAIL；全程 0 console/page 错误
```
覆盖：1440×900 布局、390×844 布局（scrollWidth=390 无横向溢出）、Demo 来源说明正向断言、`?adapter=real` 反向断言、历史键盘操作（Tab 聚焦/Enter/Space/点击/不触发选中）、门控禁止态（「确定生成」disabled）、已失效/无证据状态可见性。

截图（视口 / URL / 提交 SHA 标注）：
| 文件 | 视口 | URL | SHA |
| --- | --- | --- | --- |
| `scripts/smoke-out/rc1/rc1-desktop-1440x900-history.png` | 1440×900 | http://127.0.0.1:4310/experience.html?adapter=demo（本地预览） | `9473ac4` |
| `scripts/smoke-out/rc1/rc1-desktop-1440x900-step4-gate.png` | 1440×900 | 同上 | `9473ac4` |
| `scripts/smoke-out/rc1/rc1-mobile-390x844-history.png` | 390×844 | 同上 | `9473ac4` |

> 因审查要求「不再次部署公网」，本轮验证在本地 `vite preview` 上执行；云端 81.70.40.146:8082 当前仍为 v2 版本（`experience-BiAABMMG.js`），云端更新待负责人授权后进行。

## 6. 新增按钮/面板/交互 ↔ 功能映射（供 F 恢复真实功能）
| 视觉元素 | 对应功能 | F 需实现 |
| --- | --- | --- |
| `version-{id}` 选中按钮 | 查看该历史候选详情/定位页面 | 接 history 接口选中语义；real 历史 `pageRef` 为空时不切换页面（不臆造定位） |
| `evidence-toggle-{id}` 展开 | 查看验证证据明细 | 证据明细来自 `verification.evidence`（real）；演示为两条示例明细 |
| 「证据可用」/「仅有证据元数据 · 截图未归档」/「无证据」 | 验证状态三档诚实展示 | 按 `evidenceState` 映射，不得把 metadata 展示成已归档截图 |
| 概览 `overview-toggle-{certainty}` | 按来源确定性查看页面分组 | 依赖 `relationCertainty`；unknown 不影响 fail-closed 门控 |
| `precheck-jump-{key}` | 跳转到未完成步骤 | 仅 `setStep`，不改变门控逻辑 |
| `demo-approve` / `create-candidate`「确定生成」 | 审批门控入口 | 接真实 Approval；门控仍由 `approvalGate` 决定启用/禁用 |
| `demo-note` | 演示来源说明 | 真实模式隐藏（`dataProvenance==='real'` 时只显示 `real-badge`） |

## 7. 交付物
- 补正提交：`9473ac4`（本分支，已推送）
- 文件清单：见 `git show --stat 9473ac4`
- Draft PR：供审查创建，**注明不是针对 RC0 的可合并结果**
- 未执行：合并公共分支 / 再次部署公网 / 触发 Bolt（遵守授权边界）
