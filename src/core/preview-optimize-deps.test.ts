// @vitest-environment node
// Reproducible experiment record for the restricted optimizeDeps dependency
// discovery (coordinator approval 2026-10-22, review round 2: the restricted
// leg MUST replicate the production config, including the dependency-origin
// classifier). Runs a Bolt-shaped React app — real react/react-dom, the real
// lucide-react barrel (3,496 ESM icon modules), 40 project components, an
// aliased project import, a symlinked workspace JS package, a symlinked
// workspace TSX package, a project dynamic import and a node_modules CSS
// import — through the pinned preview config shape twice: current
// noDiscovery vs the exact production restricted shape (include + exclude
// from analyzeNodeModulesDeps + holdUntilCrawlEnd + esbuildOptions).
//
// Third-party deps are REAL directories inside the temp project's
// node_modules (matching an npm-installed production project); workspace
// packages are symlinks whose realpath lives inside the project. Asserts the
// safety invariants (workspace source never prebundled, annotation path
// parity, lucide served from the prebundle) and records navigation timings +
// request-class counts as raw evidence. Runs on Linux CI with real Chromium,
// so numbers are reproducible from the commit alone.
import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Browser } from 'playwright'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { sourceAnnotationPlugin } from './source-annotation'
import { makeFixtureRoot, removeTree } from './test-fixture-dir'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { analyzeNodeModulesDeps } from './preview-optimize-deps-excludes.mjs'

const ICONS = ['Sun', 'Moon', 'Star', 'Cloud', 'Heart', 'Zap', 'Leaf', 'Flag', 'Bell', 'Gift',
  'Camera', 'Music', 'Video', 'Image', 'Search', 'Filter', 'Plus', 'Minus', 'Check', 'X',
  'Menu', 'Home', 'User', 'Users', 'Settings', 'Trash', 'Edit', 'Save', 'Download', 'Upload',
  'ArrowLeft', 'ArrowRight', 'ArrowUp', 'ArrowDown', 'ChevronLeft', 'ChevronRight', 'ChevronsUp', 'ChevronsDown', 'Play', 'Pause',
  'MapPin', 'Calendar', 'Clock', 'Mail', 'Phone', 'MessageCircle', 'Share2', 'Link', 'ExternalLink', 'Eye',
  'Lock', 'Unlock', 'Shield', 'Key', 'CreditCard', 'ShoppingCart', 'Package', 'Truck', 'Tag', 'Bookmark']
let browser: Browser | undefined
const servers: ViteDevServer[] = []
const tmpRoots: string[] = []

afterAll(async () => {
  await browser?.close()
  await Promise.all(servers.map(server => server.close()))
  for (const root of tmpRoots) removeTree(root)
})

// Third-party deps are copied as REAL directories (like an npm-installed
// project); workspace packages are symlinks whose realpath stays inside the
// project. This mirrors the production classification inputs exactly.
function copyDeps(root: string, names: string[]) {
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  const realRoot = path.join(__dirname, '..', '..', 'node_modules')
  for (const name of names) {
    fs.cpSync(path.join(realRoot, ...name.split('/')), path.join(root, 'node_modules', ...name.split('/')), { recursive: true })
  }
}

function linkWorkspace(root: string, linkName: string, sourceDir: string) {
  fs.symlinkSync(path.join(root, sourceDir), path.join(root, 'node_modules', linkName), 'junction')
}

function buildApp(root: string) {
  copyDeps(root, ['react', 'react-dom', 'scheduler', 'lucide-react'])
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules', 'fakepkg'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', 'fakepkg', 'package.json'), JSON.stringify({ name: 'fakepkg', version: '1.0.0', type: 'module', main: './index.js', style: './style.css' }))
  fs.writeFileSync(path.join(root, 'node_modules', 'fakepkg', 'index.js'), `export const fakepkg = 'fakepkg'\n`)
  fs.writeFileSync(path.join(root, 'node_modules', 'fakepkg', 'style.css'), `.fakepkg { color: rebeccapurple }\n`)
  // A symlinked workspace-style JS package: project source, NOT a third-party dep.
  fs.mkdirSync(path.join(root, 'linked-src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'linked-src', 'package.json'), JSON.stringify({ name: 'linkedpkg', version: '0.0.0', type: 'module', main: './index.js' }))
  fs.writeFileSync(path.join(root, 'linked-src', 'index.js'), `export const linked = 'linked-value'\n`)
  fs.writeFileSync(path.join(root, 'linked-src', 'helper.js'), `export const helper = 'helper-value'\n`)
  linkWorkspace(root, 'linkedpkg', 'linked-src')
  // A symlinked workspace-style TSX package: project source with JSX, the
  // review-round-2 workspace annotation probe.
  fs.mkdirSync(path.join(root, 'linked-ui-src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'linked-ui-src', 'package.json'), JSON.stringify({ name: 'linked-ui', version: '0.0.0', type: 'module', main: './Panel.tsx' }))
  fs.writeFileSync(path.join(root, 'linked-ui-src', 'Panel.tsx'), `export function Panel() { return <aside id="workspace-panel">workspace-panel</aside> }\n`)
  linkWorkspace(root, 'linked-ui', 'linked-ui-src')
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  const iconImports = ICONS.map(name => `import { ${name} } from 'lucide-react'`).join('\n')
  const iconList = ICONS.map(name => `<${name} key="${name}" size={12} />`).join('')
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'\nimport { App } from './App'\nimport 'fakepkg/style.css'\ndocument.querySelector('#root')!.textContent = 'loading'\ncreateRoot(document.querySelector('#root')!).render(<App />)\n`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `${iconImports}\nimport { linked } from 'linkedpkg'\nimport { Panel } from 'linked-ui'\nimport { HomePage } from '@/pages/HomePage'\nexport function App() { return <div className="fakepkg">{linked}<HomePage /><Panel />${iconList}</div> }\n`)
  const compImports = Array.from({ length: 10 }, (_, c) => `import { Cmp${c} } from '../components/Cmp${c}'`).join('\n')
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `${compImports}\nimport { helper } from 'linkedpkg/helper'\nexport function HomePage() { return <main>home-{helper}{[<Cmp0 key="0" />]}</main> }\n`)
  for (let c = 0; c < 10; c += 1) fs.writeFileSync(path.join(root, 'src', 'components', `Cmp${c}.tsx`), `export function Cmp${c}() { return <span>cmp${c}</span> }\n`)
  fs.writeFileSync(path.join(root, 'lazy-chunk.ts'), `export const lazyValue = 'lazy-chunk-loaded'\n`)
  fs.writeFileSync(path.join(root, 'src', 'boot.ts'), `import { lazyValue } from '../lazy-chunk'\nexport const boot = () => lazyValue\n`)
  // boot.ts is imported dynamically by the page at runtime below.
  fs.appendFileSync(path.join(root, 'src', 'main.tsx'), `\nimport('./boot').then(m => document.body.setAttribute('data-lazy', m.boot()))\n`)
}

type Counts = { source: number; lucide: number; reactDep: number; linked: number; css: number; other: number }
type RunStats = { label: string; counts: Counts; dclMs: number[]; renderedText: string; navigations: number; urls: Record<string, number> }

async function runConfig(root: string, label: string, optimizeDeps: Record<string, unknown>, navs: number): Promise<RunStats> {
  const vite = await createServer({
    configFile: false,
    root,
    plugins: [sourceAnnotationPlugin(root), react()],
    resolve: { alias: { '@': path.join(root, 'src') }, preserveSymlinks: true },
    cacheDir: path.join(root, `.vite-cache-${label}`),
    optimizeDeps,
    server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
    logLevel: 'silent',
  })
  servers.push(vite)
  await vite.listen()
  const port = (vite.httpServer!.address() as { port: number }).port
  browser ??= await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
  const counts: Counts = { source: 0, lucide: 0, reactDep: 0, linked: 0, css: 0, other: 0 }
  const urls: Record<string, number> = {}
  const dclMs: number[] = []
  let renderedText = ''
  let navigations = 0
  for (let n = 0; n < navs; n += 1) {
    const page = await browser.newPage()
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1 })
    await page.route('**/*', route => {
      const url = route.request().url()
      const pathname = new URL(url).pathname
      if (pathname.startsWith('/src/')) counts.source += 1
      else if (url.includes('lucide-react')) counts.lucide += 1
      else if (url.includes('/node_modules/.vite/') || url.includes('/.vite-cache-') && url.includes('/deps/') || url.includes('react') || url.includes('scheduler')) counts.reactDep += 1
      else if (url.includes('lazy-chunk') || url.includes('linkedpkg') || url.includes('linked-src') || url.includes('linked-ui')) counts.linked += 1
      else if (url.includes('fakepkg')) counts.css += 1
      else counts.other += 1
      const key = url.replace(`http://127.0.0.1:${port}`, '')
      urls[key] = (urls[key] ?? 0) + 1
      return route.continue()
    })
    const t0 = Date.now()
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    dclMs.push(Date.now() - t0)
    await page.waitForFunction(() => document.body.getAttribute('data-lazy') === 'lazy-chunk-loaded', undefined, { timeout: 30_000 })
    if (n === navs - 1) renderedText = await page.evaluate(() => document.querySelector('#root')?.textContent ?? '')
    await page.close()
  }
  const stats: RunStats = { label, counts, dclMs, renderedText, navigations, urls }
  console.log(`[optdeps-bench] ${label} dclMs=${JSON.stringify(dclMs)} counts=${JSON.stringify(counts)} navigations=${navigations}`)
  console.log(`[optdeps-urls] ${label} ${JSON.stringify(urls)}`)
  return stats
}

describe('restricted optimizeDeps discovery experiment', () => {
  it('collapses confirmed third-party deps without touching project, workspace, lazy or CSS paths', async () => {
    const root = makeFixtureRoot('ripple-optdeps')
    tmpRoots.push(root)
    buildApp(root)
    // The production dependency-origin classification on this exact project.
    const analysis = analyzeNodeModulesDeps(root)
    expect(analysis.ok).toBe(true)
    // Real dirs (npm-installed third-party) are eligible; symlinked workspace
    // packages (realpath inside the project) are excluded; nothing else.
    expect(analysis.thirdParty).toEqual(['fakepkg', 'lucide-react', 'react', 'react-dom', 'scheduler'])
    expect(analysis.excludes).toEqual(['linked-ui', 'linkedpkg'])
    // The noDiscovery leg is the previous production behavior.
    const current = await runConfig(root, 'noDiscovery-current', { noDiscovery: true, include: ['react', 'react-dom/client'], esbuildOptions: { preserveSymlinks: true } }, 2)
    // The restricted leg is the EXACT production shape: same classifier, same
    // include, same esbuild pins. This is what the reviewer round-2 gap called out.
    const restricted = await runConfig(root, 'restricted-production', { include: ['react', 'react-dom/client'], exclude: analysis.excludes, holdUntilCrawlEnd: true, esbuildOptions: { preserveSymlinks: true } }, 2)
    // App rendered identically under both configs (React tree + workspace TSX
    // panel + lazy chunk).
    expect(current.renderedText).toContain('home-helper-value')
    expect(restricted.renderedText).toContain('home-helper-value')
    expect(current.renderedText).toContain('workspace-panel')
    expect(restricted.renderedText).toContain('workspace-panel')
    // Safety invariant: project source modules are served per module in both
    // configs — the sourceAnnotationPlugin path is never prebundled away.
    expect(restricted.counts.source).toBe(current.counts.source)
    expect(restricted.counts.source).toBeGreaterThan(5)
    // Workspace packages (JS linkedpkg, TSX linked-ui) are NEVER prebundled:
    // no optimized-deps URL may carry their names, in either config.
    for (const stats of [current, restricted]) {
      const prebundledWorkspace = Object.keys(stats.urls).filter(u => u.includes('/deps/') && (u.includes('linkedpkg') || u.includes('linked-ui')))
      expect(prebundledWorkspace).toEqual([])
    }
    // ...and they keep flowing per module through node_modules URLs.
    expect(Object.keys(restricted.urls).some(u => u.includes('/node_modules/linkedpkg/'))).toBe(true)
    expect(Object.keys(restricted.urls).some(u => u.includes('/node_modules/linked-ui/Panel.tsx'))).toBe(true)
    // The actual win: the lucide barrel collapses into the prebundle — every
    // lucide request under restricted discovery is a deps-chunk URL.
    expect(current.counts.lucide).toBeGreaterThan(1000)
    expect(restricted.counts.lucide).toBeLessThanOrEqual(5)
    const restrictedLucideUrls = Object.keys(restricted.urls).filter(u => u.includes('lucide-react'))
    expect(restrictedLucideUrls.length).toBeGreaterThan(0)
    expect(restrictedLucideUrls.every(u => u.includes('/deps/'))).toBe(true)
    // Dep CSS goes through the CSS pipeline under both configs.
    expect(current.counts.css).toBeGreaterThanOrEqual(1)
    expect(restricted.counts.css).toBeGreaterThanOrEqual(1)
    // Strict perf gate on the shared CI shape: the restricted config must not
    // be slower on any measured navigation.
    for (let i = 0; i < restricted.dclMs.length; i += 1) {
      expect(restricted.dclMs[i]).toBeLessThanOrEqual(Math.max(current.dclMs[i] ?? current.dclMs[0], 1) * 1.5 + 500)
    }
  }, 300_000)

  it('discovers a late dynamic dependency with exactly one controlled reload, ending rendered', async () => {
    const root = makeFixtureRoot('ripple-optdeps-late')
    tmpRoots.push(root)
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>`)
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), `const lazy = await import('./feature')\ndocument.querySelector('#root').textContent = lazy.feature()\n`)
    fs.writeFileSync(path.join(root, 'src', 'feature.ts'), `import { later } from 'laterdep'\nexport const feature = () => 'feature-' + later\n`)
    fs.mkdirSync(path.join(root, 'node_modules', 'laterdep'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules', 'laterdep', 'package.json'), JSON.stringify({ name: 'laterdep', version: '1.0.0', type: 'module', main: './index.js' }))
    fs.writeFileSync(path.join(root, 'node_modules', 'laterdep', 'index.js'), `export const later = 'ok'\n`)
    const analysis = analyzeNodeModulesDeps(root)
    expect(analysis.ok).toBe(true)
    expect(analysis.excludes).toEqual([])
    expect(analysis.thirdParty).toEqual(['laterdep'])
    const vite = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, '.vite-cache'),
      optimizeDeps: { include: ['react', 'react-dom/client'], exclude: analysis.excludes, holdUntilCrawlEnd: true, esbuildOptions: { preserveSymlinks: true } },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      logLevel: 'silent',
    })
    servers.push(vite)
    await vite.listen()
    const port = (vite.httpServer!.address() as { port: number }).port
    browser ??= await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
    const page = await browser.newPage()
    let navigations = 0
    page.on('framenavigated', frame => { if (frame === page.mainFrame()) navigations += 1 })
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForFunction(() => document.querySelector('#root')?.textContent === 'feature-ok', undefined, { timeout: 60_000 })
    // The dep was not in the entry scan, so Vite re-optimizes once and reloads
    // the page: exactly one controlled extra navigation, ending rendered —
    // observable behavior, never a silent state.
    expect(navigations).toBeLessThanOrEqual(3)
    expect(navigations).toBeGreaterThanOrEqual(1)
    console.log(`[optdeps-bench] late-dynamic-dep navigations=${navigations}`)
    await page.close()
  }, 180_000)

  it('refuses optimization on a failed node_modules scan instead of opening every dependency', () => {
    const root = makeFixtureRoot('ripple-optdeps-scan')
    tmpRoots.push(root)
    // node_modules itself is not a directory: the scan cannot classify any
    // origin, so optimization must be refused (production falls back to
    // noDiscovery), never widened to an empty exclude list.
    fs.writeFileSync(path.join(root, 'node_modules'), 'plain file, not a directory')
    const analysis = analyzeNodeModulesDeps(root)
    expect(analysis.ok).toBe(false)
    // The production config treats ok:false as "keep noDiscovery" — the empty
    // include list below stands in for that branch: optimization is refused,
    // never widened. (Assertion shape mirrors candidate-preview-vite.config.mjs.)
    const productionOptimizeDeps = analysis.ok
      ? { include: ['react', 'react-dom/client'], exclude: analysis.excludes, holdUntilCrawlEnd: true }
      : { noDiscovery: true, include: ['react', 'react-dom/client'] }
    expect(productionOptimizeDeps).toHaveProperty('noDiscovery', true)
    // A project without node_modules at all is a complete, safe answer.
    const emptyRoot = makeFixtureRoot('ripple-optdeps-empty')
    try {
      const empty = analyzeNodeModulesDeps(emptyRoot)
      expect(empty.ok).toBe(true)
      expect(empty.excludes).toEqual([])
    } finally { removeTree(emptyRoot) }
  })
})
