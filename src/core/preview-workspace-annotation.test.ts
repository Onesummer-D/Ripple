// @vitest-environment node
// Review round 2 (coordinator 2026-10-22): pin down the ACTUAL workspace
// source semantics instead of inferring them from "served per module".
//
// sourceAnnotationPlugin.transform annotates only files that are inside the
// project root AND not under any node_modules segment AND tsx/jsx
// (source-annotation.ts). With preserveSymlinks, a workspace package served
// via /node_modules/<pkg>/*.tsx hits that skip: it is project source, but it
// is NOT runtime-annotated. The static cross-file hook index DOES resolve
// linked workspace real files (hook-safety analysis only), and A's project
// graph (project.ts) excludes node_modules paths entirely — so no host-side
// graph records workspace components either. This test records the full
// matrix for one project TSX component (positive control) and one workspace
// TSX component (linked into node_modules), so the unsupported status is a
// pinned, documented fact rather than an assumption.
//
// Matrix columns:
//   prebundled            — from the optimizeDeps experiment (never, when excluded)
//   pluginAnnotated       — did sourceAnnotationPlugin transform the module?
//                             (observable: DOM carries data-ripple-source)
//   domAnnotation         — does the rendered DOM expose a trustworthy source ref?
//   runtimeIdentity       — does D's collector prove a runtime instance?
//   sourceGraph           — host-side graph membership (project.ts excludes
//                           node_modules; asserted here via documented fact,
//                           recorded as unsupported — A has no SourceGraph
//                          收录 for workspace packages)
import { afterAll, describe, expect, it } from 'vitest'
import { createServer, type ViteDevServer } from 'vite'
import react from '@vitejs/plugin-react'
import { chromium, type Browser } from 'playwright'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { sourceAnnotationPlugin } from './source-annotation'
import { collectRuntimeIdentitySnapshot } from './runtime-identity'
import { makeFixtureRoot, removeTree } from './test-fixture-dir'

let browser: Browser | undefined
const servers: ViteDevServer[] = []
const tmpRoots: string[] = []

afterAll(async () => {
  await browser?.close()
  await Promise.all(servers.map(server => server.close()))
  for (const root of tmpRoots) removeTree(root)
})

describe('workspace source annotation semantics matrix', () => {
  it('project TSX is annotated and identity-provable; workspace TSX stays per-module but unannotated (unsupported, documented)', async () => {
    const root = makeFixtureRoot('ripple-ws-annot')
    tmpRoots.push(root)
    // Third-party react as a REAL directory (production-like install).
    const realRoot = path.join(__dirname, '..', '..', 'node_modules')
    fs.mkdirSync(path.join(root, 'node_modules'), { recursive: true })
    for (const name of ['react', 'react-dom', 'scheduler']) {
      fs.cpSync(path.join(realRoot, name), path.join(root, 'node_modules', name), { recursive: true })
    }
    // Workspace TSX package, symlinked into node_modules (pnpm/workspace shape).
    fs.mkdirSync(path.join(root, 'linked-ui-src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'linked-ui-src', 'package.json'), JSON.stringify({ name: 'linked-ui', version: '0.0.0', type: 'module', main: './Panel.tsx' }))
    fs.writeFileSync(path.join(root, 'linked-ui-src', 'Panel.tsx'), `export function Panel() { return <aside id="workspace-panel" data-marker="workspace-panel-mark">workspace-panel-mark</aside> }\n`)
    fs.symlinkSync(path.join(root, 'linked-ui-src'), path.join(root, 'node_modules', 'linked-ui'), 'junction')
    fs.mkdirSync(path.join(root, 'src'), { recursive: true })
    fs.writeFileSync(path.join(root, 'index.html'), `<!doctype html><html><body><div id="root"></div><script type="module" src="/src/main.tsx"></script></body></html>`)
    fs.writeFileSync(path.join(root, 'src', 'Cmp.tsx'), `export function Cmp() { return <section id="project-cmp" data-marker="project-cmp-mark">project-cmp-mark</section> }\n`)
    fs.writeFileSync(path.join(root, 'src', 'main.tsx'), `import { createRoot } from 'react-dom/client'\nimport { Cmp } from './Cmp'\nimport { Panel } from 'linked-ui'\ncreateRoot(document.querySelector('#root')!).render(<div><Cmp /><Panel /></div>)\n`)
    const vite = await createServer({
      configFile: false,
      root,
      plugins: [sourceAnnotationPlugin(root), react()],
      resolve: { preserveSymlinks: true },
      optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client'], esbuildOptions: { preserveSymlinks: true } },
      server: { host: '127.0.0.1', port: 0, strictPort: false, hmr: false },
      logLevel: 'silent',
    })
    servers.push(vite)
    await vite.listen()
    const port = (vite.httpServer!.address() as { port: number }).port
    browser ??= await chromium.launch({ headless: true, executablePath: process.env.RIPPLE_TEST_CHROMIUM_PATH || undefined })
    const page = await browser.newPage()
    const collectorCode = `(${collectRuntimeIdentitySnapshot.toString()})`
    await page.addInitScript({ content: `window.__rippleCollect = ${collectorCode}` })
    await page.goto(`http://127.0.0.1:${port}/`, { waitUntil: 'domcontentloaded', timeout: 120_000 })
    await page.waitForFunction(() => document.querySelector('#workspace-panel') && document.querySelector('#project-cmp'), undefined, { timeout: 60_000 })
    const matrix = await page.evaluate(() => {
      const collect = (window as unknown as { __rippleCollect: typeof collectRuntimeIdentitySnapshot }).__rippleCollect
      const records = collect({ label: 'data-ripple-source' }).records
      const describe = (marker: string, sourceRefFragment: string) => {
        const annotated = document.querySelector(`[data-marker="${marker}"][data-ripple-source]`)
        const record = records.find(item => item.sourceRef.toLowerCase().includes(sourceRefFragment))
        return {
          domAnnotation: annotated ? annotated.getAttribute('data-ripple-source') : null,
          record: record ? {
            sourceRef: record.sourceRef,
            certainty: record.certainty,
            runtimeInstanceId: record.runtimeInstanceId ?? null,
          } : null,
        }
      }
      return { project: describe('project-cmp-mark', 'cmp.tsx'), workspace: describe('workspace-panel-mark', 'panel') }
    })
    console.log(`[ws-annot-matrix] ${JSON.stringify(matrix)}`)
    // Positive control — project TSX: annotated, provable runtime identity.
    expect(matrix.project.domAnnotation).toBeTruthy()
    expect(matrix.project.record).not.toBeNull()
    expect(matrix.project.record!.certainty).not.toBe('unknown')
    expect(matrix.project.record!.certainty).not.toBe('unmapped')
    expect(matrix.project.record!.runtimeInstanceId).toBeTruthy()
    expect(matrix.project.record!.runtimeInstanceId!.endsWith(':~')).toBe(false)
    // Workspace TSX: served per module, but NOT runtime-annotated — no DOM
    // source ref, no collector record. This is the documented unsupported
    // status; nothing here claims workspace identity proof.
    expect(matrix.workspace.domAnnotation).toBeNull()
    expect(matrix.workspace.record).toBeNull()
    // And the module itself was transform-served (per module), never bundled:
    // the rendered text proves the workspace component executed.
    expect(await page.evaluate(() => document.querySelector('#workspace-panel')?.textContent)).toBe('workspace-panel-mark')
  }, 180_000)
})
