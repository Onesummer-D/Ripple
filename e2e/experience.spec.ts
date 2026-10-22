import { expect, test, type Page } from '@playwright/test'

// F 体验工作台浏览器验收（PR #14 第一轮独立审查整改）。
// 覆盖：初始页面、选中与编辑、来源未知元素、Scope 阻断、无选中/无修改不得审批、
// 视口切换、模拟内容不得进入 real 模式、历史切换、桌面与窄窗口布局、控制台错误。

const consoleErrors: string[] = []

async function openExperience(page: Page, url = '/experience.html') {
  page.on('console', message => {
    if (message.type() === 'error') consoleErrors.push(message.text())
  })
  page.on('pageerror', error => consoleErrors.push(String(error)))
  await page.goto(url, { waitUntil: 'networkidle' })
  await expect(page.getByTestId('xp-topbar')).toBeVisible()
}

test.beforeEach(() => { consoleErrors.length = 0 })

test('初始页面：工程状态、页面导航、画布与 DEMO 标记', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('project-status')).toContainText('工程就绪')
  await expect(page.getByTestId('demo-badge')).toContainText('演示数据')
  await expect(page.getByTestId('page-item-page:home')).toHaveAttribute('aria-current', 'page')
  await expect(page.getByTestId('demo-canvas')).toBeVisible()
  await expect(page.getByTestId('evidence-drawer')).toBeVisible()
})

test('选中与编辑：标题更新、候选状态推进、前后对照同步', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('selection-summary')).toContainText('活动标题')
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await expect(page.getByTestId('candidate-status')).toContainText('候选已生成')
  await expect(page.getByTestId('compare-candidate')).toContainText('冬日茶器市集')
  await expect(page.getByTestId('compare-baseline')).toContainText('秋日茶器市集')
  await expect(page.getByTestId('canvas-el-el:hero-title')).toHaveAttribute('aria-pressed', 'true')
})

test('原文与草稿分离：逐字输入不改画布原文，切换元素清空草稿', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  const input = page.getByTestId('draft-text-input')
  await input.pressSequentially('冬日茶器市集')
  // 画布上的原文保持「秋日茶器市集」；候选值只出现在对照区
  await expect(page.getByTestId('canvas-el-el:hero-title')).toContainText('秋日茶器市集')
  await expect(page.getByTestId('compare-candidate')).toContainText('冬日茶器市集')
  await expect(page.getByTestId('evidence-ev:expect')).toContainText('把「秋日茶器市集」改为「冬日茶器市集」')
  // 切换元素：草稿清空，Evidence 换成新目标的原文
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(input).toHaveValue('')
  await expect(page.getByTestId('evidence-ev:expect')).toContainText('以茶会友，以器传心')
})

test('来源未知元素只能查看：无输入框、无编辑授权', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:promo-card').click()
  await expect(page.getByTestId('draft-text-input')).toHaveCount(0)
  await expect(page.getByText('来源未知：可以先查看，但不能承诺修改范围')).toBeVisible()
})

test('Scope 阻断：未证明页面包含/未决定时不得审批，排除后演示审批并给出可见反馈', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await expect(page.getByTestId('approval-area')).toContainText('未决定')
  await page.getByTestId('scope-include-page:contact').click()
  await expect(page.getByTestId('approval-area')).toContainText('无法完全证明')
  await page.getByTestId('scope-exclude-page:contact').click()
  await page.getByTestId('scope-exclude-page:seasonal').click()
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认，未执行真实应用')
})

test('无选中/无修改不得审批', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('approval-area')).toContainText('尚未选中')
  await expect(page.getByTestId('approval-area')).toContainText('修改内容为空')
  await expect(page.getByTestId('demo-approve')).toHaveCount(0)
})

test('视口切换 1440/768/375 与 390 验证中标注', async ({ page }) => {
  await openExperience(page)
  for (const id of ['desktop', 'tablet', 'mobile-375']) {
    await page.getByTestId(`viewport-${id}`).click()
    await expect(page.getByTestId(`viewport-${id}`)).toHaveAttribute('aria-pressed', 'true')
  }
  await page.getByTestId('viewport-mobile-390').click()
  await expect(page.getByTestId('viewport-mobile-390')).toContainText('验证中')
  await expect(page.getByTestId('demo-canvas')).toBeVisible()
})

test('模拟内容不得进入 real 模式：real 桩下无演示 DOM，显示未接入状态', async ({ page }) => {
  await openExperience(page, '/experience.html?adapter=real-stub')
  await expect(page.getByTestId('real-preview-pending')).toContainText('真实预览尚未接入')
  await expect(page.getByTestId('demo-canvas')).toHaveCount(0)
  await expect(page.getByText('尚无真实截图')).toHaveCount(2)
  await expect(page.getByTestId('demo-badge')).toHaveCount(0)
  await expect(page.getByTestId('demo-approve')).toHaveCount(0)
  // real 模式没有可执行审批入口，明确提示未接入（不会点击后回演示确认）
  await expect(page.getByTestId('real-approval-pending')).toContainText('真实审批尚未接入')
})

test('历史切换：胶片展示生命周期，点击定位页面', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('open-history').click()
  await expect(page.getByTestId('version-v:3')).toContainText('已回滚')
  await expect(page.getByTestId('version-v:1')).toContainText('已失效')
  await page.getByTestId('version-v:3').click()
  await expect(page.getByTestId('page-item-page:products')).toHaveAttribute('aria-current', 'page')
})

test('桌面与窄窗口布局都可操作', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('scope-panel')).toBeVisible()
  await page.setViewportSize({ width: 700, height: 900 })
  await expect(page.getByTestId('scope-panel')).toBeVisible()
  await expect(page.getByTestId('canvas-el-el:hero-title')).toBeVisible()
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('selection-summary')).toContainText('活动标题')
})

test('任务一：切换编辑目标重建页面关系与默认范围（标题→副标题→标题）', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('同源关联')
  await page.getByTestId('scope-protect-page:products').click()
  // 切换到副标题：商品专题不再虚假显示同源，旧 Scope 决定不残留
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('影响未证明')
  await expect(page.getByTestId('page-item-page:products')).not.toContainText('同源关联')
  await expect(page.getByTestId('scope-row-page:products')).toContainText('未决定')
  // 返回标题：默认影响关系与 Scope 恢复
  await page.getByTestId('canvas-el-el:hero-title').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('同源关联')
  await expect(page.getByTestId('scope-include-page:products')).toHaveAttribute('aria-pressed', 'true')
})

test('任务一负例：partial 目标不产生已证明无关页，来源确定性不被提升', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:seasonal-banner').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('影响未证明')
  await expect(page.getByTestId('scope-row-page:products')).toContainText('未决定')
  // 整个页面导航中除当前编辑页外不允许出现"来源已证实"的页面关系
  await page.getByTestId('canvas-el-el:promo-card').click()
  await expect(page.getByTestId('page-item-page:products')).toContainText('影响未证明')
  await expect(page.getByTestId('page-item-page:seasonal')).toContainText('影响未证明')
})

test('任务二：对照区绑定当前目标，无选中/无草稿显示明确状态', async ({ page }) => {
  await openExperience(page)
  await expect(page.getByTestId('compare-baseline')).toContainText('尚未选中要修改的位置')
  await expect(page.getByTestId('compare-candidate')).toContainText('尚未生成候选')
  await expect(page.getByTestId('compare-baseline')).not.toContainText('秋日茶器市集')
  // 副标题原文与草稿对照
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(page.getByTestId('compare-baseline')).toContainText('以茶会友，以器传心')
  await page.getByTestId('draft-text-input').fill('以器会友，以茶传心')
  await expect(page.getByTestId('compare-candidate')).toContainText('以器会友，以茶传心')
  // 清空草稿：候选侧恢复未生成状态，原文不被伪装成候选
  await page.getByTestId('draft-text-input').fill('')
  await expect(page.getByTestId('compare-candidate')).toContainText('尚未生成候选')
})

test('任务三：演示审批反馈随范围/草稿/目标修订失效', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.getByTestId('scope-exclude-page:contact').click()
  await page.getByTestId('scope-exclude-page:seasonal').click()
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认')
  // 修改范围决策 → 旧反馈消失，门控重新阻断且审批按钮不可用
  await page.getByTestId('scope-include-page:contact').click()
  await expect(page.getByTestId('approve-feedback')).toHaveCount(0)
  await expect(page.getByTestId('approval-area')).toContainText('无法完全证明')
  await expect(page.getByTestId('demo-approve')).toHaveCount(0)
  // 恢复范围 → 再次审批 → 修改草稿 → 旧反馈消失
  await page.getByTestId('scope-exclude-page:contact').click()
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认')
  await page.getByTestId('draft-text-input').fill('初冬茶器市集')
  await expect(page.getByTestId('approve-feedback')).toHaveCount(0)
  // 重新审批 → 切换目标 → 旧确认不得跨目标复用
  await page.getByTestId('demo-approve').click()
  await expect(page.getByTestId('approve-feedback')).toContainText('演示范围决策已确认')
  await page.getByTestId('canvas-el-el:hero-subtitle').click()
  await expect(page.getByTestId('approve-feedback')).toHaveCount(0)
})

test('控制台无错误', async ({ page }) => {
  await openExperience(page)
  await page.getByTestId('canvas-el-el:hero-title').click()
  await page.getByTestId('draft-text-input').fill('冬日茶器市集')
  await page.getByTestId('open-history').click()
  await page.getByTestId('version-v:2').click()
  expect(consoleErrors).toEqual([])
})
