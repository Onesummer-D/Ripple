# Run #18 原始证据归档索引

> 归档日期：2026-10-23（含 2026-10-23 终审审核与全量哈希补全）。本目录保存 GitHub Actions Run #18 工件 `ripple-bolt-workbench-39808500782` 的完整解压内容，用于比赛材料引用与远端过期后的复核。
> **重要**：GitHub Actions 工件默认保存 30 天，到期后远端链接失效，以本目录为长期副本；重新下载校验时用下方 ZIP SHA-256 比对。

## 来源标识

| 项 | 值 |
| --- | --- |
| 运行 | Run #18（Bolt real-project acceptance），2026-10-22，整轮 SUCCESS |
| 运行链接 | <https://github.com/Onesummer-D/Ripple/actions/runs/39808500782> |
| 工件链接 | <https://github.com/Onesummer-D/Ripple/actions/runs/39808500782/artifacts/12440030009>（工件 id 12440030009，27,183,850 字节） |
| 工件 ZIP SHA-256 | `35668a23f4ac5683a4a59297f7aa90321110a0e26d01f7cb4ed50fca62ff2c44` |
| 主仓库固定版本 | A 主线 `Onesummer-D/Ripple @ 16e737c16d95a26879d1aee813b85fb472fd8215`（`feat/project-first-core-20261018`） |
| 真实工程固定版本 | 青野 `Onesummer-D/ripple-qingye-bolt @ f7e4998a5c77ab4aeb3232dbc31e61196e9051a6`（私有仓） |
| 执行身份 | runId `verification-9396b660-33f8-4a3a-9552-0e4ea81181a9`；candidateId `candidate-d65e3891-6eaf-40cc-ab5c-5e081ed8996e`；patchHash `0f18408dad0d28ce14b3f18707cd72835ee8c8fecebbc7b12a5ac9559b04a76d` |

## 完整性校验（勿仅凭 ZIP 哈希推断解压文件）

1. **全量清单**：`SHA256SUMS.txt` 覆盖本目录全部 239 个文件（238 个工件文件 + 本 INDEX.md）的完整 64 位 SHA-256，逐文件独立计算，非自 ZIP 推导。
2. **一致性核对结果**：归档文件名与大小同原工件 ZIP **238/238 完全一致**（无缺失、无多余、无尺寸差异）。
3. **校验命令（Python，在 run18/ 目录执行）**：

```python
import hashlib
bad = 0
for line in open('SHA256SUMS.txt', encoding='utf-8'):
    h, p = line.rstrip('\n').split('  ')
    if hashlib.sha256(open(p, 'rb').read()).hexdigest() != h:
        bad += 1; print('MISMATCH', p)
print('ALL OK (239 files)' if not bad else f'{bad} MISMATCHES')
```

4. **校验命令（Windows PowerShell，在 run18/ 目录执行）**：

```powershell
Get-Content SHA256SUMS.txt | ForEach-Object {
  $h, $p = $_ -split '  ', 2
  if ((Get-FileHash $p -Algorithm SHA256).Hash -ne $h.ToUpper()) { Write-Output "MISMATCH $p" }
}
```

5. **原 ZIP 的保存与校验**：ZIP 单独保存于本工作区 `_scratch/delivery-prep/run18-artifact.zip`（未入库，避免仓库双重体积）；校验：`python -c "import hashlib;print(hashlib.sha256(open('_scratch/delivery-prep/run18-artifact.zip','rb').read()).hexdigest())"`，应等于上方 ZIP SHA-256。ZIP 内文件清单与 `SHA256SUMS.txt` 中 238 个工件路径一一对应。

## 关键文件索引（完整 64 位 SHA-256）

| 文件 | 字节 | SHA-256 |
| --- | --- | --- |
| bolt-workbench-execution.json | 155,985 | a5fe841e951577f7c69b1a8f93486ba81156230afe04960f855b2c1609096ae1 |
| browser-results.json | 7,450 | b8827cc457aac8e77cd8ce15462e4631fcd3b713822bfa643a5eae7386fa232c |
| bolt-resource-load-audit.json | 3,489 | 1c8b02876ff521adc8f0bf6029a52db905d6b45b5dbc2a14b776716c1b0f8459 |
| bolt-workbench-analysis.png | 2,652,285 | 872d25b8d0e872b59cb29e2b1463ba6f0f43702985c7b5aa4844f6e8359582ef |
| bolt-workbench-candidate.png | 2,813,105 | a5e3d3b27f464a51a00d6c79983ca8ba480dc3fd4386c354a510b9ed2fa25ef4 |
| bolt-workbench-1440.png | 2,553,853 | 21f2bc73260d8ca5dea429ebd29322eac7709bd97482fb55e9007ea7aca849c8 |
| bolt-workbench-768.png | 1,684,326 | 1a7c5c4645387cea16ad98a5011c7cf26a5f5e5ba2d287165ad137f9183af886 |
| bolt-workbench-375.png | 858,353 | d4a1a9ce9013195d9beed9added64e1398f6045cb105d4640369173d254e9e14 |
| bolt-workbench-390.png | 889,214 | fa72104166fb70c16746ff8821cd85c2a420c3825fe8e5c8e7d9237374f082ac |
| bolt-workbench-applied-site.png | 749,551 | fcc479cd26db5d3c605447dea8bbc7cda12e769985a24b0aad0d9853f6255635 |
| bolt-workbench-history-restored.png | 4,617,762 | 430bb1fca6d55ffbd78ad41ee1802a68b7e749b6dc80c299c3c13a16d3a6fce0 |

## 其余内容

- `resource-snapshots/`：221 个内容寻址（SHA-256 命名）外部资源快照，13 MB（202×WOFF2 字体 + 21×MP4 媒体 + 1×CSS，来源见下）。
- `source-resource-snapshots/`：3 个源码侧资源快照。
- `diagnostics/<runId>/`：progress.jsonl、resource-fetch-log.json、snapshot-timing.json 运行诊断。

## 2026-10-23 终审审核结果

1. **敏感信息扫描（通过）**：对全部文本类文件扫描 token/secret/password/authorization、Windows 用户目录、Bearer、GitHub PAT 等模式——零命中。仅存在 `/home/runner/work/Ripple/...` 标准 CI 路径（公开仓库名，无个人信息）与 `127.0.0.1:4173` 回环测试地址，属正常构建元数据。
2. **私有内容提示（负责人知悉项）**：8 张 PNG 为青野工程（私有仓）页面截图，含其品牌文案与带「Ripple UI验收」标记的修改后页脚；本目录随公开仓库发布即公开这些画面。比赛用途下视为可接受，最终对外口径由负责人确认。
3. **资源快照许可（低风险，非零）**：快照来源经 `bolt-resource-load-audit.json` 追溯为 `images.pexels.com`（18 个授权 URL，Pexels License 允许再分发）与 `fonts.googleapis.com`（1 个，OFL 字体允许原样再分发）。「验证时允许获取」≠ 大赛语境下的再发布已逐项确认，但目前无任何素材来自限制再分发的来源；若保守起见可仅保留哈希清单、移出媒体字节（见推荐方案）。
4. **体积统计**：239 文件共 28.4 MB（PNG 16.0 MB / 无扩展名快照 12.0 MB / JSON 0.2 MB）；最大单文件 history-restored.png 4.6 MB；已全部进入 Git 历史（提交 `40e0e19`）。
5. **长期保存推荐方案（待负责人确认，未做任何删除）**：
   - 方案 B（推荐）：公开仓库保留精简证据集（11 个关键文件 + diagnostics + 本索引与 SHA256SUMS，约 17 MB），224 个资源快照字节移出 Git 历史，完整 ZIP 另存负责人控制的归档位置（网盘/对象存储），以 ZIP SHA-256 登记衔接；快照可由固定 SHA 重跑复现，证据完整性不损失。
   - 方案 A（维持现状）：全量 28.4 MB 留库，最简单、可复现性最强；代价是每次 clone 永久携带 12 MB 快照字节。
   - 未获确认前不删除任何已提交文件、不改写 Git 历史。

## 使用边界

1. 本目录证据仅覆盖**青野 TEXT 主案例**与公共验证器能力；栖光 MEDIA 与第三方案例的缺口见 `../../evidence-gap-checklist.md`。
2. 引用时标注「Run #18 @ 16e737c × 青野 f7e4998a，2026-10-22」。
3. 审批通过的真实证明是工作台状态断言（候选进入「已批准」），不在 execution.json 字段内；回滚证明是 Footer 源码恢复 + 应用 worktree 与原工程 HEAD/status 逐字节不变断言；历史恢复是恢复选中历史候选及其验证状态展示，均非「任意历史版本重新部署」。
