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
  if (!data.runtimeInstanceId || data.runtimeInstanceId.endsWith(':~') ||
      !page || !data.runtimeInstanceId.startsWith(page.pathname + ':')) reasons.add('instance-unavailable')
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
