# 云端工作台部署技术方案（F 第二阶段完成后实施）

> 现状边界：`src/core/local-project-api.ts` 的 `assertLoopbackRequest`（仅允许 127.0.0.1）
> 与 `src/core/candidate-preview.ts` 的本机预览地址是本机开发模式的安全假设。
> **本方案不取消这些限制**，而是把它们收敛到「单用户容器内部」，对外由独立的网关与编排层提供
> 多评委并发、认证与隔离。正式云端后端改造须待 A/C+D/F 集成合同稳定后另行开发。

## 0. 总体架构

```
评委浏览器 ──HTTPS──▶ 边缘层（TLS 终结、认证、限流）
                        │
                        ▼
                 会话路由（按评委会话亲和）
                        │
        ┌───────────────┼────────────────────┐
        ▼               ▼                    ▼
   [评委容器 A]     [评委容器 B]          [评委容器 N]
   Nginx (443)      Nginx (443)           Nginx (443)
   ├ 静态 F 工作台   ├ 静态 F 工作台         ├ 静态 F 工作台
   ├ /__ripple/api ─┼ /__ripple/api        ├ /__ripple/api
   │  (同容器回环)   │  (同容器回环)         │  (同容器回环)
   ├ 预演 iframe 网关（同容器 127.0.0.1:端口，经 Nginx 反代 + 签名 Cookie）
   └ Docker 引擎（socket 仅容器内可见）
        │
        ▼
   共享只读层：固定授权的青野测试工程（只读挂载）+ 每会话可写 overlay
```

核心原则：**现有 A 核心与 F 体验层代码不在云端分支中改安全语义**；loopback 限制保留
（API 只监听容器内 127.0.0.1，Nginx 同容器反代到回环），预览地址保留本机形态
（iframe 指向同容器 Nginx 反代域名，容器内仍是 127.0.0.1 服务）。

## 1. Linux Docker 服务端部署

- **服务器配置要求**：Ubuntu 22.04+；≥ 4 vCPU / 16 GB 内存 / 100 GB SSD（按 8 个并发评委容器峰值估算，
  每容器：Node 工作台 ~300 MB、Docker 内嵌预演 ~500 MB、浏览器验证 worker ~1 GB）；Docker Engine ≥ 24。
- **前置条件**：Docker socket 仅 root/docker 组可达；`docker compose` v2；镜像仓库（GHCR 或私有）。
- **容器镜像**：`ripple-workbench:版本`——多阶段构建：① `npm ci && npm run build`（静态产物 + 服务端 bundle）
  ② 运行时 node:20-bookworm-slim + Docker CLI（仅用于启动子级预演容器，见 §7 风险约束）。
- **验收标准**：`docker compose up -d` 后健康检查通过 `/healthz`（返回 200 + 版本号）；单容器冷启动 < 60 s。

## 2. 独立后端 API 与权限认证

- **配置要求**：每容器内 Nginx 将 `/__ripple/api/` 反代到 `127.0.0.1:4173`（vite/node 服务仅绑回环）。
- **认证**：边缘层校验评委凭证（推荐 Cloudflare Access / 自建 OIDC；演示期可用带过期时间的签名 URL token）。
  会话 token 经 Nginx 注入为 `Cookie: ripple_session=<jwt>`，API 所在 node 服务校验 SameSite=Strict Cookie，
  **不新增匿名端点**；所有既有路由（`/analyze`、`/candidate/*` 等）的语义与身份授权规则不变。
- **授权矩阵**：评委仅能操作自己会话容器内的 projectId/candidateId；跨会话 ID 在路由层直接 404（不暴露存在性）。
- **验收标准**：无 token 访问任何 API → 401；A 会话 token 访问 B 会话候选 ID → 404；token 过期 → 401 且前端引导重新进入。

## 3. 固定授权的青野测试工程

- **配置要求**：青野工程以**只读** git 镜像预置在宿主 `/srv/qingye-ro`；每评委容器以
  `overlayfs`（只读 lower + 每容器 upper）或 `git worktree` 派生可写副本。
- **前置条件**：工程授权书允许公网演示用途；仓库含锁定的基线 commit（A 的 `analyze` 409 冲突机制天然防漂移）。
- **验收标准**：评委任何操作不改动只读层（宿主校验 lower 目录 git 状态始终 clean）；两评委并发修改互不可见。

## 4. 真实预演 iframe 的 HTTPS 访问网关

- **配置要求**：候选/项目预演服务（容器内 127.0.0.1 动态端口）由同容器 Nginx 以
  `https://preview-<会话>.<域名>/p/<previewId>/` 反代；路径带不可猜测的 previewId（服务端现有随机 ID 已满足）。
- **安全头**：预演 location 仅放行 `GET/HEAD`，禁用目录列表，响应带 `Content-Security-Policy: sandbox`、
  `X-Content-Type-Options: nosniff`；iframe 保持 F 已实现的 `sandbox="allow-scripts"` + `referrerpolicy="no-referrer"`。
- **验收标准**：iframe 内容经 HTTPS 加载无混合内容告警；直接访问 `/<previewId>/../` 类路径 → 400；
  会话结束后 preview 端点返回 404。

## 5. 用户会话与候选工程隔离

- **配置要求**：每评委一个独立容器（命名 `ripple-judge-<会话ID>`）；状态目录
  （`RIPPLE_WORKBENCH_STATE_DIR`）为容器内私有卷；候选工件、证据截图、历史全部留在会话卷内。
- **生命周期**：会话创建（≤ 30 s）→ 活跃（TTL 2 h，操作续期）→ 回收（容器 stop + 卷归档 7 天后删除）。
- **验收标准**：`docker ps` 只见自己的容器；两评委同时跑完整 TEXT 生命周期互不影响；
  会话卷删除后该评委全部候选与证据不可恢复（隐私承诺可验证）。

## 6. 多评委并发、资源配额、超时与容器回收

| 项 | 配置 | 验收标准 |
|---|---|---|
| 并发上限 | 默认 8 容器，可配；超出排队并显示预估等待 | 第 9 名评委进入排队页而非 500 |
| CPU/内存配额 | 每容器 `--cpus=1.5 --memory=3g` | `docker stats` 不超配；OOM 只影响单会话 |
| 磁盘配额 | 每会话卷 ≤ 2 GB（xfs project quota 或定时巡检） | 超限写入返回明确错误，不撑爆宿主 |
| 任务超时 | verify 单次 ≤ 5 min；会话空闲 30 min 标记；TTL 2 h | 超时 verify 返回失败原因，候选标记 failed-to-run |
| 容器回收 | TTL 到期 / 评委主动结束 / 崩溃 watcher 清理 | 回收后 `docker ps -a` 无残留；端口/卷全释放 |
| 浏览器验证 worker | 容器内 Playwright Chromium，每容器最多 2 实例 | 四视口验证排队 ≤ 3 min |

## 7. 安全风险与缓解

| 风险 | 缓解 |
|---|---|
| 任意代码执行（评委工程代码在服务端运行） | **只允许固定授权的青野工程**（§3），容器内无其他可写源码入口；容器以非 root 运行、只读根文件系统（tmpfs 挂载 /tmp）、`no-new-privileges`、seccomp 默认配置 |
| 容器逃逸到宿主 | Docker 24 + 用户命名空间（`userns-remap`）；容器不挂载 `/var/run/docker.sock`；预演子容器由**宿主侧代理**代建（见下） |
| 预演子容器滥用 Docker | 容器内的预演启动改为调用宿主代理（gRPC/Unix socket 鉴权），代理白名单：仅镜像 `ripple-preview:*`、仅只读挂载青野、网络仅容器内 |
| SSRF / 外部网络访问 | 容器 egress 经宿主防火墙默认拒绝；仅放行镜像仓库与字体/CDN 白名单；预演资源沿用 A 的 `trustedPreviewResourceUrls` 授权机制 |
| 非法路径访问 | 保留 A 的 realpath + 前缀校验与 loopback 断言；Nginx 层 `location ~ \.\.` 直接 400 |
| 凭证泄露 | 会话 token 短期（2 h）；证据截图 URL 沿用 A 的哈希校验；日志不落请求体 |
| DDoS / 滥用 | 边缘限流（每 IP 10 req/s）；创建会话接口额外限流（每 IP 1/10 min） |

## 8. 服务器重启恢复策略

- **容器级**：宿主开机自启 `ripple-orchestrator`（compose `restart: unless-stopped`）；
  活跃会话卷持久化，orchestrator 重启后按卷重建容器并恢复 preview 端口映射（previewId 不变，iframe 链接不失效）。
- **候选状态级**：A 已持久化候选记录（`persistCandidate`），会话卷在则状态可恢复；
  无法恢复的活候选标记 `stale`，引导评委重新生成（A 既有语义）。
- **验收标准**：演示中途 `reboot` 宿主后 ≤ 5 min 恢复服务；重启前已 apply 的工程状态与青野只读层一致。

## 9. 评委零安装完成真实 TEXT 全生命周期

- 评委点击评审链接 → 边缘认证 → 自动创建会话容器 → 浏览器直达 F 统一界面：
  打开青野工程（预置，一键）→ 点选元素（D 桥）→ 查看关系（C）→ 修改与范围决策 →
  生成候选 → 四视口验证 → 审批 → 应用 → 回滚 → 版本胶片留痕。
- **前置条件**：青野工程依赖（node_modules）预烘焙进镜像，避免公网下载。
- **验收标准**：评委全程不安装任何软件、不输入任何本机路径；完整生命周期演示脚本
  （云端版 e2e）通过；端到端耗时（打开→回滚）≤ 10 min。

## 10. 实施顺序与未完成项

**阶段 1（F 第二阶段完成后立即做）**：单容器化（§1）、会话路由 + 认证（§2）、青野只读挂载（§3）、
预演 HTTPS 网关（§4）——先支持 1 名评委端到端演示。

**阶段 2**：多并发编排、配额、回收（§5–§6）、宿主代理预演容器（§7）、恢复策略（§8）。

**未完成项（本方案不做，另行立项）**：
- A 核心的多租户数据模型（当前候选/历史按 projectId 命名空间，会话隔离靠容器，未来单进程多租户需重做存储层）。
- 真实用户的自有工程上传（云方案仅覆盖固定授权工程；通用上传需要沙箱构建管线与更大隔离强度）。
- 监控/审计大屏（评委操作审计日志的结构化采集与留存策略）。
- 成本测算：8 并发 × 2 h 评审期的云主机规格与流量费用实测。
