import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExperienceWorkbench } from './experience-workbench'
import { createStubRealAdapter } from './stub-real-adapter'

const text = (testId: string) => screen.getByTestId(testId).textContent ?? ''

/** 青野连续演示流（任务书第五节）：打开→选中标题→输入→关联页面→范围→对照→证据→历史。 */
describe('F 体验工作台 · 青野演示流', () => {
  afterEach(cleanup)

  async function selectAndType() {
    fireEvent.click(await screen.findByTestId('canvas-el-el:hero-title'))
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '冬日茶器市集' } })
  }

  it('演示数据全程标记 DEMO', async () => {
    render(<ExperienceWorkbench />)
    await screen.findByTestId('demo-badge')
    expect(text('demo-badge')).toContain('演示数据')
  })

  it('打开网页：工程与候选状态、页面导航、画布就绪', async () => {
    render(<ExperienceWorkbench />)
    await screen.findByTestId('project-status')
    expect(text('project-status')).toContain('工程就绪')
    expect(text('candidate-status')).toContain('尚无候选')
    expect(screen.getByTestId('page-item-page:home').getAttribute('aria-current')).toBe('page')
    expect(screen.getByTestId('demo-canvas')).not.toBeNull()
  })

  it('无选中/无修改时不得审批（门控前置条件）', async () => {
    render(<ExperienceWorkbench />)
    await screen.findByTestId('scope-panel')
    expect(text('approval-area')).toContain('尚未选中')
    expect(text('approval-area')).toContain('修改内容为空')
  })

  it('选中活动标题并输入新标题：候选状态推进、选中摘要与前后对照更新', async () => {
    render(<ExperienceWorkbench />)
    await selectAndType()
    expect(text('selection-summary')).toContain('活动标题')
    expect(text('selection-summary')).toContain('src/data/campaign.ts')
    expect(text('candidate-status')).toContain('候选已生成')
    expect(text('compare-candidate')).toContain('冬日茶器市集')
    expect(text('compare-baseline')).toContain('秋日茶器市集')
    expect(text('scope-summary')).toContain('包含 2')
  })

  it('原文与草稿分离：逐字输入后原文稳定，清空草稿后描述准确', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('canvas-el-el:hero-title'))
    const input = screen.getByTestId('draft-text-input')
    // 逐字输入
    fireEvent.change(input, { target: { value: '冬' } })
    fireEvent.change(input, { target: { value: '冬日茶器市集' } })
    // 画布上的原文保持「秋日茶器市集」，候选值只存在于草稿与对照区
    expect(screen.getByTestId('canvas-el-el:hero-title').textContent).toContain('秋日茶器市集')
    expect(text('evidence-ev:expect')).toContain('把「秋日茶器市集」改为「冬日茶器市集」')
    expect(text('compare-candidate')).toContain('冬日茶器市集')
    // 清空草稿：候选状态回落，Evidence 不臆造修改内容
    fireEvent.change(input, { target: { value: '' } })
    expect(text('candidate-status')).toContain('草稿')
    expect(text('evidence-ev:expect')).toContain('（尚未输入）')
  })

  it('切换元素清空草稿：新目标的 Evidence 不携带旧草稿', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('canvas-el-el:hero-title'))
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '冬日茶器市集' } })
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-subtitle'))
    expect((screen.getByTestId('draft-text-input') as HTMLInputElement).value).toBe('')
    expect(text('evidence-ev:expect')).toContain('以茶会友，以器传心')
    expect(text('evidence-ev:expect')).not.toContain('冬日茶器市集')
  })

  it('任务一：切换目标重建页面关系与默认 Scope（标题→副标题→标题）', async () => {
    render(<ExperienceWorkbench />)
    // 初次选中活动标题：商品专题存在同源关系
    fireEvent.click(await screen.findByTestId('canvas-el-el:hero-title'))
    expect(text('page-item-page:products')).toContain('同源关联')
    expect(text('scope-summary')).toContain('包含 2')
    // 修改 Scope：商品专题改为保护（旧决定，稍后不得跨目标残留）
    fireEvent.click(screen.getByTestId('scope-protect-page:products'))
    expect(screen.getByTestId('scope-protect-page:products').getAttribute('aria-pressed')).toBe('true')
    // 切换到副标题：商品专题不再虚假显示同源关联
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-subtitle'))
    expect(text('page-item-page:products')).toContain('影响未证明')
    expect(text('page-item-page:products')).not.toContain('同源关联')
    // 默认 Scope 与当前目标一致：商品专题回到未决定，不继承上一目标的保护/包含
    expect(text('scope-row-page:products')).toContain('未决定')
    // Evidence 随目标切换，不串入旧草稿
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '以器会友，以茶传心' } })
    expect(text('evidence-ev:expect')).toContain('把「以茶会友，以器传心」改为「以器会友，以茶传心」')
    // 返回活动标题：恢复标题对应的默认影响关系与 Scope
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-title'))
    expect(text('page-item-page:products')).toContain('同源关联')
    expect(text('scope-row-page:products')).toContain('包含')
    expect(text('scope-summary')).toContain('包含 2')
    // 旧草稿不串回标题
    expect(text('evidence-ev:expect')).toContain('把「秋日茶器市集」改为「（尚未输入）」')
  })

  it('任务一负例：partial/unknown 目标的页面关系不会被提升为安全可审批', async () => {
    render(<ExperienceWorkbench />)
    // partial 目标：没有页面被自动标为"已证明无影响"
    fireEvent.click(await screen.findByTestId('canvas-el-el:seasonal-banner'))
    expect(text('page-item-page:products')).toContain('影响未证明')
    expect(text('scope-row-page:products')).toContain('未决定')
    // unknown 目标同样如此
    fireEvent.click(screen.getByTestId('canvas-el-el:promo-card'))
    for (const id of ['page:products', 'page:seasonal', 'page:contact']) {
      expect(text(`page-item-${id}`)).toContain('影响未证明')
    }
  })

  it('任务二：对照区绑定当前目标，空目标/空草稿显示明确状态', async () => {
    render(<ExperienceWorkbench />)
    // 未选中目标：两侧都是明确状态，不回显旧标题
    await screen.findByTestId('compare-strip')
    expect(text('compare-baseline')).toContain('尚未选中要修改的位置')
    expect(text('compare-candidate')).toContain('尚未生成候选')
    expect(text('compare-baseline')).not.toContain('秋日茶器市集')
    // 副标题原文与副标题草稿对照
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-subtitle'))
    expect(text('compare-baseline')).toContain('以茶会友，以器传心')
    expect(text('compare-candidate')).toContain('尚未生成候选')
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '以器会友' } })
    expect(text('compare-candidate')).toContain('以器会友')
    expect(text('compare-candidate')).toContain('⟶')
    // 清空草稿：候选侧恢复未生成状态，不把原文伪装成候选
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '' } })
    expect(text('compare-candidate')).toContain('尚未生成候选')
    // 候选侧不出现草稿标题元素（焦点说明中的目标标签除外）
    expect(screen.getByTestId('compare-candidate').querySelector('.ripple-xp-compare-title.is-changed')).toBeNull()
    // 带着副标题草稿切换到活动标题：候选侧不得残留旧草稿，原文同步为目标原文
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '以器会友' } })
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-title'))
    expect(text('compare-baseline')).toContain('秋日茶器市集')
    expect(text('compare-candidate')).toContain('尚未生成候选')
    expect(text('compare-candidate')).not.toContain('以器会友')
  })

  it('任务三：演示审批反馈随目标/草稿/范围修订立即失效', async () => {
    render(<ExperienceWorkbench />)
    await selectAndType()
    // 完成 Scope（排除两个未证明页面）→ 演示审批 → 确认横幅出现
    fireEvent.click(screen.getByTestId('scope-exclude-page:contact'))
    fireEvent.click(screen.getByTestId('scope-exclude-page:seasonal'))
    fireEvent.click(screen.getByTestId('demo-approve'))
    expect(text('approve-feedback')).toContain('演示范围决策已确认')
    // 修改范围决策 → 旧反馈立即消失，approvalGate 重新阻断
    fireEvent.click(screen.getByTestId('scope-include-page:contact'))
    expect(screen.queryByTestId('approve-feedback')).toBeNull()
    expect(text('approval-area')).toContain('无法完全证明')
    expect(screen.queryByTestId('demo-approve')).toBeNull()
    // 恢复范围 → 再次审批 → 修改草稿 → 旧反馈消失
    fireEvent.click(screen.getByTestId('scope-exclude-page:contact'))
    fireEvent.click(screen.getByTestId('demo-approve'))
    expect(text('approve-feedback')).toContain('演示范围决策已确认')
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '初冬茶器市集' } })
    expect(screen.queryByTestId('approve-feedback')).toBeNull()
    // 重新审批 → 清空草稿 → 旧反馈消失（不得继续显示已确认）
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '初冬茶器市集' } })
    fireEvent.click(screen.getByTestId('demo-approve'))
    expect(text('approve-feedback')).toContain('演示范围决策已确认')
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '' } })
    expect(screen.queryByTestId('approve-feedback')).toBeNull()
    // 重新审批 → 切换目标 → 旧反馈不得跨目标复用
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '初冬茶器市集' } })
    fireEvent.click(screen.getByTestId('demo-approve'))
    expect(text('approve-feedback')).toContain('演示范围决策已确认')
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-subtitle'))
    expect(screen.queryByTestId('approve-feedback')).toBeNull()
  })

  it('来源未知的元素只能查看，不能进入编辑', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('canvas-el-el:promo-card'))
    expect(screen.queryByTestId('draft-text-input')).toBeNull()
    expect(screen.getByText(/来源未知：可以先查看，但不能承诺修改范围/)).not.toBeNull()
    expect(screen.getAllByTestId('certainty-unknown').length).toBeGreaterThan(0)
  })

  it('partial 来源的元素即使可编辑，排除未知页面后也不给安全审批', async () => {
    render(<ExperienceWorkbench />)
    // 先排除两个未证明页面，扫清"未决定/未证明包含"门控
    fireEvent.click(await screen.findByTestId('scope-exclude-page:contact'))
    fireEvent.click(screen.getByTestId('scope-exclude-page:seasonal'))
    // 选中 partial + editable 的当季横幅并输入
    fireEvent.click(screen.getByTestId('canvas-el-el:seasonal-banner'))
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '新春限定' } })
    expect(text('approval-area')).toContain('未完全证明')
    expect(screen.queryByTestId('demo-approve')).toBeNull()
  })

  it('范围决策：未证明页面被包含时审批被门控，排除后恢复，演示审批给出可见反馈', async () => {
    render(<ExperienceWorkbench />)
    await selectAndType()
    // 两个未证明页面未决定 → 门控
    expect(text('approval-area')).toContain('未决定')
    // 把未证明页面“包含” → 仍然不得审批（不得提升为安全范围）
    fireEvent.click(screen.getByTestId('scope-include-page:contact'))
    expect(text('approval-area')).toContain('无法完全证明')
    // 排除两个未证明页面 → 允许演示审批
    fireEvent.click(screen.getByTestId('scope-exclude-page:contact'))
    fireEvent.click(screen.getByTestId('scope-exclude-page:seasonal'))
    expect(text('demo-approve')).toContain('演示审批')
    expect(text('demo-approve')).toContain('不写入真实工程')
    fireEvent.click(screen.getByTestId('demo-approve'))
    expect(text('approve-feedback')).toContain('演示范围决策已确认，未执行真实应用')
    fireEvent.click(screen.getByTestId('dismiss-feedback'))
    expect(screen.queryByTestId('approve-feedback')).toBeNull()
  })

  it('证据面板第一眼分区齐全且依据类型分开标注', async () => {
    render(<ExperienceWorkbench />)
    await selectAndType()
    expect(text('evidence-ev:expect')).toContain('预期修改')
    expect(text('evidence-ev:risk')).toContain('已发现的风险')
    expect(text('evidence-ev:not-checked')).toContain('尚未检查')
    expect(text('evidence-ev:not-checked')).toContain('未运行')
    expect(text('evidence-ev:incomplete')).toContain('来源不完整的原因')
    expect(text('evidence-ev:next')).toContain('AI 建议')
    expect(text('evidence-ev:risk')).toContain('源码证实')
  })

  it('版本胶片：生命周期与证据可用性展示，点击定位页面', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('open-history'))
    expect(text('version-v:3')).toContain('已回滚')
    expect(text('version-v:2')).toContain('证据可用')
    expect(text('version-v:1')).toContain('已失效')
    expect(text('version-v:1')).toContain('无证据')
    fireEvent.click(screen.getByTestId('version-v:3'))
    expect(screen.getByTestId('page-item-page:products').getAttribute('aria-current')).toBe('page')
  })

  it('视口切换：390 标注验证中；画布状态演示覆盖加载/失败/过期', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('viewport-mobile-390'))
    expect(text('viewport-mobile-390')).toContain('验证中')
    fireEvent.change(screen.getByTestId('demo-canvas-state'), { target: { value: 'stale-evidence' } })
    expect(text('canvas-state-banner')).toContain('证据已过期')
    fireEvent.change(screen.getByTestId('demo-canvas-state'), { target: { value: 'failed' } })
    expect(text('canvas-state-banner')).toContain('加载失败')
    fireEvent.click(screen.getByTestId('canvas-retry'))
    expect(screen.getByTestId('demo-canvas')).not.toBeNull()
  })
})

describe('F 体验工作台 · 真实/演示隔离', () => {
  afterEach(cleanup)

  it('真实模式绝不渲染演示 DOM 或模拟对照，未接入时显示明确状态', async () => {
    render(<ExperienceWorkbench adapter={createStubRealAdapter()} />)
    await screen.findByTestId('real-preview-pending')
    expect(text('real-preview-pending')).toContain('真实预览尚未接入')
    expect(screen.queryByTestId('demo-canvas')).toBeNull()
    // 对照区：真实模式下只接受真实截图，缺失时明确提示
    expect(screen.getAllByText('尚无真实截图').length).toBe(2)
    // 演示状态切换器与 DEMO 标记不出现
    expect(screen.queryByTestId('demo-canvas-state')).toBeNull()
    expect(screen.queryByTestId('demo-badge')).toBeNull()
    // real 模式没有可执行的审批入口，明确提示未接入
    expect(screen.queryByTestId('demo-approve')).toBeNull()
    expect(text('real-approval-pending')).toContain('真实审批尚未接入')
  })
})
