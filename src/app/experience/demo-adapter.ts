/**
 * 青野文创演示适配器（DEMO / SIMULATED）。
 *
 * 全部数据为本地演示数据，标记 dataProvenance: 'demo'：
 * - 不连接 /__ripple/api，不创建真实 EditSession / CandidatePatch；
 * - "演示审批"等动作只在体验层内部状态流转，绝不进入真实 Approval / Apply；
 * - 画布是模拟 DOM（ripple-xp-demo 命名空间），不是真实项目 iframe。
 *
 * 演示流（与任务书第五节一致）：
 * 打开网页 → 选中活动标题 → 输入新标题 → 关联页面更新
 * → 范围决策 → 前后对照 → 证据/风险/未知 → 版本历史。
 */
import type { ExperienceAdapter } from './adapter'
import { projectPageRelations } from './view-model'
import type { CanvasElementXp, ExperienceViewModel, PageScopeChoiceXp } from './view-model'

const HOME = 'page:home'

function initialModel(): ExperienceViewModel {
  return {
    projectName: '青野文创商店',
    projectStatus: 'ready',
    candidateStatus: 'none',
    dataProvenance: 'demo',
    currentPageRef: HOME,
    draftAfterText: '',
    activeViewportId: 'desktop',
    canvasState: 'ready',
    pages: [
      { id: HOME, label: '首页', path: '/', relation: 'editing', relationCertainty: 'source-proven', scope: 'include' },
      { id: 'page:products', label: '商品专题', path: '/products', relation: 'same-source', relationCertainty: 'source-proven', scope: 'include' },
      { id: 'page:seasonal', label: '活动页', path: '/seasonal', relation: 'unproven', relationCertainty: 'partial', scope: 'undecided' },
      { id: 'page:contact', label: '联系我们', path: '/contact', relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' },
    ],
    elements: [
      {
        id: 'el:hero-title', label: '活动标题「秋日茶器市集」', demoSelector: '[data-xp-demo="hero-title"]',
        currentText: '秋日茶器市集', sourceRef: 'data:hero-title', sourcePath: 'src/data/campaign.ts',
        certainty: 'source-proven', impactPageRefs: [HOME, 'page:products'],
        unresolvedReasons: [], editable: true,
      },
      {
        id: 'el:hero-subtitle', label: '副标题「以茶会友，以器传心」', demoSelector: '[data-xp-demo="hero-subtitle"]',
        currentText: '以茶会友，以器传心', sourceRef: 'data:hero-subtitle', sourcePath: 'src/data/campaign.ts',
        certainty: 'source-proven', impactPageRefs: [HOME], unresolvedReasons: [], editable: true,
      },
      {
        id: 'el:seasonal-banner', label: '当季横幅', demoSelector: '[data-xp-demo="seasonal-banner"]',
        currentText: '冬雪限定 · 陆续上架', sourceRef: 'data:seasonal-banner', sourcePath: 'src/data/seasonal.ts',
        certainty: 'partial', impactPageRefs: ['page:seasonal'], unresolvedReasons: ['条件渲染分支只有一臂可以解析'], editable: true,
      },
      {
        id: 'el:promo-card', label: '推荐卡片（动态内容）', demoSelector: '[data-xp-demo="promo-card"]',
        currentText: '为你推荐', certainty: 'unknown', impactPageRefs: [], unresolvedReasons: ['内容来自运行时接口，静态分析无法确认'], editable: false,
      },
    ],
    viewports: [
      { id: 'desktop', label: '桌面 1440', width: 1440, height: 900, verificationStatus: 'available' },
      { id: 'tablet', label: '平板 768', width: 768, height: 1024, verificationStatus: 'available' },
      { id: 'mobile-375', label: '手机 375', width: 375, height: 812, verificationStatus: 'available' },
      { id: 'mobile-390', label: '手机 390', width: 390, height: 844, verificationStatus: 'in-verification' },
    ],
    evidence: [],
    versions: [],
    compare: {
      baseline: { state: 'ready', note: '演示数据：原网页渲染' },
      candidate: { state: 'ready', note: '演示数据：候选渲染（未经过真实浏览器验证）' },
      compareState: 'comparable', focusArea: '活动标题',
    },
  }
}

function evidenceForSelection(element: CanvasElementXp | undefined, draftText: string): ExperienceViewModel['evidence'] {
  const items: ExperienceViewModel['evidence'] = [
    {
      id: 'ev:expect', title: '预期修改', state: element?.certainty === 'source-proven' ? 'pass' : 'unknown',
      sourceKind: 'user-choice',
      summary: element
        ? `把「${element.currentText}」改为「${draftText || '（尚未输入）'}」`
        : '尚未选中要修改的位置',
    },
    {
      id: 'ev:risk', title: '已发现的风险', state: 'risk', sourceKind: 'source-graph',
      summary: '「联系我们」页通过条件渲染引用同一数据，当前只能部分证明；「推荐卡片」内容来自运行时接口，静态来源不完整。',
      detail: 'source-graph 演示口径：消费关系逐条标注确定性，无法证明的引用如实保留为未知。',
    },
    {
      id: 'ev:not-checked', title: '尚未检查的项目', state: 'not-run', sourceKind: 'runtime-observation',
      summary: '真实浏览器验证尚未运行：四视口截图、交互路径与回滚演练都还没有执行。',
    },
    {
      id: 'ev:incomplete', title: '来源不完整的原因', state: 'unknown', sourceKind: 'source-graph',
      summary: '动态接口内容与条件渲染分支无法从源码完全证明，保持未知而不是猜测。',
    },
    {
      id: 'ev:next', title: '可采取的下一步', state: 'pass', sourceKind: 'ai-suggestion',
      summary: element?.editable
        ? '确认右侧范围决策后，可以生成演示候选并查看前后对照。'
        : '该元素来源未知，建议先在真实工作台中点选定位，再决定是否能修改。',
    },
  ]
  return items
}

const initialVersions = (): ExperienceViewModel['versions'] => [
  { id: 'v:3', title: '图片替换试验', lifecycle: 'rolled-back', updatedAt: '昨天 21:12', summary: '替换了商品主图，验证未通过后回滚', pageRef: 'page:products', evidenceAvailable: true },
  { id: 'v:2', title: '导航文案微调', lifecycle: 'applied', updatedAt: '昨天 18:40', summary: '「全部作品」改为「商品专题」，两个页面一致生效', pageRef: 'page:products', evidenceAvailable: true },
  { id: 'v:1', title: '旧版活动标题候选', lifecycle: 'stale', updatedAt: '10-18 15:03', summary: '源码已更新，候选与当前工程不一致', pageRef: HOME, evidenceAvailable: false },
]

export function createDemoAdapter(): ExperienceAdapter {
  let model = initialModel()
  return {
    provenance: 'demo',
    async load() {
      model = { ...initialModel(), evidence: evidenceForSelection(undefined, ''), versions: initialVersions() }
      return model
    },
    selectElement(current, elementId) {
      const element = current.elements.find(item => item.id === elementId)
      // 重复点击当前已选目标：不算目标切换，保留该目标下的草稿与范围决定
      if (current.selectedElementId === elementId) return current
      model = {
        ...current,
        selectedElementId: elementId,
        // 切换目标时清空候选草稿：草稿属于目标，不属于全局输入框
        draftAfterText: '',
        candidateStatus: element?.editable ? 'draft' : 'none',
        // 页面关系与默认 Scope 全部以当前目标重新投影：
        // 上一目标留下的同源判定、Scope 决定都不跨目标复用
        // （演示数据没有"已证明无影响"清单，缺页一律保持未证明，不臆造 unrelated；
        //   演示元素都位于首页；真实 Adapter 中目标所属页须由可信来源提供，
        //   与用户正在浏览的 currentPageRef 区分）
        pages: projectPageRelations(current.pages, element, HOME),
        compare: { ...current.compare, focusArea: element?.label },
        evidence: evidenceForSelection(element, ''),
      }
      return model
    },
    setDraftText(current, text) {
      // 原始 currentText 保持稳定；候选值只存在 draftAfterText 草稿里，
      // Evidence 描述的原文（currentText）与修改内容（草稿）因此始终准确。
      model = {
        ...current,
        draftAfterText: text,
        candidateStatus: text.trim() && current.selectedElementId ? 'candidate'
          : current.selectedElementId ? 'draft' : current.candidateStatus,
        evidence: evidenceForSelection(current.elements.find(item => item.id === current.selectedElementId), text),
      }
      return model
    },
    setPageScope(current, pageRef, scope) {
      model = {
        ...current,
        pages: current.pages.map(page => page.id === pageRef ? { ...page, scope } : page),
      }
      return model
    },
    setViewport(current, viewportId) {
      const viewport = current.viewports.find(item => item.id === viewportId)
      model = {
        ...current,
        activeViewportId: viewportId,
        // 390 视口在正式验证中：画布可预览，但证据状态明确为未运行/验证中
        canvasState: viewport?.verificationStatus === 'unavailable' ? 'unavailable' : 'ready',
      }
      return model
    },
    setPage(current, pageRef) {
      model = { ...current, currentPageRef: pageRef }
      return model
    },
  }
}

export type { PageScopeChoiceXp }
