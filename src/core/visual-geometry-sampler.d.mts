import type { DomGeometrySample } from './visual-geometry'

export interface DomGeometrySamplerOptions {
  side: 'baseline' | 'candidate'
  interactionState: string
  /** Default document (rects include the window scroll offset). */
  coordinateSpace?: 'document' | 'viewport'
  /** Default 2000; the sampler returns at most maxElements + 1 so oversized pages are rejected, not truncated. */
  maxElements?: number
}

/** What the sampler returns: the raw query + fragment instead of its digest. */
export type RawDomGeometrySample = Omit<DomGeometrySample, 'locationSuffixSha256'> & { locationSuffix: string }

/** Runs inside the page through page.evaluate; returns an unvalidated sample for parseDomGeometrySample. */
export function sampleDomGeometryInPage(options: DomGeometrySamplerOptions): RawDomGeometrySample
