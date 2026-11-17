import { createHash } from 'node:crypto'
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const here = path.dirname(fileURLToPath(import.meta.url))
const root = path.resolve(here, '../../../..')
const files = [
  'src/core/project.ts',
  'src/core/project-config-resolver.mjs',
  'src/core/project-config-resolver.d.mts',
  'src/core/page-overrides.ts',
  'src/core/frozen-project-snapshot.ts',
  'src/core/frozen-project-snapshot.test.ts',
  'src/core/graph-identity-v2-adapter.ts',
  'src/core/graph-identity-v2-adapter.test.ts',
  'src/core/frozen-source-snapshot.ts',
  'src/core/frozen-source-snapshot.test.ts',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/README.md',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/local-validation.json',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/replay.mjs',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-positive.mjs',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/generate-manifest.mjs',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-output/canonical-graph.json',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-output/mapping-diagnostics.json',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-output/report.json',
  'docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-output/sourcegraph.json',
]
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const entries = files.map(file => {
  const bytes = fs.readFileSync(path.join(root, file))
  return { path: file.replaceAll('\\', '/'), bytes: bytes.byteLength, sha256: sha256(bytes) }
})
const manifest = {
  manifestVersion: 'graph-identity-v2-frozen-adapter-evidence/v1',
  sourceBaseCommit: '30030cd10c4eefbd976749be1b2b5df800bbf200',
  requiredPrBase: {
    branch: 'e/frozen-source-snapshot-v1-20261117',
    commit: '667ed54d2999e8f6e3ebaa1012165144015a9894',
    tree: '5870a5aab017e90a51f1ca0e65fbd06844824309',
    note: 'E-owned FrozenSourceSnapshot module and tests are inherited unchanged from this base.'
  },
  graphDigestV2: {
    pureModuleCommit: '30030cd10c4eefbd976749be1b2b5df800bbf200',
    g0Digest: '4b061992d5b8d61732d1c9da093dd643523c9a841dd8a86d9feeeaedb6f1627b',
    unchanged: true
  },
  realSourceGraphFixture: {
    status: 'available-content-only',
    graphDigest: 'af9082ccb4a0f5e53eacf4d8c5febc83bdbf6ae7bfd27ecfd9b59b7d37be66fd',
    canonicalBytesSha256: 'c86a750686001efeca4f6992a5cf54e23d2f7d01a6d46415613fa6fb460f8b9b',
    sourceDigest: '47c12fc52842e2743d08ead6a9360b5721f3c11a487e63005d2948f4be6de0b4',
    nodes: 8,
    edges: 18,
    unresolved: 2,
    tokenUseCount: 2,
    acceptedMappings: 2,
    sourceTrust: 'content-only',
    hostProvenance: 'unverified'
  },
  localValidation: JSON.parse(fs.readFileSync(path.join(here, 'local-validation.json'), 'utf8')),
  files: entries
}
fs.writeFileSync(path.join(here, 'evidence-manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`)
