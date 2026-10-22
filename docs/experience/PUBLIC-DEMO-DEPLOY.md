# 公网静态体验版部署方案（评委 Demo）

> 产物：`npm run build:demo-static` → `dist-demo/`（已另存 `ripple-f-demo-static.zip`）。
> 特性：默认访问 `/` 直接进入演示工作台；强制演示适配器（无任何后端 API 请求）；
> 保留「演示数据 DEMO」标识与「演示对照：模拟内容，未经真实浏览器验证」文案；
> `?adapter=real` 参数在静态版中被屏蔽，不显示任何无法运行的真实后端操作入口。
> 本地验收：`node scripts/verify-demo-static.mjs` —— 26/26 项通过（桌面 1440 + 手机 390 双视口，
> 覆盖关系图、范围决策、前后对照、版本历史、真实入口屏蔽、控制台零错误），
> 截图见 `docs/experience/public-demo/demo-desktop-full.png` 与 `demo-mobile-full.png`。

## 公网部署状态（2026-10-23 更新）

**Cloudflare Workers 线上地址：https://ripple-demo.dengtongxin1215.workers.dev/**

- 线上验收脚本 `scripts/verify-demo-online.mjs`：**22/22 项通过**（桌面 1440×900 + 手机 390×844 双视口）：
  默认 `/` 直达工作台、DEMO 标识、画布点选、范围决策、前后对照同步、版本历史、演示审批、
  `?adapter=real` 仍强制 DEMO 且无真实工程入口、**Console 零错误、Network 零 `/__ripple/api` 请求**。
- 线上截图（真实公网，保存于 `docs/experience/public-demo/`）：
  - `online-desktop-history.png`（桌面 · 版本历史展开）
  - `online-desktop-approved.png`（桌面 · 演示审批反馈）
  - `online-desktop-adapter-real-blocked.png`（桌面 · `?adapter=real` 被屏蔽仍为 DEMO）
  - `online-mobile-full.png`（手机 · 全流程整页）
- **国内访问限制（如实记录）**：负责人已用不带 VPN 的国内手机实测，`*.workers.dev` 域名
  **国内网络不可正常访问**。因此 Cloudflare 入口**不得**标记为「国内公网可访问验收通过」。
- **国内入口（待验收）**：负责人已将同一静态 ZIP 部署到腾讯云 Ubuntu 服务器独立端口
  `http://81.70.40.146:8082/`（计划地址，部署完成后以负责人提供的实际地址为准）。
  收到可访问地址后补做国内网络桌面/手机验收并更新本节。

## 前置条件（两种方案通用）

- 任意静态托管能力（无需 Node、Docker 或数据库）。
- 产物为相对资源路径（`base: './'`），可部署在域名根或任意子路径。
- 站点仅含公开演示数据，已注入 `noindex`；仍建议加访问控制（评委评审期后可撤下）。

## 方案 A：Cloudflare Pages（推荐，免运维）

**服务器配置要求**：无需自有服务器；Cloudflare 免费档即可（带宽/请求量对该体积绰绰有余）。

**步骤**：

```bash
cd ripple-f
npm ci && npm run build:demo-static     # 产出 dist-demo/
npx wrangler pages deploy dist-demo --project-name=ripple-demo
```

- 未装 wrangler 时：`npm i -g wrangler && wrangler login`（需要 Cloudflare 账号，浏览器授权一次）。
- 也可在 Cloudflare 控制台「Pages → 创建项目 → 直接上传资产」拖拽 `ripple-f-demo-static.zip` 解压后的目录。
- `dist-demo/_headers` 已随产物生成：全站 `X-Content-Type-Options: nosniff`、`X-Frame-Options: DENY`、
  `Referrer-Policy: no-referrer`、`Permissions-Policy` 禁用摄像头/麦克风/定位；`/assets/*` 一年不可变缓存。

**验收标准**：

1. `https://<project>.pages.dev/` 默认进入演示工作台（非白屏、非目录列表）。
2. 顶栏可见「演示数据 DEMO」徽章；前后对照区固定显示「演示对照：模拟内容，未经真实浏览器验证」。
3. 关系图点选、范围决策（包含/保护/排除）、版本历史胶片、演示审批全部可操作。
4. URL 加 `?adapter=real` 后仍是演示模式，无「打开真实工程」表单。
5. 浏览器 DevTools Network 面板无任何 `/__ripple/api/*` 请求。
6. 手机视口（≤ 390px）布局纵向堆叠，操作可达。

## 方案 B：独立 Nginx 静态站点

**服务器配置要求**：1 vCPU / 512 MB 内存 / 1 GB 磁盘即可（纯静态）；Nginx ≥ 1.18；
TLS 证书（Let's Encrypt / certbot 或自有证书）。

**部署步骤**：

```bash
# 构建机（本机）上执行，然后把 ripple-f-demo-static.zip 传到服务器
npm run build:demo-static

# 服务器上执行
sudo mkdir -p /var/www/ripple-demo
sudo unzip ripple-f-demo-static.zip -d /var/www/ripple-demo
sudo chown -R www-data:www-data /var/www/ripple-demo   # 用户按发行版调整
```

`/etc/nginx/sites-available/ripple-demo`：

```nginx
server {
    listen 80;
    server_name demo.ripple.example;          # 换成实际域名
    return 301 https://$host$request_uri;
}

server {
    listen 443 ssl http2;
    server_name demo.ripple.example;

    ssl_certificate     /etc/letsencrypt/live/demo.ripple.example/fullchain.pem;
    ssl_certificate_key /etc/letsencrypt/live/demo.ripple.example/privkey.pem;

    root /var/www/ripple-demo;
    index index.html;

    add_header X-Content-Type-Options nosniff always;
    add_header X-Frame-Options DENY always;
    add_header Referrer-Policy no-referrer always;
    add_header Permissions-Policy "camera=(), microphone=(), geolocation=()" always;

    location /assets/ {
        add_header Cache-Control "public, max-age=31536000, immutable" always;
        try_files $uri =404;
    }

    location / {
        try_files $uri $uri/ =404;            # 纯静态，无 SPA 回退
        add_header Cache-Control "no-store" always;
    }
}
```

```bash
sudo ln -s /etc/nginx/sites-available/ripple-demo /etc/nginx/sites-enabled/
sudo nginx -t && sudo systemctl reload nginx
```

**验收标准**：与方案 A 的 6 条相同，另加：

7. `curl -I https://demo.ripple.example/` 返回上述安全响应头。
8. 评分期结束后 `sudo rm /etc/nginx/sites-enabled/ripple-demo && sudo systemctl reload nginx` 即可下线。

## 两种方案对比

| 维度 | Cloudflare Pages | 独立 Nginx |
|---|---|---|
| 运维成本 | 零（托管方管 TLS/缓存/可用性） | 需维护服务器与证书续期 |
| 上线耗时 | ≈ 5 分钟 | ≈ 30 分钟（含证书） |
| 访问控制 | Cloudflare Access（可选） |  basic auth / IP 白名单自行配置 |
| 适用场景 | 评委评审期临时公开 | 已有自有服务器或需内网部署 |

## 未完成项

- ~~公网地址与线上截图~~ → **已完成（Cloudflare 段，见上）**；国内入口（腾讯云 8082）待负责人提供可访问地址后补验收。
- 静态版不含真实 TEXT 生命周期（按任务要求第二阶段完成后另行上线云端工作台，见
  `docs/experience/CLOUD-WORKBENCH-DEPLOY.md`）。

## 比赛展示 UI 优化建议（依据线上双视口截图，供 UI Agent 参考）

线上功能验收 22/22 通过后，从展示效果角度记录以下改进点（按优先级）：

1. **画布留白过大（桌面端最明显）**：画布容器约 700 px 高，演示页面内容只占顶部约 200 px，
   下方大片空白。建议画布高度按内容自适应（`min-height` + 内容撑开），或加浅色网格/骨架占位背景，
   避免评委第一印象「页面没加载完」。
2. **移动端中段空白**：手机视口下画布与「选中位置」之间存在大段空白（固定高度与外边距叠加），
   建议在 ≤720 px 媒体查询下收紧画布与面板间距。
3. **顶栏小屏换行挤压**：390 px 下工程名「青野文创商店」折行、状态徽章（工程就绪/候选已生成/
   演示数据/版本历史）换行堆叠。建议小屏隐藏工程名（保留图标）或将徽章收进「状态」单徽章。
4. **版本胶片小屏裁切**：手机端版本胶片横向滚动，卡片文案（如「导航改为一致」）被截断且无线索。
   建议小屏改纵向卡片列表，或加滑动渐变遮罩 + 「滑动查看更多」提示。
5. **前后对照占位框偏高**：窄屏下「修改前 / 候选修改后」两个占位框高度大、信息密度低，
   建议压缩高度并在框内叠加淡「DEMO」水印，既省空间又强化演示标识。
6. **源码路径字号**：顶栏摘要行 `src/data/campaign.ts` 等路径字号偏小（约 11–12 px），
   建议不低于 12 px 并增加与背景的对比度。

> 以上仅影响演示观感，不影响功能正确性；线上验收通过的交互与屏蔽行为不受这些调整影响。
