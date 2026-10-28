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
