# 第三方 TEXT 全生命周期阻断矩阵（Issue #6 / codescandy）

- 日期：2026-10-21（v1）
- 基线：Ripple PR #9 分支、codescandy `b700bbd55b31a62fe04d4cd8210fc37232f0c9f0`
- 状态取值：PASS / RISK / UNKNOWN / UNSUPPORTED / NOT RUN / BLOCKED
- 原则：第一项失败不级联——未运行的环节标记 NOT RUN/BLOCKED 并写明前置依赖，
  不写成"已验证失败"，也不提前写成 PASS。

| # | 环节 | 状态 | 依据 / 前置依赖 |
| --- | --- | --- | --- |
| 1 | SourceGraph 识别真实 route | **UNSUPPORTED** | `createBrowserRouter` 数据路由（Component:/element:/children/index/动态参数）产出 0 route 节点；path 字面量也不入图。复现：`src/core/b-thirdparty-capability-repro.test.ts`「codescandy 真实 data router 结构」2 用例。前置：A 实现 data router 路由识别 |
| 2 | TEXT 目标页面影响 source-proven | **BLOCKED**（依赖 #1） | 目标 `literal:...ProfileHeader.tsx#2691`（"Overview"）已双重定位并唯一；但 0 route 节点 → `sourceProvenPageImpact` 为 unknown，100/100 media 同理。非"已验证失败"，是 #1 的级联阻塞 |
| 3 | Candidate 合法生成 | **BLOCKED**（依赖 #2） | candidate.ts 硬性要求 sourceProvenPageImpact 无 unresolved，当前任何候选在候选阶段被拒。这是正确 fail-closed，不得放宽门控 |
| 4 | 受限 React/Vite adapter 预演 | **NOT RUN** | 依赖 #3 产出候选；adapter 对 codescandy（react-bootstrap/Sass 体系）的支持未经真实运行验证，待 #3 后实测 |
| 5 | DOM→Source 唯一匹配 | **NOT RUN** | 依赖 #4 浏览器预演；ProfileHeader "Overview" 源码唯一性已具备（图 + 源码双定位），运行时匹配未验证 |
| 6 | Scope 与四视口 Evidence | **NOT RUN** | 依赖 #4/#5；青野 MEDIA 阶段的四视口证据管线已在另一工程验证，但对 codescandy 未运行 |
| 7 | Receipt / Approval / Apply / Rollback 完整执行 | **NOT RUN** | 依赖 #3–#6；青野 Run #1 已证明该链在 source-proven MEDIA 上可行，codescandy TEXT 未运行 |
| 8 | 能力盘点与探针 | **PASS** | SourceGraph 统计（4924/5006/61 消费边）、能力边界 7 用例复现、探针加固 + smoke 测试、TEXT 目标定位——本轮完成 |
| 9 | SCSS Token 支持 | **UNSUPPORTED**（本轮不要求） | 0 token 节点；保持 unsupported，不伪装 PASS |
| 10 | 解析失败导入 fail-closed 记录 | **UNSUPPORTED** | 内部别名/裸导入解析失败被静默跳过（无 import 边、无 unresolved）；组件来源边语义正常不受影响。需 A 修复归因，见接口需求 A-P1b |

## 推进条件（进入下一阶段前必须满足）

1. A 实现 data router 路由识别并有测试（route→component→source 证明关系，
   对嵌套/动态/不可解析组件采取 partial/unknown 语义），见 A-P1a。
2. 固定 A、B、codescandy 三方 SHA，重跑真实 SourceGraph，核对 #1/#2。
3. #1/#2 转 PASS 后，#3 应在有证明时才放行；若 adapter 不支持该工程，
   把阻断推进到 #4 并如实记录，不得把路由识别成功等同于验收通过。

## 附：公共浏览器预演稳定性登记（2026-10-21）

CI #311（run 39546320560，`d696e4f4` 树）曾一次失败于
`e2e/page-override-lifecycle.spec.ts:308`：
`page.goto: net::ERR_NETWORK_CHANGED at http://127.0.0.1:34533/`
（8 passed / 1 failed / 1 skipped）。同树重跑 CI #313（run 39547183042）
9 passed / 1 skipped 全过。此为 A 公共浏览器预演稳定性问题，如实登记，
未自行修改 A 的 E2E、未降低断言、不声称已彻底解决。
