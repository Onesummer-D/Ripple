// Pure construction of the candidate/source preview Content-Security-Policy
// from the project-approved resource URL list (RIPPLE_PREVIEW_RESOURCE_URLS).
// Kept side-effect free — no container paths, no process env — so the rule is
// unit-testable outside the preview container; candidate-preview-vite.config.mjs
// validates the env list and applies it per document request.
//
// Two shapes, selected per request:
//  - STRICT (interactive workbench previews): font-src lists each approved URL
//    (origin + pathname) only. A page can fetch exactly what the project
//    authorized — nothing else.
//  - VERIFICATION (isolated runner navigations): when the runner's document
//    request carries VERIFICATION_FONT_HEADER, font-src additionally allows
//    https://fonts.gstatic.com. snapshotAuthorizedPreviewResources() fetches
//    an authorized fonts.googleapis.com stylesheet's fonts.gstatic.com
//    dependencies into hash-verified snapshots (source
//    'authorized-stylesheet-dependency') and the runner's route layer fulfills
//    exactly those URLs — Run #12 showed the page CSP blocking every approved
//    font (22,624 console errors) because the authorized list names the CSS
//    but never the font files. Pages cannot set custom headers on document
//    navigations, so only the instrumented runner ever receives this shape;
//    per-URL snapshot authorization stays enforced at the route layer.

export const VERIFICATION_FONT_HEADER = 'x-ripple-verification-fonts'
const VERIFICATION_FONT_HEADER_VALUE = 'verified-font-dependencies'

export function buildPreviewCsp(approvedResourceUrls, options = {}) {
  const externalResources = approvedResourceUrls.map(value => {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  }).join(' ')
  const approvedStylesheet = approvedResourceUrls.some(value => new URL(value).hostname === 'fonts.googleapis.com')
  const includeVerifiedFontDependencies = options.includeVerifiedFontDependencies === true
  const fontDependencyOrigin = approvedStylesheet && includeVerifiedFontDependencies ? ' https://fonts.gstatic.com' : ''
  return [
    "default-src 'self' data: blob:",
    "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
    `style-src 'self' 'unsafe-inline' ${externalResources}`,
    `font-src 'self' data: ${externalResources}${fontDependencyOrigin}`,
    `img-src 'self' data: blob: ${externalResources}`,
    `media-src 'self' data: blob: ${externalResources}`,
    "connect-src 'self'",
    "form-action 'none'",
    "object-src 'none'",
    "base-uri 'none'",
    "frame-src 'none'",
    "worker-src 'none'",
  ].join('; ')
}

// Document requests from the isolated runner carry the header (set per page
// via page.setExtraHTTPHeaders); everything else — the workbench iframes — gets
// the strict policy. Request headers are a plain IncomingHttpHeaders map.
export function previewCspForRequest(requestHeaders, approvedResourceUrls) {
  const verified = requestHeaders[VERIFICATION_FONT_HEADER] === VERIFICATION_FONT_HEADER_VALUE
  return buildPreviewCsp(approvedResourceUrls, { includeVerifiedFontDependencies: verified })
}
