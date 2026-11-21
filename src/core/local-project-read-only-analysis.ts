import type { KeyObject } from 'node:crypto'
import { realpathSync } from 'node:fs'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import type { FrozenSourceSnapshot } from './frozen-source-snapshot'
import { adaptSourceGraph } from './graph-identity-v2-adapter'
import { createGraphProducerEvidenceVerifier, type AnalyzerBuildIdentityV1 } from './graph-producer-evidence-v1'
import { createHostRegistryVerifierV1, type HostProjectBindingV1, type HostRegistryIssueResultV1 } from './host-registry-issuer-v1'
import { analyzeProject } from './project'

/** Server composition supplies E's LocalProjectAnalysisHost through this interface. */
export interface ReadOnlyAnalysisHost {
  resolveProject(projectId: string): {
    readonly checkoutRoot: string
    readonly expected: HostProjectBindingV1
    readonly publicKey: KeyObject
    readonly analyzerBuildPin: Readonly<AnalyzerBuildIdentityV1>
    readonly issueReceipt: () => HostRegistryIssueResultV1
  } | undefined
}

export interface ReadOnlyAnalysisSummary {
  projectId: string
  sourceDigest: string
  graphDigest: string
  mappingCount: number
  unresolvedCount: number
  hostReceiptStatus: 'verified'
  producerEvidenceStatus: 'available-producer-evidence'
}

type FailureCode = 'host-config-unavailable' | 'project-unregistered' | 'host-receipt-unavailable' |
  'host-receipt-rejected' | 'project-drift' | 'producer-evidence-unavailable' | 'analysis-failed'
type Failure = {
  status: 'failed'
  code: FailureCode
  hostReceiptStatus: 'verified' | 'unavailable' | 'rejected'
  producerEvidenceStatus: 'unavailable'
}
export type ReadOnlyAnalysisResult = { status: 'ok'; summary: ReadOnlyAnalysisSummary } | Failure

function fail(code: FailureCode, hostReceiptStatus: Failure['hostReceiptStatus'] = 'unavailable'): Failure {
  return { status: 'failed', code, hostReceiptStatus, producerEvidenceStatus: 'unavailable' }
}

function captureMatchingSnapshot(checkoutRoot: string, binding: HostProjectBindingV1): FrozenSourceSnapshot | undefined {
  try {
    const root = realpathSync(checkoutRoot)
    if (root !== checkoutRoot) return undefined
    const snapshot = captureFrozenSourceSnapshot(root)
    if (snapshot.root === root && snapshot.gitHead === binding.gitHead &&
        snapshot.rootTree === binding.rootTree && snapshot.sourceDigest === binding.sourceDigest) return snapshot
  } catch { /* An inaccessible or dirty checkout cannot support the receipt. */ }
  return undefined
}

/** The only operation input is a project ID. Configuration is fixed by server composition. */
export function createLocalProjectReadOnlyAnalysis(host?: ReadOnlyAnalysisHost) {
  return (projectId: string): ReadOnlyAnalysisResult => {
    if (!host) return fail('host-config-unavailable')

    let stage: FailureCode = 'host-config-unavailable'
    let receiptStatus: Failure['hostReceiptStatus'] = 'unavailable'
    try {
      const registration = host.resolveProject(projectId)
      if (!registration) return fail('project-unregistered')
      if (registration.expected.projectId !== projectId) return fail('host-receipt-rejected', 'rejected')
      const verifyReceipt = createHostRegistryVerifierV1({
        expected: registration.expected, publicKey: registration.publicKey,
      })

      stage = 'host-receipt-unavailable'
      const issued = registration.issueReceipt()
      if (issued.status === 'rejected') return fail('project-drift', 'rejected')
      const verified = verifyReceipt(issued.status === 'issued' ? issued.receipt : undefined)
      if (verified.status === 'unavailable') return fail('host-receipt-unavailable')
      if (verified.status === 'rejected') return fail('host-receipt-rejected', 'rejected')
      receiptStatus = 'verified'

      const snapshot = captureMatchingSnapshot(registration.checkoutRoot, verified.binding)
      if (!snapshot) return fail('project-drift', 'rejected')
      const { gitHead, ...identity } = verified.binding
      const binding = { ...identity, head: gitHead }

      stage = 'analysis-failed'
      const graph = analyzeProject(snapshot)
      const adapted = adaptSourceGraph({ snapshot, graph, registry: binding })
      if (adapted.status !== 'available-content-only') return fail('analysis-failed', receiptStatus)

      stage = 'producer-evidence-unavailable'
      const producer = createGraphProducerEvidenceVerifier(registration.analyzerBuildPin)
      const input = { snapshot, binding }
      const generated = producer.generate(input)
      if (generated.status !== 'available-producer-evidence') {
        return generated.reason === 'snapshot-mismatch'
          ? fail('project-drift', 'rejected')
          : fail('producer-evidence-unavailable', receiptStatus)
      }
      const replayed = producer.verify(input, generated.evidence, generated.rawGraphBytes)
      if (replayed.status !== 'available-producer-evidence') {
        return replayed.reason === 'snapshot-mismatch'
          ? fail('project-drift', 'rejected')
          : fail('producer-evidence-unavailable', receiptStatus)
      }
      if (replayed.evidence.graphDigest !== adapted.result.digest ||
          replayed.evidence.canonicalBytesSha256 !== adapted.result.canonicalBytesSha256 ||
          !replayed.rawGraphBytes.equals(Buffer.from(JSON.stringify(graph), 'utf8'))) {
        return fail('producer-evidence-unavailable', receiptStatus)
      }
      const current = captureMatchingSnapshot(registration.checkoutRoot, verified.binding)
      if (current?.root !== snapshot.root || current.trackedSetSha256 !== snapshot.trackedSetSha256) {
        return fail('project-drift', 'rejected')
      }

      return { status: 'ok', summary: {
        projectId, sourceDigest: binding.sourceDigest, graphDigest: adapted.result.digest,
        mappingCount: adapted.result.canonical.sourceMappings.length,
        unresolvedCount: adapted.result.canonical.unresolved.length,
        hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
      } }
    } catch {
      return fail(stage, receiptStatus)
    }
  }
}
