/** Ripple B — CSS Custom Properties source-evidence probe (Issue #6 P1, v5).
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
 *  Frozen historical result (A core 2f2e5a7; see separate regression CI job):
 *    - 11 distinct token labels extracted, values + file/offset captured
 *      (declaration chain is REAL and source-proven).
 *    - 252 raw var(--x) occurrences (126 src-level, all tracked CSS files —
 *      consumers-only stylesheets included) vs ONE uses-token graph edge —
 *      a per-file ordering artifact pointing INTO the committed dist/ build
 *      artifact; src-level graph edges = 0.
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
 *  Modes and exit codes:
 *    (default)     dump the full report JSON to stdout (--json also writes it)
 *    --assert      frozen regression baseline for the HISTORICAL unsupported
 *                  boundary (9 facts). Exit 0 = boundary unchanged, 1 = drift
 *                  or execution error. This baseline is intentionally kept even
 *                  after the capability lands, so the old evidence is never
 *                  overwritten by new-capability runs.
 *    --acceptance  AC-P6 capability acceptance checklist. Every item is
 *                  COMPUTED from the actual SourceGraph. Exit codes:
 *                  0 = all capability items pass;
 *                  2 = run completed but capability items are still missing
 *                      (the current public A-core branch is not ready);
 *                  1 = execution error / bad artifacts.
 *                  --expect-core-sha <sha> optionally pins the A-core identity.
 *                  A machine-readable acceptance report is printed and
 *                  written with --json.
 *
 *  Usage:
 *    node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *      scripts/b-css-token-probe.mjs <project-root> [--assert|--acceptance] [--json <out>]
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import { analyzeProject } from '../src/core/project.ts'
import { evaluateAc62, evaluateAc64, exactDefinitionNodes, matchExactRoutes, selectorClassTokens, sourceByteOffset as graphByteOffset } from './b-acp6-matching.mjs'

const STANDARD_NODE_FIELDS = new Set(['id', 'kind', 'label', 'value', 'location'])
const TARGET_SHA = 'b244f857457d2a07f118155602eef9097fd322bd'
const EXPECTED_FIXTURE = { srcCssFiles: 7, srcDefinitions: 18, srcTokenLabels: 11, srcVarUses: 126 }

function git(root, args) {
  return execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trim()
}

function sha256(value) {
  return createHash('sha256').update(value).digest('hex')
}

function assertPinnedProject(root) {
  const head = git(root, ['rev-parse', 'HEAD'])
  if (head !== TARGET_SHA) throw new Error(`wrong third-party project SHA: expected ${TARGET_SHA}, got ${head}`)
  const dirty = git(root, ['status', '--porcelain', '--untracked-files=normal'])
  if (dirty) throw new Error(`third-party project must be clean before analysis:\n${dirty}`)
  const target = path.join(root, 'src/css/style.css')
  if (!fs.existsSync(target)) throw new Error(`required fixed-project source is missing: ${target}`)
  return { sha: head, targetFileSha256: sha256(fs.readFileSync(target)) }
}

function sourcePath(node) {
  return node?.location?.path ?? node?.file ?? node?.sourceFile ?? null
}

function sourceOffset(node) {
  const value = node?.offset ?? node?.location?.offset ?? node?.range?.start ?? node?.sourceRange?.start
  return Number.isInteger(value) ? value : null
}

function sourcePosition(node) {
  const location = node?.location ?? node
  const line = location?.line ?? location?.start?.line
  const column = location?.column ?? location?.start?.column
  const offset = sourceOffset(node)
  return { offset, line: Number.isInteger(line) ? line : null, column: Number.isInteger(column) ? column : null }
}

function sourceScope(node) {
  const value = node?.selectorScope ?? node?.location?.selectorScope ?? node?.scope?.selector ?? node?.scope ?? node?.tokenScope?.selectorScope ?? node?.selector ?? null
  return typeof value === 'string' ? value : value?.selector ?? value?.selectorScope ?? null
}

function hasSourcePosition(value) {
  const location = value?.location ?? value
  return Boolean(
    (typeof location?.path === 'string' || typeof value?.file === 'string') &&
    (Number.isInteger(location?.offset) || Number.isInteger(value?.offset) || Number.isInteger(location?.line) || Number.isInteger(location?.start?.line)),
  )
}

function describe(value) {
  try { return JSON.stringify(value) } catch { return String(value) }
}

function main() {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
  const root = path.resolve(process.argv[2] ?? '.')
  const assertMode = process.argv.includes('--assert')
  const acceptanceMode = process.argv.includes('--acceptance')
  if (assertMode && acceptanceMode) throw new Error('choose either --assert or --acceptance')
  const expectedCoreIdx = process.argv.indexOf('--expect-core-sha')
  const expectedCoreSha = expectedCoreIdx >= 0 ? process.argv[expectedCoreIdx + 1] : null
  if (expectedCoreIdx >= 0 && (!expectedCoreSha || expectedCoreSha.startsWith('--'))) throw new Error('--expect-core-sha requires a SHA')
  const jsonOutIdx = process.argv.indexOf('--json')
  const jsonOut = jsonOutIdx >= 0 ? process.argv[jsonOutIdx + 1] : null
  if (jsonOutIdx >= 0 && (!jsonOut || jsonOut.startsWith('--'))) throw new Error('--json requires an output path')

  const projectIdentity = assertPinnedProject(root)
  const aCoreSha = git(repoRoot, ['rev-parse', 'HEAD'])
  if (expectedCoreSha && aCoreSha !== expectedCoreSha) throw new Error(`wrong A core SHA: expected ${expectedCoreSha}, got ${aCoreSha}`)

  const graph = analyzeProject(root, true)
  if (!graph || !Array.isArray(graph.nodes) || !Array.isArray(graph.edges)) {
    throw new Error(`analyzeProject returned an invalid SourceGraph: ${describe(graph)}`)
  }
  if (graph.nodes.length === 0 || graph.edges.length === 0 ||
      graph.nodes.some(node => !node || typeof node.id !== 'string' || typeof node.kind !== 'string') ||
      graph.edges.some(edge => !edge || typeof edge.from !== 'string' || typeof edge.to !== 'string' || typeof edge.kind !== 'string') ||
      (graph.unresolved != null && !Array.isArray(graph.unresolved))) {
    throw new Error(`analyzeProject returned an incomplete SourceGraph shape: ${describe({ nodes: graph.nodes.length, edges: graph.edges.length, unresolvedType: typeof graph.unresolved })}`)
  }
  const nodeById = new Map(graph.nodes.map(n => [n.id, n]))

  const tokens = graph.nodes.filter(n => n.kind === 'token')
  const tokenByLabel = new Map()
  for (const t of tokens) {
    if (!tokenByLabel.has(t.label)) tokenByLabel.set(t.label, [])
    tokenByLabel.get(t.label).push(t)
  }
  const cssFiles = [...new Set(tokens.map(sourcePath).filter(Boolean))]

  // -------------------------------------------------------------------------
  // Ground truth with rule context. Cover EVERY tracked CSS file — including
  // consumers-only stylesheets (footer.css/nav.css/interests.css here) that
  // contain no token definitions. Deriving the file list from the graph would
  // silently drop 38 of 126 src-level var() occurrences.
  // -------------------------------------------------------------------------
  const stripComments = css => css.replace(/\/\*[\s\S]*?\*\//g, m => ' '.repeat(m.length))

  /** Minimal CSS block parser: frames with prelude, inherited media context
   *  and char range. Heuristic; provenance recorded per finding. */
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
      } else if (ch === ';' && (stack.length === 0 || !/^@(media|supports|keyframes|font-face|import|charset)/i.test(stack[stack.length - 1].prelude))) {
        pending = ''
        preludeStart = i + 1
      } else {
        pending += ch
      }
    }
    return frames
  }

  const enclosingFrame = (frames, index) => {
    let best = null
    for (const f of frames) {
      if (index > f.start && index < f.end && (!best || f.start > best.start)) best = f
    }
    return best
  }

  /** Static consumer-element mapping: selector class → jsx source files that
   *  reference the class in className=. Semantic-candidate certainty: real DOM
   *  proof requires a browser (see b-css-token-browser-baseline). */
  function buildClassIndex(rootDir) {
    const files = execFileSync('git', ['ls-files', '*.jsx', '*.js', '*.tsx', '*.ts'], { cwd: rootDir, encoding: 'utf8' })
      .split('\n').filter(f => f && !f.startsWith('dist/'))
    const index = new Map()
    const dynamicClassFiles = []
    for (const f of files) {
      const abs = path.join(rootDir, f)
      if (!fs.existsSync(abs)) throw new Error(`tracked source file is missing from fixed checkout: ${f}`)
      const src = fs.readFileSync(abs, 'utf8')
      const add = (cls, candidate) => {
        if (!cls) return
        if (!index.has(cls)) index.set(cls, [])
        index.get(cls).push(candidate)
      }
      const component = path.basename(f).replace(/\.[^.]+$/, '')
      const staticElements = /<([A-Za-z][\w.:-]*)\b[^>]*?\bclassName\s*=\s*(["'])(.*?)\2[^>]*>/gs
      for (const m of src.matchAll(staticElements)) {
        const className = m[3]
        for (const cls of className.trim().split(/\s+/)) {
          add(cls, { file: f, component, matchedClass: cls, className, elementOffset: m.index, dynamic: false, certainty: 'source-positioned-static-classname' })
        }
      }
      const dynamicElements = /<([A-Za-z][\w.:-]*)\b[^>]*?\bclassName\s*=\s*\{([^}]*?)\}/gs
      for (const m of src.matchAll(dynamicElements)) {
        dynamicClassFiles.push(f)
        const expressionStrings = [...m[2].matchAll(/["'\x60]([^"'\x60]+)["'\x60]/g)]
        for (const literal of expressionStrings) {
          for (const cls of literal[1].trim().split(/\s+/)) {
            add(cls, { file: f, component, matchedClass: cls, className: null, elementOffset: m.index, dynamic: true, certainty: 'dynamic-classname-unresolved' })
          }
        }
      }
    }
    return { index, dynamicClassFiles, files }
  }

  const { index: classIndex, dynamicClassFiles } = buildClassIndex(root)
  const rawCssFiles = execFileSync('git', ['ls-files', '*.css'], { cwd: root, encoding: 'utf8' }).split('\n').filter(Boolean)
  const missingCssFiles = rawCssFiles.filter(f => !fs.existsSync(path.join(root, f)))
  if (missingCssFiles.length) throw new Error(`tracked CSS source files are missing from fixed checkout: ${missingCssFiles.join(', ')}`)

  const rawVarUses = []
  const definitionsRaw = []
  for (const f of rawCssFiles) {
    const abs = path.join(root, f)
    if (fs.lstatSync(abs).isSymbolicLink()) throw new Error(`tracked CSS source file is a symlink, expected plain file: ${f}`)
    const cssBytes = fs.readFileSync(abs)
    const css = cssBytes.toString('utf8')
    const stripped = stripComments(css)
    const frames = parseRuleFrames(stripped)
    for (const m of stripped.matchAll(/(--[\w-]+)\s*:\s*([^;{}]+)/g)) {
      const frame = enclosingFrame(frames, m.index)
      definitionsRaw.push({
        file: f, srcLevel: !f.startsWith('dist/'), token: m[1], value: m[2].trim(),
        offset: m.index,
        byteOffset: Buffer.byteLength(css.slice(0, m.index), 'utf8'),
        selector: frame && !frame.prelude.startsWith('@') ? frame.prelude : (frame ? frame.prelude : '<top-level>'),
        media: frame ? frame.media : [],
      })
    }
    for (const m of stripped.matchAll(/var\(\s*(--[\w-]+)/g)) {
      const frame = enclosingFrame(frames, m.index)
      const selector = frame && !frame.prelude.startsWith('@') ? frame.prelude : (frame ? frame.prelude : '<top-level>')
      const classes = selectorClassTokens(selector)
      const consumerElements = []
      for (const cls of classes) {
        consumerElements.push(...(classIndex.get(cls) ?? []))
      }
      rawVarUses.push({
        file: f, srcLevel: !f.startsWith('dist/'), token: m[1], index: m.index,
        byteOffset: Buffer.byteLength(css.slice(0, m.index), 'utf8'),
        selector, media: frame ? frame.media : [],
        pseudoClasses: selector.includes(':') ? [...selector.matchAll(/::?[a-z-]+(?:\([^)]*\))?/gi)].map(p => p[0]) : [],
        consumerElements,
        consumerElementProof: 'static-only — browser computed-style baseline: scripts/b-css-token-browser-baseline.mjs',
      })
    }
  }

  const fixtureFacts = {
    srcCssFiles: rawCssFiles.filter(f => f.startsWith('src/')).length,
    srcDefinitions: definitionsRaw.filter(d => d.srcLevel).length,
    srcTokenLabels: new Set(definitionsRaw.filter(d => d.srcLevel).map(d => d.token)).size,
    srcVarUses: rawVarUses.filter(u => u.srcLevel).length,
  }
  if (Object.entries(EXPECTED_FIXTURE).some(([key, expected]) => fixtureFacts[key] !== expected)) {
    throw new Error(`fixed-project ground-truth drift: expected ${describe(EXPECTED_FIXTURE)}, got ${describe(fixtureFacts)}`)
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

  const groupKey = u => `${u.token}|${u.selector}|${u.media.join(' ')}`
  const consumerGroupsMap = new Map()
  for (const u of rawVarUses.filter(u => u.srcLevel)) {
    if (!consumerGroupsMap.has(groupKey(u))) consumerGroupsMap.set(groupKey(u), { token: u.token, selector: u.selector, media: u.media, pseudoClasses: u.pseudoClasses, occurrenceCount: 0, consumerElements: new Map() })
    const g = consumerGroupsMap.get(groupKey(u))
    g.occurrenceCount++
    for (const el of u.consumerElements) {
      const k = [g.token, el.file, el.elementOffset, el.matchedClass, el.dynamic].join('|')
      if (!g.consumerElements.has(k)) g.consumerElements.set(k, { ...el })
    }
  }
  const consumerGroups = [...consumerGroupsMap.values()].map(g => ({ ...g, consumerElements: [...g.consumerElements.values()] }))

  // -------------------------------------------------------------------------
  // AC-P6 acceptance is computed against both the pinned source ground truth
  // and the actual SourceGraph returned by this A-core SHA. Missing evidence
  // is PENDING only after the checkout, graph, and fixture have validated.
  // Invalid inputs/graph shapes throw and become ERROR (exit 1).
  // -------------------------------------------------------------------------
  const scopeFieldsOf = node => Object.keys(node).filter(k => !STANDARD_NODE_FIELDS.has(k))
  const sourceDeclarations = definitionsRaw.filter(d => d.srcLevel)
  const repeatedSourceTokens = [...new Set(sourceDeclarations.map(d => d.token))]
    .filter(token => sourceDeclarations.filter(d => d.token === token).length > 1)
  const expectedRouteSource = fs.readFileSync(path.join(root, 'src/App.jsx'), 'utf8')
  if (!/\bHashRouter\b/.test(expectedRouteSource)) throw new Error('fixed fixture route contract drift: src/App.jsx no longer declares HashRouter')
  const expectedRoutes = [...expectedRouteSource.matchAll(/<Route\s+path=["']([^"']+)["']/g)].map(match => match[1])
  if (expectedRoutes.length !== 7 || new Set(expectedRoutes).size !== expectedRoutes.length) {
    throw new Error(`fixed fixture route contract drift: expected seven unique HashRouter paths, got ${describe(expectedRoutes)}`)
  }

  const definitionNodeMatches = declaration => exactDefinitionNodes(declaration, tokens)
  const scopedDefinitions = sourceDeclarations.filter(d => repeatedSourceTokens.includes(d.token))
  const scopedDefinitionEvidence = scopedDefinitions.map(declaration => {
    const matches = definitionNodeMatches(declaration)
    return {
      token: declaration.token,
      file: declaration.file,
      offset: declaration.offset,
      byteOffset: declaration.byteOffset,
      selectorScope: declaration.selector,
      graphNodeIds: matches.map(node => node.id),
      graphFields: matches.map(scopeFieldsOf),
      matchedExactlyOnce: matches.length === 1,
    }
  })
  const scopedIdentityPass = scopedDefinitions.length > 0 &&
    scopedDefinitionEvidence.every(item => item.matchedExactlyOnce) &&
    repeatedSourceTokens.every(token => {
      const ids = scopedDefinitionEvidence.filter(item => item.token === token).flatMap(item => item.graphNodeIds)
      return ids.length === new Set(ids).size
    })
  const ac61 = {
    id: 'AC6.1',
    name: 'scoped token identity ({file,byteOffset,selectorScope}); same-name scoped definitions are distinct nodes',
    pass: scopedIdentityPass,
    detail: {
      repeatedSourceTokens,
      scopedDefinitionEvidence,
      groundTruth: 'source declarations are independently parsed from the fixed CSS files; graph nodes must match path, UTF-8 byte offset, selector scope, and unique node identity',
    },
  }

  const srcUsedTokens = [...new Set(rawVarUses.filter(u => u.srcLevel).map(u => u.token))]
    .filter(token => sourceDeclarations.some(d => d.token === token))
  const ac62Coverage = evaluateAc62({
    declarations: sourceDeclarations.filter(declaration => srcUsedTokens.includes(declaration.token)),
    uses: rawVarUses.filter(use => use.srcLevel && srcUsedTokens.includes(use.token)),
    nodes: graph.nodes,
    edges: usesTokenEdges,
  })
  const declarationSetCoverage = ac62Coverage.declarationSetCoverage
  const ac62 = {
    id: 'AC6.2',
    name: 'uses-token edges bind the scoped declaration, exact var() source, and exact consumer element',
    pass: ac62Coverage.pass,
    detail: {
      srcUsedTokens,
      coveredTokens: ac62Coverage.coveredTokens,
      uncoveredTokens: ac62Coverage.uncoveredTokens,
      declarationSetCoverage,
      sourceUsesTokenEdges: srcLevelEdges.length,
      matchingContract: 'token node path+UTF-8 byte offset+selector scope; consumer endpoint kind/path+JSX element offset+exact class token; edge sourceUse/evidenceRef must match the var() path+offset',
    },
  }

  const routeMatch = matchExactRoutes(expectedRoutes, pages)
  const matchedRoutes = routeMatch.matches
  const ac63 = {
    id: 'AC6.3',
    name: 'HashRouter paths map one-to-one to normalized exact route identities in SourceGraph',
    pass: routeMatch.pass,
    detail: {
      expectedRoutes,
      matchedRoutes,
      pageNodes: pages.map(p => ({ id: p.id, kind: p.kind, label: p.label, routePath: p.routePath, path: p.path, page: p.page })),
      matchingContract: 'normalize hash/route prefix, duplicate and trailing slashes; exact path equality only; one distinct node per expected route',
    },
  }

  const elementKinds = new Set(['jsx-element', 'host-element', 'element'])
  const elementAnchoredEdges = usesTokenEdges.filter(edge => {
    const endpoints = [nodeById.get(edge.from), nodeById.get(edge.to)].filter(Boolean)
    return endpoints.some(node => node.kind === 'token') && endpoints.some(node => elementKinds.has(node.kind))
  })
  const consumerPairs = new Map()
  for (const use of rawVarUses.filter(item => item.srcLevel && srcUsedTokens.includes(item.token))) {
    for (const element of use.consumerElements) {
      const key = [use.token, element.file, element.elementOffset, element.matchedClass, element.dynamic].join('|')
      if (!consumerPairs.has(key)) consumerPairs.set(key, {
        token: use.token,
        file: element.file,
        component: element.component,
        elementOffset: element.elementOffset,
        matchedClass: element.matchedClass,
        className: element.className,
        dynamic: element.dynamic,
        certainty: element.certainty,
        sourceUses: [],
      })
      consumerPairs.get(key).sourceUses.push({ file: use.file, index: use.index, byteOffset: use.byteOffset, selector: use.selector })
    }
  }
  const expectedConsumerPairs = [...consumerPairs.values()]
  const ac64Coverage = evaluateAc64({
    pairs: expectedConsumerPairs,
    declarations: sourceDeclarations,
    uses: rawVarUses.filter(use => use.srcLevel),
    nodes: graph.nodes,
    edges: usesTokenEdges,
  })
  const anchoredConsumerPairs = ac64Coverage.anchoredConsumerPairs
  const ac64 = {
    id: 'AC6.4',
    name: 'each token consumer has an exact source-positioned element edge; unresolved dynamic classes remain pending',
    pass: ac64Coverage.pass && dynamicClassFiles.length === 0,
    detail: {
      expectedStaticAndDynamicConsumerPairs: expectedConsumerPairs.length,
      anchoredConsumerPairs,
      uncoveredConsumerPairs: ac64Coverage.uncoveredConsumerPairs,
      elementAnchoredEdges: elementAnchoredEdges.map(edge => ({ from: edge.from, to: edge.to, provenance: edge.provenance ?? edge.certainty ?? null })),
      componentLevelEdgesTotal: componentEdges.length,
      dynamicClassNameFiles: dynamicClassFiles,
      unresolvedDynamicClassGate: dynamicClassFiles.length === 0 ? 'none' : 'PENDING: dynamic className expressions may produce additional consumers without exact static source evidence',
      matchingContract: 'className is a whitespace-token set; matchedClass and selector class tokens are exact; node path and JSX element source offset must identify the same source element',
    },
  }

  const srcFallbackUses = rawVarUses.filter(use => use.srcLevel && use.token === '--accent-color')
  const fallbackUnresolved = (Array.isArray(graph.unresolved) ? graph.unresolved : []).filter(record =>
    describe(record).includes('--accent-color') && hasSourcePosition(record))
  const fallbackUnknownEdges = graph.edges.filter(edge => {
    if (!/unknown/i.test(String(edge.certainty ?? edge.status ?? '')) || !describe(edge).includes('--accent-color')) return false
    const endpoints = [nodeById.get(edge.from), nodeById.get(edge.to)].filter(Boolean)
    return endpoints.some(node => String(sourcePath(node) ?? '').startsWith('src/') && hasSourcePosition(node))
  })
  const sourcePositionMatches = (record, use) => {
    const location = record?.location ?? record
    const recordPath = location?.path ?? record?.file
    if (recordPath !== use.file) return false
    const recordOffset = location?.offset ?? record?.offset ?? location?.start?.offset
    if (Number.isInteger(recordOffset)) return recordOffset === use.index
    const source = fs.readFileSync(path.join(root, use.file), 'utf8').slice(0, use.index)
    const line = source.split('\n').length
    const column = source.length - source.lastIndexOf('\n') - 1
    const position = sourcePosition(record)
    return position.line === line && (position.column === column || position.column === column + 1)
  }
  const fallbackSourcePositions = srcFallbackUses.map(use => {
    const unresolved = fallbackUnresolved.filter(record => {
      return sourcePositionMatches(record, use)
    })
    const unknownEdges = fallbackUnknownEdges.filter(edge => {
      const endpoints = [nodeById.get(edge.from), nodeById.get(edge.to)].filter(Boolean)
      return endpoints.some(node => sourcePath(node) === use.file && sourcePositionMatches(node, use))
    })
    return {
      file: use.file,
      offset: use.index,
      selector: use.selector,
      matchingUnresolvedRecords: unresolved.length,
      matchingUnknownEdges: unknownEdges.length,
      recorded: unresolved.length > 0 || unknownEdges.length > 0,
    }
  })
  const ac65 = {
    id: 'AC6.5',
    name: 'undefined-variable fallback consumers kept as explicit unknowns at their source positions',
    pass: srcFallbackUses.length > 0 && fallbackSourcePositions.every(item => item.recorded),
    detail: {
      srcFallbackUses: fallbackSourcePositions,
      unresolvedMarkers: fallbackUnresolved,
      unknownEdges: fallbackUnknownEdges.length,
      groundTruth: '--accent-color has no CSS definition in the fixed checkout; each source use must remain explicitly unknown at its source offset',
    },
  }
  const acceptanceItems = [ac61, ac62, ac63, ac64, ac65].map(item => ({
    ...item,
    status: item.pass ? 'PASS' : 'PENDING',
  }))

  // -------------------------------------------------------------------------
  // Independent positive / negative cases — all computed.
  // -------------------------------------------------------------------------
  const lightScope = definitionsRaw.filter(d => d.srcLevel && d.selector.includes('[data-theme="light"]'))
  const rootScope = definitionsRaw.filter(d => d.srcLevel && d.selector === ':root')
  const tokenToTokenEdges = usesTokenEdges.filter(e => nodeById.get(e.from)?.kind === 'token' && nodeById.get(e.to)?.kind === 'token')
  const cases = {
    'case-definitions-extracted-positive': {
      expectation: 'all src-level token definitions extracted with values',
      pass: definitionsRaw.filter(d => d.srcLevel).length >= 11,
      evidence: `${definitionsRaw.filter(d => d.srcLevel).length} src-level definitions across 1 file, 11 distinct labels`,
    },
    'case-dual-theme-override-negative': {
      expectation: 'graph distinguishes :root vs [data-theme=light] definitions of the same token',
      groundTruth: `${lightScope.length} light-scope definitions vs ${rootScope.length} root-scope definitions (src level)`,
      graphDistinguishesScopes: ac61.pass,
      pass: ac61.pass,
    },
    'case-hashrouter-pages-negative': {
      expectation: 'HashRouter <Route element> routes recognised as page nodes',
      groundTruth: '7 routes declared in src/App.jsx (HashRouter)',
      pageNodes: pages.length,
      matchedRoutes,
      pass: ac63.pass,
    },
    'case-chained-alias-negative': {
      expectation: 'chained token --skill-color: var(--accent) produces a token→token reference edge',
      groundTruth: 'src/css/style.css .skills-section .skill-badge declares --skill-color: var(--accent)',
      tokenToTokenEdges: tokenToTokenEdges.length,
      pass: tokenToTokenEdges.length >= 1,
    },
    'case-fallback-consumer-negative': {
      expectation: 'var(--accent-color, var(--accent)) consumers recorded as unknown/fallback, not dropped',
      groundTruth: '3 src-level uses of undefined --accent-color with fallback to --accent',
      unknownMarkersForUndefinedVars: ac65.pass,
      pass: ac65.pass,
    },
    'case-media-query-context-negative': {
      expectation: 'media-query consumers carry responsive context on graph edges',
      groundTruth: 'src/css/nav.css @media(max-width:768px) consumes var(--border-color)',
      mediaContexts: [...new Set(rawVarUses.filter(u => u.srcLevel && u.media.length).map(u => `${u.file}:${u.media.join(',')}`))],
      edgesCarryingMediaContext: graph.edges.filter(e => /media/i.test(Object.keys(e).join(''))).length,
      pass: graph.edges.some(e => /media/i.test(Object.keys(e).join(''))),
    },
  }

  const regressionChecks = [
    { id: 'R1', name: '11 token labels extracted', pass: tokenByLabel.size === 11 },
    { id: 'R2', name: '--accent has four source+dist declarations', pass: (tokenByLabel.get('--accent') ?? []).length === 4 },
    { id: 'R3', name: 'historical graph has no source uses-token edge to --accent', pass: !usesTokenEdges.some(edge => {
      const endpoints = [nodeById.get(edge.from), nodeById.get(edge.to)].filter(Boolean)
      return endpoints.some(node => node.label === '--accent' && String(sourcePath(node) ?? '').startsWith('src/'))
    }) },
    { id: 'R4', name: 'historical graph has at most one uses-token edge', pass: usesTokenEdges.length <= 1 },
    { id: 'R5', name: 'historical graph edge retains committed dist artifact boundary', pass: distEdges.length >= 1 || usesTokenEdges.some(edge => String(edge.from).includes('dist/') || String(edge.to).includes('dist/')) },
    { id: 'R6', name: 'raw var() ground truth exceeds graph coverage by historical boundary', pass: rawVarUses.length >= 200 && usesTokenEdges.length <= 1 },
    { id: 'R7', name: 'historical graph has no page nodes or page-impact edges', pass: pages.length === 0 && edgesTouchingPages.length === 0 },
    { id: 'R8', name: 'source graph contains chained --skill-color alias declaration', pass: (tokenByLabel.get('--skill-color') ?? []).some(node => node.value === 'var(--accent)') },
    { id: 'R9', name: 'undefined fallback token is absent while source uses exist', pass: !tokenByLabel.has('--accent-color') && rawVarUses.some(use => use.srcLevel && use.token === '--accent-color') },
  ].map(item => ({ ...item, status: item.pass ? 'PASS' : 'FAIL' }))
  const regression = {
    status: regressionChecks.every(item => item.pass) ? 'PASS' : 'FAIL',
    items: regressionChecks,
    passed: regressionChecks.filter(item => item.pass).length,
    total: regressionChecks.length,
  }
  const acceptance = {
    mode: 'AC-P6 capability acceptance',
    status: acceptanceItems.every(item => item.pass) ? 'PASS' : 'PENDING',
    items: acceptanceItems,
    passed: acceptanceItems.filter(item => item.pass).length,
    pending: acceptanceItems.filter(item => !item.pass).length,
    error: 0,
    total: acceptanceItems.length,
  }

  const report = {
    schemaVersion: 2,
    generatedBy: 'scripts/b-css-token-probe.mjs (v5)',
    runMode: assertMode ? 'historical-boundary-regression' : acceptanceMode ? 'current-capability-acceptance' : 'observation',
    status: assertMode ? regression.status : acceptanceMode ? acceptance.status : 'OBSERVED',
    project: { sha: projectIdentity.sha, targetFile: 'src/css/style.css', targetFileSha256: projectIdentity.targetFileSha256, fixtureGroundTruth: fixtureFacts },
    aCore: { sha: aCoreSha, expectedSha: expectedCoreSha },
    graphStats: {
      nodes: graph.nodes.length,
      edges: graph.edges.length,
      unresolved: Array.isArray(graph.unresolved) ? graph.unresolved.length : null,
      unresolvedDetail: graph.unresolved ?? [],
    },
    splitStats,
    cssFiles,
    tokenDefinitions: [...tokenByLabel.entries()].map(([label, defs]) => ({
      label,
      definitionCount: defs.length,
      definitions: defs.map(d => ({ file: sourcePath(d), value: d.value, id: d.id, offset: sourceOffset(d), byteOffset: graphByteOffset(d), selectorScope: sourceScope(d) })),
    })),
    rawVarUseCount: rawVarUses.length,
    rawVarUsesByToken: Object.fromEntries([...new Set(rawVarUses.map(u => u.token))].map(t => [t, rawVarUses.filter(u => u.token === t).length])),
    consumerGroups,
    dynamicClassNameFiles: dynamicClassFiles,
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
    regression,
    acceptance,
  }

  console.log(JSON.stringify(report, null, 2))
  if (jsonOut) {
    fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true })
    fs.writeFileSync(jsonOut, JSON.stringify(report, null, 2))
  }

  if (assertMode) {
    for (const item of regression.items) console.log(`${item.status}  ${item.id}  ${item.name}`)
    if (regression.status !== 'PASS') {
      console.error(`css-token-probe: historical regression drift (${regression.passed}/${regression.total})`)
      return 1
    }
    console.log('css-token-probe: current unsupported boundary confirmed (regression baseline)')
  }

  if (acceptanceMode) {
    for (const item of acceptanceItems) {
      console.log(`${item.status}  ${item.id}  ${item.name}`)
    }
    if (acceptance.status === 'PASS') {
      console.log('css-token-probe: AC-P6 capability acceptance satisfied — flip the CI job to required')
      return 0
    }
    console.log(`css-token-probe: ${acceptance.passed}/${acceptance.total} AC-P6 capability items passed (exit 2 = current A-core capability pending)`)
    return 2
  }
  return assertMode && regression.status !== 'PASS' ? 1 : 0
}

try {
  const code = main()
  process.exitCode = code
} catch (error) {
  console.error('css-token-probe: execution error:', error instanceof Error ? (error.stack ?? error.message) : String(error))
  const jsonOutIdx = process.argv.indexOf('--json')
  const jsonOut = jsonOutIdx >= 0 ? process.argv[jsonOutIdx + 1] : null
  if (jsonOut && !jsonOut.startsWith('--')) {
    try {
      fs.mkdirSync(path.dirname(path.resolve(jsonOut)), { recursive: true })
      fs.writeFileSync(jsonOut, JSON.stringify({
        schemaVersion: 2,
        generatedBy: 'scripts/b-css-token-probe.mjs (v5)',
        runMode: process.argv.includes('--assert') ? 'historical-boundary-regression' : process.argv.includes('--acceptance') ? 'current-capability-acceptance' : 'observation',
        status: 'ERROR',
        error: error instanceof Error ? { name: error.name, message: error.message, stack: error.stack ?? null } : { message: String(error) },
      }, null, 2))
    } catch (writeError) {
      console.error('css-token-probe: failed to write ERROR report:', writeError instanceof Error ? writeError.message : String(writeError))
    }
  }
  process.exitCode = 1
}
