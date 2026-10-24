// In-page DOM geometry sampler for visual-difference evidence.
//
//   const sample = await page.evaluate(sampleDomGeometryInPage, { side: 'candidate', interactionState: 'rendered' })
//
// Plain JavaScript so the Playwright executor inside the verification
// container can use it without a TypeScript transform. The function is
// serialised by page.evaluate, so it must stay self-contained: no imports and
// no references to module scope.
//
// It reads only Ripple's runtime annotations (data-ripple-source,
// data-ripple-instance, data-ripple-identity-certainty) and layout boxes; it
// never reads text to infer where an element came from. To keep a page with
// too many annotated elements from being silently truncated, at most
// maxElements + 1 elements are returned, which the host-side parser rejects.
// The caller records the screenshot SHA-256 in `screenshotSha256` after taking
// the screenshot, binding the sample to those exact bytes.
//
// Identity wiring (read-only, best-effort, never throws):
// - Per-file served source versions are read from C+D's runtime registry
//   (globalThis[Symbol.for('ripple.runtime-identity')].sourceVersions) — the
//   same registry C+D's collector reads; E never hashes source itself.
// - Collection-time identity reasons come from C+D's own
//   collectRuntimeIdentitySnapshot, embedded by buildDomGeometrySampler via
//   its serialised source (same pattern as candidate-preview-vite.config.mjs).
//   Elements are correlated by the C+D-sanctioned label attribute pattern.
// - Any failure degrades every new field to null ("evidence unavailable"),
//   never to an invented value; the geometry itself still samples.

/**
 * Page function WITHOUT the C+D collector: identity reasons stay null; the
 * version registry is still read. Built at module load by inlining
 * runSampler's source so the function stays self-contained under
 * page.evaluate serialization (no module-scope reference survives).
 */
function markSamplerCollectorStatus(sampler, status) {
  try {
    Object.defineProperty(sampler, '__rippleCollectorStatus', { value: status, configurable: false, enumerable: false })
  } catch {
    // The marker is host-only metadata. A page-evaluate failure still degrades
    // to the sampler's normal unavailable identity result.
  }
  return sampler
}

export const sampleDomGeometryInPage = markSamplerCollectorStatus(
  new Function('options', `return (${runSampler.toString()})(options, null);`),
  'missing',
)

/**
 * Builds a self-contained page function with C+D's
 * collectRuntimeIdentitySnapshot embedded. `collectorSource` must be the
 * function's serialised source (fn.toString()); the result is directly
 * page.evaluate-able because new Function closes over nothing.
 */
export function buildDomGeometrySampler(collectorSource) {
  if (typeof collectorSource !== 'string' || !collectorSource) return sampleDomGeometryInPage
  try {
    // Sanity: the source must parse as a function expression.
    new Function(`return (${collectorSource});`)
  } catch {
    return markSamplerCollectorStatus(
      new Function('options', `return (${runSampler.toString()})(options, null);`),
      'serialization-error',
    )
  }
  return markSamplerCollectorStatus(
    new Function('options', `return (${runSampler.toString()})(options, (${collectorSource}));`),
    'ready',
  )
}

// Self-contained by contract: serialized whole by buildDomGeometrySampler and
// by page.evaluate(sampleDomGeometryInPage). No module-scope references.
function runSampler(options, collectRuntimeIdentitySnapshot) {
  const maxElements = Number.isInteger(options?.maxElements) && options.maxElements > 0 ? options.maxElements : 2000
  const documentSpace = options?.coordinateSpace !== 'viewport'
  const certainties = ['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped']
  const scrollX = window.scrollX
  const scrollY = window.scrollY
  const place = rect => ({ x: rect.x + (documentSpace ? scrollX : 0), y: rect.y + (documentSpace ? scrollY : 0), width: rect.width, height: rect.height })
  const intersect = (a, b) => {
    const x = Math.max(a.x, b.x)
    const y = Math.max(a.y, b.y)
    return { x, y, width: Math.max(0, Math.min(a.x + a.width, b.x + b.width) - x), height: Math.max(0, Math.min(a.y + a.height, b.y + b.height) - y) }
  }
  const nodes = Array.from(document.querySelectorAll('[data-ripple-source]')).slice(0, maxElements + 1)
  const ids = new Map(nodes.map((node, index) => [node, `e${index}`]))

  // --- C+D runtime-identity wiring (read-only) -----------------------------
  // A file whose registry history holds more than one digest (HMR /
  // re-evaluation) cannot attribute its DOM to either version: omit it.
  const sourceFileOf = ref => {
    const match = typeof ref === 'string' ? /^jsx:(.+)#\d+$/.exec(ref) : null
    return match ? match[1] : null
  }
  // The page's ACTUAL referenced source-file set, independent of what later
  // resolves in the registry. Single-file-ness is decided on this set, never
  // on the resolved map (a multi-file page whose other file is ambiguous or
  // unregistered would otherwise masquerade as single-file).
  const files = [...new Set(nodes.map(node => sourceFileOf(node.getAttribute('data-ripple-source'))).filter(Boolean))].sort()
  let sourceFileVersions = null
  let pageContext = null
  let reasonByIndex = null
  let runtimeIdentitySnapshot = null
  let runtimeIdentityCollection = 'unavailable'
  let runtimeIdentityError = null
  try {
    const registry = globalThis[Symbol.for('ripple.runtime-identity')]
    const versions = registry && registry.sourceVersions instanceof Map ? registry.sourceVersions : null
    const history = registry && registry.sourceVersionHistory instanceof Map ? registry.sourceVersionHistory : null
    if (versions && files.length) {
      const map = {}
      for (const file of files) {
        const digest = versions.get(file)
        const seen = history instanceof Map ? history.get(file) : undefined
        if (typeof digest === 'string' && /^[a-f0-9]{64}$/.test(digest) && !(seen instanceof Set && seen.size > 1)) map[file] = digest
      }
      if (Object.keys(map).length) sourceFileVersions = map
    }
    pageContext = { pathname: location.pathname, search: location.search, hash: location.hash }
    if (typeof collectRuntimeIdentitySnapshot === 'function') {
      // Correlate every sampled node with one collector record using C+D's
      // label pattern (same as the selection bridge): the collector copies the
      // value of the named attribute into record.label.
      const marker = 'data-ripple-visual-corr'
      nodes.forEach((node, index) => { node.setAttribute(marker, `v${index}`) })
      try {
        runtimeIdentitySnapshot = collectRuntimeIdentitySnapshot({ label: marker })
        runtimeIdentityCollection = runtimeIdentitySnapshot && Array.isArray(runtimeIdentitySnapshot.records)
          ? 'collected'
          : 'unavailable'
        if (runtimeIdentityCollection !== 'collected') runtimeIdentityError = 'collector returned no usable records'
      } catch (error) {
        runtimeIdentityCollection = 'failed'
        runtimeIdentityError = String(error?.message ?? error).slice(0, 300)
      } finally {
        nodes.forEach(node => { node.removeAttribute(marker) })
      }
      if (runtimeIdentitySnapshot && Array.isArray(runtimeIdentitySnapshot.records)) {
        reasonByIndex = new Map()
        for (const record of runtimeIdentitySnapshot.records) {
          const label = record && typeof record.label === 'string' ? record.label : ''
          const match = /^v(\d+)$/.exec(label)
          if (!match) continue
          const index = Number(match[1])
          if (!Number.isInteger(index) || index < 0 || index >= nodes.length || reasonByIndex.has(index)) continue
          if (!Array.isArray(record.reasons)) continue
          const reasons = record.reasons.slice(0, 8).map(reason => String(reason).slice(0, 64)).filter(Boolean)
          reasonByIndex.set(index, reasons)
        }
        if (!reasonByIndex.size) reasonByIndex = null
      }
    }
  } catch {
    sourceFileVersions = null
    pageContext = null
    reasonByIndex = null
    runtimeIdentitySnapshot = null
    runtimeIdentityCollection = 'failed'
    runtimeIdentityError = 'runtime identity sampler failed'
  }
  // Legacy single-file field: filled ONLY when the page actually references
  // exactly one source file AND that file's version resolved. Multi-file
  // pages, partially-resolved pages and ambiguous versions all keep null,
  // even when the resolved map happens to contain a single entry; the
  // per-file map above carries the truth.
  const sourceVersion = files.length === 1 && sourceFileVersions !== null && typeof sourceFileVersions[files[0]] === 'string'
    ? sourceFileVersions[files[0]]
    : null

  // Whether `ancestor` establishes the containing block that positioned
  // descendants escape to: absolute boxes skip static ancestors, fixed boxes
  // skip everything except transformed / filtered / contained ancestors.
  const containsFixed = style => style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' ||
    (style.backdropFilter && style.backdropFilter !== 'none') || /paint|layout|strict|content/.test(style.contain || '') ||
    /size/.test(style.containerType || '') || style.contentVisibility === 'auto' || /transform|perspective|filter/.test(style.willChange || '')
  // A cutting axis is bounded by the padding box; the other axis of the same
  // ancestor only scrolls (CSS turns visible into auto), so it stays unbounded.
  const UNBOUNDED = 1e6
  const elements = nodes.map((node, index) => {
    let parentId = null
    for (let parent = node.parentElement; parent; parent = parent.parentElement) {
      if (ids.has(parent)) { parentId = ids.get(parent); break }
    }
    // clip: visible area left by every clipping ancestor (hidden, clip, auto, scroll).
    // hiddenClip: area left by hidden/clip ancestors only; content beyond it is cut
    // off for good, while content beyond a scroll container is merely scrolled.
    let clip = null
    let hiddenClip = null
    let positioning = getComputedStyle(node).position
    for (let ancestor = node.parentElement; ancestor && ancestor !== document.body && ancestor !== document.documentElement; ancestor = ancestor.parentElement) {
      const style = getComputedStyle(ancestor)
      const establishes = positioning === 'fixed' ? containsFixed(style) : positioning === 'absolute' ? style.position !== 'static' || containsFixed(style) : true
      if (!establishes) continue
      positioning = style.position === 'fixed' || style.position === 'absolute' ? style.position : 'static'
      if (style.overflowX === 'visible' && style.overflowY === 'visible') continue
      const box = ancestor.getBoundingClientRect()
      const padding = { x: box.x + ancestor.clientLeft, y: box.y + ancestor.clientTop, width: ancestor.clientWidth, height: ancestor.clientHeight }
      clip = clip ? intersect(clip, padding) : padding
      const cuts = value => value === 'hidden' || value === 'clip'
      const cutX = cuts(style.overflowX), cutY = cuts(style.overflowY)
      const area = {
        x: cutX ? padding.x : -UNBOUNDED, width: cutX ? padding.width : 2 * UNBOUNDED,
        y: cutY ? padding.y : -UNBOUNDED, height: cutY ? padding.height : 2 * UNBOUNDED,
      }
      hiddenClip = hiddenClip ? intersect(hiddenClip, area) : area
    }
    const style = getComputedStyle(node)
    const rect = node.getBoundingClientRect()
    const certainty = node.getAttribute('data-ripple-identity-certainty')
    // checkVisibility also accounts for ancestors' opacity / visibility / display.
    const visible = typeof node.checkVisibility === 'function'
      ? node.checkVisibility({ opacityProperty: true, visibilityProperty: true }) && rect.width > 0 && rect.height > 0
      : style.display !== 'none' && style.visibility !== 'hidden' && style.visibility !== 'collapse' && Number(style.opacity) > 0 && rect.width > 0 && rect.height > 0
    return {
      id: ids.get(node),
      parentId,
      sourceRef: node.getAttribute('data-ripple-source') || null,
      runtimeInstanceId: node.getAttribute('data-ripple-instance') || null,
      identityCertainty: certainties.includes(certainty) ? certainty : null,
      identityReasons: reasonByIndex && reasonByIndex.has(index) ? reasonByIndex.get(index) : null,
      rect: place(rect),
      clipRect: clip ? place(clip) : null,
      hiddenClipRect: hiddenClip ? place(hiddenClip) : null,
      visible,
    }
  })
  return {
    schema: 'ripple-dom-geometry/v1',
    side: options?.side,
    route: location.pathname,
    // Query and fragment distinguish hash-router / query-addressed pages. The
    // host parser keeps only a digest of this value.
    locationSuffix: `${location.search}${location.hash}`,
    viewport: { width: window.innerWidth, height: window.innerHeight },
    devicePixelRatio: window.devicePixelRatio,
    interactionState: options?.interactionState,
    coordinateSpace: documentSpace ? 'document' : 'viewport',
    scroll: { x: scrollX, y: scrollY },
    documentSize: { width: document.documentElement.scrollWidth, height: document.documentElement.scrollHeight },
    screenshotSha256: null,
    // Served-file sha256 of the annotated source (C+D sourceVersion). Only
    // populated for single-file pages; see sourceFileVersions for the general
    // per-file binding.
    sourceVersion,
    // C+D registry-derived served-version per referenced source file
    // (project-relative path -> sha256). Null means version evidence
    // unavailable; never an empty object.
    sourceFileVersions,
    // C+D RuntimePageContext for this sample ({pathname, search, hash}).
    pageContext,
    // The exact collector result used to annotate this geometry sample. The
    // container archives this value once per side; the host later verifies
    // its hash and performs the formal assessment.
    runtimeIdentitySnapshot,
    runtimeIdentityCollection,
    ...(runtimeIdentityError ? { runtimeIdentityError } : {}),
    elements,
  }
}
