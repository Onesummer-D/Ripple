import fs from 'node:fs'
import path from 'node:path'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { captureFrozenSourceSnapshot } from '../../../../src/core/frozen-project-snapshot.ts'
import { analyzeProject } from '../../../../src/core/project.ts'
import { adaptSourceGraph } from '../../../../src/core/graph-identity-v2-adapter.ts'

const workRoot = fs.realpathSync(process.cwd())
const outputRoot = path.resolve('docs/acceptance/2026-11-17/graph-identity-v2-frozen-adapter/real-sourcegraph-output')
fs.mkdirSync(outputRoot, { recursive: true })
const root = fs.mkdtempSync(path.join(workRoot, '.phase1b-sourcegraph-fixture-'))
if (path.dirname(root) !== workRoot || !path.basename(root).startsWith('.phase1b-sourcegraph-fixture-')) throw new Error('Unsafe fixture path')

const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')
const git = (...args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 }).trim()
try {
  fs.writeFileSync(path.join(root, 'App.tsx'), 'import "./theme.css"; export function App(){return <h1 className="title">Frozen 中文</h1>}')
  fs.writeFileSync(path.join(root, 'theme.css'), '/* 中文 😀 � */\r\n:root{--accent:#456}.title{color:var(--accent);background:var(--accent)}')
  git('init')
  git('config', 'user.email', 'test@example.invalid')
  git('config', 'user.name', 'Frozen Snapshot Fixture')
  git('config', 'core.autocrlf', 'false')
  git('add', '.')
  git('commit', '-m', 'frozen-sourcegraph fixture')

  const snapshot = captureFrozenSourceSnapshot(root)
  const graph = analyzeProject(snapshot)
  const registry = { projectId: 'test-only:real-sourcegraph-fixture', repository: 'local-fixture', head: snapshot.gitHead, rootTree: snapshot.rootTree, sourceDigest: snapshot.sourceDigest }
  const adapted = adaptSourceGraph({ graph, snapshot, registry })
  fs.writeFileSync(path.join(outputRoot, 'sourcegraph.json'), `${JSON.stringify(graph, null, 2)}\n`)
  fs.writeFileSync(path.join(outputRoot, 'mapping-diagnostics.json'), `${JSON.stringify(adapted.diagnostics, null, 2)}\n`)
  if (adapted.status !== 'available-content-only') throw new Error(`Expected content-only result, got ${JSON.stringify(adapted)}`)
  fs.writeFileSync(path.join(outputRoot, 'canonical-graph.json'), adapted.result.canonicalBytes)
  const report = {
    status: adapted.status,
    graphDigest: adapted.result.digest,
    canonicalBytesSha256: adapted.result.canonicalBytesSha256,
    sourceDigest: snapshot.sourceDigest,
    gitHead: snapshot.gitHead,
    rootTree: snapshot.rootTree,
    trackedFiles: snapshot.trackedFiles,
    graph: { nodes: graph.nodes.length, edges: graph.edges.length, unresolved: graph.unresolved.length },
    tokenUseCount: graph.nodes.filter(node => node.kind === 'token-use').length,
    mappingCount: adapted.result.canonical.sourceMappings.length,
    acceptedMappings: adapted.diagnostics.filter(item => item.decision === 'accepted').length,
    sourceTrust: adapted.result.sourceTrust,
    hostProvenance: adapted.hostProvenance,
    registryBinding: adapted.registryBinding,
    artifacts: Object.fromEntries(fs.readdirSync(outputRoot).filter(name => name.endsWith('.json') && name !== 'report.json').map(name => [name, sha256(fs.readFileSync(path.join(outputRoot, name)))])),
  }
  fs.writeFileSync(path.join(outputRoot, 'report.json'), `${JSON.stringify(report, null, 2)}\n`)
  console.log(JSON.stringify(report, null, 2))
} finally {
  const resolved = path.resolve(root)
  if (path.dirname(resolved) !== workRoot || !path.basename(resolved).startsWith('.phase1b-sourcegraph-fixture-')) throw new Error('Refusing to remove unexpected fixture path')
  fs.rmSync(resolved, { recursive: true, force: true })
}
