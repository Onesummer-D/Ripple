import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'

const root = process.cwd()
const dir = path.resolve(root, 'docs/acceptance/2026-11-04/relation-id-v03-production')
const git = args => execFileSync('git', args, { cwd: root, encoding: 'utf8' }).trim()
const sha256 = file => createHash('sha256').update(fs.readFileSync(path.resolve(root, file))).digest('hex')
const bytes = file => fs.statSync(path.resolve(root, file)).size
const implementationSha = git(['rev-parse', 'HEAD'])
const implementationTree = git(['rev-parse', 'HEAD^{tree}'])
const files = [
  'docs/acceptance/2026-11-04/relation-id-v03-production/README.md',
  'docs/acceptance/2026-11-04/relation-id-v03-production/generate-fb2-graph-report.mjs',
  'docs/acceptance/2026-11-04/relation-id-v03-production/validate-fb2-graph.mjs',
  'docs/acceptance/2026-11-04/relation-id-v03-production/generate-relation-id-v1-migration-fb2.mjs',
  'docs/acceptance/2026-11-04/relation-id-v03-production/graph-base-fb2.json',
  'docs/acceptance/2026-11-04/relation-id-v03-production/graph-final-fb2.json',
  'docs/acceptance/2026-11-04/relation-id-v03-production/relation-id-v03-fb2-graph-report.json',
  'docs/acceptance/2026-11-04/relation-id-v03-production/relation-id-v1-migration-manifest-fb2.json',
  'docs/acceptance/2026-11-04/relation-id-v03-production/vitest-full-fb2-windows.log',
  'docs/acceptance/2026-11-04/relation-id-v03-production/vitest-relation-id-fb2.log',
  'docs/acceptance/2026-11-04/relation-id-v03-production/vitest-project-targeted-fb2.log',
  'docs/acceptance/2026-11-04/relation-id-v03-production/typecheck-fb2.log',
  'docs/acceptance/2026-11-04/relation-id-v03-production/build-fb2.log',
]
const graph = JSON.parse(fs.readFileSync(path.join(dir, 'relation-id-v03-fb2-graph-report.json'), 'utf8'))
const migration = JSON.parse(fs.readFileSync(path.join(dir, 'relation-id-v1-migration-manifest-fb2.json'), 'utf8'))
const fullVitest = fs.readFileSync(path.join(dir, 'vitest-full-fb2-windows.log'), 'utf8')
const testLine = /Test Files\s+([^\n]+)\n\s+Tests\s+([^\n]+)\n\s+Errors\s+([^\n]+)/m.exec(fullVitest)
const out = {
  schemaVersion: 'relation-id-v03-fb2-production-evidence/v1',
  generatedFrom: { implementationSha, implementationTree },
  authorizedReviewBase: { sha: '6388abec96183cc28824dc2b7fa486e4e944d305', tree: '8455bfc0c6f2ff5491dad8a418c8b8a7bc78ba2e' },
  integrationBase: { sha: 'fb2efe35c447eadf262d55f1d9755bb26cecabda', tree: 'e942bf8d12e3c7224b79d673705fdc253c0cf552' },
  previousImplementation: { sha: '93d528fce7a329c3e35c62d013dfaa1675cfc3fa', tree: '75539ead0e895418e8ccca245c2808b587390353' },
  previousEvidenceArchive: '0387c359f4c4d4b34b22168fe611661a22c36d7d',
  fixedProject: { name: 'allanhue/webportflio', sha: 'b244f857457d2a07f118155602eef9097fd322bd', exactCheckout: false },
  graph: {
    baseArtifactSha256: graph.base.sha256,
    finalArtifactSha256: graph.final.sha256,
    nodes: graph.final.stats.nodes,
    edges: graph.final.stats.edges,
    unresolved: graph.final.stats.unresolved,
    duplicateRelationIdKeys: { base: graph.base.stats.duplicateRelationIdKeys, final: graph.final.stats.duplicateRelationIdKeys },
    extraOccurrences: { base: graph.base.stats.extraOccurrences, final: graph.final.stats.extraOccurrences },
    sourceProvenUnchanged: graph.sourceProven.equal,
    unresolvedUnchanged: graph.unresolved.unchanged,
    graphDigestStatus: 'unavailable',
  },
  migration: {
    artifactSha256: sha256('docs/acceptance/2026-11-04/relation-id-v03-production/relation-id-v1-migration-manifest-fb2.json'),
    oldGraphSha256: migration.generatedFrom.oldGraphSha256,
    totalOldOccurrences: migration.mappingStats.totalOldOccurrences,
    retained: migration.mappingStats.retained,
    renamed: migration.mappingStats.renamed,
    unresolved: migration.mappingStats.unresolved,
    missingMapping: migration.mappingStats.missingMapping,
    note: 'Migration unresolved (168) is an audit mapping metric and is distinct from SourceGraph unresolved (253).',
  },
  vitest: { summaryLine: testLine?.[0]?.trim() ?? null, rawLogSha256: sha256('docs/acceptance/2026-11-04/relation-id-v03-production/vitest-full-fb2-windows.log'), relationTargetedPassed: 27, projectTargetedPassed: 5 },
  unverified: ['exact fixed-project checkout', 'B v5 matcher/probe on f6d1edf', 'Linux CI', 'Docker/runtime smoke', 'Chromium E2E', 'remote Draft PR'],
  files: files.map(file => ({ path: file, bytes: bytes(file), sha256: sha256(file) })),
}
const outPath = path.join(dir, 'evidence-manifest-fb2.json')
fs.writeFileSync(outPath, `${JSON.stringify(out, null, 2)}\n`)
console.log(JSON.stringify({ out: path.relative(root, outPath).replaceAll('\\', '/'), implementationSha, implementationTree, fileCount: files.length }, null, 2))
