/**
 * Runtime source identity collection and assessment.
 *
 * `collectRuntimeIdentitySnapshot` runs inside the served page (Playwright
 * `page.evaluate`, or an injected bridge) and reads only the attributes written by
 * `sourceAnnotationPlugin`. It must stay self-contained: no imports, no closures over
 * module scope, so that its source can be serialized into the page.
 *
 * The remaining functions are pure host-side helpers. None of them authorizes an edit:
 * `instanceIdentityProven` only states that one rendered element can be told apart from
 * every other element rendered from the same JSX source. Instance-level Scope and
 * page-override authorization remain separate, unreviewed contracts.
 */
import type { RuntimeElementObservation, RuntimeIdentityReason, RuntimePageContext, SourceGraph } from './model'

export type RuntimeIdentityCertainty = RuntimeElementObservation['certainty']
export const RUNTIME_IDENTITY_PROTOCOL = 'ripple-runtime-identity/v1'

export interface RuntimeIdentityRecord {
  sourceRef: string
  sourceFile?: string
  runtimeInstanceId?: string
  /** Value of `data-ripple-identity-certainty` as rendered. */
  declaredCertainty: RuntimeIdentityCertainty
  /** Certainty after collection-time downgrades (duplicates, stale route namespace, missing id). */
  certainty: RuntimeIdentityCertainty
  /** React's own key of this element (fiber key), when it has one. */
  listKey?: string
  /** sha256 of the served source file, registered by the annotated module. */
  sourceVersion?: string
  /** Per-page token of the DOM node; a new token for the same instance id means React remounted it. */
  domNode: number
  /** Number of elements in the document rendered from the same JSX source location. */
  sameSourceCount: number
  reasons: RuntimeIdentityReason[]
  /** Value of the caller-selected correlation attribute (for example `data-testid`). */
  label?: string
}

export interface RuntimeIdentitySnapshot {
  protocol: typeof RUNTIME_IDENTITY_PROTOCOL
  page: RuntimePageContext
  records: RuntimeIdentityRecord[]
}

/** Reasons that make a collected identity unusable as a unique runtime instance. */
export const BLOCKING_RUNTIME_IDENTITY_REASONS: readonly RuntimeIdentityReason[] = [
  'invalid-certainty', 'unmapped-owner', 'instance-unavailable', 'duplicate-runtime-instance', 'route-namespace-stale', 'react-keys-unavailable',
]

/**
 * Collects every annotated element under `options.root` (default: the document).
 * Self-contained by design; see the module comment.
 */
export function collectRuntimeIdentitySnapshot(options: { root?: string; label?: string } = {}): RuntimeIdentitySnapshot {
  const certainties = ['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped']
  const blocking = ['invalid-certainty', 'unmapped-owner', 'instance-unavailable', 'duplicate-runtime-instance', 'route-namespace-stale', 'react-keys-unavailable']
  const host = globalThis as unknown as Record<symbol, unknown>
  const registry = host[Symbol.for('ripple.runtime-identity')] as { sourceVersions?: unknown } | undefined
  const versions = registry && registry.sourceVersions instanceof Map ? registry.sourceVersions as Map<string, string> : undefined
  const history = registry && (registry as { sourceVersionHistory?: unknown }).sourceVersionHistory instanceof Map ? (registry as { sourceVersionHistory: Map<string, Set<string>> }).sourceVersionHistory : undefined
  const stateKey = Symbol.for('ripple.runtime-identity.collector')
  if (!host[stateKey]) Object.defineProperty(host, stateKey, { value: { nodes: new WeakMap<Element, number>(), next: 1 }, configurable: true })
  const state = host[stateKey] as { nodes: WeakMap<Element, number>; next: number }
  const page = { pathname: window.location.pathname, search: window.location.search, hash: window.location.hash }

  // React's fiber for a DOM node (read-only; React 17+ `__reactFiber$*`, 16 `__reactInternalInstance$*`).
  // Its `key` is the string React already derived from the element's key: reading it runs no
  // application code. Unavailable internals make key-dependent ids unknown (fail-closed).
  interface FiberLike { key?: unknown; return?: FiberLike | null }
  const fiberOf = (element: Element): FiberLike | undefined => {
    for (const name of Object.keys(element)) {
      if (name.startsWith('__reactFiber$') || name.startsWith('__reactInternalInstance$')) return (element as unknown as Record<string, FiberLike>)[name]
    }
    return undefined
  }
  const keyChain = (element: Element): string[] | undefined => {
    const fiber = fiberOf(element)
    if (!fiber) return undefined
    const keys: string[] = []
    for (let current: FiberLike | null | undefined = fiber, steps = 0; current && steps < 100000; current = current.return, steps += 1) {
      if (typeof current.key === 'string') keys.unshift(current.key)
    }
    return keys
  }
  // Final id: the rendered attribute, with a trailing "~" replaced by React's key chain.
  const resolveInstance = (element: Element): { id?: string; unmapped: boolean; keysUnavailable: boolean } => {
    const raw = element.getAttribute('data-ripple-instance')
    if (raw === null || raw === '') return { unmapped: false, keysUnavailable: false }
    if (raw.startsWith('unmapped:')) return { unmapped: true, keysUnavailable: false }
    if (!raw.endsWith('~')) return { id: raw, unmapped: false, keysUnavailable: false }
    const keys = keyChain(element)
    // Each key is URI-encoded so keys containing "/" (paths, URLs) cannot collide when joined.
    return keys ? { id: `${raw.slice(0, -1)}${keys.map(key => encodeURIComponent(key)).join('/')}`, unmapped: false, keysUnavailable: false } : { id: raw, unmapped: false, keysUnavailable: true }
  }

  // Uniqueness is a property of the whole document, not of the requested subtree.
  const all = Array.from(document.querySelectorAll('[data-ripple-source]'))
  const resolved = new Map(all.map(element => [element, resolveInstance(element)]))
  const byInstance = new Map<string, number>()
  const bySource = new Map<string, number>()
  for (const element of all) {
    const id = resolved.get(element)!.id
    if (id) byInstance.set(id, (byInstance.get(id) ?? 0) + 1)
    const source = element.getAttribute('data-ripple-source') ?? ''
    bySource.set(source, (bySource.get(source) ?? 0) + 1)
  }

  const scope = options.root ? document.querySelector(options.root) : document
  const elements = scope ? Array.from(scope.querySelectorAll('[data-ripple-source]')) : []
  if (scope instanceof Element && scope.hasAttribute('data-ripple-source')) elements.unshift(scope)
  const records: RuntimeIdentityRecord[] = elements.map(element => {
    const reasons: RuntimeIdentityReason[] = []
    const sourceRef = element.getAttribute('data-ripple-source') ?? ''
    const instance = resolved.get(element) ?? resolveInstance(element)
    const rawCertainty = element.getAttribute('data-ripple-identity-certainty') ?? ''
    let declaredCertainty = certainties.includes(rawCertainty) ? rawCertainty as RuntimeIdentityCertainty : 'unknown'
    if (!certainties.includes(rawCertainty)) reasons.push('invalid-certainty')
    const match = /^jsx:(.+)#\d+$/.exec(sourceRef)
    const sourceFile = match ? match[1] : undefined
    // A file evaluated with several digests cannot attribute existing DOM to either one.
    const ambiguous = !!sourceFile && (history?.get(sourceFile)?.size ?? 0) > 1
    const sourceVersion = sourceFile && versions && !ambiguous ? versions.get(sourceFile) : undefined
    if (ambiguous) reasons.push('source-version-ambiguous')
    else if (!sourceVersion) reasons.push('source-version-unavailable')
    let runtimeInstanceId = instance.id
    if (declaredCertainty === 'unmapped' || instance.unmapped) {
      declaredCertainty = 'unmapped'
      runtimeInstanceId = undefined
      reasons.push('unmapped-owner')
    } else if (!runtimeInstanceId) reasons.push('instance-unavailable')
    // v1 ids embed only pathname at render time. A component that did not re-render
    // after a pathname navigation (React.memo, unchanged props) still shows the old
    // namespace. Search/hash routes are also unverifiable in v1: even a fresh-looking
    // pathname prefix cannot distinguish the current page tuple from a retained DOM
    // instance created under a different query or HashRouter route. Keep v1 locatable,
    // but never treat it as instance proof while either part is present. The owner part
    // after the namespace is a boundary path (`jsx:`) or a React useId, which keeps
    // `/a:b:...` from passing as `/a`.
    else if (page.search !== '' || page.hash !== '' ||
      !runtimeInstanceId.startsWith(`${page.pathname}:`) ||
      !/^(?:jsx:|[_:\u00ab])/.test(runtimeInstanceId.slice(page.pathname.length + 1))) reasons.push('route-namespace-stale')
    if (instance.keysUnavailable) reasons.push('react-keys-unavailable')
    if (runtimeInstanceId && (byInstance.get(runtimeInstanceId) ?? 0) > 1) reasons.push('duplicate-runtime-instance')
    let domNode = state.nodes.get(element)
    if (!domNode) {
      domNode = state.next
      state.next += 1
      state.nodes.set(element, domNode)
    }
    const ownKey = fiberOf(element)?.key
    const label = options.label ? element.getAttribute(options.label) : null
    const certainty = declaredCertainty !== 'unmapped' && reasons.some(reason => blocking.includes(reason)) ? 'unknown' : declaredCertainty
    return {
      sourceRef, ...(sourceFile ? { sourceFile } : {}), ...(runtimeInstanceId ? { runtimeInstanceId } : {}),
      declaredCertainty, certainty, ...(typeof ownKey === 'string' ? { listKey: ownKey } : {}), ...(sourceVersion ? { sourceVersion } : {}),
      domNode, sameSourceCount: bySource.get(sourceRef) ?? 0, reasons, ...(label !== null ? { label } : {}),
    }
  })
  return { protocol: 'ripple-runtime-identity/v1', page, records }
}

export const sourceFileFromRef = (sourceRef: string): string | undefined => /^jsx:(.+)#\d+$/.exec(sourceRef)?.[1]
const isStable = (certainty: RuntimeIdentityCertainty) => certainty === 'stable-keyed-instance' || certainty === 'stable-react-instance'
const samePage = (actual: RuntimePageContext, expected: Partial<RuntimePageContext>) =>
  (expected.pathname === undefined || expected.pathname === actual.pathname) &&
  (expected.search === undefined || expected.search === actual.search) &&
  (expected.hash === undefined || expected.hash === actual.hash)

/**
 * Observations that may enter `createRuntimeSourceMap` for source navigation. Unknown,
 * unmapped and collection-downgraded elements are left out; position-dependent ones stay
 * (they navigate to source but `resolveRuntimeElement` refuses them as instance targets).
 */
export function selectableRuntimeObservations(snapshot: RuntimeIdentitySnapshot): RuntimeElementObservation[] {
  return snapshot.records
    // Same rule as createRuntimeSourceMap: only a missing page-side version is tolerated.
    .filter(record => !!record.runtimeInstanceId && record.certainty !== 'unknown' && record.certainty !== 'unmapped' &&
      !record.reasons.some(reason => reason !== 'source-version-unavailable'))
    .map(record => ({
      sourceRef: record.sourceRef,
      runtimeInstanceId: record.runtimeInstanceId!,
      certainty: record.certainty,
      pageContext: { ...snapshot.page },
      ...(record.sourceVersion ? { sourceVersion: record.sourceVersion } : {}),
      reasons: [...record.reasons],
    }))
}

/**
 * Two different questions, kept apart on purpose:
 * - `locatable`: may this element be used to NAVIGATE to its JSX source? (sourceRef exists in
 *   the graph and no proven version conflict). Missing evidence does not block navigation.
 * - `instanceIdentityProven`: is this ONE rendered instance proven distinct from all others,
 *   from the same source version, on the expected page? Requires every piece of evidence:
 *   stable certainty, a non-empty id, no collection reason, a `fileDigest` reader whose digest
 *   equals the page's registered version, and (when given) the expected page. It is the only
 *   input a future instance-level Scope may start from, and is never an authorization itself.
 */
export interface RuntimeIdentityAssessment {
  sourceRef: string
  runtimeInstanceId?: string
  certainty: RuntimeIdentityCertainty
  page: RuntimePageContext
  locatable: boolean
  instanceIdentityProven: boolean
  /** Elements rendered from the same JSX source in the snapshot; >1 means editing the source changes all of them. */
  sameSourceCount: number
  reasons: RuntimeIdentityReason[]
}

/**
 * Host-side verdict for one collected element against the SourceGraph it will be resolved
 * with. `fileDigest` must read the same revision the graph was built from (for example the
 * candidate worktree); without it the source version cannot be proven.
 */
export function assessRuntimeIdentity(graph: SourceGraph, snapshot: RuntimeIdentitySnapshot, record: RuntimeIdentityRecord, context: {
  fileDigest?: (file: string) => string | undefined
  expectedPage?: Partial<RuntimePageContext>
} = {}): RuntimeIdentityAssessment {
  const reasons = new Set<RuntimeIdentityReason>(record.reasons)
  const inGraph = graph.nodes.some(node => node.kind === 'jsx-element' && node.id === record.sourceRef)
  if (!inGraph) reasons.add('source-not-in-graph')
  const file = record.sourceFile ?? sourceFileFromRef(record.sourceRef)
  let versionMismatch = false
  if (context.fileDigest) {
    let expected: string | undefined
    try { expected = file ? context.fileDigest(file) : undefined } catch { expected = undefined }
    if (!record.sourceVersion || !expected) reasons.add('source-version-unavailable')
    else if (expected !== record.sourceVersion) { reasons.add('source-version-mismatch'); versionMismatch = true }
    else reasons.delete('source-version-unavailable')
  } else reasons.add('source-version-unavailable')
  // An instance is only proven for a page the caller names; no (or an empty) expectation is not proof.
  if (!context.expectedPage || context.expectedPage.pathname === undefined) reasons.add('page-context-unverified')
  else if (!samePage(snapshot.page, context.expectedPage)) reasons.add('page-context-mismatch')
  if (!isStable(record.certainty)) reasons.add('identity-not-stable')
  const ordered = [...reasons]
  // An ambiguous version history means the offsets may belong to an earlier revision.
  const locatable = inGraph && !versionMismatch && !reasons.has('source-version-ambiguous')
  return {
    sourceRef: record.sourceRef,
    ...(record.runtimeInstanceId ? { runtimeInstanceId: record.runtimeInstanceId } : {}),
    certainty: record.certainty,
    page: { ...snapshot.page },
    locatable,
    instanceIdentityProven: locatable && !!record.runtimeInstanceId && record.runtimeInstanceId !== record.sourceRef && ordered.length === 0,
    sameSourceCount: record.sameSourceCount,
    reasons: ordered,
  }
}

export type RuntimeLifecycleStatus = 'same-node' | 'remounted' | 'removed' | 'added'
export interface RuntimeLifecycleChange { runtimeInstanceId: string; sourceRef: string; status: RuntimeLifecycleStatus }

/**
 * Separates identity continuity (same instance id) from React lifecycle (same DOM node).
 * What "same id" means depends on certainty: for stable-keyed it follows the business key,
 * for stable-react the call-site chain, for position-dependent only the list position.
 * Both snapshots must come from the same page session; duplicated ids are ignored.
 */
export function compareRuntimeSnapshots(before: RuntimeIdentitySnapshot, after: RuntimeIdentitySnapshot): RuntimeLifecycleChange[] {
  const unique = (snapshot: RuntimeIdentitySnapshot) => new Map(snapshot.records
    .filter(record => record.runtimeInstanceId && !record.reasons.includes('duplicate-runtime-instance'))
    .map(record => [record.runtimeInstanceId!, record]))
  const previous = unique(before)
  const next = unique(after)
  const changes: RuntimeLifecycleChange[] = []
  for (const [id, record] of previous) {
    const current = next.get(id)
    changes.push({ runtimeInstanceId: id, sourceRef: record.sourceRef, status: !current ? 'removed' : current.domNode === record.domNode ? 'same-node' : 'remounted' })
  }
  for (const [id, record] of next) if (!previous.has(id)) changes.push({ runtimeInstanceId: id, sourceRef: record.sourceRef, status: 'added' })
  return changes
}
