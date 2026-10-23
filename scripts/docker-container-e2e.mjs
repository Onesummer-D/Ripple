// Docker container end-to-end: container CAPTURES, host ANALYSES.
//
// Runs INSIDE mcr.microsoft.com/playwright:v1.64.0-noble as plain ESM (the
// container Node has no TypeScript transform). Serves an annotated
// baseline/candidate page pair, drives the REAL formal runner path
// (verification-execution.mjs -> visual-capture-executor.mjs), and writes
//
//   /out/manifest.json          the full execution manifest (visualCaptures)
//   /out/evidence/              artifact tree referenced by the manifest
//   /out/container-summary.json hash self-check results (container side)
//
// Every manifest-recorded artifact path is re-read from disk and its SHA-256
// re-computed here, so the host can trust the bindings without re-validating
// container internals. Exits non-zero on any mismatch.
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as http from 'node:http'
// NODE_PATH is honoured by the CJS resolver only, so pull playwright in via
// createRequire (the container installs it under /pw/node_modules).
const require = createRequire('/pw/entry.js')
const { chromium } = require('playwright')
import { executeVerification } from '../src/core/verification-execution.mjs'

const CANDIDATE_HOST = '127.0.0.24'
const BASELINE_HOST = '127.0.0.25'
const OUT = process.env.DOCKER_E2E_OUT ?? '/out'
const RUNTIME = 'docker-e2e-runtime/chromium'
const sha = value => createHash('sha256').update(value).digest('hex')
const BASE_DIGEST = sha('docker-e2e-base')
const TREE_DIGEST = sha('docker-e2e-tree')
const PATCH = sha('docker-e2e-patch')

const page = (brand) => `<!doctype html><html><head><meta charset="utf-8"><style>body{font-family:system-ui,sans-serif;margin:0}main{padding:24px}</style></head><body>
  <div id="root"><main data-ripple-source="src/App.tsx#main" data-ripple-instance="App" data-ripple-identity-certainty="stable-react-instance">
    <h1 data-ripple-source="src/App.tsx#h1" data-ripple-instance="App/h1" data-ripple-identity-certainty="stable-react-instance">${brand}</h1>
  </main></div></body></html>`

const input = {
  runId: 'run-docker-e2e', candidateId: 'candidate-docker-1', scopeDecisionId: 'scope-docker-1', scopeVersion: 1,
  baseSourceDigest: BASE_DIGEST, patchHash: PATCH, candidateTreeDigest: TREE_DIGEST, runtimeFingerprint: RUNTIME,
  verificationContractHash: 'contract',
  viewports: [{ name: 'desktop', width: 900, height: 700 }],
  previewHost: CANDIDATE_HOST, baselineHost: BASELINE_HOST,
  targetBindings: [], baselineComparisonPageRef: 'page:home', routeRefs: ['page:home'],
  operations: [], scopeTargetPageRefs: {}, verificationContract: { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Home page' }], interactions: [] },
  resourceSnapshots: [], unavailableResources: [],
}

const servers = []
async function serve(host, brand) {
  const server = http.createServer((_request, response) => {
    response.setHeader('content-type', 'text/html; charset=utf-8')
    response.end(page(brand))
  })
  await new Promise((resolve, reject) => { server.once('error', reject); server.listen(5173, host, resolve) })
  servers.push(server)
}

function checkCapture(entry, evidenceRoot) {
  const problems = []
  if (entry.baseline?.failure || entry.candidate?.failure) problems.push(`capture recorded failure: ${entry.baseline?.failure ?? entry.candidate?.failure}`)
  for (const side of ['baseline', 'candidate']) {
    for (const kind of ['screenshot', 'geometry']) {
      const ref = entry[side]?.[kind]
      if (!ref) { problems.push(`${side}.${kind} missing from manifest`); continue }
      if (!/^visual\/[a-z0-9-]{1,32}\/(baseline|candidate)(\.png|-geometry\.json)$/.test(ref.path)) {
        problems.push(`${side}.${kind} path violates the host whitelist: ${ref.path}`)
      }
      const absolute = `${evidenceRoot}/${ref.path}`
      if (!fs.existsSync(absolute)) { problems.push(`${side}.${kind} artifact absent: ${absolute}`); continue }
      const bytes = fs.readFileSync(absolute)
      if (sha(bytes) !== ref.sha256) problems.push(`${side}.${kind} sha256 mismatch: manifest=${ref.sha256} actual=${sha(bytes)}`)
    }
    const declared = entry[side]?.descriptor?.screenshot?.declaredSha256
    const recorded = entry[side]?.screenshot?.sha256
    if (declared !== recorded) problems.push(`${side} declaredSha256 != manifest sha256`)
    if (entry[side]?.descriptor?.capture?.stable !== true) problems.push(`${side} capture not measured stable`)
    if (entry[side]?.descriptor?.route !== '/') problems.push(`${side} route drifted: ${entry[side]?.descriptor?.route}`)
  }
  return problems
}

async function main() {
  fs.mkdirSync(OUT, { recursive: true })
  const evidenceRoot = `${OUT}/evidence`
  fs.rmSync(evidenceRoot, { recursive: true, force: true })
  fs.mkdirSync(evidenceRoot, { recursive: true })

  await serve(CANDIDATE_HOST, 'New brand')
  await serve(BASELINE_HOST, 'Old brand')
  const browser = await chromium.launch({ headless: true })

  const progressEvents = []
  const outcome = await executeVerification({ input, browser, evidenceRoot, progress: event => progressEvents.push(event) })
  await browser.close()
  await Promise.all(servers.map(server => new Promise(resolve => server.close(resolve))))

  const manifest = outcome.manifest
  fs.writeFileSync(`${OUT}/manifest.json`, `${JSON.stringify(manifest, null, 2)}\n`)

  const problems = []
  if (manifest.completed !== true) problems.push(`manifest.completed=${manifest.completed}`)
  if (!Array.isArray(manifest.visualCaptures)) problems.push('manifest.visualCaptures absent')
  if (manifest.visualCaptures?.length !== 1) problems.push(`expected 1 visual capture, got ${manifest.visualCaptures?.length}`)
  const entry = manifest.visualCaptures?.[0]
  if (entry) {
    if (entry.checkId !== 'run-docker-e2e-desktop') problems.push(`checkId=${entry.checkId}`)
    if (entry.route !== '/') problems.push(`route=${entry.route}`)
    if (entry.state !== 'rendered') problems.push(`state=${entry.state}`)
    if (entry.viewport?.width !== 900 || entry.viewport?.height !== 700) problems.push(`viewport=${JSON.stringify(entry.viewport)}`)
    problems.push(...checkCapture(entry, evidenceRoot))
  }

  const summary = {
    container: 'mcr.microsoft.com/playwright:v1.64.0-noble',
    node: process.version,
    platform: `${process.platform}/${process.arch}`,
    chromiumVersion: browser.version(),
    runId: manifest.runId,
    completed: manifest.completed,
    visualCaptures: manifest.visualCaptures?.length ?? 0,
    visualCaptureEntry: entry ? {
      checkId: entry.checkId, route: entry.route, state: entry.state,
      baselineArtifacts: [entry.baseline?.screenshot?.path, entry.baseline?.geometry?.path],
      candidateArtifacts: [entry.candidate?.screenshot?.path, entry.candidate?.geometry?.path],
      baselineStable: entry.baseline?.descriptor?.capture?.stable,
      candidateStable: entry.candidate?.descriptor?.capture?.stable,
    } : null,
    evidenceFiles: fs.readdirSync(`${evidenceRoot}/visual/desktop`).sort(),
    problems,
    ok: problems.length === 0,
  }
  fs.writeFileSync(`${OUT}/container-summary.json`, `${JSON.stringify(summary, null, 2)}\n`)
  console.log(JSON.stringify(summary, null, 2))
  process.exitCode = summary.ok ? 0 : 1
}

main().catch(error => {
  console.error('container e2e failed:', error)
  process.exitCode = 1
})
