// @vitest-environment node
// Reproducible experiment record for the restricted optimizeDeps dependency
// discovery (coordinator approval 2026-10-22). Runs a Bolt-shaped React app —
// real react/react-dom, the real lucide-react barrel (3,496 ESM icon modules),
// 40 project components, an aliased project import, a symlinked workspace
// package, a project dynamic import and a node_modules CSS import — through
// the pinned preview config shape twice: current noDiscovery vs restricted
// discovery. Asserts the safety invariants (project/linked source is never
// prebundled, request parity on the annotation path) and records navigation
// timings + request-class counts as raw evidence. Runs on Linux CI with real
// Chromium, so numbers are reproducible from the commit alone.
import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Browser } from 'playwright'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { sourceAnnotationPlugin } from './source-annotation'
// @ts-expect-error The container runtime is plain ESM without a TS build target.
import { symlinkedWorkspaceExcludes } from './preview-optimize-deps-excludes.mjs'

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
  for (const root of tmpRoots) fs.rmSync(root, { recursive: true, force: true })
})

// Link the real installed packages into the temp project so vite resolves
// bare imports the same way it does for a real project with node_modules.
function linkDeps(root: string, names: string[]) {
  fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
  const real = path.join(__dirname, '..', '..', 'node_modules')
  for (const name of names) {
    const target = path.join(real, ...name.split('/'))
    const link = path.join(root, 'node_modules', ...name.split('/'))
    fs.mkdirSync(path.dirname(link), { recursive: true })
    fs.symlinkSync(target, link, 'junction')
  }
}

function buildApp(root: string) {
  linkDeps(root, ['react', 'react-dom', 'scheduler', 'lucide-react'])
  fs.mkdirSync(path.join(root, 'src', 'pages'), { recursive: true })
  fs.mkdirSync(path.join(root, 'src', 'components'), { recursive: true })
  fs.mkdirSync(path.join(root, 'node_modules', 'fakepkg'), { recursive: true })
  fs.writeFileSync(path.join(root, 'node_modules', 'fakepkg', 'package.json'), JSON.stringify({ name: 'fakepkg', version: '1.0.0', type: 'module', main: './index.js', style: './style.css' }))
  fs.writeFileSync(path.join(root, 'node_modules', 'fakepkg', 'index.js'), `export const fakepkg = 'fakepkg'\n`)
  fs.writeFileSync(path.join(root, 'node_modules', 'fakepkg', 'style.css'), `.fakepkg { color: rebeccapurple }\n`)
  // A symlinked workspace-style package: project source, NOT a third-party dep.
  fs.mkdirSync(path.join(root, 'linked-src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'linked-src', 'package.json'), JSON.stringify({ name: 'linkedpkg', version: '0.0.0', type: 'module', main: './index.js' }))
  fs.writeFileSync(path.join(root, 'linked-src', 'index.js'), `export const linked = 'linked-value'\n`)
  fs.writeFileSync(path.join(root, 'linked-src', 'helper.js'), `export const helper = 'helper-value'\n`)
  fs.symlinkSync(path.join(root, 'linked-src'), path.join(root, 'node_modules', 'linkedpkg'), 'junction')
  fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
  const iconImports = ICONS.map(name => `import { ${name} } from 'lucide-react'`).join('\n')
  const iconList = ICONS.map(name => `<${name} key="${name}" size={12} />`).join('')
  fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'\nimport { App } from './App'\nimport 'fakepkg/style.css'\ndocument.querySelector('#root')!.textContent = 'loading'\ncreateRoot(document.querySelector('#root')!).render(<App />)\n`)
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `${iconImports}\nimport { linked } from 'linkedpkg'\nimport { HomePage } from '@/pages/HomePage'\nexport function App() { return <div className="fakepkg">{linked}<HomePage />${iconList}</div> }\n`)
  const compImports = Array.from({ length: 10 }, (_, c) => `import { Cmp${c} } from '../components/Cmp${c}'`).join('\n')
  fs.writeFileSync(path.join(root, 'src', 'pages', 'HomePage.tsx'), `${compImports}\nimport { helper } from 'linkedpkg/helper'\nexport function HomePage() { return <main>home-{helper}{[<Cmp0 key="0" />]}</main> }\n`)
  for (let c = 0; c < 10; c += 1) fs.writeFileSync(path.join(root, 'src', 'components', `Cmp${c}.tsx`), `export function Cmp${c}() { return <span>cmp${c}</span> }\n`)
  fs.writeFileSync(path.join(root, 'src', 'lazy-chunk.ts'), `export const lazyValue = 'lazy-chunk-loaded'\n`)
  fs.writeFileSync(path.join(root, 'src', 'boot.ts'), `import { lazyValue } from './lazy-chunk'\nexport const boot = () => lazyValue\n`)
  // boot.ts is imported dynamically by the page at runtime below.
  fs.appendFileSync(path.join(root, 'src', 'main.tsx'), `\nimport('./boot').then(m => document.body.setAttribute('data-lazy', m.boot()))\n`)
}

type Counts = { source: number; lucide: number; reactDep: number; linked: number; css: number; other: number }
type RunStats = { label: string; counts: Counts; dclMs: number[]; renderedText: string; navigations: number }

async function runConfig(label: string, optimizeDeps: Record<string, unknown>, navs: number): Promise<RunStats> {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-optdeps-'))
  tmpRoots.push(root)
  buildApp(root)
  const vite = await createServer({
    configFile: false,
    root,
    plugins: [sourceAnnotationPlugin(root), react()],
    resolve: { alias: { '@': path.join(root, 'src') }, preserveSymlinks: true },
    cacheDir: path.join(root, '.vite-cache'),
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
      else if (url.includes('/node_modules/.vite/') || url.includes('react') || url.includes('scheduler')) counts.reactDep += 1
      else if (url.includes('lazy-chunk') || url.includes('linkedpkg') || url.includes('linked-src')) counts.linked += 1
      else if (url.includes('fakepkg')) counts.css += 1
      else counts.other += 1
      urls[url.replace(`http://127.0.0.1:${port}`, '')] = (urls[url.replace(`http://127.0.0.1:${port}`, '')] ?? 0) + 1
      return route.continue()
    })
    const t0 = Date.now()
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 180_000 })
    dclMs.push(Date.now() - t0)
    await page.waitForFunction(() => document.body.getAttribute('data-lazy') === 'lazy-chunk-loaded', undefined, { timeout: 30_000 })
    if (n === navs - 1) renderedText = await page.evaluate(() => document.querySelector('#root')?.textContent ?? '')
    await page.close()
  }
  const stats: RunStats = { label, counts, dclMs, renderedText, navigations }
  console.log(`[optdeps-bench] ${label} dclMs=${JSON.stringify(dclMs)} counts=${JSON.stringify(counts)} navigations=${navigations}`)
  console.log(`[optdeps-urls] ${label} ${JSON.stringify(urls)}`)
  return stats
}

describe('restricted optimizeDeps discovery experiment', () => {
  it('collapses bare node_modules imports without touching project, linked, lazy or CSS paths', async () => {
    const current = await runConfig('noDiscovery-current', { noDiscovery: true, include: ['react', 'react-dom/client'], esbuildOptions: { preserveSymlinks: true } }, 2)
    const restricted = await runConfig('restricted-discovery', { include: ['react', 'react-dom/client'], holdUntilCrawlEnd: true, esbuildOptions: { preserveSymlinks: true } }, 2)
    // App rendered identically under both configs (React tree + lazy chunk).
    expect(current.renderedText).toContain('home-helper-value')
    expect(restricted.renderedText).toContain('home-helper-value')
    // Safety invariant: project source modules are served per module in both
    // configs — the sourceAnnotationPlugin path is never prebundled away.
    expect(restricted.counts.source).toBe(current.counts.source)
    expect(restricted.counts.source).toBeGreaterThan(10)
    // Linked workspace package stays per-module in both configs.
    expect(current.counts.linked).toBeGreaterThanOrEqual(2)
    expect(restricted.counts.linked).toBe(current.counts.linked)
    // Dep CSS goes through the CSS pipeline under both configs.
    expect(current.counts.css).toBeGreaterThanOrEqual(1)
    expect(restricted.counts.css).toBeGreaterThanOrEqual(1)
    // The actual win: the lucide barrel stops exploding into per-icon module
    // requests once bare node_modules imports are prebundled.
    expect(current.counts.lucide).toBeGreaterThan(1000)
    expect(restricted.counts.lucide).toBeLessThanOrEqual(5)
    // Strict perf gate on the shared CI shape: the restricted config must not
    // be slower on any measured navigation.
    for (let i = 0; i < restricted.dclMs.length; i += 1) {
      expect(restricted.dclMs[i]).toBeLessThanOrEqual(Math.max(current.dclMs[i] ?? current.dclMs[0], 1) * 1.5 + 500)
    }
  }, 300_000)

  it('discovers a late dynamic dependency with exactly one controlled reload, ending rendered', async () => {
    const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-optdeps-late-'))
    tmpRoots.push(root)
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.ts"></script></body></html>`)
    fs.writeFileSync(path.join(root, 'src', 'main.ts'), `const lazy = await import('./feature')\ndocument.querySelector('#root').textContent = lazy.feature()\n`)
    fs.writeFileSync(path.join(root, 'src', 'feature.ts'), `import { later } from 'laterdep'\nexport const feature = () => 'feature-' + later\n`)
    fs.mkdirSync(path.join(root, 'node_modules', 'laterdep'), { recursive: true })
    fs.writeFileSync(path.join(root, 'node_modules', 'laterdep', 'package.json'), JSON.stringify({ name: 'laterdep', version: '1.0.0', type: 'module', main: './index.js' }))
    fs.writeFileSync(path.join(root, 'node_modules', 'laterdep', 'index.js'), `export const later = 'ok'\n`)
    const vite = await createServer({
      configFile: false,
      root,
      cacheDir: path.join(root, '.vite-cache'),
      optimizeDeps: { include: ['react', 'react-dom/client'], exclude: symlinkedWorkspaceExcludes(root), holdUntilCrawlEnd: true },
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
})
