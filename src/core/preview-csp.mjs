// Pure construction of the candidate/source preview Content-Security-Policy
// from the project-approved resource URL list (RIPPLE_PREVIEW_RESOURCE_URLS).
// Kept side-effect free — no container paths, no process env — so the rule is
// unit-testable outside the preview container; candidate-preview-vite.config.mjs
// validates the env list and delegates to buildPreviewCsp.
//
// font-src covers two kinds of sources:
//  - each approved URL itself (origin + pathname, as before)
//  - https://fonts.gstatic.com, but ONLY when a fonts.googleapis.com stylesheet
//    was approved. snapshotAuthorizedPreviewResources() fetches the stylesheet's
//    fonts.gstatic.com dependencies into hash-verified snapshots (source
//    'authorized-stylesheet-dependency') and the verification route layer
//    fulfills exactly those URLs. Run #12: without this, the page CSP blocked
//    every approved font (22,624 console errors) even though the snapshot
//    pipeline had verified each file.
export function buildPreviewCsp(approvedResourceUrls) {
  const externalResources = approvedResourceUrls.map(value => {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  }).join(' ')
  const approvedStylesheet = approvedResourceUrls.some(value => new URL(value).hostname === 'fonts.googleapis.com')
  const fontDependencyOrigin = approvedStylesheet ? ' https://fonts.gstatic.com' : ''
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
