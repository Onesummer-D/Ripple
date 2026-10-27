/**
 * B Agent: independent computed-style truth for webportflio CSS Token AC-P6.
 *
 * This is deliberately outside Ripple's Candidate/Approval pipeline. It runs
 * two isolated copies of a fixed, clean third-party checkout, changes exactly
 * one scoped declaration in the candidate, and records browser-observed
 * computed styles for the four contractual viewports.
 *
 * Exit codes: 0 = all checks pass, 2 = completed with unknown/risk/failure
 * evidence, 1 = setup or execution error. The original checkout is never
 * modified.
 */
import fs from 'node:fs'
import path from 'node:path'
import os from 'node:os'
import net from 'node:net'
import { spawn, spawnSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { chromium } from '@playwright/test'

const TARGET_SHA = 'b244f857457d2a07f118155602eef9097fd322bd'
const TARGET_FILE = 'src/css/style.css'
const SOURCE_VALUE = '#e63946'
const CANDIDATE_VALUE = '#7c3aed'
const DARK_VALUE = '#ff5555'
const ROUTE_SENTINELS = {
  '/': '.home-container',
  '/about': '.about-section',
  '/experience': '.experience-item',
  '/projects': '.card',
  '/certifications': '.skills-grid',
  '/education': '.education-section',
  '/interests': '.interests-grid',
}
const VIEWPORTS = [
  { width: 1440, height: 900 },
  { width: 768, height: 1024 },
  { width: 375, height: 812 },
  { width: 390, height: 844 },
]

const args = process.argv.slice(2)
const projectRoot = path.resolve(args.find(arg => !arg.startsWith('--')) ?? '.')
const evidenceRoot = 'docs/probes/evidence/b-css-token-browser-baseline-20261025-review'
const jsonIndex = args.indexOf('--json')
if (jsonIndex >= 0 && (!args[jsonIndex + 1] || args[jsonIndex + 1].startsWith('--'))) throw new Error('--json requires an output path')
const jsonPath = path.resolve(jsonIndex >= 0 ? (args[jsonIndex + 1] ?? `${evidenceRoot}/report.json`) : `${evidenceRoot}/report.json`)
const artifactIndex = args.indexOf('--artifacts')
if (artifactIndex >= 0 && (!args[artifactIndex + 1] || args[artifactIndex + 1].startsWith('--'))) throw new Error('--artifacts requires a directory path')
const artifactRoot = path.resolve(artifactIndex >= 0 ? (args[artifactIndex + 1] ?? `${evidenceRoot}/screenshots`) : `${evidenceRoot}/screenshots`)

const sha256 = value => createHash('sha256').update(value).digest('hex')
const normalizeStyle = value => String(value ?? '').replace(/\s+/g, '').toLowerCase()
const viewportKey = viewport => `${viewport.width}x${viewport.height}`
const npmCommand = process.platform === 'win32' ? 'npm.cmd' : 'npm'

function git(root, command, allowFailure = false) {
  const result = spawnSync('git', ['-C', root, ...command], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0 && !allowFailure) throw new Error(`git ${command.join(' ')} failed: ${result.stderr || result.stdout}`)
  return (result.stdout ?? '').trim()
}

function assertFixedCheckout(root) {
  const head = git(root, ['rev-parse', 'HEAD'])
  if (head !== TARGET_SHA) throw new Error(`expected webportflio ${TARGET_SHA}, got ${head}`)
  if (git(root, ['status', '--porcelain', '--untracked-files=normal']) !== '') throw new Error('third-party checkout must be clean')
  const packageJson = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'))
  if (packageJson.scripts?.dev !== 'vite') throw new Error('fixed project does not expose the expected Vite dev script')
  const indexHtml = fs.readFileSync(path.join(root, 'index.html'), 'utf8')
  if (!/<script\b[^>]*\bsrc=["']\/src\/main\.jsx["']/i.test(indexHtml)) throw new Error('index.html does not serve the Vite src/main.jsx entry point')
  const appSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  if (!/\bHashRouter\b/.test(appSource)) throw new Error('src/App.jsx does not contain the expected HashRouter')
  const routePaths = [...appSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map(match => match[1])
  if (routePaths.length !== Object.keys(ROUTE_SENTINELS).length || routePaths.some(route => !(route in ROUTE_SENTINELS))) {
    throw new Error(`HashRouter route drift: expected ${Object.keys(ROUTE_SENTINELS).join(', ')}, received ${routePaths.join(', ')}`)
  }
  const file = path.join(root, TARGET_FILE)
  if (!fs.existsSync(file)) throw new Error(`missing ${TARGET_FILE}`)
  return {
    head,
    packageVersion: packageJson.version ?? null,
    sourceFileHash: sha256(fs.readFileSync(file)),
    entrypoint: '/src/main.jsx',
    routePaths,
    sourceHashes: Object.fromEntries(['index.html', 'src/main.jsx', 'src/App.jsx', TARGET_FILE].map(relative => [relative, sha256(fs.readFileSync(path.join(root, relative)))])),
  }
}

function copyCheckout(source, destination) {
  fs.cpSync(source, destination, {
    recursive: true,
    filter: candidate => {
      const normalized = candidate.replaceAll('\\', '/')
      return !normalized.endsWith('/node_modules') && !normalized.includes('/node_modules/')
    },
  })
  const dependencies = path.join(source, 'node_modules')
  const linkedDependencies = path.join(destination, 'node_modules')
  if (!fs.existsSync(dependencies)) throw new Error('fixed checkout has no installed node_modules; run npm ci first')
  try {
    fs.symlinkSync(dependencies, linkedDependencies, process.platform === 'win32' ? 'junction' : 'dir')
  } catch (error) {
    if (process.platform !== 'win32' || !['EPERM', 'EACCES'].includes(error?.code)) throw error
    const junction = spawnSync('cmd.exe', ['/d', '/c', `mklink /J "${linkedDependencies}" "${dependencies}"`], { windowsHide: true })
    if (junction.status === 0 && fs.existsSync(linkedDependencies)) return
    // Windows environments without Developer Mode cannot create junctions in
    // a sandbox. Copying the already-installed fixed dependency tree preserves
    // the same package bytes and keeps the two source copies isolated.
    fs.cpSync(dependencies, linkedDependencies, { recursive: true })
  }
}

function patchCandidate(root) {
  const file = path.join(root, TARGET_FILE)
  const before = fs.readFileSync(file, 'utf8')
  const pattern = /(\[data-theme="light"\]\s*\{[\s\S]*?--accent:\s*)#e63946(\s*;)/g
  const matches = [...before.matchAll(pattern)]
  if (matches.length !== 1) throw new Error(`expected one light-scope --accent declaration, found ${matches.length}`)
  const after = before.replace(pattern, `$1${CANDIDATE_VALUE}$2`)
  if (after === before || !after.includes(`${CANDIDATE_VALUE};`)) throw new Error('candidate declaration patch did not change the expected bytes')
  fs.writeFileSync(file, after, 'utf8')
  const changedFiles = git(root, ['diff', '--name-only']).split(/\r?\n/).filter(Boolean)
  if (changedFiles.length !== 1 || changedFiles[0] !== TARGET_FILE) throw new Error(`candidate changed unexpected files: ${changedFiles.join(', ')}`)
  git(root, ['diff', '--check'])
  return {
    file: TARGET_FILE,
    beforeValue: SOURCE_VALUE,
    afterValue: CANDIDATE_VALUE,
    beforeFileHash: sha256(before),
    afterFileHash: sha256(after),
    patch: git(root, ['diff', '--', TARGET_FILE]),
  }
}

function findFreePort() {
  return new Promise((resolve, reject) => {
    const server = net.createServer()
    server.once('error', reject)
    server.listen(0, '127.0.0.1', () => {
      const address = server.address()
      server.close(error => error ? reject(error) : resolve(address.port))
    })
  })
}

async function startVite(root, expectedLightAccent) {
  const port = await findFreePort()
  const logs = []
  const command = process.platform === 'win32'
    ? 'cmd.exe'
    : npmCommand
  const commandArgs = process.platform === 'win32'
    ? ['/d', '/s', '/c', `npm.cmd run dev -- --host 127.0.0.1 --port ${port} --strictPort`]
    : ['run', 'dev', '--', '--host', '127.0.0.1', '--port', String(port), '--strictPort']
  const child = spawn(command, commandArgs, {
    cwd: root,
    stdio: ['ignore', 'pipe', 'pipe'],
    windowsHide: true,
    detached: process.platform !== 'win32',
  })
  const collect = chunk => {
    logs.push(String(chunk))
    if (logs.length > 80) logs.shift()
  }
  child.stdout.on('data', collect)
  child.stderr.on('data', collect)
  const baseUrl = `http://127.0.0.1:${port}`
  const deadline = Date.now() + 30_000
  while (Date.now() < deadline) {
    if (child.exitCode !== null) throw new Error(`Vite exited before serving: ${logs.join('')}`)
    try {
      const response = await fetch(`${baseUrl}/`)
      if (response.ok) {
        const html = await response.text()
        if (!/<script\b[^>]*\bsrc=["']\/src\/main\.jsx["']/i.test(html)) throw new Error('Vite-served index does not reference /src/main.jsx')
        const moduleResponse = await fetch(`${baseUrl}/src/main.jsx`)
        if (!moduleResponse.ok) throw new Error(`Vite source entry returned HTTP ${moduleResponse.status}`)
        const moduleText = await moduleResponse.text()
        if (!moduleText.includes('App')) throw new Error('Vite source entry does not resolve the application module')
        const cssResponse = await fetch(`${baseUrl}/src/css/style.css`)
        if (!cssResponse.ok) throw new Error(`Vite source CSS returned HTTP ${cssResponse.status}`)
        const cssText = await cssResponse.text()
        if (!cssText.includes('--accent') || !cssText.includes(expectedLightAccent) || !cssText.includes(DARK_VALUE)) throw new Error(`Vite did not serve expected src/css/style.css source values (${expectedLightAccent}, ${DARK_VALUE})`)
        return {
          child,
          baseUrl,
          logs,
          sourceServing: {
            indexHttpStatus: response.status,
            entrypoint: '/src/main.jsx',
            entrypointHttpStatus: moduleResponse.status,
            entrypointSha256: sha256(moduleText),
            styleSource: '/src/css/style.css',
            styleSourceHttpStatus: cssResponse.status,
            styleSourceSha256: sha256(cssText),
            expectedLightAccent,
          },
        }
      }
    } catch {}
    await new Promise(resolve => setTimeout(resolve, 200))
  }
  stopVite(child)
  throw new Error(`timed out waiting for Vite: ${logs.join('')}`)
}

function stopVite(child) {
  if (process.platform === 'win32') {
    if (child.exitCode !== null) return
    spawnSync('taskkill', ['/pid', String(child.pid), '/t', '/f'], { windowsHide: true })
  } else {
    try {
      // npm run dev starts a shell and the Vite child. Kill their detached
      // process group so descendants cannot retain Node's piped stdio and
      // keep the browser job alive after its report has been written.
      process.kill(-child.pid, 'SIGTERM')
      const processGroupId = child.pid
      const hardStop = setTimeout(() => {
        try { process.kill(-processGroupId, 'SIGKILL') } catch {}
      }, 1_500)
      hardStop.unref()
    } catch {
      if (child.exitCode === null) child.kill('SIGTERM')
    }
  }
}

async function setTheme(page, target) {
  const current = await page.locator('html').getAttribute('data-theme')
  if (current === target) return { method: 'initial-state' }
  const toggle = page.locator('.theme-toggle').first()
  if (await toggle.count()) {
    await toggle.click()
    await page.locator('html[data-theme="' + target + '"]').waitFor({ state: 'attached', timeout: 3_000 })
    return { method: 'ui-toggle' }
  }
  await page.evaluate(theme => {
    document.documentElement.setAttribute('data-theme', theme)
    localStorage.setItem('portfolio-theme', theme)
  }, target)
  await page.waitForFunction(theme => document.documentElement.getAttribute('data-theme') === theme, target, { timeout: 3_000 })
  return { method: 'script-fallback' }
}

async function styleFor(page, selector, pseudo = null) {
  return page.evaluate(({ selector: query, pseudo: pseudoElement }) => {
    const elements = [...document.querySelectorAll(query)]
    if (!elements.length) return { selector: query, pseudo: pseudoElement, found: false, hostFound: false, count: 0, pseudoComputed: false, values: [], reason: 'host-element-not-rendered-on-route' }
    const values = elements.map(element => {
      const style = getComputedStyle(element, pseudoElement)
      const rect = element.getBoundingClientRect()
      return {
        tagName: element.tagName,
        text: element.innerText?.trim().slice(0, 120) ?? '',
        color: style.color,
        backgroundColor: style.backgroundColor,
        backgroundImage: style.backgroundImage,
        borderColor: style.borderColor,
        content: style.content,
        customProperty: style.getPropertyValue('--accent').trim(),
        accentColor: style.getPropertyValue('--accent-color').trim(),
        rect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
      }
    })
    return {
      selector: query,
      pseudo: pseudoElement,
      found: true,
      hostFound: true,
      count: elements.length,
      pseudoComputed: Boolean(pseudoElement),
      ...values[0],
      values,
    }
  }, { selector, pseudo })
}

async function hoverStyle(page, selector) {
  const locator = page.locator(selector)
  const count = await locator.count()
  if (!count) return { selector, found: false, reason: 'selector-not-found', values: [] }
  try {
    const values = []
    for (let index = 0; index < count; index++) {
      const target = locator.nth(index)
      if (!await target.isVisible()) {
        const menu = page.locator('.hamburger').first()
        if (await menu.count() && await menu.isVisible()) await menu.click()
      }
      await target.hover({ timeout: 3_000 })
      await page.waitForTimeout(600)
      values.push(await page.evaluate(({ query, targetIndex }) => {
        const element = [...document.querySelectorAll(query)][targetIndex]
        if (!element) return null
        const style = getComputedStyle(element)
        const rect = element.getBoundingClientRect()
        return {
          tagName: element.tagName,
          text: element.innerText?.trim().slice(0, 120) ?? '',
          color: style.color,
          backgroundColor: style.backgroundColor,
          backgroundImage: style.backgroundImage,
          borderColor: style.borderColor,
          accentColor: style.getPropertyValue('--accent-color').trim(),
          rect: { x: rect.x + window.scrollX, y: rect.y + window.scrollY, width: rect.width, height: rect.height },
        }
      }, { query: selector, targetIndex: index }))
    }
    return { selector, found: true, count, values, ...values[0], hovered: true, hoveredElementCount: count }
  } catch (error) {
    return { selector, found: false, count, reason: error instanceof Error ? error.message : String(error), values: [] }
  }
}

async function movePointerToNeutral(page) {
  const point = await page.evaluate(() => {
    const targets = ['.btn-primary', '.nav-link', '.skill-badge']
    const candidates = [
      [1, 1], [innerWidth - 2, 1], [1, innerHeight - 2], [innerWidth - 2, innerHeight - 2],
      [Math.floor(innerWidth / 2), 1], [Math.floor(innerWidth / 2), innerHeight - 2],
    ]
    return candidates.find(([x, y]) => {
      const element = document.elementFromPoint(x, y)
      return !element || !targets.some(selector => element.matches(selector) || element.closest(selector))
    }) ?? null
  })
  await page.mouse.move(point?.[0] ?? -1, point?.[1] ?? -1)
  const hoverRemains = await page.evaluate(() => ['.btn-primary', '.nav-link', '.skill-badge'].some(selector =>
    [...document.querySelectorAll(selector)].some(element => element.matches(':hover'))))
  if (hoverRemains) throw new Error('could not move the pointer away from style consumers before sampling')
}

async function capture(page, viewport, theme, method, revision, screenshotPath, browserErrors) {
  await movePointerToNeutral(page)
  const expectedButtonBackground = hexToRgb(expectedThemeAccent(theme, revision))
  let buttonTransitionSettled = true
  try {
    await page.waitForFunction(expected => {
      const button = document.querySelector('.btn-primary')
      return Boolean(button) && getComputedStyle(button).backgroundColor === expected
    }, expectedButtonBackground, { timeout: 5_000 })
  } catch {
    // Keep sampling the real computed value. The ordinary assertion below
    // reports a mismatch instead of converting a transition timeout to PASS.
    buttonTransitionSettled = false
  }
  const selectors = {
    sectionTitle: await styleFor(page, '.section-title'),
    nameHighlight: await styleFor(page, '.name-highlight'),
    primaryButton: await styleFor(page, '.btn-primary'),
    statIcon: await styleFor(page, '.stat-icon'),
    sectionTitleAfter: await styleFor(page, '.section-title', '::after'),
    nameHighlightAfter: await styleFor(page, '.name-highlight', '::after'),
    statCardBefore: await styleFor(page, '.stat-card', '::before'),
    navLinkHover: await hoverStyle(page, '.nav-link'),
    skillBadgeHover: await hoverStyle(page, '.skill-badge'),
  }
  await page.evaluate(() => window.scrollTo(0, 0))
  await page.waitForTimeout(100)
  await movePointerToNeutral(page)
  const layout = await page.evaluate(() => {
    const rect = selector => {
      const element = document.querySelector(selector)
      if (!element) return null
      const box = element.getBoundingClientRect()
      return { x: box.x, y: box.y, width: box.width, height: box.height }
    }
    return {
      documentWidth: document.documentElement.scrollWidth,
      viewportWidth: document.documentElement.clientWidth,
      bodyBackground: getComputedStyle(document.body).backgroundColor,
      accent: getComputedStyle(document.documentElement).getPropertyValue('--accent').trim(),
      accentSecondary: getComputedStyle(document.documentElement).getPropertyValue('--accent-secondary').trim(),
      rects: { sectionTitle: rect('.section-title'), primaryButton: rect('.btn-primary'), statIcon: rect('.stat-icon') },
    }
  })
  await page.screenshot({ path: screenshotPath, fullPage: true })
  return {
    theme,
    themeMethod: method,
    viewport,
    route: '#/',
    url: page.url(),
    transitionSettle: { selector: '.btn-primary', property: 'backgroundColor', expected: expectedButtonBackground, matchedBeforeCapture: buttonTransitionSettled },
    selectors,
    layout,
    browserErrors: [...browserErrors],
    screenshot: path.basename(screenshotPath),
  }
}

async function visitRoute(page, baseUrl, route) {
  const expectedHash = `#${route}`
  const baseOrigin = new URL(baseUrl).origin
  const currentOrigin = page.url() === 'about:blank' ? null : new URL(page.url()).origin
  if (currentOrigin !== baseOrigin) {
    await page.goto(`${baseUrl}/${expectedHash}`, { waitUntil: 'commit', timeout: 15_000 })
  } else {
    // Keep the browser in the same app document. HashRouter observes the real
    // location.hash change and renders the requested route without reloading
    // Vite for every census row.
    await page.evaluate(hash => {
      if (location.hash !== hash) location.hash = hash
    }, expectedHash)
  }
  const sentinel = ROUTE_SENTINELS[route]
  await page.locator('main').locator(sentinel).first().waitFor({ state: 'attached', timeout: 20_000 })
  const observed = await page.evaluate(() => ({ hash: location.hash, mainTextLength: document.querySelector('main')?.innerText.trim().length ?? 0 }))
  if (observed.hash !== expectedHash || observed.mainTextLength === 0) {
    throw new Error(`HashRouter route verification failed for ${route}: ${JSON.stringify(observed)}`)
  }
  return { route, hash: observed.hash, sentinel, mainTextLength: observed.mainTextLength, navigation: currentOrigin === baseOrigin ? 'hashrouter-location-hash' : 'initial-vite-document-load', verified: true }
}

function expectedThemeAccent(theme, revision) {
  if (theme === 'dark') return DARK_VALUE
  return revision === 'original' || revision === 'baseline' ? SOURCE_VALUE : CANDIDATE_VALUE
}

function hexToRgb(value) {
  const match = /^#([\da-f]{6})$/i.exec(value)
  if (!match) throw new Error(`unsupported expected color: ${value}`)
  const number = Number.parseInt(match[1], 16)
  return `rgb(${number >> 16}, ${(number >> 8) & 255}, ${number & 255})`
}

async function captureCopy(root, label, baseUrl, sourceServing, routePaths) {
  const browser = await chromium.launch({ headless: true })
  const runs = []
  const routeCensus = []
  const traceFiles = []
  try {
    for (const viewport of VIEWPORTS) {
      const context = await browser.newContext({ viewport })
      const tracePath = path.join(artifactRoot, `${label}-${viewportKey(viewport)}-playwright-trace.zip`)
      // Keep DOM snapshots and source files in traces for failure diagnosis.
      // The 16 full-page browser screenshots are saved separately below.
      await context.tracing.start({ screenshots: false, snapshots: true, sources: true })
      await context.route('https://fonts.googleapis.com/**', route => route.fulfill({ status: 200, contentType: 'text/css', body: '/* external font stylesheet isolated for deterministic color/layout sampling */' }))
      const page = await context.newPage()
      const browserErrors = []
      page.on('pageerror', error => browserErrors.push(`pageerror:${error.message}`))
      page.on('console', message => { if (message.type() === 'error') browserErrors.push(`console:${message.text()}`) })
      page.on('requestfailed', request => browserErrors.push(`requestfailed:${request.url()} ${request.failure()?.errorText ?? ''}`))
      let traceSaved = false
      try {
        await visitRoute(page, baseUrl, '/')
        await page.evaluate(() => localStorage.clear())
        await page.reload({ waitUntil: 'commit', timeout: 15_000 })
        await page.locator(ROUTE_SENTINELS['/']).waitFor({ state: 'attached', timeout: 20_000 })
        const darkMethod = await setTheme(page, 'dark')
        const dark = await capture(page, viewport, 'dark', darkMethod.method, label, path.join(artifactRoot, `${label}-dark-${viewportKey(viewport)}.png`), browserErrors)
        const lightMethod = await setTheme(page, 'light')
        const light = await capture(page, viewport, 'light', lightMethod.method, label, path.join(artifactRoot, `${label}-light-${viewportKey(viewport)}.png`), browserErrors)
        runs.push({ viewport, dark, light, sourceServing })

        for (const theme of ['dark', 'light']) {
          for (const route of routePaths) {
            const routeState = await visitRoute(page, baseUrl, route)
            const themeState = await setTheme(page, theme)
            for (const target of [
              { selector: '.section-title', pseudo: null, property: 'color' },
              { selector: '.section-title', pseudo: '::after', property: 'backgroundColor' },
            ]) {
              const sample = await styleFor(page, target.selector, target.pseudo)
              const actual = sample.found ? sample[target.property] ?? null : null
              const expected = expectedThemeAccent(theme, label)
              routeCensus.push({
                viewport,
                theme,
                revision: label === 'baseline' ? 'original' : 'manual-candidate',
                route: `#${route}`,
                routeVerification: routeState,
                themeControl: themeState.method,
                selector: target.pseudo ? `${target.selector}${target.pseudo}` : target.selector,
                property: target.property,
                expected,
                actual,
                status: sample.found ? (normalizeStyle(actual) === normalizeStyle(hexToRgb(expected)) ? 'pass' : 'fail') : 'unknown',
                hostFound: sample.found,
                pseudoComputedWithGetComputedStyle: Boolean(sample.found && sample.pseudoComputed),
                reason: sample.found ? null : sample.reason,
              })
            }
          }
        }
        await context.tracing.stop({ path: tracePath })
        traceSaved = true
        traceFiles.push(path.basename(tracePath))
        console.log(`browser viewport complete: revision=${label} viewport=${viewportKey(viewport)} routeSamples=${routeCensus.filter(row => row.viewport.width === viewport.width && row.viewport.height === viewport.height).length} trace=${path.basename(tracePath)}`)
      } catch (error) {
        try {
          await context.tracing.stop({ path: tracePath })
          traceSaved = true
          traceFiles.push(path.basename(tracePath))
        } catch (traceError) {
          error.message = `${error.message}; trace save failed: ${traceError instanceof Error ? traceError.message : String(traceError)}`
        }
        error.tracePath = traceSaved ? path.basename(tracePath) : null
        throw error
      } finally {
        if (!traceSaved) await context.tracing.stop().catch(() => {})
        await context.close()
      }
    }
  } finally {
    await browser.close()
  }
  return { runs, routeCensus, traceFiles }
}

function result(status, name, detail) {
  return { status: status === true ? 'pass' : status === false ? 'fail' : status, name, detail }
}
function value(run, key) { return run?.layout?.[key] ?? null }
function same(a, b) { return normalizeStyle(a) === normalizeStyle(b) }
function rectsSame(a, b) {
  if (!a || !b) return false
  return ['x', 'y', 'width', 'height'].every(key => Math.abs((a[key] ?? 0) - (b[key] ?? 0)) <= 1)
}

function compareRuns(baseline, candidate) {
  const checks = []
  const matrix = []
  const consumerTargets = [
    { name: 'section-title', selector: '.section-title', key: 'sectionTitle', property: 'color', behavior: 'accent' },
    { name: 'name-highlight', selector: '.name-highlight', key: 'nameHighlight', property: 'color', behavior: 'accent' },
    { name: 'btn-primary', selector: '.btn-primary', key: 'primaryButton', property: 'backgroundColor', behavior: 'accent' },
    { name: 'stat-icon', selector: '.stat-icon', key: 'statIcon', property: 'color', behavior: 'inline-fallback' },
    { name: 'section-title-after', selector: '.section-title::after', key: 'sectionTitleAfter', property: 'backgroundColor', behavior: 'accent', pseudo: '::after' },
    { name: 'name-highlight-after', selector: '.name-highlight::after', key: 'nameHighlightAfter', property: 'backgroundImage', behavior: 'accent', pseudo: '::after' },
    { name: 'stat-card-before', selector: '.stat-card::before', key: 'statCardBefore', property: 'backgroundColor', behavior: 'inline-fallback', pseudo: '::before' },
    { name: 'nav-link-hover', selector: '.nav-link:hover', key: 'navLinkHover', property: 'color', behavior: 'accent' },
    { name: 'skill-badge-hover', selector: '.skill-badge:hover', key: 'skillBadgeHover', property: 'backgroundColor', behavior: 'accent' },
  ]
  for (const viewport of VIEWPORTS) {
    const key = viewportKey(viewport)
    const base = baseline.find(run => viewportKey(run.viewport) === key)
    const cand = candidate.find(run => viewportKey(run.viewport) === key)
    for (const theme of ['dark', 'light']) {
      const original = base?.[theme]
      const manualCandidate = cand?.[theme]
      if (!original || !manualCandidate) {
        checks.push(result('unknown', `${theme}-${key}-capture`, 'missing original or manual-candidate capture'))
        continue
      }
      if (original.browserErrors.length || manualCandidate.browserErrors.length) checks.push(result('risk', `${theme}-${key}-browser-errors`, { original: original.browserErrors, manualCandidate: manualCandidate.browserErrors }))
      const prefix = `${theme}-${key}`
      const expectedOriginalAccent = expectedThemeAccent(theme, 'original')
      const expectedCandidateAccent = expectedThemeAccent(theme, 'manual-candidate')
      const originalAccent = value(original, 'accent')
      const candidateAccent = value(manualCandidate, 'accent')
      checks.push(result(same(originalAccent, expectedOriginalAccent) && same(candidateAccent, expectedCandidateAccent), `${prefix}-root-accent-expected`, { original: originalAccent, manualCandidate: candidateAccent, expected: { original: expectedOriginalAccent, manualCandidate: expectedCandidateAccent } }))
      checks.push(result(same(value(original, 'accentSecondary'), value(manualCandidate, 'accentSecondary')) ? 'pass' : 'fail', `${prefix}-accent-secondary-preserved`, { original: value(original, 'accentSecondary'), manualCandidate: value(manualCandidate, 'accentSecondary') }))
      checks.push(result(same(value(original, 'bodyBackground'), value(manualCandidate, 'bodyBackground')) ? 'pass' : 'fail', `${prefix}-body-background-preserved`, { original: value(original, 'bodyBackground'), manualCandidate: value(manualCandidate, 'bodyBackground') }))
      const layoutPass = value(original, 'documentWidth') === value(manualCandidate, 'documentWidth') && value(original, 'viewportWidth') === value(manualCandidate, 'viewportWidth') &&
        rectsSame(value(original, 'rects')?.primaryButton, value(manualCandidate, 'rects')?.primaryButton) && rectsSame(value(original, 'rects')?.statIcon, value(manualCandidate, 'rects')?.statIcon)
      checks.push(result(layoutPass ? 'pass' : 'fail', `${prefix}-responsive-layout-preserved`, { original: value(original, 'rects'), manualCandidate: value(manualCandidate, 'rects') }))

      for (const target of consumerTargets) {
        const originalSample = original.selectors[target.key]
        const candidateSample = manualCandidate.selectors[target.key]
        const originalValues = (originalSample?.values ?? []).map(item => item?.[target.property] ?? null)
        const candidateValues = (candidateSample?.values ?? []).map(item => item?.[target.property] ?? null)
        const originalActual = originalSample?.found ? originalValues : null
        const candidateActual = candidateSample?.found ? candidateValues : null
        const originalFound = Boolean(originalSample?.found)
        const candidateFound = Boolean(candidateSample?.found)
        let status = 'pass'
        let reason = null
        let expected
        if (!originalFound && !candidateFound) {
          status = 'unknown'
          reason = 'stylesheet selector has no host element in the rendered Home route; route census checks all seven real HashRouter routes'
          expected = {
            original: target.property === 'backgroundImage' ? `gradient contains ${hexToRgb(expectedOriginalAccent)}` : hexToRgb(expectedOriginalAccent),
            manualCandidate: target.property === 'backgroundImage' ? `gradient contains ${hexToRgb(expectedCandidateAccent)}` : hexToRgb(expectedCandidateAccent),
          }
        } else if (originalFound !== candidateFound) {
          status = 'fail'
          reason = 'manual candidate changed whether the target host renders'
          expected = { original: 'host present', manualCandidate: 'host present' }
        } else if (target.behavior === 'accent') {
          const originalExpected = hexToRgb(expectedOriginalAccent)
          const candidateExpected = hexToRgb(expectedCandidateAccent)
          expected = {
            original: target.property === 'backgroundImage' ? `gradient contains ${originalExpected}` : originalExpected,
            manualCandidate: target.property === 'backgroundImage' ? `gradient contains ${candidateExpected}` : candidateExpected,
          }
          const matches = (actualValues, expectedValue) => actualValues.length > 0 && actualValues.every(actual => target.property === 'backgroundImage'
            ? normalizeStyle(actual).includes(normalizeStyle(expectedValue))
            : same(actual, expectedValue))
          const originalPass = matches(originalValues, originalExpected)
          const candidatePass = matches(candidateValues, candidateExpected)
          if (!originalPass || !candidatePass) {
            status = 'fail'
            reason = 'actual computed consumer value did not match the expected theme accent'
          }
        } else {
          expected = { original: 'fixed-project inline --accent-color', manualCandidate: 'preserve original computed fallback consumer' }
          const originalAccentColors = (originalSample?.values ?? []).map(item => item?.accentColor ?? '')
          const candidateAccentColors = (candidateSample?.values ?? []).map(item => item?.accentColor ?? '')
          if (originalValues.length !== candidateValues.length || originalValues.some((item, index) => !same(item, candidateValues[index])) ||
              originalAccentColors.length !== candidateAccentColors.length || originalAccentColors.some((item, index) => !same(item, candidateAccentColors[index]))) {
            status = 'fail'
            reason = 'manual candidate changed a consumer explicitly scoped by inline --accent-color'
          }
        }
        const row = {
          viewport,
          theme,
          revision: 'original/manual-candidate paired comparison',
          route: '#/',
          selector: target.selector,
          property: target.property,
          expected,
          actual: { original: originalActual, manualCandidate: candidateActual },
          elementCounts: { original: originalSample?.count ?? 0, manualCandidate: candidateSample?.count ?? 0 },
          sourceCustomProperties: {
            originalAccentColor: (originalSample?.values ?? []).map(item => item?.accentColor ?? null),
            manualCandidateAccentColor: (candidateSample?.values ?? []).map(item => item?.accentColor ?? null),
          },
          status,
          reason,
          applicability: status === 'unknown' ? 'no rendered host in this route sample; retained as UNKNOWN' : 'applicable',
          pseudoComputedWithGetComputedStyle: target.pseudo ? { original: Boolean(originalSample?.pseudoComputed), manualCandidate: Boolean(candidateSample?.pseudoComputed) } : null,
        revisionSamples: [
          { revision: 'original', expected: target.behavior === 'accent'
            ? (target.property === 'backgroundImage' ? `gradient contains ${hexToRgb(expectedOriginalAccent)}` : hexToRgb(expectedOriginalAccent))
            : 'observe fixed-project inline --accent-color fallback',
          actual: originalActual,
          status: !originalFound ? 'unknown' : target.behavior === 'accent'
            ? (originalValues.length > 0 && originalValues.every(actual => target.property === 'backgroundImage'
              ? normalizeStyle(actual).includes(normalizeStyle(hexToRgb(expectedOriginalAccent)))
              : same(actual, hexToRgb(expectedOriginalAccent))) ? 'pass' : 'fail')
            : 'pass',
          reason: !originalFound ? 'host-element-not-rendered-on-route; retained as UNKNOWN' : null,
          sourceCustomProperty: (originalSample?.values ?? []).map(item => item?.accentColor ?? null),
          pseudoComputedWithGetComputedStyle: target.pseudo ? Boolean(originalSample?.pseudoComputed) : null },
          { revision: 'manual-candidate', expected: target.behavior === 'accent'
            ? (target.property === 'backgroundImage' ? `gradient contains ${hexToRgb(expectedCandidateAccent)}` : hexToRgb(expectedCandidateAccent))
            : 'computed style and inline --accent-color must match original',
          actual: candidateActual,
          status: !candidateFound ? 'unknown' : target.behavior === 'accent'
            ? (candidateValues.length > 0 && candidateValues.every(actual => target.property === 'backgroundImage'
              ? normalizeStyle(actual).includes(normalizeStyle(hexToRgb(expectedCandidateAccent)))
              : same(actual, hexToRgb(expectedCandidateAccent))) ? 'pass' : 'fail')
            : (originalValues.length === candidateValues.length && originalValues.every((actual, index) => same(actual, candidateValues[index]))
              && (originalSample?.values ?? []).every((item, index) => same(item?.accentColor ?? '', candidateSample?.values?.[index]?.accentColor ?? '')) ? 'pass' : 'fail'),
          reason: !candidateFound ? 'host-element-not-rendered-on-route; retained as UNKNOWN' : null,
          sourceCustomProperty: (candidateSample?.values ?? []).map(item => item?.accentColor ?? null),
          pseudoComputedWithGetComputedStyle: target.pseudo ? Boolean(candidateSample?.pseudoComputed) : null },
        ],
        }
        matrix.push(row)
        checks.push(result(status, `${prefix}-${target.name}-observed`, row))

        // Keep the first-run assertion semantics alongside the richer matrix:
        // one assertion checks the expected computed value above, and this
        // second assertion checks whether the candidate changed only the
        // intended light-theme consumers or preserved the inline fallback.
        if (!['section-title', 'section-title-after'].includes(target.name) && originalFound && candidateFound) {
          let behaviorPass
          let behaviorName
          let behaviorExpected
          if (target.behavior === 'inline-fallback') {
            behaviorPass = originalValues.length === candidateValues.length &&
              originalValues.every((actual, index) => same(actual, candidateValues[index])) &&
              (originalSample?.values ?? []).every((item, index) => same(item?.accentColor ?? '', candidateSample?.values?.[index]?.accentColor ?? ''))
            behaviorName = theme === 'dark' ? `${target.name}-dark-untouched` : `${target.name}-inline-scope-preserved`
            behaviorExpected = 'computed consumer and inline --accent-color remain identical'
          } else if (theme === 'dark') {
            behaviorPass = originalValues.length === candidateValues.length && originalValues.every((actual, index) => same(actual, candidateValues[index]))
            behaviorName = `${target.name}-dark-untouched`
            behaviorExpected = 'dark-theme computed consumer remains identical'
          } else {
            behaviorPass = originalValues.length === candidateValues.length && originalValues.some((actual, index) => !same(actual, candidateValues[index]))
            behaviorName = `${target.name}-light-target-differs`
            behaviorExpected = 'light-theme computed consumer changes with --accent'
          }
          checks.push(result(behaviorPass ? 'pass' : 'fail', `${prefix}-${behaviorName}`, {
            selector: target.selector,
            property: target.property,
            expected: behaviorExpected,
            original: originalValues,
            manualCandidate: candidateValues,
          }))
        }
      }

      if (theme === 'dark') {
        const allDarkConsumersUnchanged = consumerTargets.every(target => {
          const before = original.selectors[target.key]
          const after = manualCandidate.selectors[target.key]
          if (Boolean(before?.found) !== Boolean(after?.found)) return false
          if (!before?.found) return true
          const beforeValues = (before.values ?? []).map(item => item?.[target.property] ?? null)
          const afterValues = (after.values ?? []).map(item => item?.[target.property] ?? null)
          return beforeValues.length === afterValues.length && beforeValues.every((actual, index) => same(actual, afterValues[index]))
        })
        const darkUntouched = same(originalAccent, candidateAccent) &&
          same(value(original, 'accentSecondary'), value(manualCandidate, 'accentSecondary')) &&
          same(value(original, 'bodyBackground'), value(manualCandidate, 'bodyBackground')) &&
          layoutPass && allDarkConsumersUnchanged
        checks.push(result(darkUntouched ? 'pass' : 'fail', `${prefix}-dark-untouched`, {
          rootAccent: { original: originalAccent, manualCandidate: candidateAccent },
          accentSecondary: { original: value(original, 'accentSecondary'), manualCandidate: value(manualCandidate, 'accentSecondary') },
          bodyBackground: { original: value(original, 'bodyBackground'), manualCandidate: value(manualCandidate, 'bodyBackground') },
          layoutPass,
          allDarkConsumersUnchanged,
        }))
      }
    }
  }
  return { checks, matrix }
}

async function main() {
  fs.mkdirSync(artifactRoot, { recursive: true })
  for (const name of fs.readdirSync(artifactRoot)) {
    if (/^(baseline|candidate)-(dark|light)-\d+x\d+\.png$/.test(name) || /^(baseline|candidate)-\d+x\d+-.+trace\.zip$/.test(name)) {
      fs.rmSync(path.join(artifactRoot, name), { force: true })
    }
  }
  const source = assertFixedCheckout(projectRoot)
  // Keep run copies in a short, writable sibling scratch path. Deep Windows
  // worktree paths can exceed filesystem cleanup limits once node_modules is
  // copied; this sibling keeps the third-party checkout itself untouched.
  const tempBase = path.join(path.dirname(projectRoot), '.ripple-b-css-browser-work')
  fs.mkdirSync(tempBase, { recursive: true })
  const tempRoot = fs.mkdtempSync(path.join(tempBase, 'run-'))
  const baselineRoot = path.join(tempRoot, 'baseline')
  const candidateRoot = path.join(tempRoot, 'candidate')
  let baselineServer
  let candidateServer
  try {
    copyCheckout(projectRoot, baselineRoot)
    copyCheckout(projectRoot, candidateRoot)
    const candidatePatch = patchCandidate(candidateRoot)
    baselineServer = await startVite(baselineRoot, SOURCE_VALUE)
    const baselineResult = await captureCopy(baselineRoot, 'baseline', baselineServer.baseUrl, baselineServer.sourceServing, source.routePaths)
    stopVite(baselineServer.child)
    candidateServer = await startVite(candidateRoot, CANDIDATE_VALUE)
    const candidateResult = await captureCopy(candidateRoot, 'candidate', candidateServer.baseUrl, candidateServer.sourceServing, source.routePaths)
    const comparison = compareRuns(baselineResult.runs, candidateResult.runs)
    const routeCensus = [...baselineResult.routeCensus, ...candidateResult.routeCensus]
    const sectionTitleApplicability = ['.section-title', '.section-title::after'].map(selector => {
      const entries = routeCensus.filter(row => row.selector === selector)
      const absentEverywhere = entries.length > 0 && entries.every(row => !row.hostFound)
      return {
        selector,
        applicability: absentEverywhere ? 'not-applicable-to-rendered-fixed-project-routes' : 'applicable-or-partially-rendered',
        status: absentEverywhere ? 'UNKNOWN_RETAINED' : 'ROUTE_CENSUS_RECORDED',
        routeSamples: entries.length,
        reason: absentEverywhere ? 'the CSS rule exists but no host element is rendered on any of the seven real HashRouter routes; the selector remains in the UNKNOWN matrix' : null,
      }
    })
    const checks = comparison.checks
    const screenshotFiles = fs.readdirSync(artifactRoot).filter(name => name.endsWith('.png')).sort()
    if (screenshotFiles.length !== 16) throw new Error(`expected 16 newly captured real screenshots, found ${screenshotFiles.length}`)
    const sourceAfter = assertFixedCheckout(projectRoot)
    if (JSON.stringify(source.sourceHashes) !== JSON.stringify(sourceAfter.sourceHashes)) throw new Error('original third-party source bytes changed during the isolated browser run')
    const routeCensusSummary = {
      pass: routeCensus.filter(row => row.status === 'pass').length,
      fail: routeCensus.filter(row => row.status === 'fail').length,
      unknown: routeCensus.filter(row => row.status === 'unknown').length,
    }
    const report = {
      schemaVersion: 2,
      generatedBy: 'scripts/b-css-token-browser-baseline.mjs',
      status: checks.some(check => check.status === 'fail' || check.status === 'risk') || routeCensusSummary.fail > 0 ? 'FAIL' : checks.some(check => check.status === 'unknown') ? 'PENDING' : 'PASS',
      project: { sha: source.head, targetFile: TARGET_FILE, packageVersion: source.packageVersion, sourceHashes: source.sourceHashes },
      candidate: candidatePatch,
      runtimeEnvironment: {
        servedBy: 'npm run dev (Vite) from isolated original and candidate source trees; /src/main.jsx returned HTTP 200; upstream dist is not served',
        originalSourceUnchanged: true,
        candidateChangedFiles: [candidatePatch.file],
        themeControl: 'the ThemeToggle component file exists but is not rendered; the report records script-fallback data-theme changes for this fixed SHA',
        externalFonts: 'fonts.googleapis.com CSS import is fulfilled with an empty stylesheet for deterministic color/layout sampling; font rendering and font-request behavior are outside this evidence',
        screenshots: screenshotFiles,
        traceFiles: [...baselineResult.traceFiles, ...candidateResult.traceFiles],
        baselineSourceServing: baselineResult.runs[0]?.sourceServing ?? null,
        candidateSourceServing: candidateResult.runs[0]?.sourceServing ?? null,
        environment: { node: process.version, platform: process.platform, architecture: process.arch, chromium: chromium.version ?? 'Playwright Chromium' },
      },
      viewports: VIEWPORTS,
      routes: source.routePaths.map(route => ({ path: route, hash: `#${route}`, sentinel: ROUTE_SENTINELS[route] })),
      baselineRuns: baselineResult.runs,
      candidateRuns: candidateResult.runs,
      matrix: comparison.matrix,
      revisionMatrix: comparison.matrix.flatMap(row => row.revisionSamples.map(sample => ({
        viewport: row.viewport,
        theme: row.theme,
        revision: sample.revision,
        route: row.route,
        selector: row.selector,
        property: row.property,
        expected: sample.expected,
        actual: sample.actual,
        status: sample.status,
        reason: sample.reason,
        sourceCustomProperty: sample.sourceCustomProperty,
        pseudoComputedWithGetComputedStyle: sample.pseudoComputedWithGetComputedStyle,
      }))),
      routeCensus,
      targetApplicability: sectionTitleApplicability,
      checks,
      summary: {
        pass: checks.filter(check => check.status === 'pass').length,
        fail: checks.filter(check => check.status === 'fail').length,
        unknown: checks.filter(check => check.status === 'unknown').length,
        risk: checks.filter(check => check.status === 'risk').length,
      },
      routeCensusSummary,
    }
    if (jsonPath) {
      fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
      fs.writeFileSync(jsonPath, JSON.stringify(report, null, 2))
    }
    console.log(JSON.stringify({
      event: 'b-css-token-browser-baseline-summary',
      status: report.status,
      projectSha: source.head,
      sourceFileHash: source.sourceFileHash,
      runtimeEnvironment: report.runtimeEnvironment.environment,
      summary: report.summary,
      matrixRows: report.matrix.length,
      revisionRows: report.revisionMatrix.length,
      routeCensusRows: report.routeCensus.length,
      screenshots: screenshotFiles.length,
      traces: report.runtimeEnvironment.traceFiles.length,
      failedChecks: report.checks.filter(check => check.status === 'fail').map(check => ({ name: check.name, detail: check.detail })),
      targetApplicability: report.targetApplicability,
    }, null, 2))
    const blocking = checks.some(check => check.status === 'fail' || check.status === 'unknown' || check.status === 'risk') || routeCensusSummary.fail > 0
    process.exitCode = blocking ? 2 : 0
  } finally {
    if (baselineServer) stopVite(baselineServer.child)
    if (candidateServer) stopVite(candidateServer.child)
    try {
      fs.rmSync(tempRoot, { recursive: true, force: true, maxRetries: 5, retryDelay: 500 })
    } catch (error) {
      // Preserve the primary browser/setup error if cleanup is denied. The
      // generated path is deterministic to this run and outside the fixture.
      console.error(`b-css-token-browser-baseline: scratch cleanup warning (${tempRoot}): ${error instanceof Error ? error.message : String(error)}`)
    }
  }
}

main().catch(error => {
  console.error('b-css-token-browser-baseline: execution error:', error instanceof Error ? (error.stack ?? error.message) : String(error))
  try {
    fs.mkdirSync(path.dirname(jsonPath), { recursive: true })
    fs.writeFileSync(jsonPath, JSON.stringify({
      schemaVersion: 2,
      generatedBy: 'scripts/b-css-token-browser-baseline.mjs',
      status: 'ERROR',
      error: error instanceof Error ? { name: error.name, message: error.message, tracePath: error.tracePath ?? null, stack: error.stack ?? null } : { message: String(error) },
      screenshots: fs.existsSync(artifactRoot) ? fs.readdirSync(artifactRoot).filter(name => name.endsWith('.png')) : [],
    }, null, 2))
  } catch (writeError) {
    console.error('b-css-token-browser-baseline: failed to write ERROR report:', writeError instanceof Error ? writeError.message : String(writeError))
  }
  process.exitCode = 1
})
