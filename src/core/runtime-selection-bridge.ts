/** A navigation-only trust boundary for selection messages from an opaque-origin iframe.
 * This cannot authorize Scope or instance-level edit; runtime provenance is still
 * verified independently against the candidate, project source graph and actual files.
 */
export type PickerCertainty = 'stable-keyed-instance' | 'stable-react-instance' | 'position-dependent' | 'unknown' | 'unmapped'
export interface PickerEnvelope {
  type: 'ripple:element-selected'
  protocol: 'ripple-runtime-identity/v1'
  previewId: string
  token: string
  sourceRef: string
  runtimeInstanceId?: string
  identityCertainty: PickerCertainty
  reasons?: string[]
  sourceVersion?: string
  pageContext?: { pathname: string; search: string; hash: string }
  sameSourceCount?: number
  tagName: string
  text: string
}

const certainties: readonly string[] = ['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped']
const validSourceAnchor = (suffix: string, sourceRef: string): boolean => {
  if (!/^(?:jsx:|[_:\u00ab])/.test(suffix)) return false
  const anchor = `:${sourceRef}`
  const at = suffix.indexOf(anchor)
  if (at <= 0) return false
  const tail = suffix.slice(at + anchor.length)
  return tail === '' || tail.startsWith(':')
}
const runtimeNamespaceMatches = (id: string, sourceRef: string, page: { pathname: string; search: string; hash: string }): boolean => {
  if (id.startsWith('ripple-page-v2:')) {
    const start = 'ripple-page-v2:'.length
    const boundary = id.indexOf(':', start)
    if (boundary < 0) return false
    const encoded = id.slice(start, boundary)
    let decoded: string
    try { decoded = decodeURIComponent(encoded) } catch { return false }
    let tuple: unknown
    try { tuple = JSON.parse(decoded) } catch { return false }
    if (!Array.isArray(tuple) || tuple.length !== 3 || tuple.some(part => typeof part !== 'string')) return false
    const canonical = JSON.stringify(tuple)
    if (canonical !== decoded || encodeURIComponent(canonical) !== encoded ||
      tuple[0] !== page.pathname || tuple[1] !== page.search || tuple[2] !== page.hash) return false
    return validSourceAnchor(id.slice(boundary + 1), sourceRef)
  }
  // Historical picker messages can carry a v1 ID only on an unambiguous bare pathname.
  if (page.search !== '' || page.hash !== '' || !id.startsWith(`${page.pathname}:`)) return false
  return validSourceAnchor(id.slice(page.pathname.length + 1), sourceRef)
}
export function isCurrentPickerEnvelope(
  input: unknown, current: { eventSource: unknown; iframeSource: unknown; previewId: string; token: string },
): input is PickerEnvelope {
  if (!current.iframeSource || current.eventSource !== current.iframeSource || !input || typeof input !== 'object' || Array.isArray(input)) return false
  const data = input as Record<string, unknown>
  return data.type === 'ripple:element-selected' &&
    data.protocol === 'ripple-runtime-identity/v1' &&
    data.previewId === current.previewId && data.token === current.token &&
    typeof data.sourceRef === 'string' && /^jsx:.+#\d+$/.test(data.sourceRef) &&
    typeof data.identityCertainty === 'string' && certainties.includes(data.identityCertainty) &&
    typeof data.tagName === 'string' && typeof data.text === 'string'
}

/** Display-only result. No result of this function authorizes editing or overrides. */
export function assessPickerDisplayIdentity(data: PickerEnvelope, trusted: {
  sourceRef: string
  sourceVersion?: string
  expectedPathname: string
}): {
  certainty: PickerCertainty
  runtimeInstanceId?: string
  reasons: string[]
  permission: 'navigation-only'
} {
  const reasons = new Set<string>(
    Array.isArray(data.reasons) && data.reasons.every(reason => typeof reason === 'string')
      ? data.reasons : ['invalid-certainty'],
  )
  if (data.sourceRef !== trusted.sourceRef) reasons.add('source-not-in-graph')
  if (!trusted.sourceVersion || !/^[a-f0-9]{64}$/.test(trusted.sourceVersion) || !data.sourceVersion) {
    reasons.add('source-version-unavailable')
  } else if (data.sourceVersion !== trusted.sourceVersion) reasons.add('source-version-mismatch')
  const page = data.pageContext
  if (!page || typeof page.pathname !== 'string' || typeof page.search !== 'string' || typeof page.hash !== 'string') {
    reasons.add('page-context-unverified')
  } else if (page.pathname !== trusted.expectedPathname) reasons.add('page-context-mismatch')
  if (!data.runtimeInstanceId || data.runtimeInstanceId.endsWith(':~')) reasons.add('instance-unavailable')
  if (!data.runtimeInstanceId || !page || !runtimeNamespaceMatches(data.runtimeInstanceId, data.sourceRef, page)) reasons.add('route-namespace-stale')
  if (data.identityCertainty !== 'stable-react-instance' && data.identityCertainty !== 'stable-keyed-instance') {
    reasons.add('identity-not-stable')
  }
  return {
    certainty: reasons.size === 0 ? data.identityCertainty : 'unknown',
    ...(reasons.size === 0 ? { runtimeInstanceId: data.runtimeInstanceId } : {}),
    reasons: [...reasons],
    permission: 'navigation-only',
  }
}
