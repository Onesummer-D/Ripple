/** Ripple B — CSS Custom Properties source-evidence probe (Issue #6 P1).
 *
 *  Runs A-core analyzeProject against a REAL third-party React/Vite project
 *  that consumes pure CSS Custom Properties, and measures the gap between
 *  ground truth (raw var(--x) recount) and the graph's uses-token coverage.
 *
 *  Reference project: allanhue/webportflio @ b244f857457d2a07f118155602eef9097fd322bd
 *  (MIT, License file in repo; React 18 + Vite, HashRouter, ThemeContext toggles
 *  data-theme at runtime; theme variables declared twice — :root and
 *  [data-theme="light"]; upstream commits dist/ build output).
 *
 *  Empirical result (A core 2f2e5a7):
 *    - 11 distinct token labels extracted, values + file/offset captured
 *      (declaration chain is REAL and source-proven).
 *    - 212 raw var(--x) occurrences in tracked CSS, but only ONE uses-token
 *      graph edge — and it is a per-file ordering artifact pointing INTO the
 *      committed dist/ build artifact (file:dist/...css → token:dist/...css#10508).
 *    - Root cause of the gap: every brand token is declared in TWO scopes
 *      (:root dark base + [data-theme="light"] override) and dist/ duplicates
 *      them again, so the "exactly one definition" gate drops every real
 *      source-level consumer; scopes/selectors are not modelled at all.
 *    - ZERO page nodes (HashRouter + <Route element> not recognised) →
 *      token → page impact cannot be computed even if file edges existed.
 *    - Chained token (--skill-color: var(--accent)) gets no token→token edge.
 *    - var(--accent-color, var(--accent)) fallback: --accent-color has NO
 *      definition anywhere → 6 static-unresolvable fallback consumers.
 *    - Runtime theme state (ThemeContext + localStorage) is invisible to
 *      static analysis; media-query consumers (nav.css @media 768px) carry
 *      no responsive context.
 *
 *  Usage:
 *    node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *      scripts/b-css-token-probe.mjs <project-root> [--assert] [--json <out>]
 *
 *  --assert encodes the CURRENT unsupported boundary as a regression test
 *  (expected to FLIP to full coverage once A lands scoped token identity +
 *  page impact for CSS consumers). Exit 0 = boundary as documented.
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProject } from '../src/core/project.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.argv[2] ?? '.')
const assertMode = process.argv.includes('--assert')
const jsonOutIdx = process.argv.indexOf('--json')
const jsonOut = jsonOutIdx > 0 ? process.argv[jsonOutIdx + 1] : null

const graph = analyzeProject(root, true)

const tokens = graph.nodes.filter(n => n.kind === 'token')
const tokenByLabel = new Map()
for (const t of tokens) {
  if (!tokenByLabel.has(t.label)) tokenByLabel.set(t.label, [])
  tokenByLabel.get(t.label).push(t)
}
const cssFiles = [...new Set(tokens.map(t => t.location.path))]

// Ground truth: independent raw recount of var(--x) occurrences in tracked CSS.
const rawVarUses = []
for (const f of cssFiles) {
  const abs = path.join(root, f)
  if (!fs.existsSync(abs) || fs.lstatSync(abs).isSymbolicLink()) continue
  const css = fs.readFileSync(abs, 'utf8')
  for (const m of css.matchAll(/var\(\s*(--[\w-]+)/g)) rawVarUses.push({ file: f, token: m[1], index: m.index })
}

const usesTokenEdges = graph.edges.filter(e => e.kind === 'uses-token')
const fileEdges = usesTokenEdges.filter(e => e.from.startsWith('file:'))
const componentEdges = usesTokenEdges.filter(e => !e.from.startsWith('file:'))

const pages = graph.nodes.filter(n => n.kind === 'page' || /route/i.test(n.kind))
const pageIds = new Set(pages.map(p => p.id))
const edgesTouchingPages = graph.edges.filter(e => pageIds.has(e.from) || pageIds.has(e.to))

const rawUseCountByToken = new Map()
for (const u of rawVarUses) rawUseCountByToken.set(u.token, (rawUseCountByToken.get(u.token) ?? 0) + 1)
const tokensWithoutFileEdges = [...rawUseCountByToken.keys()]
  .filter(label => (tokenByLabel.get(label) ?? []).length !== 1)
  .map(label => ({
    label,
    definitions: (tokenByLabel.get(label) ?? []).map(d => ({ file: d.location.path, value: d.value })),
    rawUses: rawUseCountByToken.get(label),
    graphFileEdges: usesTokenEdges.filter(e => e.to === (tokenByLabel.get(label) ?? [])[0]?.id).length,
  }))

const report = {
  generatedBy: 'scripts/b-css-token-probe.mjs',
  repoRoot,
  projectRoot: root,
  aCoreNote: 'analyzeProject imported from the A-core checkout this script is transplanted onto',
  graphStats: {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    unresolved: graph.unresolved?.length ?? null,
    unresolvedDetail: graph.unresolved ?? [],
  },
  cssFiles,
  tokenDefinitions: [...tokenByLabel.entries()].map(([label, defs]) => ({
    label,
    definitionCount: defs.length,
    definitions: defs.map(d => ({ file: d.location.path, value: d.value, id: d.id })),
  })),
  rawVarUseCount: rawVarUses.length,
  rawVarUsesByToken: Object.fromEntries(rawUseCountByToken),
  graphUsesTokenEdges: usesTokenEdges.length,
  usesTokenEdges: usesTokenEdges.map(e => ({ from: e.from, to: e.to })),
  fileLevelEdges: fileEdges.length,
  componentLevelEdges: componentEdges.length,
  tokensWithoutFileEdges,
  pages: pages.map(p => ({ id: p.id, kind: p.kind, label: p.label })),
  pageEdgeKinds: [...new Set(edgesTouchingPages.map(e => e.kind))],
  edgeKindsPresent: [...new Set(graph.edges.map(e => e.kind))],
  componentCount: graph.nodes.filter(n => n.kind === 'component').length,
}

console.log(JSON.stringify(report, null, 2))
if (jsonOut) fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))

if (assertMode) {
  const checks = [
    ['token labels extracted (>=11)', tokenByLabel.size >= 11],
    ['--accent declared in 4 places (2 scopes × src+dist)', (tokenByLabel.get('--accent') ?? []).length === 4],
    ['theme override makes every brand token non-unique (no src file edge for --accent)',
      !fileEdges.some(e => e.to === (tokenByLabel.get('--accent') ?? [])[0]?.id)],
    ['graph uses-token edges <= 1 (current boundary: unique-definition gate + dist artifact)',
      usesTokenEdges.length <= 1],
    ['any graph edge is into committed dist build output', usesTokenEdges.some(e => e.from.includes('dist/') || e.to.includes('dist/'))],
    ['raw var() ground truth >= 200 while graph edges <= 1 (coverage gap documented)',
      rawVarUses.length >= 200 && usesTokenEdges.length <= 1],
    ['zero page nodes for HashRouter project (page impact impossible)',
      pages.length === 0 && edgesTouchingPages.length === 0],
    ['chained token --skill-color aliases var(--accent)',
      (tokenByLabel.get('--skill-color') ?? []).some(d => d.value === 'var(--accent)')],
    ['fallback-only token --accent-color has no definition',
      !tokenByLabel.has('--accent-color') && (rawUseCountByToken.get('--accent-color') ?? 0) >= 1],
  ]
  let failed = 0
  for (const [name, ok] of checks) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed++
  }
  if (failed > 0) {
    console.error(`css-token-probe: ${failed} boundary assertion(s) failed`)
    process.exit(1)
  }
  console.log('css-token-probe: current unsupported boundary confirmed (regression baseline)')
}
