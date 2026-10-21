import { afterEach, describe, expect, it } from 'vitest'
import { cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExperienceWorkbench } from './experience-workbench'

afterEach(cleanup)

const text = (testId: string) => screen.getByTestId(testId).textContent ?? ''

/** 青野连续演示流（任务书第五节）：打开→选中标题→输入→关联页面→范围→对照→证据→历史。 */
describe('F 体验工作台 · 青野演示流', () => {
  it('演示数据全程标记 DEMO，且不能把演示结果送入真实审批', async () => {
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

  it('选中活动标题并输入新标题：候选状态推进、选中摘要与前后对照更新', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('canvas-el-el:hero-title'))
    expect(text('selection-summary')).toContain('活动标题')
    expect(text('selection-summary')).toContain('src/data/campaign.ts')
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '冬日茶器市集' } })
    expect(text('candidate-status')).toContain('候选已生成')
    expect(text('compare-candidate')).toContain('冬日茶器市集')
    expect(text('compare-baseline')).toContain('秋日茶器市集')
    expect(text('scope-summary')).toContain('包含 3')
  })

  it('来源未知的元素只能查看，不能进入编辑', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('canvas-el-el:promo-card'))
    expect(screen.queryByTestId('draft-text-input')).toBeNull()
    expect(screen.getByText(/来源未知：可以先查看，但不能承诺修改范围/)).not.toBeNull()
    expect(screen.getAllByTestId('certainty-unknown').length).toBeGreaterThan(0)
  })

  it('范围决策：影响未证明页面被包含时审批被门控，排除后恢复', async () => {
    render(<ExperienceWorkbench />)
    await screen.findByTestId('scope-panel')
    // 默认两个 unproven 页面未决定 → 门控
    expect(screen.queryByTestId('demo-approve')).toBeNull()
    expect(text('approval-area')).toContain('未决定')
    // 把未证明页面“包含” → 仍然不得审批（不得提升为安全范围）
    fireEvent.click(screen.getByTestId('scope-include-page:contact'))
    expect(text('approval-area')).toContain('无法完全证明')
    // 排除两个未证明页面 → 允许演示审批
    fireEvent.click(screen.getByTestId('scope-exclude-page:contact'))
    fireEvent.click(screen.getByTestId('scope-exclude-page:seasonal'))
    expect(text('demo-approve')).toContain('演示审批')
    expect(text('demo-approve')).toContain('不写入真实工程')
  })

  it('证据面板第一眼分区齐全且依据类型分开标注', async () => {
    render(<ExperienceWorkbench />)
    fireEvent.click(await screen.findByTestId('canvas-el-el:hero-title'))
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
