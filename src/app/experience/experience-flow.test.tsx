import { afterEach, describe, expect, it } from 'vitest'
import { act, cleanup, fireEvent, render, screen } from '@testing-library/react'
import { ExperienceWorkbench } from './experience-workbench'
import { StaleResponseError } from './real-adapter'
import { createStubRealAdapter } from './stub-real-adapter'
import type { ExperienceAdapter } from './adapter'
import type { ExperienceViewModel } from './view-model'
import { createRealAdapter } from './real-adapter'

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

  it('DEMO 对照文案负例：绝不显示真实截图校验通过的结论', async () => {
    render(<ExperienceWorkbench />)
    await screen.findByTestId('compare-strip')
    expect(text('viewport-match-note')).toContain('演示对照')
    expect(text('viewport-match-note')).toContain('未经真实浏览器验证')
    expect(text('viewport-match-note')).not.toContain('可比较')
    expect(text('viewport-match-note')).not.toContain('真实截图')
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
    expect(text('scope-row-page:products')).toContain('同源页面')
    expect(text('scope-summary')).toContain('包含 2')
    // 修改 Scope：商品专题改为保护（旧决定，稍后不得跨目标残留）
    fireEvent.click(screen.getByTestId('scope-protect-page:products'))
    expect(screen.getByTestId('scope-protect-page:products').getAttribute('aria-pressed')).toBe('true')
    // 切换到副标题：商品专题不再虚假显示同源关联
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-subtitle'))
    expect(text('scope-row-page:products')).toContain('影响未证明')
    expect(text('scope-row-page:products')).not.toContain('同源')
    // 默认 Scope 与当前目标一致：商品专题回到未决定，不继承上一目标的保护/包含
    expect(text('scope-row-page:products')).toContain('未决定')
    // Evidence 随目标切换，不串入旧草稿
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '以器会友，以茶传心' } })
    expect(text('evidence-ev:expect')).toContain('把「以茶会友，以器传心」改为「以器会友，以茶传心」')
    // 返回活动标题：恢复标题对应的默认影响关系与 Scope
    fireEvent.click(screen.getByTestId('canvas-el-el:hero-title'))
    expect(text('scope-row-page:products')).toContain('同源页面')
    expect(text('scope-row-page:products')).toContain('包含')
    expect(text('scope-summary')).toContain('包含 2')
    // 旧草稿不串回标题
    expect(text('evidence-ev:expect')).toContain('把「秋日茶器市集」改为「（尚未输入）」')
  })

  it('任务一负例：partial/unknown 目标的页面关系不会被提升为安全可审批', async () => {
    render(<ExperienceWorkbench />)
    // partial 目标：没有页面被自动标为"已证明无影响"
    fireEvent.click(await screen.findByTestId('canvas-el-el:seasonal-banner'))
    expect(text('scope-row-page:products')).toContain('影响未证明')
    expect(text('scope-row-page:products')).toContain('未决定')
    // unknown 目标同样如此
    fireEvent.click(screen.getByTestId('canvas-el-el:promo-card'))
    for (const id of ['page:products', 'page:seasonal', 'page:contact']) {
      expect(text(`scope-row-${id}`)).toContain('影响未证明')
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
    // 主按钮常显但禁用（检查清单门控），点击不产生任何审批
    expect((screen.getByTestId('demo-approve') as HTMLButtonElement).disabled).toBe(true)
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
    expect((screen.getByTestId('demo-approve') as HTMLButtonElement).disabled).toBe(true)
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

describe('F 体验工作台 · REAL 模式异步竞态', () => {
  afterEach(cleanup)

  const VIEWPORTS: ExperienceViewModel['viewports'] = [
    { id: 'desktop', label: '桌面 1440', width: 1440, height: 900, verificationStatus: 'available' },
    { id: 'tablet', label: '平板 768', width: 768, height: 1024, verificationStatus: 'available' },
    { id: 'mobile-375', label: '手机 375', width: 375, height: 812, verificationStatus: 'available' },
    { id: 'mobile-390', label: '手机 390', width: 390, height: 844, verificationStatus: 'in-verification' },
  ]

  it('工程切换竞态：旧请求最后返回（StaleResponseError）不得覆盖新工程的 ready 状态', async () => {
    const pending = new Map<string, { resolve: (m: ExperienceViewModel) => void; reject: (e: Error) => void }>()
    const readyModel = (name: string, projectId: string): ExperienceViewModel => ({
      projectName: name, projectStatus: 'ready', candidateStatus: 'none', dataProvenance: 'real',
      currentPageRef: '', draftAfterText: '', activeViewportId: 'desktop', canvasState: 'unavailable',
      pages: [], elements: [], viewports: VIEWPORTS, evidence: [], versions: [],
      compare: { baseline: { state: 'unavailable' }, candidate: { state: 'unavailable' }, compareState: 'none' },
      projectIdentity: { projectId, sourceDigest: 'digest' },
    })
    const initial: ExperienceViewModel = { ...readyModel('（未选择工程）', ''), projectStatus: 'unavailable' }
    const adapter: ExperienceAdapter = {
      provenance: 'real',
      load: async () => initial,
      openProject: (root: string) => new Promise<ExperienceViewModel>((resolve, reject) => { pending.set(root, { resolve, reject }) }),
      selectElement: model => model,
      setDraftText: model => model,
      setPageScope: model => model,
      setViewport: model => model,
      setPage: model => model,
    }
    render(<ExperienceWorkbench adapter={adapter} />)
    const input = await screen.findByTestId('open-project-path')
    // A 工程请求开始（故意挂起）
    fireEvent.change(input, { target: { value: '/work/a' } })
    fireEvent.click(screen.getByTestId('open-project-submit'))
    // B 工程请求开始（busy 期间按钮停用，用户以回车提交表单），先完成
    fireEvent.change(input, { target: { value: '/work/b' } })
    fireEvent.submit(screen.getByTestId('open-project-form'))
    await act(async () => { pending.get('/work/b')!.resolve(readyModel('工程B', 'proj-b')) })
    // B 已 ready：表单消失，顶栏显示 B
    await screen.findByText('工程B')
    expect(screen.queryByTestId('open-project-error')).toBeNull()
    // A 最后返回：以 StaleResponseError 拒绝，UI 必须保持 B，不出现任何错误/加载态
    await act(async () => { pending.get('/work/a')!.reject(new StaleResponseError('stale')) })
    expect(screen.queryByText('工程A')).toBeNull()
    expect(screen.queryByTestId('load-error')).toBeNull()
    expect(screen.queryByTestId('open-project-error')).toBeNull()
    expect(screen.getByText('工程B')).not.toBeNull()
  })

  it('REAL 模式：页面导航明确未接入（按钮停用 + 说明），不误导用户以为画布已切页', async () => {
    const model: ExperienceViewModel = {
      projectName: 'acme-shop', projectStatus: 'ready', candidateStatus: 'none', dataProvenance: 'real',
      currentPageRef: 'page:home', draftAfterText: '', activeViewportId: 'desktop', canvasState: 'ready',
      pages: [
        { id: 'page:home', label: '首页', path: '/', relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' },
        { id: 'page:about', label: '关于', path: '/about', relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' },
      ],
      elements: [], viewports: VIEWPORTS, evidence: [], versions: [],
      compare: { baseline: { state: 'unavailable' }, candidate: { state: 'unavailable' }, compareState: 'none' },
      preview: { url: 'http://127.0.0.1:9999/preview/p1/', projectId: 'p', previewId: 'p1', sourceDigest: 'd' },
    }
    const adapter: ExperienceAdapter = {
      provenance: 'real',
      load: async () => model,
      selectElement: m => m,
      setDraftText: m => m,
      setPageScope: m => m,
      setViewport: m => m,
      setPage: m => m,
    }
    render(<ExperienceWorkbench adapter={adapter} />)
    await screen.findByTestId('page-nav-pending')
    expect(text('page-nav-pending')).toContain('尚未接入')
    // 导航按钮停用：点击不会触发 setPage（currentPageRef 保持首页，iframe 地址不变）
    expect((screen.getByTestId('page-item-page:about') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.click(screen.getByTestId('page-item-page:about'))
    expect(screen.getByTestId('page-item-page:home').getAttribute('aria-current')).toBe('page')
    expect((screen.getByTestId('real-preview-frame') as HTMLIFrameElement).src).toBe(model.preview!.url)
  })

  it('候选创建成功后再次进入点选：旧点选会话不得把下一次点击误判为退出（6c 回归）', async () => {
    const model: ExperienceViewModel = {
      projectName: 'acme-shop', projectStatus: 'ready', candidateStatus: 'none', dataProvenance: 'real',
      currentPageRef: 'page:home', draftAfterText: '', activeViewportId: 'desktop', canvasState: 'ready',
      pages: [
        { id: 'page:home', label: '首页', path: '/', relation: 'editing', relationCertainty: 'source-proven', scope: 'include' },
      ],
      elements: [
        {
          id: 'el:title', label: '首页标题', demoSelector: '', currentText: '原标题',
          sourceRef: 'jsx:src/pages/HomePage.jsx#1', sourcePath: 'src/pages/HomePage.jsx',
          certainty: 'source-proven', impactPageRefs: ['page:home'], unresolvedReasons: [], editable: true,
        },
      ],
      viewports: VIEWPORTS, evidence: [], versions: [],
      compare: { baseline: { state: 'unavailable' }, candidate: { state: 'unavailable' }, compareState: 'none' },
      preview: { url: 'http://127.0.0.1:9999/preview/p1/', projectId: 'p', previewId: 'p1', sourceDigest: 'd' },
      pickerAvailable: true,
      projectIdentity: { projectId: 'p', sourceDigest: 'd' },
    }
    const adapter: ExperienceAdapter = {
      provenance: 'real',
      load: async () => model,
      selectElement: (m, elementId) => ({ ...m, selectedElementId: elementId }),
      setDraftText: (m, text) => ({ ...m, draftAfterText: text }),
      setPageScope: m => m,
      setViewport: m => m,
      setPage: m => m,
      createCandidate: async m => ({ ...m, candidateStatus: 'candidate' }),
    }
    render(<ExperienceWorkbench adapter={adapter} />)
    await screen.findByTestId('picker-toggle')
    // 第一轮：进入点选 → 选中 + 草稿 → 生成候选（成功后自动退出点选）
    fireEvent.click(screen.getByTestId('picker-toggle'))
    expect(screen.queryByTestId('picker-hint')).not.toBeNull()
    fireEvent.click(screen.getByTestId('canvas-el-el:title'))
    fireEvent.change(screen.getByTestId('draft-text-input'), { target: { value: '新标题' } })
    await act(async () => { fireEvent.click(screen.getByTestId('create-candidate')) })
    expect(screen.queryByTestId('picker-hint')).toBeNull()
    // 第二轮（6c 真实切换路径）：点击必须重新进入点选。
    // 回归根因：候选创建只清了 pickerNonce state，pickerSessionRef 残留旧会话，
    // 以 ref 判定的 toggle 会把本次点击当成"退出"，点选永远进不去。
    fireEvent.click(screen.getByTestId('picker-toggle'))
    expect(screen.queryByTestId('picker-hint')).not.toBeNull()
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

describe('F 体验工作台 · Real Adapter 真实流程', () => {
  afterEach(cleanup)

  interface MockResponse { status: number; body: unknown }
  function mockFetch(routes: Record<string, MockResponse>) {
    const fetchImpl = (async (input: RequestInfo | URL) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = url.replace(/^.*?\/__ripple\/api\//, '')
      const route = routes[path]
      if (!route) return { ok: false, status: 404, json: async () => ({ error: `未注册的路由：${path}` }) } as unknown as Response
      return { ok: route.status >= 200 && route.status < 300, status: route.status, json: async () => route.body } as unknown as Response
    }) as typeof fetch
    return fetchImpl
  }

  const ANALYSIS = {
    status: 200,
    body: {
      projectRoot: 'D:\\work\\acme-shop',
      revision: { projectId: 'proj-acme', sourceDigest: 'digest-1', runtimeFingerprint: 'fp-1' },
      graphId: 'graph-1',
      unresolved: [],
      routes: [{ id: 'page:home', label: '首页', page: '/' }],
      targets: [{
        id: 'data:hero-title', kind: 'data', label: '首页标题', value: 'Acme 商店',
        location: { path: 'src/data/site.ts', start: 10, end: 20 },
        impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' },
      }],
      relationCounts: { reads: 1 },
    },
  }
  const HISTORY = {
    status: 200,
    body: {
      history: [{
        candidateId: 'candidate-real-1', projectId: 'proj-acme', lifecycle: 'applied',
        patchHash: 'hash-1234abcd', updatedAt: '2026-10-22T09:30:00Z',
        verification: { state: 'passed', runId: 'run-1' },
      }],
    },
  }

  it('真实模式未打开工程：显示打开工程入口与阻断原因，无演示内容', async () => {
    render(<ExperienceWorkbench adapter={createRealAdapter({ fetchImpl: mockFetch({}) })} />)
    await screen.findByTestId('open-project-form')
    expect(text('blocked-reason')).toContain('尚未选择工程')
    expect(screen.queryByTestId('demo-canvas')).toBeNull()
    expect(screen.queryByTestId('demo-badge')).toBeNull()
    expect(screen.getByTestId('real-badge')).toBeTruthy()
  })

  it('打开真实工程：真实页面/目标/历史呈现，审批入口明确未接入', async () => {
    const fetchImpl = mockFetch({ analyze: ANALYSIS, history: HISTORY, 'project/preview': { status: 503, body: { error: '隔离预演网络池为空' } } })
    render(<ExperienceWorkbench adapter={createRealAdapter({ fetchImpl })} />)
    fireEvent.change(await screen.findByTestId('open-project-path'), { target: { value: 'D:\\work\\acme-shop' } })
    fireEvent.click(screen.getByTestId('open-project-submit'))
    // 真实工程页面列表与元素
    await screen.findByTestId('page-item-page:home')
    expect(text('real-badge')).toContain('真实工程')
    expect(text('project-status')).toContain('工程就绪')
    // 预演不可用：准确阻断原因，绝不渲染演示 DOM
    await screen.findByTestId('real-preview-pending')
    expect(text('real-preview-pending')).toContain('隔离预演网络池为空')
    expect(screen.queryByTestId('demo-canvas')).toBeNull()
    // 真实历史（来自 API 的候选 id），点击不臆造页面切换
    fireEvent.click(screen.getByTestId('open-history'))
    await screen.findByTestId('version-candidate-real-1')
    expect(text('version-candidate-real-1')).toContain('已应用')
    fireEvent.click(screen.getByTestId('version-candidate-real-1'))
    // 真实审批未接入；元素可选中并查看真实来源
    expect(text('real-approval-pending')).toContain('真实审批尚未接入')
    fireEvent.click(screen.getByTestId('close-filmstrip'))
    fireEvent.click(screen.getByTestId('canvas-el-data:hero-title'))
    expect(text('selection-summary')).toContain('src/data/site.ts')
    expect(text('selection-summary')).toContain('来源已证实')
  })

  it('打开工程失败：服务端错误如实显示，可修正后重试', async () => {
    const failing = mockFetch({ analyze: { status: 400, body: { error: '项目路径不是目录' } } })
    render(<ExperienceWorkbench adapter={createRealAdapter({ fetchImpl: failing })} />)
    fireEvent.change(await screen.findByTestId('open-project-path'), { target: { value: 'D:\\no\\such' } })
    fireEvent.click(screen.getByTestId('open-project-submit'))
    await screen.findByTestId('open-project-error')
    expect(text('open-project-error')).toContain('项目路径不是目录')
  })
})
