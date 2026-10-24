# Ripple A+F 第三批联合验收报告（真实 TEXT 全生命周期 UI 成功路径）

日期：2026-10-24
分支：`feat/a-f-joint-acceptance-20261023`
验收 HEAD：`9786475`

## 一、固定基线

| 项 | 值 |
| --- | --- |
| A 公共核心 | `feat/project-first-core-20261018` @ `45a2d7c` |
| A passed fixture | `feat/a-passed-fixture-20261023` @ `7a3ec43`（merge 引入：`7b695d1`） |
| F 第三批基线 | `3f65cb1` |
| fixture 工程 SHA（验收时） | `ffa54331dd5437b5497f3a46e6d1b6fc66042fa2` |

## 二、正式 CI 与测试统计

- CI Run：#40095429268 SUCCESS（head `9786475`）
  https://github.com/Onesummer-D/Ripple/actions/runs/40095429268
- Vitest：59 文件 / **809 通过**
- Playwright：**70 通过，1 跳过**（跳过项为 A 的 Bolt 门控工作流用例，按约定不触发 Bolt，此前轮次同样跳过）
- 联合验收用例：`e2e/experience-passed-lifecycle.spec.ts` › 联合验收 UI 成功路径（21.6s，通过）

## 三、真实 UI 成功路径步骤记录

固定两页 data-router 工程（`/` 与 `/about`，`SiteFooter` 共享文本源，显式完整 Scope，七项真实浏览器断言，四视口证据）：

1. 加载真实工程，iframe 画布内点选共享页脚文本（真实 DOM 点选 → `project/source-selection` 身份校验）。
2. 验证合同：两页标记（青野家居生活馆 / 关于青野）+ 一条显式交互声明（「展开服务详情」→「服务详情已展开」）。
3. 显式完整 Scope 决策（两页 include）。
4. UI 创建真实 Candidate（`POST /candidate`）。
5. Docker 四视口 Verification：**7/7 passed**（target-change / non-target-preserved / scope-propagation / interaction / responsive-layout / source-mapping / browser-errors）。
6. UI 审批：绑定最新 passed `runId`（`POST /candidate/approve`）。
7. 两步确认应用（`POST /candidate/apply`）：磁盘 `SiteFooter.tsx` 与候选文件 **Buffer.compare 逐字节相等**。
8. 两步确认回滚（`POST /candidate/rollback`）：磁盘文件与基线 **Buffer.compare 逐字节相等**（git 无差异）。
9. `page.reload()` 刷新核对：真实工程徽章、候选终态「已回滚」、版本记录全部如实恢复。

五步操作（候选 → 验证 → 审批 → 应用 → 回滚）使用**同一 candidateId**，由用例全程断言。

## 四、关键响应身份

```json
{
  "fixtureSha": "ffa54331dd5437b5497f3a46e6d1b6fc66042fa2",
  "candidateId": "candidate-fddd0ef3-f3c4-4399-9cc4-872121373465",
  "runId": "verification-2c9b2cc6-3714-432b-8020-cfb21c07c63c",
  "patchHash": "f38c99e9c596c3ff377cf2642bbd4239353c0d62193ced07aa59751090ed31ca",
  "recordHash": "ce7fa294c1dd96d373453b602fede42ad8ac567fdd8b3b2abea1533b83f7f2da"
}
```

## 五、证据截图（docs/experience/joint-acceptance/）

| 文件 | 阶段 |
| --- | --- |
| xp-passed-picked-1440.png | 点选共享页脚 |
| xp-passed-contract-1440.png | 验证合同（两页标记 + 交互声明） |
| xp-passed-verified-1440.png | 7/7 passed 验证结果与四视口证据 |
| xp-passed-approved-1440.png | 审批成功（绑定 runId） |
| xp-passed-applied-1440.png | 应用成功（逐字节写盘） |
| xp-passed-rolled-back-1440.png | 回滚成功（逐字节还原） |
| xp-passed-refreshed-1440.png | 刷新后生命周期与版本记录核对 |

完整浏览器工件另见 CI artifact `ripple-browser-evidence-40095429268`。

## 六、本联合验收轮次修复的真实缺陷

1. **scope-panel 回滚门控**（`50e8e87`）：服务端 `rollbackAvailable === false` 时禁用回滚按钮 + 组件测试。
2. **验证合同接线**（`763068c`/`ad8a60d`）：A 的 verify 要求候选携带 `verificationContract`（pages 覆盖全部 routeRefs + 每页 markerText + ≥1 交互），否则 interaction/scope-propagation 断言恒 unknown；F 从分析结果提出标记建议（安全路径门控：非根绝对路径整体不提交合同），用户在 UI 显式声明交互。
3. **应用/回滚后不再重复 analyze**（`4ea387a`）：直接采用服务端响应内嵌的重新分析结果；A 核心 `requireClean` 会拒绝应用后的脏树，重复 analyze 会把成功写盘误报为失败。
4. **终态推导顺序**（`379e5e8`）：A 的 session 回滚后仍保留 applied 记录，终态必须先看 rollback 再看 applied；并修复生命周期方法返回模型前未清在途 busy 标记导致 UI 永久卡在「提交中」。
5. **reload 预览锁瞬时冲突**（`2d9bf53`）：跨页 reload 时旧页 dispose 的 `preview/stop` 与新页 analyze/preview 在 A 服务端预览锁上瞬时相撞；对「正在执行」锁冲突做有限退避重试（遵守 generation 过期语义，持续失败仍如实抛出，fail-closed），消除刷新后整页错误态。
6. **刷新后 workflow 投影重建**（`9786475`）：历史记录携带 approval/applied/rollback 全部痕迹（A 回滚后 session 仍保留 applied 记录）；旧重建漏掉 applied/rollback 导致终态推导退化为 approval 优先，回滚后误显示「已审批」。现由 `workflowFromHistory()` 整体重建，applied 终态保留服务端已知的 rollbackAvailable。

## 七、已知限制（如实登记）

1. 应用后工作树若带未提交字节，刷新时 analyze 如实报「工作树不干净」——这是 A 核心 fail-closed 语义，不是缺陷。
2. SPA 状态切换类工程（路由路径非根绝对路径）无法提交验证合同，相关断言保持 unknown（fail-closed）。
3. 成功路径用例依赖 Docker 运行器：CI 实跑；本机无 Docker 时按两态门控如实跳过。
4. 本分支为联合验收分支，保持 Draft，不合并 main，不触发 Bolt。
