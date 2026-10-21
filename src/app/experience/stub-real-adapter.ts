/**
 * 真实模式接入桩（仅用于隔离测试，不是真实能力）。
 *
 * 目的：验证「真实数据模式绝不渲染演示 DOM / 模拟对照」这条边界——
 * 当 provenance 为 'real' 且未提供预览地址、截图与 Evidence 时，
 * 界面必须显示"真实预览尚未接入""尚无真实截图"等明确状态。
 *
 * 它不连接 /__ripple/api，不创建真实 EditSession，不得进入真实 Approval/Apply。
 * 真实适配器由集成阶段按 docs/experience/HANDOFF.md 第 4 节实现并替换本桩。
 */
import type { ExperienceAdapter } from './adapter'
import type { ExperienceViewModel } from './view-model'

const emptyModel: ExperienceViewModel = {
  projectName: '（未接入真实工程）',
  projectStatus: 'unavailable',
  candidateStatus: 'none',
  dataProvenance: 'real',
  currentPageRef: '',
  draftAfterText: '',
  activeViewportId: 'desktop',
  canvasState: 'unavailable',
  pages: [],
  elements: [],
  viewports: [
    { id: 'desktop', label: '桌面 1440', width: 1440, height: 900, verificationStatus: 'available' },
    { id: 'tablet', label: '平板 768', width: 768, height: 1024, verificationStatus: 'available' },
    { id: 'mobile-375', label: '手机 375', width: 375, height: 812, verificationStatus: 'available' },
    { id: 'mobile-390', label: '手机 390', width: 390, height: 844, verificationStatus: 'in-verification' },
  ],
  evidence: [],
  versions: [],
  compare: {
    baseline: { state: 'unavailable' },
    candidate: { state: 'unavailable' },
    matchedViewport: true,
  },
}

export function createStubRealAdapter(): ExperienceAdapter {
  let model = emptyModel
  return {
    provenance: 'real',
    async load() { model = emptyModel; return model },
    selectElement(current) { model = { ...current, selectedElementId: undefined }; return model },
    setDraftText(current) { model = { ...current, draftAfterText: '' }; return model },
    setPageScope(current) { return current },
    setViewport(current, viewportId) { model = { ...current, activeViewportId: viewportId }; return model },
    setPage(current) { return current },
  }
}
