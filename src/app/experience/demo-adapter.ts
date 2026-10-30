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
import { DEMO_CONTENT, type DemoContentSlot } from './demo-content'
import { projectPageRelations } from './view-model'
import type { CanvasElementXp, ExperienceViewModel, PageScopeChoiceXp } from './view-model'

const HOME = 'page:home'

function slotText(slot: DemoContentSlot): string {
  const value = slot.original as { text?: string; asset?: { alt: string }; label?: string }
  return value.text ?? value.asset?.alt ?? value.label ?? ''
}

function ownerRelation(slot: DemoContentSlot): DemoContentSlot['consumers'][number] | undefined {
  return slot.consumers.find(consumer => consumer.pageRef === slot.pageRef)
}

function demoElements(): CanvasElementXp[] {
  return DEMO_CONTENT.pages.flatMap(page => page.slots
    .filter(slot => slot.selectableElement)
    .map(slot => {
      const selectable = slot.selectableElement!
      const owner = ownerRelation(slot)
      const impactPageRefs = slot.consumers
        .filter(consumer => consumer.certainty !== 'unknown' && consumer.relation !== 'unrelated')
        .map(consumer => consumer.pageRef)
      return {
        id: selectable.elementId,
        label: selectable.label,
        demoSelector: selectable.selector,
        currentText: slotText(slot),
        sourceRef: `demo:${slot.sourceKey}`,
        sourcePath: slot.sourceKey.startsWith('campaign.') ? 'Demo fixture · src/data/campaign.ts'
          : slot.sourceKey === 'data:seasonal-banner' ? 'Demo fixture · src/data/seasonal.ts'
            : `Demo fixture · ${page.path}`,
        certainty: owner?.certainty ?? 'unknown',
        impactPageRefs,
        demoPageRef: slot.pageRef,
        demoSlotId: slot.slotId,
        demoSourceKey: slot.sourceKey,
        demoProvenance: 'demo' as const,
        unresolvedReasons: [...slot.unknownReasons],
        editable: selectable.editable,
      }
    }))
}

function initialPages(): ExperienceViewModel['pages'] {
  return DEMO_CONTENT.pages.map(page => ({
    id: page.pageRef,
    label: page.label,
    path: page.path,
    relation: page.pageRef === HOME ? 'editing' as const : page.pageRef === 'page:products' ? 'same-source' as const : 'unproven' as const,
    relationCertainty: page.pageRef === HOME || page.pageRef === 'page:products' ? 'source-proven' as const : page.pageRef === 'page:seasonal' ? 'partial' as const : 'unknown' as const,
    scope: page.pageRef === HOME || page.pageRef === 'page:products' ? 'include' as const : 'undecided' as const,
  }))
}

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
    pages: initialPages(),
    elements: demoElements(),
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
      summary: 'Contact 页面内容可浏览，但来源关系未证明，不能编辑或纳入安全范围；「推荐卡片」内容来自运行时接口，静态来源不完整。',
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

const DEMO_FILM_ART: Record<string, string> = {
  'v:1': 'demo-assets/workshop.jpg',
  'v:2': 'demo-assets/vessels.jpg',
  'v:3': 'demo-assets/seasonal.jpg',
}

const initialVersions = (): ExperienceViewModel['versions'] => [
  {
    id: 'v:3', title: '图片替换试验', lifecycle: 'rolled-back', updatedAt: '昨天 21:12',
    summary: '替换了商品主图，验证未通过后回滚', pageRef: 'page:products',
    evidenceAvailable: true, evidenceState: 'archived',
    thumbnail: { url: DEMO_FILM_ART['v:3'], source: 'demo-art' },
    evidenceList: ['演示记录：商品主图替换前后的对照', '演示记录：四视口验证未通过并触发回滚'],
  },
  {
    id: 'v:2', title: '导航文案微调', lifecycle: 'applied', updatedAt: '昨天 18:40',
    summary: '「全部作品」改为「商品专题」，两个页面一致生效', pageRef: 'page:products',
    evidenceAvailable: true, evidenceState: 'archived',
    thumbnail: { url: DEMO_FILM_ART['v:2'], source: 'demo-art' },
    evidenceList: ['演示记录：首页与商品专题的导航文案一致'],
  },
  {
    id: 'v:1', title: '旧版活动标题候选', lifecycle: 'stale', updatedAt: '10-18 15:03',
    summary: '源码已更新，候选与当前工程不一致', pageRef: HOME,
    evidenceAvailable: false, evidenceState: 'none',
    thumbnail: { url: DEMO_FILM_ART['v:1'], source: 'demo-art' },
  },
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
        //   目标所属页始终来自 fixture 的 demoPageRef，与用户正在浏览的
        //   currentPageRef 区分；projectPageRelations 再按元素确定性降级）
        pages: projectPageRelations(
          current.pages,
          element,
          element?.demoPageRef ?? HOME,
        ),
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
