import type { PageScopeChoiceXp, SourceCertainty } from './view-model'

/**
 * UI-RC2 Demo 内容契约。
 *
 * 这里描述的是本地演示素材，不是 Project API、SourceGraph 或 Runtime Identity
 * 的替代品。所有 registry/slot 都必须明确标记 provenance=demo；Demo 数据不能
 * 进入 Candidate、VerificationRun、Approval、Apply 或 Rollback。
 */

export type DemoPageRef = 'page:home' | 'page:products' | 'page:seasonal' | 'page:contact'

export type DemoContentProvenance = 'demo'

export type DemoSlotKind = 'text' | 'rich-text' | 'image' | 'unknown'

export interface DemoImageAsset {
  src: string
  alt: string
  width?: number
  height?: number
}

export type DemoSlotValue =
  | { kind: 'text' | 'rich-text'; text: string }
  | { kind: 'image'; asset: DemoImageAsset }
  | { kind: 'unknown'; label: string }

export interface DemoPageBlock {
  blockId: string
  kind: 'header' | 'hero' | 'grid' | 'form' | 'section' | 'footer'
  label: string
  /** Slot IDs rendered by this block, in visual order. */
  slotIds: readonly string[]
}

export interface DemoPageStructure {
  /** Stable fixture version; it is not a source or runtime identity. */
  schema: 'demo-content/v1'
  blocks: readonly DemoPageBlock[]
}

export interface DemoSelectableElement {
  /** ViewModel element ID used by the Demo Adapter. */
  elementId: string
  /** Demo-only selector; never interpreted as a Real sourceRef. */
  selector: string
  label: string
  editable: boolean
}

export interface DemoPageConsumerRelation {
  pageRef: DemoPageRef
  relation: 'editing' | 'same-source' | 'unrelated' | 'unproven'
  certainty: SourceCertainty
  /** Why this page is or is not a proven consumer of the shared source. */
  reason: string
  /** Initial display suggestion only; user ScopeDecision remains authoritative. */
  defaultScope?: PageScopeChoiceXp
}

export interface DemoContentSlot {
  /** Explicit owner page from the fixture; never inferred from currentPageRef. */
  pageRef: DemoPageRef
  slotId: string
  /** Shared source key. Equal keys may be consumed by more than one page. */
  sourceKey: string
  kind: DemoSlotKind
  /** Original fixture content shown by the baseline layer. */
  original: DemoSlotValue
  provenance: DemoContentProvenance
  /** Optional mapping into the selectable CanvasElementXp projection. */
  selectableElement?: DemoSelectableElement
  /** Explicit page consumers for shared-source candidate projection. */
  consumers: readonly DemoPageConsumerRelation[]
  /** UNKNOWN and partial evidence is retained here for visible fail-closed UI. */
  unknownReasons: readonly string[]
  /** Reasons the element cannot be edited in the Demo. */
  notEditableReasons: readonly string[]
}

export interface DemoContentPage {
  pageRef: DemoPageRef
  label: string
  path: string
  provenance: DemoContentProvenance
  structure: DemoPageStructure
  slots: readonly DemoContentSlot[]
}

export interface DemoContentRegistry {
  schema: 'demo-content/v1'
  provenance: DemoContentProvenance
  pages: readonly DemoContentPage[]
}

/** Identity helper so UI fixtures are checked against the shared contract. */
export function defineDemoContent(content: DemoContentRegistry): DemoContentRegistry {
  return content
}

const sharedHeroConsumers: readonly DemoPageConsumerRelation[] = [
  { pageRef: 'page:home', relation: 'editing', certainty: 'source-proven', reason: 'fixture owner page', defaultScope: 'include' },
  { pageRef: 'page:products', relation: 'same-source', certainty: 'source-proven', reason: 'same campaign source is rendered by the product feature page', defaultScope: 'include' },
  { pageRef: 'page:seasonal', relation: 'same-source', certainty: 'source-proven', reason: 'same campaign source is rendered by the seasonal feature page', defaultScope: 'include' },
  { pageRef: 'page:contact', relation: 'unproven', certainty: 'unknown', reason: 'no proven consumer edge for the contact page', defaultScope: 'undecided' },
]

const homeHeader: DemoPageBlock = { blockId: 'home.header', kind: 'header', label: '站点导航', slotIds: [] }
const productsHeader: DemoPageBlock = { blockId: 'products.header', kind: 'header', label: '站点导航', slotIds: [] }
const seasonalHeader: DemoPageBlock = { blockId: 'seasonal.header', kind: 'header', label: '站点导航', slotIds: [] }
const contactHeader: DemoPageBlock = { blockId: 'contact.header', kind: 'header', label: '站点导航', slotIds: [] }

/**
 * Four-page Demo fixture consumed by the Demo Adapter. The pages are deliberately
 * static and local; the explicit consumers list is the only source of cross-page
 * Demo projection and is never treated as a Real source graph.
 */
export const DEMO_CONTENT = defineDemoContent({
  schema: 'demo-content/v1',
  provenance: 'demo',
  pages: [
    {
      pageRef: 'page:home', label: '首页', path: '/', provenance: 'demo',
      structure: {
        schema: 'demo-content/v1',
        blocks: [
          homeHeader,
          { blockId: 'home.hero', kind: 'hero', label: '活动主视觉', slotIds: ['home.hero.title', 'home.hero.subtitle', 'home.hero.banner'] },
          { blockId: 'home.featured', kind: 'grid', label: '精选商品', slotIds: ['home.featured.ceramic', 'home.featured.teapot'] },
        ],
      },
      slots: [
        {
          pageRef: 'page:home', slotId: 'home.hero.title', sourceKey: 'campaign.hero.title', kind: 'text',
          original: { kind: 'text', text: '秋日茶器市集' }, provenance: 'demo',
          selectableElement: { elementId: 'el:hero-title', selector: '[data-xp-demo="hero-title"]', label: '活动标题「秋日茶器市集」', editable: true },
          consumers: sharedHeroConsumers, unknownReasons: [], notEditableReasons: [],
        },
        {
          pageRef: 'page:home', slotId: 'home.hero.subtitle', sourceKey: 'campaign.hero.subtitle', kind: 'text',
          original: { kind: 'text', text: '以茶会友，以器传心' }, provenance: 'demo',
          selectableElement: { elementId: 'el:hero-subtitle', selector: '[data-xp-demo="hero-subtitle"]', label: '副标题「以茶会友，以器传心」', editable: true },
          consumers: [{ pageRef: 'page:home', relation: 'editing', certainty: 'source-proven', reason: 'fixture owner page', defaultScope: 'include' }],
          unknownReasons: [], notEditableReasons: [],
        },
        {
          pageRef: 'page:home', slotId: 'home.hero.banner', sourceKey: 'campaign.seasonal.banner', kind: 'text',
          original: { kind: 'text', text: '冬雪限定 · 陆续上架' }, provenance: 'demo',
          consumers: [{ pageRef: 'page:home', relation: 'unproven', certainty: 'partial', reason: 'conditional campaign branch', defaultScope: 'undecided' }],
          unknownReasons: ['条件渲染分支只有一臂可以解析'], notEditableReasons: ['来源只有部分证明'],
        },
        {
          pageRef: 'page:home', slotId: 'home.featured.ceramic', sourceKey: 'catalog.featured.ceramic', kind: 'image',
          original: { kind: 'image', asset: { src: 'demo-assets/workshop.jpg', alt: '柴烧茶壶' } }, provenance: 'demo',
          consumers: [{ pageRef: 'page:home', relation: 'same-source', certainty: 'source-proven', reason: 'fixture-only visual asset' }],
          unknownReasons: [], notEditableReasons: ['本轮只演示 TEXT 修改'],
        },
        {
          pageRef: 'page:home', slotId: 'home.featured.teapot', sourceKey: 'catalog.featured.teapot', kind: 'image',
          original: { kind: 'image', asset: { src: 'demo-assets/vessels.jpg', alt: '素白陶碗' } }, provenance: 'demo',
          consumers: [{ pageRef: 'page:home', relation: 'same-source', certainty: 'source-proven', reason: 'fixture-only visual asset' }],
          unknownReasons: [], notEditableReasons: ['本轮只演示 TEXT 修改'],
        },
      ],
    },
    {
      pageRef: 'page:products', label: '商品专题', path: '/products', provenance: 'demo',
      structure: {
        schema: 'demo-content/v1',
        blocks: [
          productsHeader,
          { blockId: 'products.hero', kind: 'hero', label: '商品专题主视觉', slotIds: ['products.hero.title', 'products.hero.copy'] },
          { blockId: 'products.grid', kind: 'grid', label: '商品目录', slotIds: ['products.card.teapot', 'products.card.bowl', 'products.promo'] },
        ],
      },
      slots: [
        {
          pageRef: 'page:products', slotId: 'products.hero.title', sourceKey: 'campaign.hero.title', kind: 'text',
          original: { kind: 'text', text: '秋日茶器市集' }, provenance: 'demo',
          consumers: sharedHeroConsumers, unknownReasons: [], notEditableReasons: [],
        },
        {
          pageRef: 'page:products', slotId: 'products.hero.copy', sourceKey: 'catalog.hero.copy', kind: 'text',
          original: { kind: 'text', text: '从一只茶杯开始，认识手作的温度。' }, provenance: 'demo',
          selectableElement: { elementId: 'el:product-title', selector: '[data-xp-demo="product-title"]', label: '商品专题标题', editable: true },
          consumers: [{ pageRef: 'page:products', relation: 'editing', certainty: 'source-proven', reason: 'fixture owner page', defaultScope: 'include' }],
          unknownReasons: [], notEditableReasons: [],
        },
        {
          pageRef: 'page:products', slotId: 'products.card.teapot', sourceKey: 'catalog.card.teapot', kind: 'image',
          original: { kind: 'image', asset: { src: 'demo-assets/workshop.jpg', alt: '柴烧茶壶' } }, provenance: 'demo',
          consumers: [{ pageRef: 'page:products', relation: 'same-source', certainty: 'source-proven', reason: 'fixture-only visual asset' }],
          unknownReasons: [], notEditableReasons: ['本轮只演示 TEXT 修改'],
        },
        {
          pageRef: 'page:products', slotId: 'products.card.bowl', sourceKey: 'catalog.card.bowl', kind: 'image',
          original: { kind: 'image', asset: { src: 'demo-assets/vessels.jpg', alt: '素白陶碗' } }, provenance: 'demo',
          consumers: [{ pageRef: 'page:products', relation: 'same-source', certainty: 'source-proven', reason: 'fixture-only visual asset' }],
          unknownReasons: [], notEditableReasons: ['本轮只演示 TEXT 修改'],
        },
        {
          pageRef: 'page:products', slotId: 'products.promo', sourceKey: 'runtime.promo-card', kind: 'unknown',
          original: { kind: 'unknown', label: '为你推荐' }, provenance: 'demo',
          selectableElement: { elementId: 'el:promo-card', selector: '[data-xp-demo="promo-card"]', label: '推荐卡片（动态内容）', editable: false },
          consumers: [{ pageRef: 'page:products', relation: 'unproven', certainty: 'unknown', reason: '内容来自运行时接口，静态来源无法确认', defaultScope: 'undecided' }],
          unknownReasons: ['内容来自运行时接口，静态来源无法确认'], notEditableReasons: ['来源未知，仅可查看'],
        },
      ],
    },
    {
      pageRef: 'page:seasonal', label: '活动页', path: '/seasonal', provenance: 'demo',
      structure: {
        schema: 'demo-content/v1',
        blocks: [
          seasonalHeader,
          { blockId: 'seasonal.hero', kind: 'hero', label: '活动主视觉', slotIds: ['seasonal.hero.title', 'seasonal.banner'] },
          { blockId: 'seasonal.story', kind: 'section', label: '活动说明', slotIds: ['seasonal.story.copy'] },
        ],
      },
      slots: [
        {
          pageRef: 'page:seasonal', slotId: 'seasonal.hero.title', sourceKey: 'campaign.hero.title', kind: 'text',
          original: { kind: 'text', text: '秋日茶器市集' }, provenance: 'demo',
          consumers: sharedHeroConsumers, unknownReasons: [], notEditableReasons: [],
        },
        {
          pageRef: 'page:seasonal', slotId: 'seasonal.banner', sourceKey: 'data:seasonal-banner', kind: 'text',
          original: { kind: 'text', text: '冬雪限定 · 陆续上架' }, provenance: 'demo',
          selectableElement: { elementId: 'el:seasonal-banner', selector: '[data-xp-demo="seasonal-banner"]', label: '当季横幅', editable: true },
          consumers: [{ pageRef: 'page:seasonal', relation: 'editing', certainty: 'partial', reason: '条件渲染分支只有一臂可以解析', defaultScope: 'undecided' }],
          unknownReasons: ['条件渲染分支只有一臂可以解析'], notEditableReasons: ['来源只有部分证明，审批保持 fail-closed'],
        },
        {
          pageRef: 'page:seasonal', slotId: 'seasonal.story.copy', sourceKey: 'campaign.seasonal.story', kind: 'rich-text',
          original: { kind: 'rich-text', text: '在风起的时候，挑一只适合慢慢使用的器物。' }, provenance: 'demo',
          consumers: [{ pageRef: 'page:seasonal', relation: 'same-source', certainty: 'source-proven', reason: 'fixture-only activity copy' }],
          unknownReasons: [], notEditableReasons: ['本轮只演示共享 TEXT 修改'],
        },
      ],
    },
    {
      pageRef: 'page:contact', label: '联系我们', path: '/contact', provenance: 'demo',
      structure: {
        schema: 'demo-content/v1',
        blocks: [
          contactHeader,
          { blockId: 'contact.intro', kind: 'section', label: '联系说明', slotIds: ['contact.title', 'contact.copy'] },
          { blockId: 'contact.form', kind: 'form', label: '联系表单', slotIds: ['contact.form.name', 'contact.form.message'] },
        ],
      },
      slots: [
        {
          pageRef: 'page:contact', slotId: 'contact.title', sourceKey: 'runtime.contact.title', kind: 'unknown',
          original: { kind: 'unknown', label: '和我们聊聊你的茶器故事' }, provenance: 'demo',
          consumers: [{ pageRef: 'page:contact', relation: 'unproven', certainty: 'unknown', reason: 'Contact 页面内容可浏览，但来源关系未证明', defaultScope: 'undecided' }],
          unknownReasons: ['Contact 页面内容为 Demo 素材，来源关系未证明'], notEditableReasons: ['未知来源不可编辑'],
        },
        {
          pageRef: 'page:contact', slotId: 'contact.copy', sourceKey: 'runtime.contact.copy', kind: 'text',
          original: { kind: 'text', text: '工作日 10:00–18:00 回复来信。' }, provenance: 'demo',
          consumers: [{ pageRef: 'page:contact', relation: 'unproven', certainty: 'unknown', reason: 'Contact 页面内容可浏览，但来源关系未证明', defaultScope: 'undecided' }],
          unknownReasons: ['没有可核查的来源锚点'], notEditableReasons: ['未知来源不可编辑'],
        },
        {
          pageRef: 'page:contact', slotId: 'contact.form.name', sourceKey: 'runtime.contact.form.name', kind: 'text',
          original: { kind: 'text', text: '你的称呼' }, provenance: 'demo',
          consumers: [{ pageRef: 'page:contact', relation: 'unproven', certainty: 'unknown', reason: '表单为 Demo-only 内容', defaultScope: 'undecided' }],
          unknownReasons: ['表单字段没有来源证明'], notEditableReasons: ['未知来源不可编辑'],
        },
        {
          pageRef: 'page:contact', slotId: 'contact.form.message', sourceKey: 'runtime.contact.form.message', kind: 'text',
          original: { kind: 'text', text: '告诉我们你想了解什么' }, provenance: 'demo',
          consumers: [{ pageRef: 'page:contact', relation: 'unproven', certainty: 'unknown', reason: '表单为 Demo-only 内容', defaultScope: 'undecided' }],
          unknownReasons: ['表单字段没有来源证明'], notEditableReasons: ['未知来源不可编辑'],
        },
      ],
    },
  ],
})

export function demoPage(pageRef: DemoPageRef): DemoContentPage {
  return DEMO_CONTENT.pages.find(page => page.pageRef === pageRef) ?? DEMO_CONTENT.pages[0]
}

export function demoSlotForElement(elementId: string): DemoContentSlot | undefined {
  for (const page of DEMO_CONTENT.pages) {
    const slot = page.slots.find(item => item.selectableElement?.elementId === elementId)
    if (slot) return slot
  }
  return undefined
}

export type DemoPreviewState = 'baseline' | 'candidate' | 'protected' | 'unproven'

export interface DemoSlotProjection {
  displayText: string
  candidateText?: string
  state: DemoPreviewState
  reason?: string
}

/**
 * Pure Demo-only candidate projection. It never mutates the fixture or adapter
 * state and never claims to be a Real Candidate/Verification result.
 */
export function projectDemoSlot(
  slot: DemoContentSlot,
  pageRef: DemoPageRef,
  input: { selectedSourceKey?: string; draftText: string; scope: PageScopeChoiceXp },
): DemoSlotProjection {
  const value = slot.original as { text?: string; asset?: DemoImageAsset; label?: string }
  const original = value.text ?? value.asset?.alt ?? value.label ?? ''
  const relation = slot.consumers.find(consumer => consumer.pageRef === pageRef)
  const selected = input.selectedSourceKey !== undefined && input.selectedSourceKey === slot.sourceKey && input.draftText.trim().length > 0

  if (!selected) return { displayText: original, state: 'baseline' }
  if (!relation || relation.certainty !== 'source-proven') {
    return {
      displayText: original,
      state: 'unproven',
      reason: relation?.reason ?? '没有该页面的来源消费证明',
    }
  }
  if (input.scope === 'protect' || input.scope === 'exclude') {
    return {
      displayText: original,
      state: 'protected',
      reason: input.scope === 'protect' ? '本页已保护，候选不替换' : '本页已排除，候选不替换',
    }
  }
  if (input.scope !== 'include') {
    return { displayText: original, state: 'unproven', reason: '本页范围尚未决定，候选不替换' }
  }
  return { displayText: input.draftText, candidateText: input.draftText, state: 'candidate', reason: 'Demo 候选：演示关系已设定且范围已包含' }
}
