/** Issue #6 — real "candidate accepted" positive case (v1).
 *
 *  The codescandy gate (scripts/b-thirdparty-candidate-gate.mjs) can only prove
 *  the CURRENT blocked state (rejection semantics). This script proves the
 *  candidate success contract end-to-end on a minimal, script-owned fixture
 *  project: real git repo, real analyzeProject graph, real createCandidate —
 *  no mocked record.
 *
 *  Fixture shape deliberately mirrors e2e/cd-data-router-footer-fixture
 *  (Component-based routes, no errorElement, no scss import, no dynamic
 *  params), so the TEXT target reaches certainty 'source-proven' on the
 *  current SourceGraph without any relaxation of Scope/Candidate gating.
 *
 *  Safety: EVERYTHING lives inside one mkdtemp root (prefix 'ripple-b-fix-').
 *  The only git repo created or mutated is the fixture inside that root; the
 *  candidate worktree is registered and removed from it; cleanup is in a
 *  finally and runs even on acceptance-verification failure. Nothing outside
 *  the temp root is touched.
 *
 *  Usage:
 *    node b-candidate-accepted-fixture.mjs [--artifacts <dir>]
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import { analyzeProject, digestTrackedTree } from '../src/core/project.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { createCandidate, CandidateError } from '../src/core/candidate.ts'

const argv = process.argv.slice(2)
const flagValue = (name) => { const at = argv.indexOf(name); return at >= 0 ? argv[at + 1] : undefined }
const artifactsDir = path.resolve(flagValue('--artifacts') ?? 'test-results')

const sha256hex = (buf) => createHash('sha256').update(buf).digest('hex')
const git = (root, args) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8' }).trim()

/** The ONLY directory this script may create/remove. */
const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-b-fix-'))
const tempRootReal = fs.realpathSync(tempRoot)
let cleanedUp = false
const sleepMs = (ms) => new Promise(r => setTimeout(r, ms))
const cleanup = async () => {
  if (cleanedUp) return
  cleanedUp = true
  if (path.basename(tempRootReal).startsWith('ripple-b-fix-') && tempRootReal !== path.dirname(tempRootReal)) {
    // Windows：git 对象文件只读 + git 子进程句柄未释放——先清属性，再带重试删除。
    const makeWritable = (target) => {
      let stat
      try { stat = fs.lstatSync(target) } catch { return }
      try { fs.chmodSync(target, 0o777) } catch { /* ignore */ }
      if (stat.isDirectory() && !stat.isSymbolicLink()) {
        for (const entry of fs.readdirSync(target)) makeWritable(path.join(target, entry))
      }
    }
    for (let i = 0; i < 10; i++) {
      try {
        makeWritable(tempRootReal)
        fs.rmSync(tempRootReal, { recursive: true, force: true, maxRetries: 3, retryDelay: 200 })
        return
      } catch { await sleepMs(400) }
    }
    console.error(`[fixture] WARN: could not remove temp root ${tempRootReal} after retries`)
  }
}

const ORIGINAL_TEXT = 'Hello Ripple'
const REPLACEMENT_TEXT = 'Hello Ripple B'

let result
try {
  // ---- 1. fixture project (script-owned, inside tempRoot only) ----
  const project = path.join(tempRoot, 'fixture-project')
  fs.mkdirSync(path.join(project, 'src', 'pages'), { recursive: true })
  fs.writeFileSync(path.join(project, 'package.json'), JSON.stringify({ name: 'ripple-b-accepted-fixture', private: true }, null, 2) + '\n')
  fs.writeFileSync(path.join(project, 'index.html'), '<!doctype html>\n<html><head><meta charset="utf-8"><title>fixture</title></head>\n<body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>\n')
  fs.writeFileSync(path.join(project, 'tsconfig.json'), '{"compilerOptions":{"jsx":"react-jsx","moduleResolution":"Bundler"},"include":["**/*.tsx","*.tsx","index.html"]}\n')
  fs.writeFileSync(path.join(project, 'src', 'main.tsx'), [
    "import { StrictMode } from 'react'",
    "import { createRoot } from 'react-dom/client'",
    "import { App } from './App'",
    '',
    "createRoot(document.getElementById('root')!).render(<StrictMode><App /></StrictMode>)",
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(project, 'src', 'App.tsx'), [
    "import { createBrowserRouter, RouterProvider } from 'react-router-dom'",
    "import { HomePage } from './pages/HomePage'",
    '',
    'const router = createBrowserRouter([',
    "  { path: '/', Component: HomePage },",
    '])',
    '',
    'export function App() {',
    '  return <RouterProvider router={router} />',
    '}',
    '',
  ].join('\n'))
  fs.writeFileSync(path.join(project, 'src', 'pages', 'HomePage.tsx'), [
    'export function HomePage() {',
    '  return <main>',
    `    <h1>${ORIGINAL_TEXT}</h1>`,
    '  </main>',
    '}',
    '',
  ].join('\n'))

  execFileSync('git', ['init', '--quiet', '--initial-branch=main', '--', project], { stdio: 'pipe' })
  execFileSync('git', ['-C', project, 'config', 'core.autocrlf', 'false'], { stdio: 'pipe' })
  execFileSync('git', ['-C', project, '-c', 'core.autocrlf=false', 'add', '-A'], { stdio: 'pipe' })
  execFileSync('git', ['-C', project, '-c', 'user.email=b-agent@ripple.local', '-c', 'user.name=Ripple B Agent', 'commit', '--quiet', '-m', 'fixture: data-router home page'], { stdio: 'pipe' })
  if (git(project, ['status', '--porcelain']) !== '') throw new Error('fixture repo is dirty after commit')

  // ---- 2. source proof: target must be source-proven with no unresolved ----
  const graph = analyzeProject(project, true)
  const target = graph.nodes.find(n =>
    n.kind === 'data' && n.value?.trim() === ORIGINAL_TEXT && n.location?.path === 'src/pages/HomePage.tsx')
  if (!target) throw new Error(`TEXT literal ${JSON.stringify(ORIGINAL_TEXT)} not found in fixture graph`)
  const impact = sourceProvenPageImpact(graph, target.id)
  if (impact.certainty !== 'source-proven' || impact.unresolved.length !== 0) {
    throw new Error(`fixture target is not source-proven: ${JSON.stringify(impact)}`)
  }

  // ---- 3. real candidate creation ----
  const candidateRoot = path.join(tempRoot, 'candidate-worktree')
  const artifactRoot = path.join(tempRoot, 'candidate-artifacts')
  let record = null
  let creationError = null
  try {
    record = createCandidate({
      projectRoot: project,
      candidateRoot,
      artifactRoot,
      graph,
      scope: {
        id: 'scope-accepted-fixture-1', version: 1, decidedBy: 'b-accepted-fixture', decidedAt: new Date().toISOString(),
        // shared scope 必须显式包含受影响页面，否则 candidate 以 fail-closed 拒绝
        strategy: 'shared', includedRefs: [target.id, ...impact.pageRefs], excludedRefs: [], protectedRefs: [],
      },
      operations: [{
        id: 'op-hello-text', kind: 'TEXT', targetRef: target.id,
        before: target.value, after: target.value.replace(ORIGINAL_TEXT, REPLACEMENT_TEXT),
      }],
      candidateId: 'b-accepted-fixture-1',
    })
  } catch (error) {
    creationError = error
  }

  // ---- 4. acceptance verification (BEFORE cleanup, on the real bytes) ----
  const verification = {}
  if (record) {
    const targetRel = target.location.path
    const patchPath = path.join(artifactRoot, `${record.id}.patch`)
    const patchBytes = fs.existsSync(patchPath) ? fs.readFileSync(patchPath) : Buffer.alloc(0)
    const marker = fs.existsSync(record.markerPath) ? JSON.parse(fs.readFileSync(record.markerPath, 'utf8')) : null
    const originalBytes = fs.readFileSync(path.join(project, targetRel), 'utf8')
    const candidateBytes = fs.existsSync(path.join(candidateRoot, targetRel)) ? fs.readFileSync(path.join(candidateRoot, targetRel), 'utf8') : ''
    const { start, end } = target.location
    const expectedCandidate = originalBytes.slice(0, start) + REPLACEMENT_TEXT + originalBytes.slice(end)
    verification.recordShapeOk = typeof record.id === 'string'
      && Array.isArray(record.modifiedPaths)
      && record.markerPath === path.join(candidateRoot, '.ripple-candidate.json')
    verification.modifiedTarget = record.modifiedPaths.includes(targetRel)
    verification.patchHashMatchesBytes = sha256hex(patchBytes) === record.patchHash
    verification.patchNotEmpty = patchBytes.length > 0
    verification.markerMatchesRecord = !!marker && marker.id === record.id && marker.baseSourceDigest === record.baseSourceDigest
    verification.candidateBytesExactEdit = candidateBytes === expectedCandidate
    verification.candidateHasReplacement = candidateBytes.includes(REPLACEMENT_TEXT) && !candidateBytes.includes(`<h1>${ORIGINAL_TEXT}</h1>`)
    verification.candidateTreeDigestMatches = digestTrackedTree(candidateRoot) === record.candidateTreeDigest
  }

  // ---- 5. finally-style release: remove the candidate worktree (and partial artifacts on failure) ----
  let removalError = null
  try {
    if (record) {
      execFileSync('git', ['-c', 'core.longpaths=true', '-C', project, 'worktree', 'remove', '--force', candidateRoot], { stdio: 'pipe' })
    }
    for (const dir of [candidateRoot, artifactRoot]) {
      if (fs.existsSync(dir)) fs.rmSync(dir, { recursive: true, force: true })
    }
  } catch (error) {
    removalError = error instanceof Error ? error.message : String(error)
  }

  const postChecks = {
    worktreeListEmpty: git(project, ['worktree', 'list', '--porcelain']).split('\n').filter(l => l.startsWith('worktree ')).length === 1,
    candidateDirRemoved: !fs.existsSync(candidateRoot),
    candidateArtifactsRemoved: !fs.existsSync(artifactRoot),
    fixtureProjectCleanAfterRemoval: git(project, ['status', '--porcelain']) === '',
  }

  const pass = !creationError && record !== null
    && Object.values(verification).every(v => v === true)
    && removalError === null
    && Object.values(postChecks).every(v => v === true)

  result = {
    schemaVersion: 1,
    mode: 'candidate-accepted-fixture',
    fixture: 'script-owned minimal data-router project (Component routes, no errorElement, no scss)',
    target: { id: target.id, path: target.location.path, value: JSON.stringify(target.value) },
    impact,
    creation: {
      created: record !== null,
      recordId: record?.id ?? null,
      errorName: creationError?.name ?? null,
      isCandidateError: creationError instanceof CandidateError,
      message: creationError?.message?.slice(0, 300) ?? null,
    },
    verification,
    removalError,
    postChecks,
    pass,
    note: '真实 createCandidate 成功正例：补丁字节、patchHash、marker、候选工作树精确编辑字节与树摘要全部核对通过，且无 worktree/工件残留。',
  }
} catch (error) {
  result = {
    schemaVersion: 1,
    mode: 'candidate-accepted-fixture',
    fatal: error instanceof Error ? error.message : String(error),
    pass: false,
  }
} finally {
  fs.mkdirSync(artifactsDir, { recursive: true })
  if (result) fs.writeFileSync(path.join(artifactsDir, 'candidate-accepted-fixture.json'), JSON.stringify(result, null, 2) + '\n')
  await cleanup()
}

console.log(JSON.stringify(result, null, 2))
process.exitCode = result && result.pass === false ? 1 : 0
