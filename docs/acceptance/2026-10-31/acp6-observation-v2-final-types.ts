/** Evidence-only types for sourcegraph-identity/v2 and
 * sourcegraph-observation-binding/v1. Not imported by production code. */

export type Sha256 = string & { readonly __sha256: unique symbol }
export type Side = 'baseline' | 'candidate'
export type OffsetUnit = 'code-unit'
/** Frozen SourceGraph kind permitted for an observation source-use reference. */
export type SourceUseNodeKind = 'token-use'
export type GraphNodeKind = 'file' | 'symbol' | 'component' | 'route' | 'data' | 'media' | 'token' | 'token-use' | 'jsx-element' | 'state'
export type GraphEdgeKind = 'imports' | 'reads' | 'renders' | 'uses-token' | 'token-reference' | 'asset-consumer' | 'css-cascade' | 'same-copy' | 'semantic-link'

export interface SourceUse {
  path: string
  charOffset: number // zero-based UTF-16 code-unit offset
  byteOffset: number // zero-based UTF-8 byte offset
  offsetUnit: OffsetUnit
}

export interface SourceUseRef {
  sourceRef: string
  graphNodeId: string
  relationId?: string
  sourceUse: SourceUse
}

export interface GraphIdentityV2 {
  graphIdentityVersion: 'sourcegraph-identity/v2'
  graphSchemaVersion: string
  relationIdentityVersion: string
  projectId: string // host project registry only
  sourceDigest: Sha256
  graphDigest: Sha256
}

export interface SideGraphReferenceInput {
  nodes: ReadonlyArray<{ id: string; kind: GraphNodeKind; [key: string]: unknown }>
  edges: ReadonlyArray<{
    id: string
    from: string
    to: string
    kind: GraphEdgeKind
    certainty: 'source-proven' | 'runtime-observed' | 'semantic-candidate' | 'unknown'
    evidenceRefs: readonly string[]
    sourceUse?: SourceUse
    sourceIdentity?: string
    [key: string]: unknown
  }>
}

export interface GraphReferenceValidation {
  status: ObservationStatus
  reasonCode: ObservationReasonCode
  trusted: boolean
}

export interface ObservationBindingV1 {
  observationBindingVersion: 'sourcegraph-observation-binding/v1'
  graph: GraphIdentityV2
  sourceRef?: string
  sourceUseRef?: SourceUseRef
  runId: string
  checkId: string
  side: Side
  route: string
  page: { pathname: string; search: string; hash: string }
  viewport: { width: number; height: number; deviceScaleFactor?: number }
  state: { id: string; digest?: Sha256 }
  artifact: {
    kind: 'observation-json' | 'runtime-snapshot' | 'mapping'
    path: string
    sha256: Sha256
    sizeBytes: number
  }
  status: 'complete' | 'partial' | 'unknown' | 'unavailable' | 'stale'
  proof: 'not-proven' | 'runtime-observed'
  primaryReasonCode: ObservationReasonCode
  secondaryReasonCodes: ObservationReasonCode[]
  observationBindingDigest: Sha256
}

export type ObservationStatus = 'complete' | 'partial' | 'unknown' | 'unavailable' | 'stale'

export type ObservationReasonCode =
  | `observation/${ObservationReasonName}`

export type ObservationReasonName =
  | 'complete'
  | 'missing-side' | 'missing-artifact' | 'artifact-hash-mismatch'
  | 'artifact-path-invalid' | 'artifact-changed-after-validation'
  | 'cross-run' | 'cross-check' | 'side-mismatch'
  | 'logical-project-mismatch' | 'untrusted-capture'
  | 'required-verification-not-pass'
  | 'runtime-version-stale' | 'route-namespace-stale'
  | 'geometry-only' | 'runtime-location-conflict'
  | 'declaration-node-not-source-use' | 'source-use-location-mismatch'
  | 'duplicate-record' | 'duplicate-artifact-conflict'
  | 'viewport-mismatch' | 'state-mismatch' | 'identity-not-stable'
  | 'pseudo-element-without-host-proof' | 'non-strict-consumer-edge'
  | 'missing-consumer-edge' | 'runtime-instance-without-edge'
  | 'dynamic-without-runtime-map' | 'page-impact-not-proven'
  | 'missing-cross-side-map'
  | 'missing-source-ref'
  | 'missing-source-use-ref'
  | 'missing-source-use'
  | 'source-ref-mismatch'
  | 'graph-node-not-unique'
  | 'source-ref-not-in-graph'
  | 'declaration-node-not-source-use'
  | 'missing-relation-id'
  | 'relation-not-in-graph'
  | 'duplicate-relation-id'
  | 'source-use-ref-mismatch'
  | 'source-digest-mismatch'
  | 'graph-digest-mismatch'
  | 'graph-schema-invalid'
  | 'artifact-missing'
  | 'artifact-digest-mismatch'
  | 'page-context-mismatch'
  | 'page-context-unverified'
  | 'observation-tuple-mismatch'

/** Exactly the fields included in observationBindingDigest. */
export type ObservationBindingDigestInput = Omit<ObservationBindingV1,
  'status' | 'proof' | 'primaryReasonCode' | 'secondaryReasonCodes' |
  'observationBindingDigest'>

/** Quarantine shape only. V2 parsing never converts this payload. */
export interface LegacyInput {
  legacyKind: 'b-v5-report' | 'legacy-sourcegraph' | 'legacy-relation-id'
  legacyVersion: string
  payload: unknown
}
