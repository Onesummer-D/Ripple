function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

/** Mirrors the frozen v1.2 canonical JSON rules: sorted object keys, ordered arrays. */
export function canonicalRuntimeIdentityJsonForConsumer(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean') return JSON.stringify(value)
  if (typeof value === 'number') {
    if (!Number.isFinite(value)) throw new Error('Runtime identity checksum input contains a non-finite number.')
    return JSON.stringify(value)
  }
  if (Array.isArray(value)) return `[${value.map(canonicalRuntimeIdentityJsonForConsumer).join(',')}]`
  if (isObject(value)) {
    return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonicalRuntimeIdentityJsonForConsumer(value[key])}`).join(',')}}`
  }
  throw new Error('Runtime identity checksum input contains an unsupported value.')
}

/**
 * Rechecks the v1.2 content checksum in browsers and Node. A valid checksum
 * detects misbinding or changed content; it does not authenticate the host.
 */
export async function runtimeIdentityAssessmentChecksum(
  capture: { checkId: string; route: string; viewport: { width: number; height: number }; state: string; side: 'baseline' | 'candidate' },
  snapshotSha256: string,
  recordKey: string,
  assessment: unknown,
): Promise<string> {
  const subtle = globalThis.crypto?.subtle
  if (!subtle) throw new Error('Web Crypto SHA-256 is unavailable in this environment.')
  const serialized = canonicalRuntimeIdentityJsonForConsumer({
    protocol: 'ripple-runtime-identity-assessment/v1.2',
    capture: {
      checkId: capture.checkId,
      route: capture.route,
      viewport: { width: capture.viewport.width, height: capture.viewport.height },
      state: capture.state,
      side: capture.side,
    },
    snapshotSha256,
    recordKey,
    assessment,
  })
  const hash = await subtle.digest('SHA-256', new TextEncoder().encode(serialized))
  return [...new Uint8Array(hash)].map(byte => byte.toString(16).padStart(2, '0')).join('')
}
