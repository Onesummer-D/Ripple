import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, execSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyzeProject, resolveRenderedElement, readProjectSnapshot } from '../src/core/project.ts'
import { assertCandidateCurrent, createCandidate, removeCandidate } from '../src/core/candidate.ts'
import { applyApprovedCandidate, rollbackAppliedCandidate } from '../src/core/apply.ts'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate } from '../src/core/session.ts'

const projectRoot = path.resolve(process.argv[2] ?? '')
const workRoot = path.resolve(process.argv[3] ?? '')
if (!process.argv[2] || !process.argv[3]) throw new Error('Usage: node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs scripts/bolt-integration-acceptance.mjs <Bolt-project-root> <Ripple-work-root-outside-project>')
process.env.PLAYWRIGHT_BROWSERS_PATH ??= path.join(workRoot, 'playwright-browsers')
const { chromium } = await import('@playwright/test')
const projectRealPath = fs.realpathSync(projectRoot)
let existingWorkParent = workRoot
while (!fs.existsSync(existingWorkParent)) existingWorkParent = path.dirname(existingWorkParent)
const physicalWorkRoot = path.join(fs.realpathSync(existingWorkParent), path.relative(existingWorkParent, workRoot))
const relativeWorkRoot = path.relative(projectRealPath, physicalWorkRoot)
if (!relativeWorkRoot || (!relativeWorkRoot.startsWith(`..${path.sep}`) && relativeWorkRoot !== '..' && !path.isAbsolute(relativeWorkRoot))) {
  throw new Error('验收 work root 必须位于真实 Bolt 项目目录之外')
}

const id = `bolt-${Date.now()}`
const worktreesRoot = path.join(workRoot, 'worktrees')
const artifactRoot = path.join(workRoot, 'artifacts', id)
const candidateRoot = path.join(worktreesRoot, `${id}-candidate`)
const baselineRoot = path.join(worktreesRoot, `${id}-baseline`)
const originalRevision = readProjectSnapshot(projectRoot).revision

let candidate
let baselineCreated = false
let graph
let operations
let scope
let headlineElement
let ctaNode
const servers = []
let browser
try {
  fs.mkdirSync(worktreesRoot, { recursive: true })
  fs.mkdirSync(artifactRoot, { recursive: true })
  execFileSync('git', ['-c', 'core.autocrlf=false', '-C', projectRoot, 'worktree', 'add', '--detach', baselineRoot, originalRevision.gitCommit], { stdio: 'inherit' })
  baselineCreated = true
  const baselineRevision = readProjectSnapshot(baselineRoot).revision
  assert.equal(baselineRevision.sourceDigest, originalRevision.sourceDigest, 'disposable Bolt baseline must match the real checkout bytes')
  graph = analyzeProject(baselineRoot)
  headlineElement = graph.nodes.find(node => node.kind === 'dom-instance' && node.label === '<h1>' && node.location?.path === 'src/pages/HomePage.tsx')
  assert.ok(headlineElement, 'Bolt home page H1 must map to src/pages/HomePage.tsx')
  const headline = resolveRenderedElement(graph, headlineElement.id).editableText.find(node => node.label.includes('山野之间，器以新生'))
  assert.ok(headline?.value, 'Bolt hero headline must be an editable source literal')
  ctaNode = graph.nodes.find(node => node.kind === 'dom-instance' && node.label === '<button>' && node.location?.path === 'src/pages/HomePage.tsx' &&
    resolveRenderedElement(graph, node.id).editableText.some(text => text.label === '浏览器物'))
  assert.ok(ctaNode, 'Bolt primary CTA must map to a source element')
  const cta = resolveRenderedElement(graph, ctaNode.id).editableText.find(node => node.label === '浏览器物')
  assert.ok(cta?.value, 'Bolt primary CTA label must be an editable source literal')
  operations = [
    { id: `${id}-headline`, kind: 'TEXT', targetRef: headline.id, before: headline.value, after: headline.value.replace('山野之间，器以新生', '山野之间，器以新生 · 候选预演') },
    { id: `${id}-cta`, kind: 'TEXT', targetRef: cta.id, before: cta.value, after: cta.value.replace('浏览器物', '探索器物') },
  ]
  scope = {
    id: `${id}-home-local`, version: 1,
    includedRefs: ['page:home', ...operations.map(operation => operation.targetRef)],
    excludedRefs: ['page:autumn', 'page:products', 'page:story'],
    protectedRefs: [], decidedBy: 'acceptance-user', decidedAt: new Date().toISOString(),
  }
  const session = recordSourceGraph(openSession(`${id}-session`, graph.revision, '只修改首页主标题和主按钮文案，保留青野网站现有视觉设计。', [headlineElement.id, ctaNode.id]), graph.id, graph.revision.sourceDigest)
  const scoped = chooseScope(session, scope)
  candidate = createCandidate({ projectRoot: baselineRoot, candidateRoot, artifactRoot, graph, scope, operations, candidateId: id })
  const staged = stageCandidate(scoped, candidate)
  assert.equal(staged.candidate?.operations.length, 2, 'one candidate must retain both text operations')

  for (const root of [baselineRoot, candidate.candidateRoot]) {
    execSync('npm ci --ignore-scripts --no-audit --no-fund', { cwd: root, stdio: 'inherit', windowsHide: true })
  }
  execSync('npm run build', { cwd: candidate.candidateRoot, stdio: 'inherit', windowsHide: true })

  async function reservePort() {
    const listener = net.createServer()
    await new Promise((resolve, reject) => { listener.once('error', reject); listener.listen(0, '127.0.0.1', resolve) })
    const address = listener.address()
    assert.ok(address && typeof address === 'object')
    await new Promise((resolve, reject) => listener.close(error => error ? reject(error) : resolve()))
    return address.port
  }

  async function startProjectServer(root, instrument) {
    const port = await reservePort()
    const args = [path.join(root, 'node_modules', 'vite', 'bin', 'vite.js')]
    if (instrument) {
      const sidecar = path.join(artifactRoot, `${id}-instrumented-vite-config.mjs`)
      const configUrl = pathToFileURL(path.join(root, 'vite.config.ts')).href
      const pluginUrl = pathToFileURL(fileURLToPath(new URL('../src/core/source-annotation.ts', import.meta.url))).href
      const viteEntry = pathToFileURL(path.join(root, 'node_modules', 'vite', 'index.cjs')).href
      fs.writeFileSync(sidecar, `import viteApi from ${JSON.stringify(viteEntry)};\nimport siteConfig from ${JSON.stringify(configUrl)};\nimport { sourceAnnotationPlugin } from ${JSON.stringify(pluginUrl)};\nconst { mergeConfig } = viteApi;\nexport default async (env) => { const base = typeof siteConfig === 'function' ? await siteConfig(env) : siteConfig; const merged = mergeConfig(base, {}); return { ...merged, plugins: [sourceAnnotationPlugin(${JSON.stringify(root)}), ...(merged.plugins ?? [])] }; };\n`)
      args.push('--config', sidecar)
    }
    args.push('--host', '127.0.0.1', '--port', String(port), '--strictPort')
    const child = spawn(process.execPath, args, { cwd: root, stdio: ['ignore', 'pipe', 'pipe'], windowsHide: true })
    let output = ''
    let spawnError
    child.on('error', error => { spawnError = error })
    child.stdout.setEncoding('utf8').on('data', chunk => { output = `${output}${chunk}`.slice(-12000) })
    child.stderr.setEncoding('utf8').on('data', chunk => { output = `${output}${chunk}`.slice(-12000) })
    servers.push(child)
    const url = `http://127.0.0.1:${port}/`
    const deadline = Date.now() + 30000
    while (Date.now() < deadline) {
      if (spawnError) throw spawnError
      if (child.exitCode !== null || child.signalCode !== null) throw new Error(`候选站点 Vite 已退出：${child.exitCode ?? child.signalCode}\n${output}`)
      try {
        const response = await fetch(url, { signal: AbortSignal.timeout(1_000) })
        if (response.ok) { console.log(`Vite ready root=${root} url=${url}`); return url }
      } catch { /* server is not ready */ }
      await new Promise(resolve => setTimeout(resolve, 250))
    }
    throw new Error(`候选站点 Vite 未能在 30 秒内启动：${url}\n${output}`)
  }

  const baselineUrl = await startProjectServer(baselineRoot, false)
  const candidateUrl = await startProjectServer(candidate.candidateRoot, true)
  browser = await chromium.launch({ headless: true, timeout: 15_000 })
  const { PNG } = await import('pngjs')
  const pixelmatch = (await import('pixelmatch')).default
  const viewports = [{ width: 375, height: 812 }, { width: 768, height: 1024 }, { width: 1440, height: 900 }]
  const checks = []
  const evidence = []
  const verificationStartedAt = new Date().toISOString()
  for (const viewport of viewports) {
    const context = await browser.newContext({ viewport, colorScheme: 'light' })
    const baselinePage = await context.newPage()
    const candidatePage = await context.newPage()
    const errors = []
    candidatePage.on('pageerror', error => errors.push(error.message))
    candidatePage.on('console', message => { if (message.type() === 'error') errors.push(`console: ${message.text()}`) })
    candidatePage.setDefaultTimeout(12_000)
    console.log(`browser navigation viewport=${viewport.width}x${viewport.height}`)
    await baselinePage.goto(baselineUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await candidatePage.goto(candidateUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await candidatePage.addStyleTag({ content: '*{transition:none!important;scroll-behavior:auto!important}' })
    await baselinePage.addStyleTag({ content: '*{transition:none!important;scroll-behavior:auto!important}' })
    await Promise.all([baselinePage.locator('h1').first().waitFor(), candidatePage.locator('h1').first().waitFor()])
    console.log(`browser DOM ready viewport=${viewport.width}x${viewport.height}`)
    const settleImages = page => page.evaluate(() => Promise.race([
      Promise.all([...document.images].map(image => image.decode().catch(() => undefined))),
      new Promise(resolve => setTimeout(resolve, 2_000)),
    ]))
    await Promise.all([settleImages(baselinePage), settleImages(candidatePage)])
    const baselineHeading = await baselinePage.locator('h1').first().innerText()
    const candidateHeading = await candidatePage.locator('h1').first().innerText()
    assert.match(baselineHeading, /山野之间，器以新生/)
    assert.match(candidateHeading, /候选预演/)
    const selectedDomRef = await candidatePage.locator('h1').first().getAttribute('data-ripple-source')
    assert.equal(selectedDomRef, headlineElement.selector?.match(/"(.+)"/)?.[1], 'served DOM reference must resolve to analyzed source graph')
    assert.deepEqual(errors, [], `candidate browser page errors at ${viewport.width}px`)

    const baselinePath = path.join(artifactRoot, `baseline-${viewport.width}.png`)
    const candidatePath = path.join(artifactRoot, `candidate-${viewport.width}.png`)
    const diffPath = path.join(artifactRoot, `diff-${viewport.width}.png`)
    await baselinePage.screenshot({ path: baselinePath, fullPage: true, animations: 'disabled' })
    await candidatePage.screenshot({ path: candidatePath, fullPage: true, animations: 'disabled' })
    const baselinePng = PNG.sync.read(fs.readFileSync(baselinePath))
    const candidatePng = PNG.sync.read(fs.readFileSync(candidatePath))
    assert.equal(candidatePng.width, baselinePng.width)
    assert.equal(candidatePng.height, baselinePng.height)
    const diffData = Buffer.alloc(baselinePng.data.length)
    const diffPixels = pixelmatch(baselinePng.data, candidatePng.data, diffData, baselinePng.width, baselinePng.height, { threshold: 0.1, includeAA: false })
    fs.writeFileSync(diffPath, PNG.sync.write({ width: baselinePng.width, height: baselinePng.height, data: diffData }))
    assert.ok(diffPixels > 0, `candidate must produce a real visual difference at ${viewport.width}px`)

    const checkId = `${id}-home-${viewport.width}`
    const runtimeState = 'currentPage=home;dom-ready;transitions-disabled;finite-animations-finished-for-capture;page-errors=0'
    checks.push({ id: checkId, route: '/', viewport, state: runtimeState, description: '首页候选标题/CTA、源码标识和浏览器渲染', mandatory: true })
    evidence.push({ id: `evidence-${checkId}`, checkId, result: 'pass', capturedAt: new Date().toISOString(), pageUrl: candidateUrl, viewport,
      runtimeState, elementRefs: operations.map(operation => operation.targetRef), artifactPath: candidatePath,
      artifactHash: createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex') })
    await context.close()
    console.log(`PASS viewport=${viewport.width}x${viewport.height} diffPixels=${diffPixels}/${baselinePng.width * baselinePng.height}`)
  }

  assertCandidateCurrent(candidate)
  const finishedAt = new Date().toISOString()
  const run = registerVerification(staged, {
    id: `${id}-verification`, candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest,
    patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint: graph.revision.runtimeFingerprint, startedAt: verificationStartedAt, completedAt: finishedAt,
    checks, evidence, status: 'incomplete',
  })
  assert.equal(run.runs.at(-1)?.status, 'passed')
  const approved = approve(run, { candidateId: candidate.id, verificationRunId: run.runs.at(-1).id, by: 'acceptance-user', at: new Date().toISOString() })
  const appliedRevision = applyApprovedCandidate(approved, candidate)
  const appliedSession = recordAppliedRevision(approved, appliedRevision)
  assert.equal(readProjectSnapshot(baselineRoot, false).revision.sourceDigest, candidate.candidateTreeDigest, 'same approved patch must reach the disposable Bolt checkout')
  rollbackAppliedCandidate(appliedSession, candidate)
  assert.equal(readProjectSnapshot(baselineRoot).revision.sourceDigest, baselineRevision.sourceDigest, 'same patch must restore disposable Bolt checkout to its baseline')
  const originalCheckoutUnchanged = readProjectSnapshot(projectRoot).revision.sourceDigest === originalRevision.sourceDigest
  assert.ok(originalCheckoutUnchanged, 'real Bolt checkout must remain unchanged')
  const summary = {
    projectRoot: candidate.projectRoot,
    originalCheckoutUnchanged,
    disposableBoltPatchAppliedAndRolledBack: true,
    routes: graph.nodes.filter(node => node.kind === 'route').map(node => node.page),
    sharedComponents: graph.nodes.filter(node => node.kind === 'component' && (node.pages?.length ?? 0) > 1).map(node => ({ name: node.label, pages: node.pages })),
    tailwindTokenCount: graph.nodes.filter(node => node.kind === 'token').length,
    mediaSourceCount: graph.nodes.filter(node => node.kind === 'media').length,
    operations: candidate.operations,
    scope,
    candidate: { id: candidate.id, baseSourceDigest: candidate.baseSourceDigest, patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest },
    verification: approved.runs.at(-1),
    screenshots: evidence.map(item => item.artifactPath),
    visualDiffs: viewports.map(viewport => path.join(artifactRoot, `diff-${viewport.width}.png`)),
    applyState: 'same approved patch applied to and rolled back from a disposable Bolt worktree; original checkout unchanged',
  }
  fs.writeFileSync(path.join(artifactRoot, 'acceptance.json'), JSON.stringify(summary, null, 2))
  console.log(JSON.stringify(summary, null, 2))
} finally {
  if (browser) await browser.close()
  for (const server of servers.reverse()) {
    if (server.exitCode !== null) continue
    if (process.platform === 'win32' && server.pid) {
      try { execFileSync('taskkill', ['/PID', String(server.pid), '/T', '/F'], { stdio: 'ignore' }) } catch { server.kill('SIGTERM') }
    } else server.kill('SIGTERM')
  }
  if (candidate) removeCandidate(candidate)
  if (baselineCreated) execFileSync('git', ['-c', 'core.longpaths=true', '-C', projectRoot, 'worktree', 'remove', '--force', baselineRoot], { stdio: 'inherit' })
}
