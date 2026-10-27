# webportflio CSS Token 浏览器真值（2026-10-25）

> 复审说明：下方 `148 PASS / 16 UNKNOWN` 是首轮汇总，保留作历史记录；它没有
> 显式逐行 matrix 或七路由 census，不能单独作为本轮正式验收。复审版脚本增加
> 72 条原版/候选成对矩阵、144 条逐 revision 样本和 224 条真实路由 census；
> 每条含 viewport、theme、revision、route、selector、property、expected、actual、
> status/reason，16 个逻辑 UNKNOWN 对应原版与候选各自的缺失样本。复审版的正式
> JSON、16 张截图、trace 和日志由 `b-css-token-acceptance.yml` 的独立
> Playwright job 生成并上传 GitHub Actions artifact。Windows 本地沙箱的 Vite
> `127.0.0.1` 探测超时按执行错误 `1` 留档，不作为通过或 PENDING；以 CI artifact
> 中完整的成功/失败报告为本轮复审结果。

## 固定输入

- 仓库：`allanhue/webportflio`
- 源 SHA：`b244f857457d2a07f118155602eef9097fd322bd`
- 原始工作树：干净；候选在独立临时副本中运行
- 唯一改动：`src/css/style.css` 的 `[data-theme="light"] { --accent }`，`#e63946` → `#7c3aed`
- 候选文件 SHA-256：`43d91af283977298efa94862df06b9ea1ddb4a0278f36e882a5b2c73efb2e28c`
- 视口：`1440×900`、`768×1024`、`375×812`、`390×844`
- 浏览器：Playwright Chromium + Vite dev server；暗/亮主题各测四个视口

## 结果

| 结果 | 数量 |
| --- | ---: |
| PASS | 148 |
| FAIL | 0 |
| UNKNOWN | 16 |
| RISK | 0 |

接受性退出码为 `2`，因为 UNKNOWN 仍不能当作 PASS。16 个 UNKNOWN 都是四种视口、两种主题下 `.section-title` 与其 `::after` 没有 DOM 实例。固定 SHA 的 CSS 有这些选择器规则，但实际 JSX 没有渲染该 class；没有伪造目标元素来补绿。

### 已观测行为

- `:root --accent` 暗色保持 `#ff5555`。
- `[data-theme="light"] --accent` 从 `#e63946` 变为 `#7c3aed`。
- 实际 Home 页面 `.name-highlight`、它的 `::after` 渐变、`.btn-primary` 与 hover 中的 `.nav-link` / `.skill-badge` 在亮色下跟随新值。
- `body` 背景、`--accent-secondary`、桌面/平板/两种手机视口下 `.btn-primary` 与统计图标几何位置均保持。
- `.stat-icon` 与 `.stat-card::before` 亮色下仍为每张统计卡自己的颜色。这不是 `--accent` fallback 的副作用：`Home.jsx` 在每个卡片上直接设置 `--accent-color: stat.color`，子元素继承该内联自定义属性。
- 首轮 16 张全页截图和逐样式 JSON 与源文件/候选文件哈希一并保存在本地工作区
  `docs/probes/evidence/b-css-token-browser-baseline-20261025/`。正式复审截图和
  原始 JSON 以对应 PR 的 GitHub Actions artifact 为准。

## 交接案例修订点

1. 源码里有 `ThemeToggle.jsx`，但在该固定提交的 App、布局或导航中没有引用。主题由 `ThemeContext` 从 `localStorage` 读入并写到 `<html data-theme>`。本次用脚本显式设置并记录为 `script-fallback`，不宣称完成了按钮交互验收。
2. 旧案例预期 `.stat-icon` / `.stat-card::before` 跟随 `--accent`，与真实 DOM 的每卡片内联 `--accent-color` 冲突。当前真实结果是每卡片颜色保持；将来 A 的 TOKEN Scope 必须把这些对象显示为独立覆盖/保护项，不能静默把其颜色改成品牌色。
3. Google Fonts 使用外链 `@import`。为避免网络等待和环境差异，浏览器测试将该 URL 的 CSS 响应为空样式表；所以此工件证明颜色与有限布局几何，**不证明字体呈现或字体请求行为**。

## 可复现

从 Ripple B 工作树运行：

```powershell
node scripts/b-css-token-browser-baseline.mjs <固定 SHA 的 webportflio 检出目录>
```

脚本默认写入上述证据目录。接受性严格保留任何失败和未知状态，返回 `0` 表示全部通过、`2` 表示运行完成但存在 UNKNOWN/失败、`1` 表示执行异常。该对照独立于 Ripple Candidate、Approval 与 Apply，不代表正式 AC-P6 产品闭环。


## Frozen-fixture boundary

The 148 PASS / 0 FAIL / 16 UNKNOWN / 0 RISK count and the two missing .section-title targets are frozen regression expectations for only allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd. The CI matrix verifies that exact project SHA before applying those counts. They are not a required UNKNOWN count for later projects; future fixtures need their own evidence and expectations.
