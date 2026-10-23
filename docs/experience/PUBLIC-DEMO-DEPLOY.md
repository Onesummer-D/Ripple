# 公网静态体验版部署方案（评委 Demo）

> 产物：`npm run build:demo-static` → `dist-demo/`（已另存 `ripple-f-demo-static.zip`）。
> 特性：默认访问 `/` 直接进入演示工作台；强制演示适配器（无任何后端 API 请求）；
> 保留「演示数据 DEMO」标识与「演示对照：模拟内容，未经真实浏览器验证」文案；
> `?adapter=real` 参数在静态版中被屏蔽，不显示任何无法运行的真实后端操作入口。
> 本地验收：`node scripts/verify-demo-static.mjs` —— 26/26 项通过（桌面 1440 + 手机 390 双视口，
> 覆盖关系图、范围决策、前后对照、版本历史、真实入口屏蔽、控制台零错误），
> 截图见 `docs/experience/public-demo/demo-desktop-full.png` 与 `demo-mobile-full.png`。

## 公网部署状态（2026-10-23 更新）

### 主要体验地址（国内公网，验收通过）：http://81.70.40.146:8082/

- **国内可访问性**：负责人已用不带 VPN 的国内手机实测成功打开；本机探测 HTTP 200、首响 0.43 s。**国内公网可访问验收通过。**
- 线上验收脚本 `scripts/verify-demo-online.mjs`（`DEMO_BASE` 指向本地址）：**22/22 项通过**
  （桌面 1440×900 + 手机 390×844 双视口）：默认 `/` 直达工作台、DEMO 标识、画布点选、
  范围决策、前后对照同步、版本历史、演示审批（文案「不写入真实工程」「未执行真实应用」）、
  `?adapter=real` 仍强制 DEMO 且无真实工程入口、**双端 Console 零错误、Network 零 `/__ripple/api` 请求**。
- 线上截图（腾讯云真实公网，`docs/experience/public-demo/`）：
  `cn-desktop-history.png`、`cn-desktop-approved.png`、`cn-desktop-adapter-real-blocked.png`、`cn-mobile-full.png`。

### 备用地址（海外网络）：https://ripple-demo.dengtongxin1215.workers.dev/

- Cloudflare Workers 线上验收同样 **22/22 项通过**（截图 `online-*.png`）。
- **国内访问限制（如实记录）**：负责人已用不带 VPN 的国内手机实测，`*.workers.dev` 域名
  **国内网络不可正常访问**。该入口仅作备用，**不标记为国内可访问**；正式评审发放国内地址。

### 评审入口结论

- 国内评委发放 **http://81.70.40.146:8082/**（主）；海外评委可备用 Cloudflare 地址。
- 两个入口同一构建产物（`ripple-f-demo-static.zip`），行为一致：静态 DEMO、保留演示标识、
  真实能力边界明确（无真实后端入口，模拟审批一律表述为「演示审批 / 未执行真实应用」）。

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

- ~~公网地址与线上截图~~ → **已完成**：腾讯云国内入口 22/22 验收通过（主），Cloudflare 备用 22/22（海外）。
- 静态版不含真实 TEXT 生命周期（按任务要求第二阶段完成后另行上线云端工作台，见
  `docs/experience/CLOUD-WORKBENCH-DEPLOY.md`）。
- ~~UI 优化方案（见下节）尚未实施~~ → **已实施**（设计系统 v2，`d8de78c`）：
  本地静态验收 26/26 复跑通过；**线上 22/22 复跑待负责人将新 ZIP 重传两处部署后执行**。

## 比赛展示 UI 优化：设计系统 v2 已实施（`d8de78c`）

按负责人审美要求（对齐 smartify.org 编辑式排版、参考 `docs/research/competitors/bolt-new/README.md`
§07/§09 的 Bolt 借鉴原则）对体验页做整体设计系统重构。**禁止卡片、禁小字备注、主标题仅概括性短语、
禁副标题**；字号全面上调（正文 16px 起、注释性文字 14px 起）；统一茶青单色体系。

实施内容：

1. **单色文字标记体系**：工程/候选状态、确定性（来源已证实/部分证明/未知）、证据状态、
   生命周期全部从彩色胶囊改为加粗文字标记（茶青=已证实、赭琥珀=部分、石灰=未知、陶红=风险）；
   全站仅保留一枚实心墨色「演示数据 DEMO」徽章。
2. **编辑式排版**：暖纸底色 + 衬线大标题 + 细分隔线分区，无卡片边框；顶栏/页导航/范围决策/证据/
   前后对照全部重排；青野演示页改为大图 hero + 衬线标题压图 + 图片商品行的杂志式版面。
3. **画布空白根因修复（原 P0）**：`viewport-shell` 显式给出 `scale` 后的高度，
   桌面/手机画布死白同时消除。
4. **版本胶片改为图片轮播**：smartify 式横向滚动（箭头 + 滚动吸附 + 悬停缩放），
   配 4 张茶器主题编辑摄影（AI 生成，水印已裁除，`public/demo-assets/`）。
5. **涟漪感动效**：全局点击涟漪（产品名 Ripple 的核心触感）、分区滚动浮现（IO 驱动，
   动画不可用时内容始终可见）、`prefers-reduced-motion` 全量降级。

验证：体验层单测 63/63、e2e 18/18、本地静态验收 26/26 全绿；66 个 testid 与全部演示语义文案
（「演示数据」「演示对照：模拟内容，未经真实浏览器验证」「演示审批（不写入真实工程）」等）原样保留。

重构后截图（本地构建验收，`docs/experience/public-demo/`）：
`demo-desktop-full.png`、`demo-mobile-full.png`。

> 待办：负责人将新 `ripple-f-demo-static.zip` 重传腾讯云/Cloudflare 后，复跑
> `scripts/verify-demo-online.mjs`（双地址）须仍 22/22，并更新线上截图（`cn-*.png` / `online-*.png`）。
