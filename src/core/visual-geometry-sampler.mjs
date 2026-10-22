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
export function sampleDomGeometryInPage(options) {
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
  // Whether `ancestor` establishes the containing block that positioned
  // descendants escape to: absolute boxes skip static ancestors, fixed boxes
  // skip everything except transformed / filtered / contained ancestors.
  const containsFixed = style => style.transform !== 'none' || style.filter !== 'none' || style.perspective !== 'none' ||
    (style.backdropFilter && style.backdropFilter !== 'none') || /paint|layout|strict|content/.test(style.contain || '') ||
    /size/.test(style.containerType || '') || style.contentVisibility === 'auto' || /transform|perspective|filter/.test(style.willChange || '')
  // A cutting axis is bounded by the padding box; the other axis of the same
  // ancestor only scrolls (CSS turns visible into auto), so it stays unbounded.
  const UNBOUNDED = 1e6
  const elements = nodes.map(node => {
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
      if (cutX || cutY) {
        const area = {
          x: cutX ? padding.x : -UNBOUNDED, width: cutX ? padding.width : 2 * UNBOUNDED,
          y: cutY ? padding.y : -UNBOUNDED, height: cutY ? padding.height : 2 * UNBOUNDED,
        }
        hiddenClip = hiddenClip ? intersect(hiddenClip, area) : area
      }
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
    // Served-file sha256 per annotated source file (C+D sourceVersion).
    // Not yet collected: null means every file's version is UNVERIFIED for
    // pairing (never valid, never a clash by itself). Wiring contract:
    // docs/architecture/visual-sampler-identity-rfc.md
    sourceFileVersions: null,
    elements,
  }
}
