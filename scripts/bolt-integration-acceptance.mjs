import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { execFileSync, execSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as net from 'node:net'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { analyzeProject, resolveJsxSourceElement, readProjectSnapshot } from '../src/core/project.ts'
import { assertCandidateCurrent, createCandidate, removeCandidate } from '../src/core/candidate.ts'
import { applyApprovedCandidate, rollbackAppliedCandidate } from '../src/core/apply.ts'
import { approve, chooseScope, openSession, recordAppliedRevision, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from '../src/core/session.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'
import { attestBrowserExecution } from '../src/core/verification-receipt.ts'

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
let sharedCandidate
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
  headlineElement = graph.nodes.find(node => node.kind === 'jsx-element' && node.label === '<h1>' && node.location?.path === 'src/pages/HomePage.tsx')
  assert.ok(headlineElement, 'Bolt home page H1 must map to src/pages/HomePage.tsx')
  const headline = resolveJsxSourceElement(graph, headlineElement.id).editableText.find(node => node.label.includes('山野之间，器以新生'))
  assert.ok(headline?.value, 'Bolt hero headline must be an editable source literal')
  ctaNode = graph.nodes.find(node => node.kind === 'jsx-element' && node.label === '<button>' && node.location?.path === 'src/pages/HomePage.tsx' &&
    resolveJsxSourceElement(graph, node.id).editableText.some(text => text.label === '浏览器物'))
  assert.ok(ctaNode, 'Bolt primary CTA must map to a source element')
  const cta = resolveJsxSourceElement(graph, ctaNode.id).editableText.find(node => node.label === '浏览器物')
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
  for (const operation of operations) {
    const impact = sourceProvenPageImpact(graph, operation.targetRef)
    assert.deepEqual(impact.pageRefs, ['page:home'], 'local homepage edits must have only homepage consumers')
    assert.deepEqual(impact.unresolved, [], 'homepage edit impact must be fully source-proven')
  }
  const session = recordSourceGraph(openSession(`${id}-session`, graph.revision, '只修改首页主标题和主按钮文案，保留青野网站现有视觉设计。', [headlineElement.id, ctaNode.id]), graph.id, graph.revision.sourceDigest)
  const scoped = chooseScope(session, scope)
  candidate = createCandidate({ projectRoot: baselineRoot, candidateRoot, artifactRoot, graph, scope, operations, candidateId: id })
  const staged = stageCandidate(stageOperations(scoped, candidate.operations), candidate)
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
  const assertions = new Map()
  const recordAssertion = (id, detail) => assertions.set(id, { id, result: 'pass', detail })
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
    const baselineCta = baselinePage.getByRole('button', { name: '浏览器物', exact: true })
    const candidateCta = candidatePage.getByRole('button', { name: '探索器物', exact: true })
    assert.equal(await baselineCta.count(), 1)
    assert.equal(await candidateCta.count(), 1)
    const baselineHomeText = await baselinePage.locator('body').innerText()
    const candidateHomeText = await candidatePage.locator('body').innerText()
    assert.equal(candidateHomeText.replace(candidateHeading, baselineHeading).replace('探索器物', '浏览器物'), baselineHomeText, 'only the two explicit home text targets may change')
    const selectedDomRef = await candidatePage.locator('h1').first().getAttribute('data-ripple-source')
    assert.equal(selectedDomRef, headlineElement.selector?.match(/"(.+)"/)?.[1], 'served DOM reference must resolve to analyzed source graph')
    const renderedInstances = await candidatePage.locator('[data-ripple-source]').evaluateAll(elements => elements.map(element => ({ source: element.getAttribute('data-ripple-source'), instance: element.getAttribute('data-ripple-instance') })))
    assert.ok(renderedInstances.every(item => item.source && item.instance && item.source !== item.instance), 'source definition anchors and runtime instance ids must remain distinct')
    const instancesBySource = new Map()
    for (const item of renderedInstances) instancesBySource.set(item.source, [...(instancesBySource.get(item.source) ?? []), item.instance])
    const repeatedSources = [...instancesBySource.values()].filter(instances => instances.length > 1)
    assert.ok(repeatedSources.length > 0, 'homepage list must render at least one repeated JSX source instance')
    assert.ok(repeatedSources.every(instances => new Set(instances).size === instances.length), 'repeated JSX source renders must have distinct runtime instance ids')
    assert.deepEqual(errors, [], `candidate browser page errors at ${viewport.width}px`)
    const layout = await candidatePage.evaluate(() => {
      const heading = document.querySelector('h1')?.getBoundingClientRect()
      const cta = [...document.querySelectorAll('button')].find(button => button.textContent?.trim() === '探索器物')?.getBoundingClientRect()
      return { width: window.innerWidth, scrollWidth: document.documentElement.scrollWidth, headingBottom: heading?.bottom, ctaTop: cta?.top, ctaRight: cta?.right }
    })
    assert.ok(layout.scrollWidth <= layout.width, `no horizontal overflow at ${viewport.width}px`)
    assert.ok(layout.headingBottom !== undefined && layout.ctaTop !== undefined && layout.ctaTop >= layout.headingBottom - 1, `hero heading and action must retain vertical separation at ${viewport.width}px`)
    assert.ok(layout.ctaRight !== undefined && layout.ctaRight <= layout.width, `primary action must remain in viewport at ${viewport.width}px`)

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
    const checkId = `${id}-home-${viewport.width}`
    const runtimeState = 'currentPage=home;dom-ready;transitions-disabled;finite-animations-finished-for-capture;page-errors=0'
    checks.push({ id: checkId, route: '/', viewport, state: runtimeState, description: '首页候选标题/CTA、源码标识和浏览器渲染', mandatory: true })
    evidence.push({ id: `evidence-${checkId}`, checkId, result: 'pass', capturedAt: new Date().toISOString(), pageUrl: candidateUrl, viewport,
      runtimeState, elementRefs: operations.map(operation => operation.targetRef), artifactPath: candidatePath,
      artifactHash: createHash('sha256').update(fs.readFileSync(candidatePath)).digest('hex') })

    if (viewport.width >= 768) {
      for (const [label, pageTitle] of [['秋日手作节', '秋日手作节'], ['商品专题', '商品专题'], ['品牌故事', '品牌故事']]) {
        const baselineNavigation = baselinePage.getByRole('button', { name: label, exact: true }).first()
        const candidateNavigation = candidatePage.getByRole('button', { name: label, exact: true }).first()
        await Promise.all([baselineNavigation.click(), candidateNavigation.click()])
        await Promise.all([baselinePage.locator('main').waitFor(), candidatePage.locator('main').waitFor()])
        assert.equal(await candidatePage.locator('main').innerText(), await baselinePage.locator('main').innerText(), `non-target ${label} page must remain unchanged under home-only scope`)
        if (label === '商品专题') {
          const cards = candidatePage.locator('main img[alt]')
          assert.ok(await cards.count() >= 6, 'products interaction must render the existing product catalog')
          const productInstanceIds = await candidatePage.locator('main img[alt]').evaluateAll(elements => elements.map(element => element.getAttribute('data-ripple-instance')))
          assert.ok(productInstanceIds.every(Boolean) && new Set(productInstanceIds).size === productInstanceIds.length, 'repeated ProductCard render instances must be distinguishable in the real DOM')
        }
        await Promise.all([baselinePage.getByRole('button', { name: '首页', exact: true }).first().click(), candidatePage.getByRole('button', { name: '首页', exact: true }).first().click()])
      }
    } else {
      await Promise.all([baselineCta.click(), candidateCta.click()])
      assert.equal(await candidatePage.locator('main').innerText(), await baselinePage.locator('main').innerText(), 'the modified CTA must preserve navigation to the unchanged product page on mobile')
    }
    recordAssertion('target-change', 'candidate heading and primary action show exactly the requested text changes')
    recordAssertion('non-target-preserved', 'all remaining homepage text and desktop non-target pages match baseline')
    recordAssertion('scope-propagation', 'source-proven home-only impact excludes autumn, products and story; their browser output is unchanged')
    recordAssertion('interaction', 'the edited primary action still opens the existing product catalog')
    recordAssertion('responsive-layout', `${viewport.width}x${viewport.height} has no horizontal overflow and preserves hero target geometry`)
    recordAssertion('source-mapping', 'JSX definition sourceRef resolves while repeated live DOM instances have distinct runtime IDs')
    recordAssertion('browser-errors', 'candidate page emitted no uncaught page errors or console errors')

    await context.close()
    console.log(`PASS viewport=${viewport.width}x${viewport.height} diffPixels=${diffPixels}/${baselinePng.width * baselinePng.height}`)
  }

  assertCandidateCurrent(candidate)
  const finishedAt = new Date().toISOString()
  const run = {
    id: `${id}-verification`, candidateId: candidate.id, baseSourceDigest: candidate.baseSourceDigest,
    patchHash: candidate.patchHash, candidateTreeDigest: candidate.candidateTreeDigest,
    runtimeFingerprint: graph.revision.runtimeFingerprint, startedAt: verificationStartedAt, completedAt: finishedAt,
    checks, assertions: [...assertions.values()], evidence, status: 'incomplete',
  }
  const executionRecordPath = path.join(artifactRoot, 'browser-execution.json')
  fs.writeFileSync(executionRecordPath, JSON.stringify({
    schemaVersion: 1, executor: 'playwright', completed: true, runId: run.id, candidateId: run.candidateId,
    baseSourceDigest: run.baseSourceDigest, patchHash: run.patchHash, candidateTreeDigest: run.candidateTreeDigest,
    runtimeFingerprint: run.runtimeFingerprint,
    checks: run.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: true })),
    assertions: run.assertions,
    evidence: run.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath) })),
    artifacts: run.evidence.filter(item => item.artifactPath && item.artifactHash).map(item => ({ checkId: item.checkId, path: path.relative(artifactRoot, item.artifactPath), sha256: item.artifactHash })),
  }, null, 2))
  const attestedRun = attestBrowserExecution(run, executionRecordPath)
  const registered = registerVerification(staged, attestedRun)
  assert.equal(registered.runs.at(-1)?.status, 'passed')
  const approved = approve(registered, { candidateId: candidate.id, verificationRunId: registered.runs.at(-1).id, by: 'acceptance-user', at: new Date().toISOString() })
  const appliedRevision = applyApprovedCandidate(approved, candidate)
  const appliedSession = recordAppliedRevision(approved, appliedRevision)
  assert.equal(readProjectSnapshot(baselineRoot, false).revision.sourceDigest, candidate.candidateTreeDigest, 'same approved patch must reach the disposable Bolt checkout')
  rollbackAppliedCandidate(appliedSession, candidate)
  assert.equal(readProjectSnapshot(baselineRoot).revision.sourceDigest, baselineRevision.sourceDigest, 'same patch must restore disposable Bolt checkout to its baseline')

  const sharedTarget = graph.nodes.find(node => node.kind === 'data' && node.location?.path === 'src/components/Footer.tsx' && node.label === '山野器物')
  assert.ok(sharedTarget?.value, 'shared-footer brand literal must resolve from the real Bolt source graph')
  const sharedImpact = sourceProvenPageImpact(graph, sharedTarget.id)
  const allPageRefs = graph.nodes.filter(node => node.kind === 'route').map(node => node.id).sort()
  assert.deepEqual(sharedImpact.pageRefs, allPageRefs, 'footer source must have proven consumers on every Bolt page')
  assert.deepEqual(sharedImpact.unresolved, [], 'shared footer page impact must be fully resolved')
  const sharedOperation = { id: `${id}-shared-footer`, kind: 'TEXT', targetRef: sharedTarget.id, before: sharedTarget.value, after: '山野器物 · 全站共享候选' }
  const sharedScope = {
    id: `${id}-all-pages`, version: 1, includedRefs: [...allPageRefs, sharedTarget.id], excludedRefs: [], protectedRefs: [],
    decidedBy: 'acceptance-user', decidedAt: new Date().toISOString(),
  }
  const sharedScoped = chooseScope(recordSourceGraph(openSession(`${id}-shared-session`, graph.revision, '将品牌页脚名称同步更新到所有页面。'), graph.id, graph.revision.sourceDigest), sharedScope)
  const sharedStaged = stageOperations(sharedScoped, [sharedOperation])
  sharedCandidate = createCandidate({ projectRoot: baselineRoot, candidateRoot: path.join(worktreesRoot, `${id}-shared-candidate`), artifactRoot, graph, scope: sharedScope, operations: [sharedOperation], candidateId: `${id}-shared` })
  const sharedCandidateSession = stageCandidate(sharedStaged, sharedCandidate)
  execSync('npm ci --ignore-scripts --no-audit --no-fund', { cwd: sharedCandidate.candidateRoot, stdio: 'inherit', windowsHide: true })
  const sharedUrl = await startProjectServer(sharedCandidate.candidateRoot, true)
  const sharedContext = await browser.newContext({ viewport: { width: 1440, height: 900 }, colorScheme: 'light' })
  const sharedBaselinePage = await sharedContext.newPage()
  const sharedCandidatePage = await sharedContext.newPage()
  const sharedBrowserErrors = []
  sharedCandidatePage.on('pageerror', error => sharedBrowserErrors.push(error.message))
  sharedCandidatePage.on('console', message => { if (message.type() === 'error') sharedBrowserErrors.push(`console: ${message.text()}`) })
  const sharedStartedAt = new Date().toISOString()
  const sharedChecks = []
  const sharedEvidence = []
  const pageLabels = [['home', '首页'], ['autumn', '秋日手作节'], ['products', '商品专题'], ['story', '品牌故事']]
  const sharedSourceElement = graph.nodes.find(node => node.kind === 'jsx-element' && node.location?.path === 'src/components/Footer.tsx' && resolveJsxSourceElement(graph, node.id).editableText.some(text => text.id === sharedTarget.id))
  assert.ok(sharedSourceElement, 'shared-footer runtime element must map back to its JSX source definition')
  for (const [pageId, label] of pageLabels) {
    await sharedBaselinePage.goto(baselineUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await sharedCandidatePage.goto(sharedUrl, { waitUntil: 'domcontentloaded', timeout: 20_000 })
    await Promise.all([sharedBaselinePage.locator('footer').waitFor(), sharedCandidatePage.locator('footer').waitFor()])
    if (pageId !== 'home') {
      await Promise.all([
        sharedBaselinePage.locator('header').getByRole('button', { name: label, exact: true }).first().click(),
        sharedCandidatePage.locator('header').getByRole('button', { name: label, exact: true }).first().click(),
      ])
    }
    const oldFooter = await sharedBaselinePage.locator('footer').innerText()
    const newFooter = await sharedCandidatePage.locator('footer').innerText()
    assert.ok(oldFooter.includes('山野器物'))
    assert.ok(newFooter.includes(sharedOperation.after), `shared footer edit must appear on /${pageId}`)
    assert.equal(newFooter.split(sharedOperation.after).join(sharedTarget.value), oldFooter, `only the shared footer source changes on /${pageId}`)
    assert.equal((await sharedCandidatePage.locator('main').innerText()), (await sharedBaselinePage.locator('main').innerText()), `page content outside the shared footer must remain unchanged on /${pageId}`)
    const runtimeElement = sharedCandidatePage.locator('footer span').filter({ hasText: sharedOperation.after }).first()
    assert.equal(await runtimeElement.getAttribute('data-ripple-source'), sharedSourceElement.selector?.match(/"(.+)"/)?.[1], 'shared runtime element must resolve to its source JSX anchor')
    const instanceId = await runtimeElement.getAttribute('data-ripple-instance')
    assert.ok(instanceId && instanceId !== sharedSourceElement.id, 'shared DOM node identity must stay distinct from the JSX definition anchor')
    const layout = await sharedCandidatePage.evaluate(() => ({ width: innerWidth, scrollWidth: document.documentElement.scrollWidth }))
    assert.ok(layout.scrollWidth <= layout.width, `shared scope must retain responsive page width on /${pageId}`)
    const checkId = `${id}-shared-${pageId}`
    const runtimeState = `currentPage=${pageId};dom-ready;shared-scope;browser-errors=0`
    const screenshotPath = path.join(artifactRoot, `shared-${pageId}.png`)
    await sharedCandidatePage.screenshot({ path: screenshotPath, fullPage: true, animations: 'disabled' })
    sharedChecks.push({ id: checkId, route: '/', viewport: { width: 1440, height: 900 }, state: runtimeState, description: `全站共享页脚 Source 在 ${pageId} 页面生效`, mandatory: true })
    sharedEvidence.push({ id: `evidence-${checkId}`, checkId, result: 'pass', capturedAt: new Date().toISOString(), pageUrl: sharedUrl, viewport: { width: 1440, height: 900 }, runtimeState, elementRefs: [sharedTarget.id], artifactPath: screenshotPath, artifactHash: createHash('sha256').update(fs.readFileSync(screenshotPath)).digest('hex') })
  }
  assert.deepEqual(sharedBrowserErrors, [], 'shared candidate must not emit page or console errors')
  await sharedContext.close()
  const sharedAssertions = [
    { id: 'target-change', result: 'pass', detail: 'the footer source target changed to the requested shared value on all pages' },
    { id: 'non-target-preserved', result: 'pass', detail: 'main content and all footer text other than the selected source match baseline' },
    { id: 'scope-propagation', result: 'pass', detail: `all source-proven consumers changed: ${allPageRefs.join(', ')}` },
    { id: 'interaction', result: 'pass', detail: 'navigation remained functional across home, autumn, products and story states' },
    { id: 'responsive-layout', result: 'pass', detail: 'no horizontal overflow on all four shared-scope pages at 1440px' },
    { id: 'source-mapping', result: 'pass', detail: 'runtime footer source marker matched the JSX definition and had a separate instance id' },
    { id: 'browser-errors', result: 'pass', detail: 'shared candidate emitted no uncaught browser or console errors' },
  ]
  const sharedRun = {
    id: `${id}-shared-verification`, candidateId: sharedCandidate.id, baseSourceDigest: sharedCandidate.baseSourceDigest,
    patchHash: sharedCandidate.patchHash, candidateTreeDigest: sharedCandidate.candidateTreeDigest, runtimeFingerprint: graph.revision.runtimeFingerprint,
    startedAt: sharedStartedAt, completedAt: new Date().toISOString(), checks: sharedChecks, assertions: sharedAssertions, evidence: sharedEvidence, status: 'incomplete',
  }
  const sharedRecordPath = path.join(artifactRoot, 'shared-browser-execution.json')
  fs.writeFileSync(sharedRecordPath, JSON.stringify({
    schemaVersion: 1, executor: 'playwright', completed: true, runId: sharedRun.id, candidateId: sharedRun.candidateId,
    baseSourceDigest: sharedRun.baseSourceDigest, patchHash: sharedRun.patchHash, candidateTreeDigest: sharedRun.candidateTreeDigest,
    runtimeFingerprint: sharedRun.runtimeFingerprint,
    checks: sharedRun.checks.map(check => ({ id: check.id, route: check.route, viewport: check.viewport, state: check.state, passed: true })),
    assertions: sharedRun.assertions,
    evidence: sharedRun.evidence.map(item => ({ ...item, artifactPath: path.basename(item.artifactPath) })),
    artifacts: sharedRun.evidence.map(item => ({ checkId: item.checkId, path: path.relative(artifactRoot, item.artifactPath), sha256: item.artifactHash })),
  }, null, 2))
  const attestedShared = attestBrowserExecution(sharedRun, sharedRecordPath)
  const sharedRegistered = registerVerification(sharedCandidateSession, attestedShared)
  assert.equal(sharedRegistered.runs.at(-1)?.status, 'passed', 'shared Scope must pass only after all page checks and screenshots are attested')
  assertCandidateCurrent(sharedCandidate)

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
    sharedScope,
    sharedCandidate: { id: sharedCandidate.id, patchHash: sharedCandidate.patchHash, candidateTreeDigest: sharedCandidate.candidateTreeDigest },
    sharedVerification: sharedRegistered.runs.at(-1),
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
  if (sharedCandidate) removeCandidate(sharedCandidate)
  if (baselineCreated) execFileSync('git', ['-c', 'core.longpaths=true', '-C', projectRoot, 'worktree', 'remove', '--force', baselineRoot], { stdio: 'inherit' })
}
