import { describe, it, afterAll } from 'vitest'
import { execFileSync } from 'node:child_process'
import { writeFileSync, mkdirSync } from 'node:fs'
import { dirname } from 'node:path'
import * as ts from 'typescript'
import { analyzeProject } from './project'
import { sourceProvenPageImpact } from './scope'

/**
 * Reproducible real-project probe entry point (reviewer requirement #3).
 *
 * Re-run against the SAME frozen source checkouts with:
 *
 *   RIPPLE_PROBE_QINGYE=<abs path to ripple-qingye-bolt checkout> \
 *   RIPPLE_PROBE_MOUNTAIN=<abs path to mountain-spirit-showcase checkout> \
 *   RIPPLE_PROBE_CODECANDY=<abs path to codescandy-dashui checkout> \
 *   RIPPLE_PROBE_OUT=<abs path for results JSON>   (optional; defaults to console)
 *   npx vitest run src/core/b-real-project-probe.test.ts
 *
 * The SHA of each analyzed checkout is captured into the results so the
 * numbers can be reproduced bit-for-bit. Unset paths skip the project
 * (the test stays green in CI where the private checkouts do not exist).
 */

interface ClosureEntry { id: string; label: string; path?: string; consumed: boolean; certainty: string; pageRefs: number; unresolved: string[] }
interface ClosureStats {
  total: number
  consumed: number
  full: number
  partial: number
  unknown: number
  entries: ClosureEntry[]
}

interface ProbeResult {
  name: string
  rootEnv: string
  frozenSha: string | 'unavailable'
  nodes: number
  edges: number
  kinds: Record<string, number>
  assetConsumer: { sourceProven: number; semanticCandidate: number }
  mediaClosure: ClosureStats
  tokenConsumer: { sourceProven: number; semanticCandidate: number; unknown: number }
  tokenClosure: ClosureStats
  unresolvedCount: number
  unresolved: string[]
}

function frozenSha(root: string): string | 'unavailable' {
  try {
    return execFileSync('git', ['-C', root, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return 'unavailable'
  }
}

const targets = [
  ['qingye-bolt', 'RIPPLE_PROBE_QINGYE'],
  ['mountain-spirit', 'RIPPLE_PROBE_MOUNTAIN'],
  ['codescandy-dashui', 'RIPPLE_PROBE_CODECANDY'],
] as const

const results: ProbeResult[] = []

afterAll(() => {
  const out = JSON.stringify({
    generatedAt: new Date().toISOString(),
    rippleHead: frozenSha(process.cwd()),
    runtimeFingerprint: { node: process.version, typescript: ts.version },
    projects: results,
  }, null, 2)
  if (process.env.RIPPLE_PROBE_OUT) {
    mkdirSync(dirname(process.env.RIPPLE_PROBE_OUT), { recursive: true })
    writeFileSync(process.env.RIPPLE_PROBE_OUT, out)
  } else console.log(out)
})

describe('real-project probe (reproducible deliverable)', () => {
  for (const [name, envVar] of targets) {
    const root = process.env[envVar]
    const run = root ? it : it.skip
    run(`${name} (set ${envVar} to enable)`, () => {
      const graph = analyzeProject(root!)
      const kinds: Record<string, number> = {}
      for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1
      const proven = graph.edges.filter(e => e.kind === 'asset-consumer' && e.certainty === 'source-proven').length
      const candidate = graph.edges.filter(e => e.kind === 'asset-consumer' && e.certainty === 'semantic-candidate').length

      const consumerEdgeMedia = new Set(graph.edges.filter(e => e.kind === 'asset-consumer').map(e => e.to))
      const mediaEntries = graph.nodes.filter(n => n.kind === 'media').map(node => {
        const impact = sourceProvenPageImpact(graph, node.id)
        return {
          id: node.id,
          label: node.label,
          path: node.location?.path,
          consumed: consumerEdgeMedia.has(node.id),
          certainty: impact.certainty,
          pageRefs: impact.pageRefs.length,
          unresolved: impact.unresolved,
        }
      })
      const consumed = mediaEntries.filter(m => m.consumed)
      const tokenProven = graph.edges.filter(e => e.kind === 'uses-token' && e.certainty === 'source-proven').length
      const tokenCandidate = graph.edges.filter(e => e.kind === 'uses-token' && e.certainty === 'semantic-candidate').length
      const tokenUnknownEdges = graph.edges.filter(e => e.kind === 'uses-token' && e.certainty === 'unknown').length
      const consumerEdgeToken = new Set(graph.edges.filter(e => e.kind === 'uses-token').map(e => e.to))
      const tokenEntries = graph.nodes.filter(n => n.kind === 'token').map(node => {
        const impact = sourceProvenPageImpact(graph, node.id)
        return {
          id: node.id,
          label: node.label,
          path: node.location?.path,
          consumed: consumerEdgeToken.has(node.id),
          certainty: impact.certainty,
          pageRefs: impact.pageRefs.length,
          unresolved: impact.unresolved,
        }
      })
      const tokensConsumed = tokenEntries.filter(t => t.consumed)
      results.push({
        name,
        rootEnv: envVar,
        frozenSha: frozenSha(root!),
        nodes: graph.nodes.length,
        edges: graph.edges.length,
        kinds,
        assetConsumer: { sourceProven: proven, semanticCandidate: candidate },
        mediaClosure: {
          total: mediaEntries.length,
          consumed: consumed.length,
          full: consumed.filter(m => m.certainty === 'source-proven').length,
          partial: consumed.filter(m => m.certainty === 'partial').length,
          unknown: consumed.filter(m => m.certainty === 'unknown').length,
          entries: mediaEntries,
        },
        tokenConsumer: { sourceProven: tokenProven, semanticCandidate: tokenCandidate, unknown: tokenUnknownEdges },
        tokenClosure: {
          total: tokenEntries.length,
          consumed: tokensConsumed.length,
          full: tokensConsumed.filter(t => t.certainty === 'source-proven').length,
          partial: tokensConsumed.filter(t => t.certainty === 'partial').length,
          unknown: tokensConsumed.filter(t => t.certainty === 'unknown').length,
          entries: tokenEntries,
        },
        unresolvedCount: graph.unresolved.length,
        unresolved: graph.unresolved,
      })
    })
  }
})
