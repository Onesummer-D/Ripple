# PR #61 AC-P6 最终精确 SHA 正式验收

日期：2026-10-27

## 固定输入

- C+D 精确 HEAD：`2ebd1e20d043287edbbfc2ec31c10f15688a4499`
- B 冻结验收基线：`0c02b85cdf7b1d52821fee3e06c013cbd664efa8`
- 冻结探针 blob：`3431294c0807161432e0a7c986825ffc5263bc87`
- 冻结匹配器 blob：`3a04ab896b40500b2c314b710b4cb1c3a3893dcb`
- 固定第三方工程：`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd`
- 固定工程 `src/css/style.css` SHA-256：`8de0b6c59beb8538534adcbd5bb20906bda6b6ca7b9e3998702a229a2506a920`
- 固定工程工作树：clean
- 运行环境：Windows；Node `v24.15.0`；TypeScript `5.9.3`；PostCSS `8.5.30`；nanoid `3.3.20`；picocolors `1.1.1`；source-map-js `1.2.2`

本次使用 C+D 最终精确 HEAD；使用冻结、未经修改的 B v5 探针与匹配器正式复跑 的 `src/core/css-token-source.ts`、`model.ts`、`project-data-routes.ts`、`project.ts` 等源文件；探针、匹配器和 TypeScript loader 均从冻结 B 基线恢复。未使用 C+D 的 detail.json 作为判定输入。

## 本次运行的源文件字节摘要

C+D 精确 HEAD 源文件（本地 UTF-8 bytes 的 SHA-256）：

- `src/core/css-token-source.ts`: `8CED2A2CC3DF4486B7042297B8155E7E0B444F868584090E697B1D8A38EC1400`
- `src/core/model.ts`: `C193FD31108268234A0EAA5671E3EBA3E3F6D5B04FCEB3DCBEC0B4CD743346FA`
- `src/core/project-data-routes.ts`: `6C2C4E682864879581A34420E8E0D4807F7542D9E5513EC0A64EA7DE8BA9FE52`
- `src/core/project.ts`: `B2583EBC7C7452D2E6774718FD4CBC7921A43B2BE2C12BE0F7A2CF1F5E3AE196`
- `src/core/project.test.ts`: `959550708CE0A21A15138897BE927CC465B4F6F9DE9386E12017887FE3FDCBFE`

- 2ebd 精确快照的新增测试文件 SHA-256：`4DF7B0E6A610EFD8B552819F491513E3B1C1E1C842A2FED38248AC26E01C0A1A`

## 复跑命令与机器结果

```powershell
node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs ./scripts/b-css-token-probe.mjs "D:/Onesummer_D/Learning/Competitons/ShuMei_QG/Ripple涟漪/_scratch/webportflio-b244f85" --acceptance --json "D:/Onesummer_D/Learning/Competitons/ShuMei_QG/Ripple涟漪/_scratch/acp6-pr61-2ebd1e20-independent-20261027/acceptance-2ebd1e20-final.json" --expect-core-sha 2ebd1e20d043287edbbfc2ec31c10f15688a4499
```

- 进程退出码：`2`（能力项仍有 PENDING，非执行异常）
- JSON：1,035,281 bytes
- JSON SHA-256：`289EDDE457393F499BF53ECD85379B874E6BDE4782949E08418194723CC0571B`
- 总结：**3 PASS / 2 PENDING / 0 ERROR**

| Acceptance | Status | 依据 |
| --- | --- | --- |
| AC6.1 | PASS | 18 个声明、11 个 token label，scoped identity 精确匹配 |
| AC6.2 | PENDING | 8 个 token 中严格完整覆盖 1 个，7 个未闭合 |
| AC6.3 | PASS | 7 条 route 一对一绑定，全部使用权威 `routePath` |
| AC6.4 | PENDING | 147 对中 131 个静态锚定，16 个 UNKNOWN |
| AC6.5 | PASS | 3 个未定义 fallback 用法保留为 explicit unknown |

## AC6.1

实际固定 CSS 声明为 18 个、11 个 token label。相同 token 在 `:root` 与 `[data-theme="light"]` 中保持不同 graph node，按文件、UTF-8 byteOffset 和 selector scope 独立匹配。

## AC6.2

- 8 个 token 中只有 `--skill-color` 达到 token-level strict coverage（1/8）。
- 未闭合的 7 个 token：`--text-primary`、`--border-color`、`--accent`、`--text-secondary`、`--background`、`--card-bg`、`--accent-secondary`。
- 123 个 source-use rows 中 85 个有严格覆盖，38 个 `linkedStrictEdges=0`。
- 因此 1/8 token 的合同门控仍为 PENDING；没有把部分 source-use 覆盖升级为 PASS。

## AC6.3

七条路由均唯一匹配，权威身份字段均为 `routePath`，没有冲突或重复：

| Route | Graph node | Source |
| --- | --- | --- |
| `/` | `page:/` | `src/App.jsx:1035` |
| `/about` | `page:/about` | `src/App.jsx:1090` |
| `/experience` | `page:/experience` | `src/App.jsx:1152` |
| `/projects` | `page:/projects` | `src/App.jsx:1223` |
| `/certifications` | `page:/certifications` | `src/App.jsx:1290` |
| `/education` | `page:/education` | `src/App.jsx:1359` |
| `/interests` | `page:/interests` | `src/App.jsx:1422` |

`routeIdentityConflicts=[]`，每条 `graphNodeIds` 长度为 1，七个 node id 互不重复。

## AC6.4

- 147 个 source-positioned consumer pairs。
- 131 个 anchored，16 个 UNKNOWN。
- 16 个 UNKNOWN 中：9 个静态 source pair 没有严格 element edge，7 个来自动态 `className`。
- 动态候选 4 条记录，涉及 `src/layouts/Nav.jsx` 1 条和 `src/pages/Home.jsx` 3 条；动态 gate 继续为 PENDING。
- 静态未闭合项包括 compound/pseudo selector（例如 `.footer-section h4`、`.nav-link:hover`、`.stat-card::before` 等）及其 exact source-positioned edge 缺失。没有通过删除 UNKNOWN 或放宽 class 规则提高通过率。
- `componentLevelEdgesTotal=0`。

## AC6.5

`--accent-color` 未定义的 3 个 fallback 消费点仍保留为 explicit unknown，位置为：

- `src/css/style.css:12715`
- `src/css/style.css:12991`
- `src/css/style.css:13078`

结果：AC6.5 PASS，`unknownEdges=3`。

## SourceGraph 变化核对

独立对 `analyzeProject(...)` 的真实输出做了节点/边类型统计，未采信 C+D detail.json：

| 指标 | 旧冻结结果 | 5c 独立结果 | 增量 |
| --- | ---: | ---: | ---: |
| nodes | 650 | 675 | +25 |
| edges | 4656 | 5302 | +646 |
| unresolved | 253 | 253 | 0 |
| jsx-element nodes | 196 | 214 | +18 |
| route nodes | 0 | 7 | +7 |
| renders edges | 204 | 250 | +46 |
| uses-token edges | 2108 | 2408 | +300 |
| css-cascade edges | 884 | 1184 | +300 |

新增的 7 个 route nodes 都绑定到 `src/App.jsx` 的七个 literal route source offsets；其余主要增量是 SourceGraph 的 JSX element、render、uses-token 和 css-cascade 关系，说明 650→675 与 4656→5302 来自真实 SourceGraph 增强。unresolved 数量保持 253，动态 class、复杂选择器、主题/级联和 fallback 仍按合同降级。

## 结论

本次独立验收结论为：

**AC6.1 PASS、AC6.2 PENDING、AC6.3 PASS、AC6.4 PENDING、AC6.5 PASS；总计 3/5 PASS，0 ERROR，退出码 2。**

该结论只绑定 C+D 精确 SHA `2ebd1e20d043287edbbfc2ec31c10f15688a4499`。后续若 LF 清理或其他提交生成新的 HEAD，必须对新的精确 SHA 重新复跑。

未修改验收器阈值、C+D 生产代码、Candidate、Verification、Approval、Apply、Rollback；未合并、未部署、未触发 Bolt。



