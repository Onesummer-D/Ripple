# Run #18 原始证据归档索引

> 归档日期：2026-10-23。本目录保存 GitHub Actions Run #18 工件 `ripple-bolt-workbench-39808500782` 的完整解压内容（238 个文件，与远端逐字节一致），用于比赛材料引用与过期后的复核。
> **重要**：GitHub Actions 工件默认保存 30 天，到期后远端链接失效，以本目录为唯一长期副本；重新下载校验时用下方 ZIP SHA-256 比对。

## 来源标识

| 项 | 值 |
| --- | --- |
| 运行 | Run #18（Bolt real-project acceptance），2026-10-22，整轮 SUCCESS，唯一用例 1.4 分钟 passed |
| 运行链接 | <https://github.com/Onesummer-D/Ripple/actions/runs/39808500782> |
| 工件链接 | <https://github.com/Onesummer-D/Ripple/actions/runs/39808500782/artifacts/12440030009>（工件 id 12440030009，27,183,850 字节） |
| 工件 ZIP SHA-256 | `35668a23f4ac5683a4a59297f7aa90321110a0e26d01f7cb4ed50fca62ff2c44` |
| 主仓库固定版本 | A 主线 `Onesummer-D/Ripple @ 16e737c16d95a26879d1aee813b85fb472fd8215`（`feat/project-first-core-20261018`） |
| 真实工程固定版本 | 青野 `Onesummer-D/ripple-qingye-bolt @ f7e4998a5c77ab4aeb3232dbc31e61196e9051a6`（私有仓，凭据由负责人配置） |
| 执行身份 | runId `verification-9396b660-33f8-4a3a-9552-0e4ea81181a9`；candidateId `candidate-d65e3891-6eaf-40cc-ab5c-5e081ed8996e`；patchHash `0f18408dad0d28ce14b3f18707cd72835ee8c8fecebbc7b12a5ac9559b04a76d` |

## 关键文件索引（SHA-256 已复核）

| 文件 | 字节 | SHA-256 | 证明内容 |
| --- | --- | --- | --- |
| bolt-workbench-execution.json | 155,985 | `a5fe841e…9096ae1` | v4 manifest，completed:true；七断言全 pass；16 条 scopeObservations（4 页 × 4 视口）；scopeVersion 1；221 资源快照登记；blockedExternalResourceUrls=[] |
| browser-results.json | 7,450 | `b8827cc4…6fa232c` | 真实浏览器运行结果汇总 |
| bolt-resource-load-audit.json | 3,489 | `1c8b0287…b0f8459` | 授权 URL 清单与图片加载审计；unavailable=0 |
| bolt-workbench-analysis.png | 2,652,285 | `872d25b8…8359582ef` | 工程分析阶段工作台截图（4 页面状态） |
| bolt-workbench-candidate.png | 2,813,105 | `a5e3d3b2…a25ef4` | 候选生成阶段工作台截图（diff + 哈希网格） |
| bolt-workbench-1440.png | 2,553,853 | `21f2bc73…aca849c8` | 桌面视口 1440×900 截图（哈希与 artifactHash 绑定） |
| bolt-workbench-768.png | 1,684,326 | `1a7c5c46…3af886` | 平板视口 768×1024 截图（同上） |
| bolt-workbench-375.png | 858,353 | `d4a1a9ce…d254e9e14` | 手机视口 375×812 截图（同上） |
| bolt-workbench-390.png | 889,214 | `fa721041…f74f082ac` | 手机视口 390×844 截图（同上）；**仅证明青野 TEXT 案例与公共验证器的该视口能力，不构成栖光 MEDIA 验收证据** |
| bolt-workbench-applied-site.png | 749,551 | `fcc479cd…6255635` | 应用后某次三页导航之一的单张截图；三页导航的完整证明是执行记录中的逐页 H1/Footer 断言 |
| bolt-workbench-history-restored.png | 4,617,762 | `430bb1fc…d3a6fce0` | 历史恢复后工作台画面；恢复内容 = 选中历史候选及其验证状态，非任意历史版本重新部署 |

## 其余内容

- `resource-snapshots/`：221 个内容寻址（SHA-256 命名）的外部资源快照，13 MB。
- `source-resource-snapshots/`：源码侧资源快照。
- `diagnostics/<runId>/`：progress.jsonl、resource-fetch-log.json、snapshot-timing.json 运行诊断。

## 使用边界

1. 本目录证据仅覆盖**青野 TEXT 主案例**与公共验证器能力；栖光 MEDIA 与第三方案例的缺口见 `../../evidence-gap-checklist.md`。
2. 引用时标注「Run #18 @ 16e737c × 青野 f7e4998a，2026-10-22」。
3. 审批通过的真实证明是工作台状态断言（候选进入「已批准」），不在 execution.json 字段内；回滚证明是 Footer 源码恢复 + 应用 worktree 与原工程 HEAD/status 逐字节不变断言；历史恢复证明是恢复后候选 ID/patchHash/验证状态一致的断言。
