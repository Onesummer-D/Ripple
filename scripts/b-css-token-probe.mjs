/** Ripple B — CSS Custom Properties source-evidence probe (Issue #6 P1, v2).
 *
 *  Runs A-core analyzeProject against a REAL third-party React/Vite project
 *  that consumes pure CSS Custom Properties, and measures the gap between
 *  ground truth (raw var(--x) recount with rule context) and the graph's
 *  uses-token coverage.
 *
 *  Reference project: allanhue/webportflio @ b244f857457d2a07f118155602eef9097fd322bd
 *  (MIT, License file in repo; React 18 + Vite, HashRouter, ThemeContext toggles
 *  data-theme at runtime; theme variables declared twice — :root and
 *  [data-theme="light"]; upstream commits dist/ build output).
 *
 *  Empirical result (A core 2f2e5a7):
 *    - 11 distinct token labels extracted, values + file/offset captured
 *      (declaration chain is REAL and source-proven).
 *    - 252 raw var(--x) occurrences (126 src-level, all tracked CSS files —
 *      consumers-only stylesheets included) vs ONE uses-token graph
 *      edge — a per-file ordering artifact pointing INTO the committed
 *      dist/ build artifact.
 *    - Root cause of the gap: every brand token is declared in TWO scopes
 *      (:root dark base + [data-theme="light"] override) and dist/ duplicates
 *      them again, so the "exactly one definition" gate drops every real
 *      source-level consumer; scopes/selectors are not modelled at all.
 *    - ZERO page nodes (HashRouter + <Route element> not recognised) →
 *      token → page impact cannot be computed even if file edges existed.
 *    - Chained token (--skill-color: var(--accent)) gets no token→token edge;
 *      var(--accent-color, var(--accent)) fallback consumers are unresolvable
 *      statically (--accent-color is never defined in the project);
 *      runtime theme state (ThemeContext + localStorage) is invisible.
 *
 *  Modes:
 *    (default)          dump the full report JSON to stdout (--json to file)
 *    --assert           frozen regression baseline for the CURRENT unsupported
 *                       boundary (9 facts). Exit 0 = boundary unchanged.
 *    --acceptance       AC-P6 capability acceptance checklist (strict):
 *                       exit 0 only when every contract item passes. While A
 *                       has not implemented AC-P6 this exits 1 — CI treats
 *                       exit 1 as "expected pending", exit 0 as "capability
 *                       landed, flip this job to required", anything else as
 *                       a hard failure. --assert is intentionally NOT turned
 *                       into an expect-all-pass mode.
 *
 *  Usage:
 *    node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *      scripts/b-css-token-probe.mjs <project-root> [--assert|--acceptance] [--json <out>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { analyzeProject } from '../src/core/project.ts'

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const root = path.resolve(process.argv[2] ?? '.')
const assertMode = process.argv.includes('--assert')
const acceptanceMode = process.argv.includes('--acceptance')
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

// ---------------------------------------------------------------------------
// Ground truth with rule context: parse each tracked CSS file, attribute every
// var(--x) occurrence to its enclosing rule (selector + media context +
// pseudo-classes). This is B-side empirical evidence for AC-P6 — the A core
// does not model any of it.
// ---------------------------------------------------------------------------
function stripComments(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))
}

/** Minimal CSS block parser: returns frames with prelude, inherited media
 *  context and char range. Heuristic (strings not special-cased beyond url()
 *  data) — provenance recorded per finding, verified against the source files. */
function parseRuleFrames(css) {
  const frames = []
  const stack = []
  let pending = ''
  let preludeStart = 0
  for (let i = 0; i < css.length; i++) {
    const ch = css[i]
    if (ch === '{') {
      const prelude = pending.trim()
      const parentMedia = stack.length ? [...stack[stack.length - 1].media] : []
      const isMedia = /^@media\b/i.test(prelude)
      const media = isMedia ? [...parentMedia, prelude.match(/^@media[^{]*/i)[0].trim()] : parentMedia
      stack.push({ prelude, media, start: i, preludePos: preludeStart })
      pending = ''
      preludeStart = i + 1
    } else if (ch === '}') {
      const frame = stack.pop()
      if (frame) frames.push({ ...frame, end: i })
      pending = ''
      preludeStart = i + 1
    } else if (ch === ';' && stack.length === 0) {
      pending = ''
      preludeStart = i + 1
    } else if (ch === ';' && stack.length > 0 && !/^@(media|supports|keyframes|font-face|import|charset)/i.test(stack[stack.length - 1].prelude)) {
      // declaration separator inside a style rule: prelude no longer applies
      pending = ''
      preludeStart = i + 1
    } else {
      pending += ch
    }
  }
  return frames
}

function enclosingFrame(frames, index) {
  let best = null
  for (const f of frames) {
    if (index > f.start && index < f.end && (!best || f.start > best.start)) best = f
  }
  return best
}

/** Static consumer-element mapping: selector class → jsx source files that
 *  reference the class in className=/class=. Semantic-candidate certainty:
 *  real DOM proof requires a browser (see acceptance case doc). */
function buildClassIndex(rootDir) {
  const files = execFileSync('git', ['ls-files', '*.jsx', '*.js', '*.tsx', '*.ts'], { cwd: rootDir, encoding: 'utf8' })
    .split('\n').filter(f => f && !f.startsWith('dist/'))
  const index = new Map() // class -> Set<file>
  const dynamicClassFiles = []
  for (const f of files) {
    const abs = path.join(rootDir, f)
    if (!fs.existsSync(abs)) continue
    const src = fs.readFileSync(abs, 'utf8')
    for (const m of src.matchAll(/className\s*=\s*["'`]([^"'`]+)["'`]/g)) {
      for (const cls of m[1].split(/\s+/)) {
        if (!cls) continue
        if (!index.has(cls)) index.set(cls, new Set())
        index.get(cls).add(f)
      }
    }
    if (/className\s*=\s*\{/.test(src)) dynamicClassFiles.push(f)
  }
  return { index, dynamicClassFiles, files }
}

const srcCssFiles = cssFiles.filter(f => !f.startsWith('dist/'))
const distCssFiles = cssFiles.filter(f => f.startsWith('dist/'))
const { index: classIndex, dynamicClassFiles } = buildClassIndex(root)

const rawVarUses = [] // each: {file, srcLevel, token, index, selector, media, pseudoClasses, consumerElements}
const definitionsRaw = []
// Ground truth must cover EVERY tracked CSS file — including consumers-only
// stylesheets (footer.css/nav.css/interests.css here) that contain no token
// definitions and therefore no graph token nodes. Deriving the file list from
// the graph would silently drop 38 of 126 src-level var() occurrences.
const rawCssFiles = execFileSync('git', ['ls-files', '*.css'], { cwd: root, encoding: 'utf8' })
  .split('\n').filter(Boolean)
for (const f of rawCssFiles) {
  const abs = path.join(root, f)
  if (!fs.existsSync(abs) || fs.lstatSync(abs).isSymbolicLink()) continue
  const css = fs.readFileSync(abs, 'utf8')
  const stripped = stripComments(css)
  const frames = parseRuleFrames(stripped)
  for (const m of stripped.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
    const frame = enclosingFrame(frames, m.index)
    definitionsRaw.push({
      file: f, srcLevel: !f.startsWith('dist/'), token: m[1], value: m[2].trim(),
      selector: frame && !frame.prelude.startsWith('@') ? frame.prelude : (frame ? frame.prelude : '<top-level>'),
      media: frame ? frame.media : [],
    })
  }
  for (const m of stripped.matchAll(/var\(\s*(--[\w-]+)/g)) {
    const frame = enclosingFrame(frames, m.index)
    const selector = frame && !frame.prelude.startsWith('@') ? frame.prelude : (frame ? frame.prelude : '<top-level>')
    const classes = [...selector.matchAll(/\.([\w-]+)/g)].map(c => c[1])
    const consumerElements = []
    for (const cls of classes) {
      for (const file of classIndex.get(cls) ?? []) {
        consumerElements.push({
          file,
          component: path.basename(file).replace(/\.[^.]+$/, ''),
          matchedClass: cls,
          certainty: 'semantic-candidate-static-classname',
        })
      }
    }
    rawVarUses.push({
      file: f, srcLevel: !f.startsWith('dist/'), token: m[1], index: m.index,
      selector, media: frame ? frame.media : [],
      pseudoClasses: selector.includes(':') ? [...selector.matchAll(/::?[a-z-]+(?:\([^)]*\))?/gi)].map(p => p[0]) : [],
      consumerElements,
      consumerElementProof: 'static-only — requires browser computed-style for DOM proof',
    })
  }
}

const usesTokenEdges = graph.edges.filter(e => e.kind === 'uses-token')
const srcLevelEdges = usesTokenEdges.filter(e => !e.from.includes('dist/') && !e.to.includes('dist/'))
const distEdges = usesTokenEdges.filter(e => e.from.includes('dist/') || e.to.includes('dist/'))
const componentEdges = usesTokenEdges.filter(e => e.from.startsWith('component:'))

const pages = graph.nodes.filter(n => n.kind === 'page' || /route/i.test(n.kind))
const pageIds = new Set(pages.map(p => p.id))
const edgesTouchingPages = graph.edges.filter(e => pageIds.has(e.from) || pageIds.has(e.to))

const splitStats = {
  src: {
    cssFiles: rawCssFiles.filter(f => !f.startsWith('dist/')),
    definitions: definitionsRaw.filter(d => d.srcLevel).length,
    definitionTokens: new Set(definitionsRaw.filter(d => d.srcLevel).map(d => d.token)).size,
    rawVarUses: rawVarUses.filter(u => u.srcLevel).length,
    usesTokenEdges: srcLevelEdges.length,
  },
  dist: {
    cssFiles: rawCssFiles.filter(f => f.startsWith('dist/')),
    definitions: definitionsRaw.filter(d => !d.srcLevel).length,
    definitionTokens: new Set(definitionsRaw.filter(d => !d.srcLevel).map(d => d.token)).size,
    rawVarUses: rawVarUses.filter(u => !u.srcLevel).length,
    usesTokenEdges: distEdges.length,
  },
}

// Consumer groups: token + selector + media → occurrences + elements.
const groupKey = u => `${u.token}|${u.selector}|${u.media.join(' ')}`
const consumerGroupsMap = new Map()
for (const u of rawVarUses.filter(u => u.srcLevel)) {
  if (!consumerGroupsMap.has(groupKey(u))) consumerGroupsMap.set(groupKey(u), { token: u.token, selector: u.selector, media: u.media, pseudoClasses: u.pseudoClasses, occurrenceCount: 0, consumerElements: new Map() })
  const g = consumerGroupsMap.get(groupKey(u))
  g.occurrenceCount++
  for (const el of u.consumerElements) {
    const k = `${el.file}|${el.component}|${el.matchedClass}`
    if (!g.consumerElements.has(k)) g.consumerElements.set(k, { ...el })
  }
}
const consumerGroups = [...consumerGroupsMap.values()].map(g => ({
  ...g, consumerElements: [...g.consumerElements.values()],
}))

// ---------------------------------------------------------------------------
// Independent positive / negative cases (requested in acceptance review).
// ---------------------------------------------------------------------------
const lightScope = definitionsRaw.filter(d => d.srcLevel && d.selector.includes('[data-theme="light"]'))
const rootScope = definitionsRaw.filter(d => d.srcLevel && d.selector === ':root')
const cases = {
  'case-definitions-extracted-positive': {
    expectation: 'all src-level token definitions extracted with values',
    pass: definitionsRaw.filter(d => d.srcLevel).length >= 11,
    evidence: `${definitionsRaw.filter(d => d.srcLevel).length} src-level definitions across ${srcCssFiles.length} files, 11 distinct labels`,
  },
  'case-dual-theme-override-negative': {
    expectation: 'graph distinguishes :root vs [data-theme=light] definitions of the same token',
    groundTruth: `${lightScope.length} light-scope definitions vs ${rootScope.length} root-scope definitions (src level)`,
    graphDistinguishesScopes: false, // token nodes carry label+value+location only — no selector scope
    pass: false,
  },
  'case-hashrouter-pages-negative': {
    expectation: 'HashRouter <Route element> routes recognised as page nodes',
    groundTruth: '6 routes declared in src/App.jsx (HashRouter)',
    pageNodes: pages.length,
    pass: pages.length >= 6,
  },
  'case-chained-alias-negative': {
    expectation: 'chained token --skill-color: var(--accent) produces a token→token reference edge',
    groundTruth: 'src/css/style.css .skills-section .skill-badge declares --skill-color: var(--accent)',
    tokenToTokenEdges: usesTokenEdges.filter(e => e.to.startsWith('token:') && e.from.startsWith('token:')).length,
    pass: false,
  },
  'case-fallback-consumer-negative': {
    expectation: 'var(--accent-color, var(--accent)) consumers recorded as unknown/fallback, not dropped',
    groundTruth: '6 src-level uses of undefined --accent-color with fallback to --accent',
    unknownMarkersForUndefinedVars: graph.unresolved?.some(u => String(u).includes('--accent-color')) ?? false,
    pass: false,
  },
  'case-media-query-context-negative': {
    expectation: 'media-query consumers carry responsive context',
    groundTruth: 'src/css/nav.css @media(max-width:768px) consumes var(--border-color)',
    mediaContexts: [...new Set(rawVarUses.filter(u => u.srcLevel && u.media.length).map(u => `${u.file}:${u.media.join(',')}`))],
    pass: false,
  },
}

const report = {
  generatedBy: 'scripts/b-css-token-probe.mjs (v2)',
  repoRoot,
  projectRoot: root,
  aCoreNote: 'analyzeProject imported from the A-core checkout this script is transplanted onto',
  graphStats: {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    unresolved: graph.unresolved?.length ?? null,
    unresolvedDetail: graph.unresolved ?? [],
  },
  splitStats,
  cssFiles,
  tokenDefinitions: [...tokenByLabel.entries()].map(([label, defs]) => ({
    label,
    definitionCount: defs.length,
    definitions: defs.map(d => ({ file: d.location.path, value: d.value, id: d.id })),
  })),
  rawVarUseCount: rawVarUses.length,
  rawVarUsesByToken: Object.fromEntries([...new Map(rawVarUses.map(u => [u.token, 0]))].map(([t]) => [t, rawVarUses.filter(u => u.token === t).length])),
  rawVarUsesSrcOnly: rawVarUses.filter(u => u.srcLevel).length,
  consumerGroups,
  dynamicClassNameFiles: dynamicClassFiles, // classnames static mapping cannot see these
  graphUsesTokenEdges: usesTokenEdges.length,
  usesTokenEdges: usesTokenEdges.map(e => ({ from: e.from, to: e.to })),
  srcLevelEdges: srcLevelEdges.length,
  distEdges: distEdges.length,
  componentLevelEdges: componentEdges.length,
  pages: pages.map(p => ({ id: p.id, kind: p.kind, label: p.label })),
  pageEdgeKinds: [...new Set(edgesTouchingPages.map(e => e.kind))],
  edgeKindsPresent: [...new Set(graph.edges.map(e => e.kind))],
  componentCount: graph.nodes.filter(n => n.kind === 'component').length,
  cases,
}

console.log(JSON.stringify(report, null, 2))
if (jsonOut) {
  fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true })
  fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
}

if (assertMode && acceptanceMode) {
  console.error('choose either --assert or --acceptance')
  process.exit(1)
}

if (assertMode) {
  const checks = [
    ['token labels extracted (>=11)', tokenByLabel.size >= 11],
    ['--accent declared in 4 places (2 scopes × src+dist)', (tokenByLabel.get('--accent') ?? []).length === 4],
    ['theme override makes every brand token non-unique (no src file edge for --accent)',
      !usesTokenEdges.some(e => e.to === (tokenByLabel.get('--accent') ?? [])[0]?.id)],
    ['graph uses-token edges <= 1 (current boundary: unique-definition gate + dist artifact)',
      usesTokenEdges.length <= 1],
    ['any graph edge is into committed dist build output', distEdges.length >= 1 || usesTokenEdges.some(e => e.from.includes('dist/'))],
    ['raw var() ground truth >= 200 while graph edges <= 1 (coverage gap documented)',
      rawVarUses.length >= 200 && usesTokenEdges.length <= 1],
    ['zero page nodes for HashRouter project (page impact impossible)',
      pages.length === 0 && edgesTouchingPages.length === 0],
    ['chained token --skill-color aliases var(--accent)',
      (tokenByLabel.get('--skill-color') ?? []).some(d => d.value === 'var(--accent)')],
    ['fallback-only token --accent-color has no definition',
      !tokenByLabel.has('--accent-color') && rawVarUses.some(u => u.token === '--accent-color')],
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

if (acceptanceMode) {
  // AC-P6 capability acceptance checklist (see a-interface-requirements-issue6.md).
  // Strict: exit 0 only when A has implemented the whole contract.
  const tokensWithSrcUses = new Set(rawVarUses.filter(u => u.srcLevel).map(u => u.token)).size
  const tokenComponentEdges = usesTokenEdges.filter(e => e.from.startsWith('component:') || e.from.startsWith('jsx-element:')).length
  const items = [
    ['AC6.1 scoped token identity ({file,offset,selectorScope}); same-name scoped definitions are distinct nodes',
      cases['case-dual-theme-override-negative'].graphDistinguishesScopes],
    ['AC6.2 var() consumption edges connect to the declaration SET (no unique-definition gate); >= half of src-used tokens covered',
      srcLevelEdges.length >= Math.max(1, Math.ceil(tokensWithSrcUses / 2))],
    ['AC6.3 HashRouter <Route element> routes recognised (page nodes >= 6)',
      pages.length >= 6],
    ['AC6.4 element-level anchors: token edges reach components/jsx-elements (not file-level only)',
      tokenComponentEdges >= 1],
    ['AC6.5 undefined-variable fallback consumers kept as explicit unknowns (not dropped)',
      cases['case-fallback-consumer-negative'].unknownMarkersForUndefinedVars],
  ]
  let failed = 0
  for (const [name, ok] of items) {
    console.log(`${ok ? 'PASS' : 'FAIL'}  ${name}`)
    if (!ok) failed++
  }
  if (failed > 0) {
    console.log(`css-token-probe: ${items.length - failed}/${items.length} AC-P6 capability items satisfied — acceptance pending A implementation (exit 1 is the EXPECTED state)`)
    process.exit(1)
  }
  console.log('css-token-probe: AC-P6 capability acceptance satisfied — flip the CI job to required')
}
