import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { ProjectRevision, Relation, RuntimeElementObservation, RuntimeSourceMap, SourceGraph, SourceNode } from './model'
import { findPageOverrideMarkers, readPageOverrideRegistry } from './page-overrides'

export class ProjectReadError extends Error {
  constructor(message: string) { super(message); this.name = 'ProjectReadError' }
}

export interface ProjectSnapshot {
  root: string
  revision: ProjectRevision
  trackedFiles: string[]
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const normalize = (value: string) => path.resolve(value).replaceAll('\\', '/')
const runGit = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd()

function gitRoot(input: string): string {
  const resolved = fs.realpathSync(input)
  let root: string
  try { root = runGit(resolved, ['rev-parse', '--show-toplevel']) }
  catch { throw new ProjectReadError('选定目录不是可读取的 Git 项目') }
  return fs.realpathSync(root)
}

function trackedFiles(root: string): string[] {
  const output = execFileSync('git', ['-C', root, 'ls-files', '-z'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  return output.split('\0').filter(Boolean).sort((a, b) => a.localeCompare(b, 'en'))
}

export function trackedProjectFiles(root: string): string[] { return trackedFiles(gitRoot(root)) }

export function isProjectWorkingTreeClean(input: string): boolean {
  return runGit(gitRoot(input), ['status', '--porcelain', '--untracked-files=normal']) === ''
}

function fileBytes(root: string, relative: string): Uint8Array {
  const absolute = path.resolve(root, relative)
  const rel = path.relative(root, absolute)
  if (!rel || rel === '..' || rel.startsWith(`..${path.sep}`) || path.isAbsolute(rel)) throw new ProjectReadError(`项目路径越界：${relative}`)
  const stat = fs.lstatSync(absolute)
  if (stat.isSymbolicLink()) return Buffer.from(`symlink:${fs.readlinkSync(absolute)}`)
  if (!stat.isFile()) return Buffer.from(`special-file:${stat.mode}`)
  return fs.readFileSync(absolute)
}

export function digestTrackedTree(root: string, files = trackedFiles(gitRoot(root))): string {
  const absoluteRoot = gitRoot(root)
  const hash = createHash('sha256')
  for (const relative of [...new Set(files)].sort((left, right) => left.localeCompare(right, 'en'))) {
    const bytes = fileBytes(absoluteRoot, relative)
    hash.update(String(Buffer.byteLength(relative))).update(':').update(relative).update(':')
      .update(String(bytes.byteLength)).update(':').update(sha256(bytes)).update('\n')
  }
  return hash.digest('hex')
}

function runtimeFingerprint(root: string): string {
  const parts = [`node=${process.version}`, `typescript=${ts.version}`]
  for (const name of ['package.json', 'package-lock.json', 'pnpm-lock.yaml', 'yarn.lock', 'bun.lockb', 'bun.lock']) {
    const candidate = path.join(root, name)
    if (fs.existsSync(candidate) && fs.statSync(candidate).isFile()) parts.push(`${name}=${sha256(fs.readFileSync(candidate))}`)
  }
  return sha256(parts.sort().join('\n'))
}

export function readProjectSnapshot(input: string, requireClean = true): ProjectSnapshot {
  const root = gitRoot(input)
  if (requireClean && !isProjectWorkingTreeClean(root)) {
    throw new ProjectReadError('项目工作树不干净；先提交或收起现有改动，再创建候选')
  }
  const files = trackedFiles(root).filter(file => fs.existsSync(path.join(root, file)))
  const gitCommit = runGit(root, ['rev-parse', 'HEAD'])
  const revision: ProjectRevision = {
    projectId: `project:${sha256(normalize(root)).slice(0, 20)}`,
    sourceDigest: digestTrackedTree(root, files),
    gitCommit,
    ref: runGit(root, ['branch', '--show-current']) || gitCommit,
    runtimeFingerprint: runtimeFingerprint(root),
  }
  return { root, revision, trackedFiles: files }
}

interface ComponentInfo { id: string; name: string; file: string; node: ts.Node }
interface ImportTarget { file: string; exportName: string }

const sourceKindFor = (file: string) => /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
const parseErrors = (source: ts.SourceFile) => (source as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics
const hasJsx = (node: ts.Node): boolean => {
  if (ts.isJsxElement(node) || ts.isJsxSelfClosingElement(node)) return true
  return node.forEachChild(hasJsx) ?? false
}
const nodeId = (file: string, kind: string, offset: number) => `${kind}:${file}#${offset}`
const relativeTo = (root: string, absolute: string) => path.relative(root, absolute).replaceAll('\\', '/')
const jsxTagName = (node: ts.JsxOpeningLikeElement) => ts.isIdentifier(node.tagName) ? node.tagName.text : undefined
const propertyName = (property: ts.ObjectLiteralElementLike) => property.name && (ts.isIdentifier(property.name) || ts.isStringLiteral(property.name) || ts.isNumericLiteral(property.name)) ? property.name.text : undefined
const stringValue = (node: ts.Node | undefined): ts.StringLiteral | ts.NoSubstitutionTemplateLiteral | undefined => {
  if (!node) return undefined
  if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node)) return node
  if (ts.isJsxExpression(node) && node.expression && (ts.isStringLiteral(node.expression) || ts.isNoSubstitutionTemplateLiteral(node.expression))) return node.expression
  return undefined
}
const imageLike = (value: string) => /(?:\.(?:avif|gif|jpe?g|png|svg|webp)(?:[?#].*)?$|^https?:\/\/[^\s]+(?:images|photos|pexels)[^\s]*|^data:image\/)/i.test(value)
const assetFileLike = (file: string) => /\.(avif|gif|jpe?g|png|svg|webp)$/i.test(file)

type DrilledProperty = { kind: 'value'; text: string } | { kind: 'asset'; assetFile: string }

const IMAGE_PROPERTY = /^(src|srcSet|image|cover|poster|thumbnail|heroImage|avatar)$/i

/** Values of `property` across object literals in an array literal (bounded, syntactic only).
 *  Identifier initializers are resolved through `resolveAsset` (imported-image bindings).
 *  Conservative by design: literals containing a spread, or a duplicated property key, are
 *  skipped — their runtime value cannot be proven from syntax alone. */
function objectLiteralPropertyValues(array: ts.ArrayLiteralExpression, property: string, resolveAsset: (name: string, sourceFile: ts.SourceFile) => string | undefined): DrilledProperty[] {
  const values: DrilledProperty[] = []
  const arrayFile = array.getSourceFile()
  for (const element of array.elements) {
    if (!ts.isObjectLiteralExpression(element)) continue
    if (element.properties.some(ts.isSpreadAssignment)) continue
    const byName = new Map<string, ts.PropertyAssignment[]>()
    for (const entry of element.properties) {
      if (!ts.isPropertyAssignment(entry)) continue
      const name = propertyName(entry)
      if (!name) continue
      if (!byName.has(name)) byName.set(name, [])
      byName.get(name)!.push(entry)
    }
    const entries = byName.get(property)
    // Duplicated key: runtime keeps the last value but provenance of which is "live" is
    // not ours to guess — skip rather than emit a possibly-dead edge.
    if (!entries || entries.length !== 1) continue
    const initializer = entries[0].initializer
    const literal = stringValue(initializer)
    if (literal) {
      values.push({ kind: 'value', text: literal.text })
    } else if (initializer && ts.isIdentifier(initializer)) {
      const assetFile = resolveAsset(initializer.text, arrayFile)
      if (assetFile) values.push({ kind: 'asset', assetFile })
    }
  }
  return values
}

/**
 * Bounded backward drill from a JSX attribute / callback expression to the string
 * literal values (or imported asset files) of `property`, through identifiers bound
 * to array literals, callback parameters of `.map` / `.filter` / `.slice`, and chained
 * calls of those methods. Anything outside this shape yields [] — the caller keeps the
 * honest lower-certainty result instead of guessing.
 * Soundness rules: only `const` declarations are drilled (a reassigned `let` makes the
 * initializer value non-provable); a conditional must have BOTH arms drillable.
 */
function arrayDrill(expression: ts.Expression, property: string, checker: ts.TypeChecker, visited: Set<ts.Node>, resolveAsset: (name: string, sourceFile: ts.SourceFile) => string | undefined): DrilledProperty[] {
  if (visited.has(expression)) return []
  visited.add(expression)
  if (ts.isIdentifier(expression) || ts.isPropertyAccessExpression(expression)) {
    const symbol = checker.getSymbolAtLocation(ts.isIdentifier(expression) ? expression : expression.name)
    // Export aliases (`export const products`) carry no valueDeclaration on the alias symbol.
    const declaration = symbol?.valueDeclaration
      ?? ((symbol?.flags ?? 0) & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol!).valueDeclaration : undefined)
      ?? symbol?.declarations?.find(ts.isVariableDeclaration)
    if (declaration && ts.isVariableDeclaration(declaration) && declaration.initializer) {
      // A non-const declaration may be reassigned after initialization; the initializer's
      // literals are then not the runtime values. Fail closed. (`const` lives on the
      // VariableDeclarationList, so check both levels defensively.)
      const constFlag = (declaration.flags | (ts.isVariableDeclarationList(declaration.parent) ? declaration.parent.flags : 0)) & ts.NodeFlags.Const
      if (!constFlag) return []
      let initializer: ts.Expression = declaration.initializer
      if (ts.isAsExpression(initializer) || ts.isSatisfiesExpression(initializer)) initializer = initializer.expression
      if (ts.isParenthesizedExpression(initializer)) return arrayDrill(initializer.expression, property, checker, visited, resolveAsset)
      if (ts.isConditionalExpression(initializer)) {
        // Only when BOTH arms drill do we know the property value regardless of runtime branch.
        const whenTrue = arrayDrill(initializer.whenTrue, property, checker, visited, resolveAsset)
        const whenFalse = arrayDrill(initializer.whenFalse, property, checker, visited, resolveAsset)
        if (!whenTrue.length || !whenFalse.length) return []
        return [...whenTrue, ...whenFalse]
      }
      if (ts.isArrayLiteralExpression(initializer)) return objectLiteralPropertyValues(initializer, property, resolveAsset)
      return []
    }
    if (declaration && ts.isParameter(declaration)) {
      let fn: ts.Node | undefined = declaration.parent
      while (fn && !(ts.isArrowFunction(fn) || ts.isFunctionExpression(fn))) fn = fn.parent
      let call: ts.Node | undefined = fn?.parent
      while (call && !ts.isCallExpression(call)) call = call.parent
      if (call && ts.isCallExpression(call) && ts.isPropertyAccessExpression(call.expression) &&
        ['map', 'filter', 'slice'].includes(call.expression.name.text) && call.expression.expression) {
        return arrayDrill(call.expression.expression, property, checker, visited, resolveAsset)
      }
    }
    return []
  }
  if (ts.isCallExpression(expression) && ts.isPropertyAccessExpression(expression.expression)) {
    const method = expression.expression.name.text
    if (method === 'map' || method === 'filter' || method === 'slice') {
      return arrayDrill(expression.expression.expression, property, checker, visited, resolveAsset)
    }
    return []
  }
  return []
}

function componentInfos(root: string, sources: Map<string, ts.SourceFile>): ComponentInfo[] {
  const result: ComponentInfo[] = []
  for (const [absolute, source] of sources) {
    const file = relativeTo(root, absolute)
    const add = (name: string, node: ts.Node) => {
      if (hasJsx(node)) result.push({ id: nodeId(file, 'component', node.getStart(source)), name, file, node })
    }
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) add(node.name.text, node)
      node.forEachChild(visit)
    }
    visit(source)
  }
  return result
}

function declarationComponentName(tag: string | undefined, localImports: Map<string, ImportTarget>, byExport: Map<string, ComponentInfo>): ComponentInfo | undefined {
  if (!tag) return undefined
  const target = localImports.get(tag)
  return target ? byExport.get(`${target.file}#${target.exportName}`) : undefined
}

export function analyzeProject(input: string, requireClean = true): SourceGraph {
  const snapshot = readProjectSnapshot(input, requireClean)
  const overrideRegistry = readPageOverrideRegistry(snapshot.root)
  const sourceFiles = new Map<string, ts.SourceFile>()
  const tracked = new Set(snapshot.trackedFiles.map(file => normalize(path.join(snapshot.root, file))))
  const codeFiles = snapshot.trackedFiles.filter(file => /\.(tsx?|jsx?)$/i.test(file) && !/(^|\/)(node_modules|dist|build|\.ripple)(\/|$)/.test(file))
  for (const relative of codeFiles) {
    const absolute = path.join(snapshot.root, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink() || !stat.isFile()) continue
    const source = ts.createSourceFile(relative, fs.readFileSync(absolute, 'utf8'), ts.ScriptTarget.Latest, true, sourceKindFor(relative))
    if (parseErrors(source).length) throw new ProjectReadError(`TypeScript/JSX 解析失败：${relative}`)
    sourceFiles.set(normalize(absolute), source)
  }

  const compilerOptions: ts.CompilerOptions = { jsx: ts.JsxEmit.Preserve, moduleResolution: ts.ModuleResolutionKind.Bundler, allowJs: true }
  for (const configName of ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']) {
    const configFile = path.join(snapshot.root, configName)
    if (!fs.existsSync(configFile)) continue
    const read = ts.readConfigFile(configFile, ts.sys.readFile)
    if (!read.error) Object.assign(compilerOptions, ts.parseJsonConfigFileContent(read.config, ts.sys, snapshot.root, undefined, configFile).options)
  }
  const program = ts.createProgram([...sourceFiles.keys()], compilerOptions)
  const checker = program.getTypeChecker()
  for (const absolute of sourceFiles.keys()) {
    const boundSource = program.getSourceFile(absolute)
    if (boundSource) sourceFiles.set(absolute, boundSource)
  }

  const nodes: SourceNode[] = []
  const edges: Relation[] = []
  const unresolved: string[] = []
  const nodeById = new Map<string, SourceNode>()
  const addNode = (node: SourceNode) => { if (!nodeById.has(node.id)) { nodes.push(node); nodeById.set(node.id, node) } }
  const addEdge = (from: string, to: string, kind: Relation['kind'], id: string, certainty: Relation['certainty'] = 'source-proven') => {
    edges.push({ id, from, to, kind, certainty, evidenceRefs: [] })
  }

  const overrideMarkers = new Map<string, Array<{ path: string; fallback: string; start: number; end: number }>>()
  const overrideMarkersByLocation = new Map<string, { id: string; fallback: string }>()
  for (const [absolute, source] of sourceFiles) {
    const file = relativeTo(snapshot.root, absolute)
    const found = findPageOverrideMarkers(source.text, file)
    for (const invalid of found.invalid) unresolved.push(invalid)
    for (const marker of found.markers) {
      const matches = overrideMarkers.get(marker.id) ?? []
      matches.push({ path: file, fallback: marker.fallback, start: marker.start, end: marker.end })
      overrideMarkers.set(marker.id, matches)
      overrideMarkersByLocation.set(`${file}#${marker.start}`, { id: marker.id, fallback: marker.fallback })
    }
  }
  const validOverrideTargets = new Set<string>()
  for (const [id, metadata] of Object.entries(overrideRegistry.targets)) {
    const matches = overrideMarkers.get(id) ?? []
    if (matches.length !== 1) {
      unresolved.push(matches.length ? `页面覆盖目标 ${id} 在源码中出现多次，无法唯一映射` : `页面覆盖目标 ${id} 已失去源码标记，规则待确认`)
    } else if (matches[0].fallback !== metadata.original) {
      unresolved.push(`页面覆盖目标 ${id} 的共享来源已变化，规则待确认`)
    } else validOverrideTargets.add(id)
  }
  for (const id of overrideMarkers.keys()) {
    if (!(id in overrideRegistry.targets)) unresolved.push(`源码标记 ${id} 没有对应的页面覆盖注册记录`)
  }

  for (const relative of snapshot.trackedFiles) {
    addNode({ id: `file:${relative}`, kind: 'file', label: relative, location: { path: relative } })
  }
  const components = componentInfos(snapshot.root, sourceFiles)
  const byExport = new Map(components.map(component => [`${component.file}#${component.name}`, component]))
  for (const component of components) {
    const loc = { path: component.file, start: component.node.getStart(), end: component.node.getEnd() }
    addNode({ id: component.id, kind: 'component', label: component.name, location: loc })
    addEdge(component.id, `file:${component.file}`, 'imports', `source:${component.id}`)
  }

  const tokenNodes = new Map<string, SourceNode[]>()
  const mediaNodes = new Map<string, SourceNode[]>()
  const mediaBySource = new Map<string, SourceNode>()
  const mediaByValue = new Map<string, SourceNode[]>()
  const assetMediaId = (assetFile: string) => `media:${assetFile}#asset`
  const addIndexedValue = (node: SourceNode, index: Map<string, SourceNode[]>, key: string) => {
    addNode(node)
    if (!index.has(key)) index.set(key, [])
    index.get(key)!.push(node)
    addEdge(`file:${node.location!.path}`, node.id, 'reads', `definition:${node.id}`)
  }
  for (const [absolute, source] of sourceFiles) {
    const file = relativeTo(snapshot.root, absolute)
    const addMedia = (property: string, literal: ts.StringLiteral | ts.NoSubstitutionTemplateLiteral) => {
      if (!imageLike(literal.text)) return
      const start = literal.getStart(source) + 1
      const end = literal.getEnd() - 1
      const media: SourceNode = { id: nodeId(file, 'media', start), kind: 'media', label: property, value: literal.text, location: { path: file, start, end } }
      addIndexedValue(media, mediaNodes, property)
      mediaBySource.set(`${file}#${start}`, media)
      if (!mediaByValue.has(literal.text)) mediaByValue.set(literal.text, [])
      mediaByValue.get(literal.text)!.push(media)
    }
    const scanValues = (node: ts.Node) => {
      if (ts.isPropertyAssignment(node)) {
        const name = propertyName(node)
        const value = stringValue(node.initializer)
        if (name && value && /^(src|srcSet|image|cover|poster|thumbnail|heroImage|avatar)$/i.test(name)) addMedia(name, value)
        if (name === 'colors' && ts.isObjectLiteralExpression(node.initializer) && /(?:tailwind|theme|tokens?)[^/\\]*\.(?:c?[jt]s|json)$/i.test(file)) {
          const walkPalette = (object: ts.ObjectLiteralExpression, parts: string[]) => {
            for (const entry of object.properties) {
              if (!ts.isPropertyAssignment(entry)) continue
              const segment = propertyName(entry)
              if (!segment) continue
              if (ts.isObjectLiteralExpression(entry.initializer)) { walkPalette(entry.initializer, [...parts, segment]); continue }
              const literal = stringValue(entry.initializer)
              if (!literal || !/^#[\da-f]{3,8}$/i.test(literal.text)) continue
              const token = [...parts, segment].join('.')
              const start = literal.getStart(source) + 1
              const end = literal.getEnd() - 1
              addIndexedValue({ id: nodeId(file, 'token', start), kind: 'token', label: token, value: literal.text, location: { path: file, start, end } }, tokenNodes, token)
            }
          }
          walkPalette(node.initializer, [])
        }
      }
      if (ts.isJsxAttribute(node) && node.name.getText(source) === 'src') {
        const literal = stringValue(node.initializer)
        if (literal) addMedia('src', literal)
      }
      node.forEachChild(scanValues)
    }
    scanValues(source)
  }
  for (const file of snapshot.trackedFiles.filter(candidate => /\.css$/i.test(candidate))) {
    const absolute = path.join(snapshot.root, file)
    if (fs.lstatSync(absolute).isSymbolicLink()) continue
    const css = fs.readFileSync(absolute, 'utf8')
    const definitions = /(--[\w-]+)\s*:\s*([^;{}]+)/g
    for (const match of css.matchAll(definitions)) {
      const raw = match[2]
      const value = raw.trim()
      const start = match.index! + match[0].indexOf(raw) + raw.indexOf(value)
      const token: SourceNode = { id: nodeId(file, 'token', start), kind: 'token', label: match[1], value, location: { path: file, start, end: start + value.length } }
      addIndexedValue(token, tokenNodes, match[1])
    }
    for (const match of css.matchAll(/var\((--[\w-]+)/g)) {
      const definitionsForToken = tokenNodes.get(match[1]) ?? []
      if (definitionsForToken.length === 1) addEdge(`file:${file}`, definitionsForToken[0].id, 'uses-token', `css-token-use:${file}:${match.index}`)
    }
  }

  const componentRenders = new Map<string, Set<string>>()
  const appDirect = new Set<string>()
  const pageTargets = new Map<string, Set<string>>()
  const appComponent = components.find(component => component.name === 'App')
  const pageStateNames = new Set<string>()
  if (appComponent) {
    const findState = (node: ts.Node) => {
      if (ts.isVariableDeclaration(node) && node.initializer && ts.isCallExpression(node.initializer) &&
        ts.isIdentifier(node.initializer.expression) && node.initializer.expression.text === 'useState') {
        if (ts.isIdentifier(node.name)) pageStateNames.add(node.name.text)
        if (ts.isArrayBindingPattern(node.name) && node.name.elements[0] && ts.isBindingElement(node.name.elements[0]) && ts.isIdentifier(node.name.elements[0].name)) {
          pageStateNames.add(node.name.elements[0].name.text)
        }
      }
      node.forEachChild(findState)
    }
    findState(appComponent.node)
  }

  // Imported image assets (e.g. `import hero from './assets/hero.jpg'`): one media node per
  // asset file, plus per-file binding names for identifier provenance. Asset-backed media has
  // no source offsets — editing it is an asset-swap candidate, not a literal replacement.
  const assetImportBindings = new Map<string, Map<string, string>>()
  const componentUsages: Array<{ targetId: string; element: ts.JsxOpeningLikeElement; source: ts.SourceFile; file: string }> = []
  const pendingDrills: Array<{ ownerId: string; paramName: string; property: string; position: number; file: string }> = []
  for (const [absolute, source] of sourceFiles) {
    const relative = relativeTo(snapshot.root, absolute)
    const imports = new Map<string, ImportTarget>()
    const importedModules = new Map<string, string>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      const scriptResolved = ts.resolveModuleName(specifier, absolute, compilerOptions, ts.sys).resolvedModule?.resolvedFileName
      const cssResolved = /\.css$/i.test(specifier) ? path.resolve(path.dirname(absolute), specifier) : undefined
      // Alias resolution for asset specifiers the type checker refuses to resolve (e.g.
      // `.jpg` imports): honor a declared `@/*` paths mapping when present, else the Vite
      // convention `@/ → <root>/src` (evidence: Lovable TanStack Start declares paths
      // `@/* → ./src/*` yet ts.resolveModuleName still fails on image files).
      const declaredPaths = compilerOptions.paths ? Object.entries(compilerOptions.paths) : []
      const aliasMapping = declaredPaths.find(([pattern]) => pattern === '@/*')
      const aliasResolved = specifier.startsWith('@/')
        ? aliasMapping
          ? path.resolve(snapshot.root, aliasMapping[1][0].replace(/\*$/, ''), specifier.slice(2))
          : path.resolve(snapshot.root, 'src', specifier.slice(2))
        : undefined
      const resolved = scriptResolved ?? (cssResolved && tracked.has(normalize(cssResolved)) ? cssResolved : undefined)
        ?? (aliasResolved && tracked.has(normalize(aliasResolved)) ? aliasResolved : undefined)
      if (!resolved || !tracked.has(normalize(resolved))) {
        if ((specifier.startsWith('.') || specifier.startsWith('@/')) && !/\.css$/i.test(specifier)) unresolved.push(`${relative} → ${specifier}`)
        continue
      }
      const targetFile = relativeTo(snapshot.root, resolved)
      importedModules.set(specifier, targetFile)
      const clause = statement.importClause
      if (clause?.name) imports.set(clause.name.text, { file: targetFile, exportName: 'default' })
      if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
        for (const item of clause.namedBindings.elements) imports.set(item.name.text, { file: targetFile, exportName: item.propertyName?.text ?? item.name.text })
      }
      addEdge(`file:${relative}`, `file:${targetFile}`, 'imports', `import:${relative}:${statement.getStart()}`)
      if (assetFileLike(targetFile)) {
        const id = assetMediaId(targetFile)
        if (!nodeById.has(id)) {
          addNode({ id, kind: 'media', label: path.basename(targetFile), value: targetFile, location: { path: targetFile } })
          mediaByValue.set(targetFile, [nodeById.get(id)!])
        }
        if (!assetImportBindings.has(relative)) assetImportBindings.set(relative, new Map())
        if (clause?.name) assetImportBindings.get(relative)!.set(clause.name.text, targetFile)
        if (clause?.namedBindings && ts.isNamedImports(clause.namedBindings)) {
          for (const item of clause.namedBindings.elements) assetImportBindings.get(relative)!.set(item.name.text, targetFile)
        }
      }
    }
    const owner = components.filter(component => component.file === relative)
    const visit = (node: ts.Node) => {
      const ownerComponent = owner.find(component => component.node.pos <= node.pos && component.node.end >= node.end)
      if ((ts.isJsxSelfClosingElement(node) || ts.isJsxOpeningElement(node)) && ts.isIdentifier(node.tagName) && node.tagName.text === 'RippleText') {
        const marker = overrideMarkersByLocation.get(`${relative}#${node.getStart(source)}`)
        if (marker && validOverrideTargets.has(marker.id)) {
          const sourceNode: SourceNode = {
            id: marker.id,
            kind: 'data',
            label: marker.fallback.trim(),
            value: marker.fallback,
            location: { path: relative, start: node.getStart(source), end: node.getEnd() },
            pageOverrides: Object.fromEntries(Object.entries(overrideRegistry.pages).flatMap(([pageRef, values]) => marker.id in values ? [[pageRef, values[marker.id]]] : [])),
          }
          addNode(sourceNode)
          if (ownerComponent) addEdge(ownerComponent.id, sourceNode.id, 'reads', `override-target:${sourceNode.id}:${ownerComponent.id}`)
        }
      }
      if (ownerComponent && ts.isPropertyAccessExpression(node)) {
        const symbol = checker.getSymbolAtLocation(node.name)
        const declaration = symbol?.valueDeclaration
        const literal = declaration && ts.isPropertyAssignment(declaration) ? stringValue(declaration.initializer) : undefined
        let linked = false
        if (literal && imageLike(literal.text)) {
          const sourcePath = relativeTo(snapshot.root, declaration!.getSourceFile().fileName)
          const media = mediaBySource.get(`${sourcePath}#${literal.getStart(declaration!.getSourceFile()) + 1}`)
          // Same uniqueness rule as the drilling post-pass: upgrading requires that the value
          // identifies exactly one media node; otherwise the edge stays a semantic candidate.
          const unique = (mediaByValue.get(literal.text) ?? []).length === 1
          if (media && unique) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
            linked = true
          }
        }
        // Provenance 1: property bound to an imported image asset (e.g. `image: item1`
        // where `import item1 from '@/assets/item-1.jpg'`). Statically verifiable.
        if (!linked && declaration && ts.isPropertyAssignment(declaration) && declaration.initializer && ts.isIdentifier(declaration.initializer)) {
          const declarationFile = relativeTo(snapshot.root, declaration.getSourceFile().fileName)
          const assetFile = assetImportBindings.get(declarationFile)?.get(declaration.initializer.text)
          if (assetFile && nodeById.has(assetMediaId(assetFile))) {
            addEdge(ownerComponent.id, assetMediaId(assetFile), 'asset-consumer', `asset:${ownerComponent.id}:${assetMediaId(assetFile)}:${node.getStart(source)}`)
            linked = true
          }
        }
        // Provenance 2: prop drilling — `product.image` inside a card component whose
        // `product` prop is fed at usage sites by expressions traceable to array literals
        // (identifier → array literal; `.map`/`.filter`/`.slice` chains). Only exact
        // single matches upgrade to source-proven; ambiguity stays semantic-candidate.
        // Resolved in a post-pass: usage sites in other files may not be visited yet.
        if (!linked) {
          const objectSymbol = checker.getSymbolAtLocation(node.expression)
          const objectDeclaration = objectSymbol?.valueDeclaration
          const paramName = objectDeclaration && (ts.isParameter(objectDeclaration) || ts.isBindingElement(objectDeclaration)) && ts.isIdentifier(objectDeclaration.name)
            ? objectDeclaration.name.text : undefined
          // Only image-bearing props can carry media provenance; queueing every prop access
          // would cost a usage scan per access and strip unrelated name-based candidates.
          if (paramName && IMAGE_PROPERTY.test(node.name.text)) {
            pendingDrills.push({ ownerId: ownerComponent.id, paramName, property: node.name.text, position: node.getStart(source), file: relative })
            linked = true
          }
        }
        if (!linked) {
          for (const media of mediaNodes.get(node.name.text) ?? []) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset-candidate:${ownerComponent.id}:${media.id}:${node.getStart(source)}`, 'semantic-candidate')
          }
        }
      }
      if (ownerComponent && ts.isJsxAttribute(node) && node.name.getText(source) === 'src') {
        const literal = stringValue(node.initializer)
        if (literal && imageLike(literal.text)) {
          const media = mediaNodes.get('src')?.find(candidate => candidate.location?.path === relative && candidate.location.start === literal.getStart(source) + 1)
          if (media) addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
        } else if (node.initializer && ts.isJsxExpression(node.initializer) && node.initializer.expression && ts.isIdentifier(node.initializer.expression)) {
          const assetFile = assetImportBindings.get(relative)?.get(node.initializer.expression.text)
          if (assetFile && nodeById.has(assetMediaId(assetFile))) {
            addEdge(ownerComponent.id, assetMediaId(assetFile), 'asset-consumer', `asset:${ownerComponent.id}:${assetMediaId(assetFile)}:${node.getStart(source)}`)
          }
        }
      }
      if (ownerComponent && ts.isJsxAttribute(node) && node.name.getText(source) === 'className') {
        const classNames = stringValue(node.initializer)?.text ?? ''
        for (const [name, candidates] of tokenNodes) {
          if (candidates.length !== 1) continue
          const tailwindName = name.replace('.', '-')
          const pattern = new RegExp(`(?:^|\\s)(?:bg|text|border|ring|fill|stroke|from|to|via)-${tailwindName}(?:\\/[^\\s]+)?(?=\\s|$)`)
          if (pattern.test(classNames)) addEdge(ownerComponent.id, candidates[0].id, 'uses-token', `token-use:${ownerComponent.id}:${candidates[0].id}:${node.getStart(source)}`)
        }
      }
      if (ts.isJsxText(node) && node.text.trim()) {
        const start = node.getStart(source), end = node.getEnd()
        const parentElement = node.parent
        const rawValue = source.text.slice(start, end)
        const sourceNode: SourceNode = { id: nodeId(relative, 'literal', start), kind: 'data', label: rawValue.trim(), value: rawValue, location: { path: relative, start, end }, page: undefined }
        addNode(sourceNode)
        if (ownerComponent) addEdge(ownerComponent.id, sourceNode.id, 'reads', `literal-read:${sourceNode.id}`)
        if (ts.isJsxElement(parentElement)) {
          const elementId = nodeId(relative, 'jsx', parentElement.openingElement.getStart(source))
          addEdge(elementId, sourceNode.id, 'reads', `jsx-text:${elementId}:${sourceNode.id}`)
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node)
        if (tag && /^[a-z]/.test(tag)) {
          const start = node.getStart(source)
          const elementEnd = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.getEnd() : node.getEnd()
          addNode({ id: nodeId(relative, 'jsx', start), kind: 'jsx-element', label: `<${tag}>`, location: { path: relative, start, end: elementEnd }, selector: `[data-ripple-source="jsx:${relative}#${start}"]` })
        }
        const target = declarationComponentName(tag, imports, byExport)
        if (target && ownerComponent) {
          if (!componentRenders.has(ownerComponent.id)) componentRenders.set(ownerComponent.id, new Set())
          componentRenders.get(ownerComponent.id)!.add(target.id)
          addEdge(ownerComponent.id, target.id, 'renders', `render:${ownerComponent.id}:${node.getStart(source)}`)
          componentUsages.push({ targetId: target.id, element: node, source, file: relative })
          if (appComponent?.id === ownerComponent.id) appDirect.add(target.id)
        }
      }
      if (relative === appComponent?.file && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(node.left) && pageStateNames.has(node.left.text) && ts.isStringLiteral(node.right)) {
        const state = node.right.text
        const targets = new Set<string>()
        const collectTags = (child: ts.Node) => {
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            const target = declarationComponentName(jsxTagName(child), imports, byExport)
            if (target) targets.add(target.id)
          }
          child.forEachChild(collectTags)
        }
        let conditional: ts.Node = node
        while (conditional.parent && !(ts.isBinaryExpression(conditional.parent) && conditional.parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken)) conditional = conditional.parent
        if (conditional.parent && ts.isBinaryExpression(conditional.parent)) collectTags(conditional.parent.right)
        pageTargets.set(state, targets)
        const pageId = `page:${state}`
        addNode({ id: pageId, kind: 'route', label: state, page: state, location: { path: relative, start: node.getStart(source), end: node.getEnd() } })
        for (const target of targets) addEdge(pageId, target, 'renders', `page-render:${state}:${target}`)
      }
      node.forEachChild(visit)
    }
    visit(source)
    void importedModules
  }

  // Post-pass: prop-drilling provenance needs usage sites from every file collected first.
  {
    const resolveAsset = (name: string, sourceFile: ts.SourceFile) => assetImportBindings.get(relativeTo(snapshot.root, sourceFile.fileName))?.get(name)
    for (const drill of pendingDrills) {
      const drilled = new Map<string, DrilledProperty>()
      for (const usage of componentUsages) {
        if (usage.targetId !== drill.ownerId) continue
        const attribute = usage.element.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(usage.source) === drill.paramName)
        const initializer = attribute && ts.isJsxAttribute(attribute) ? attribute.initializer : undefined
        const expression = initializer && ts.isJsxExpression(initializer) ? initializer.expression : undefined
        if (!expression) continue
        const items = arrayDrill(expression, drill.property, checker, new Set(), resolveAsset)
        for (const item of items) drilled.set(JSON.stringify(item), item)
      }
      for (const item of drilled.values()) {
        if (item.kind === 'asset') {
          if (nodeById.has(assetMediaId(item.assetFile))) {
            addEdge(drill.ownerId, assetMediaId(item.assetFile), 'asset-consumer', `asset:${drill.ownerId}:${assetMediaId(item.assetFile)}:${drill.position}`)
          }
          continue
        }
        const matches = mediaByValue.get(item.text) ?? []
        if (matches.length === 1) {
          addEdge(drill.ownerId, matches[0].id, 'asset-consumer', `asset:${drill.ownerId}:${matches[0].id}:${drill.position}`)
        } else {
          for (const match of matches) addEdge(drill.ownerId, match.id, 'asset-consumer', `asset-candidate:${drill.ownerId}:${match.id}:${drill.position}`, 'semantic-candidate')
        }
      }
      // A component whose prop drilling finds nothing anywhere stays honestly unproven:
      // no edge is emitted here, and the visit-time code already suppressed the coarse
      // name-based fallback for prop-sourced accesses.
    }
  }
  void pendingDrills

  const routedComponentIds = new Set([...pageTargets.values()].flatMap(targets => [...targets]))
  const sharedAppComponents = [...appDirect].filter(id => !routedComponentIds.has(id))
  for (const [state, targets] of pageTargets) {
    for (const global of appDirect) {
      if (!routedComponentIds.has(global)) addEdge(`page:${state}`, global, 'renders', `page-global:${state}:${global}`)
    }
    const queue = [...targets, ...sharedAppComponents]
    const visited = new Set<string>()
    while (queue.length) {
      const current = queue.shift()!
      if (visited.has(current)) continue
      visited.add(current)
      const node = nodeById.get(current)
      if (node?.kind === 'component') node.pages = [...(node.pages ?? []), state]
      for (const child of componentRenders.get(current) ?? []) queue.push(child)
    }
  }

  const endDigest = readProjectSnapshot(snapshot.root, false).revision.sourceDigest
  if (endDigest !== snapshot.revision.sourceDigest) throw new ProjectReadError('分析期间项目源码发生变化，请重新读取')
  return { id: `graph:${snapshot.revision.sourceDigest.slice(0, 20)}`, revision: snapshot.revision, nodes, edges, unresolved: [...new Set(unresolved)] }
}

export function resolveJsxSourceElement(graph: SourceGraph, sourceRef: string): { element: SourceNode; editableText: SourceNode[] } {
  const normalizedRef = sourceRef.startsWith('jsx:') ? sourceRef : `jsx:${sourceRef}`
  const element = graph.nodes.find(node => node.kind === 'jsx-element' && node.id === normalizedRef)
  if (!element) throw new ProjectReadError(`运行时元素没有已确认的源码映射：${sourceRef}`)
  const textRefs = new Set(graph.edges.filter(edge => edge.kind === 'reads' && edge.from === element.id).map(edge => edge.to))
  const editableText = graph.nodes.filter(node => node.kind === 'data' && textRefs.has(node.id))
  return { element, editableText }
}

export function createRuntimeSourceMap(graph: SourceGraph, observations: RuntimeElementObservation[]): RuntimeSourceMap {
  const nodes = new Map(graph.nodes.filter(node => node.kind === 'jsx-element').map(node => [node.id, node]))
  const ids = new Set<string>()
  for (const observation of observations) {
    if (!nodes.has(observation.sourceRef)) throw new ProjectReadError(`运行时元素引用了未映射的 JSX 源码：${observation.sourceRef}`)
    if (!observation.runtimeInstanceId || ids.has(observation.runtimeInstanceId)) throw new ProjectReadError('运行时实例标识缺失或重复')
    if (observation.certainty === 'unmapped' || observation.certainty === 'unknown') throw new ProjectReadError('未确认映射身份的运行时元素不能进入源码选择')
    ids.add(observation.runtimeInstanceId)
  }
  return { graphId: graph.id, sourceDigest: graph.revision.sourceDigest, runtimeFingerprint: graph.revision.runtimeFingerprint, observations: observations.map(item => ({ ...item })) }
}

export function resolveRuntimeElement(graph: SourceGraph, selection: { sourceRef: string; runtimeInstanceId: string }, runtimeMap: RuntimeSourceMap): { element: SourceNode; runtimeInstanceId: string; editableText: SourceNode[] } {
  if (!selection.runtimeInstanceId || selection.runtimeInstanceId === selection.sourceRef) throw new ProjectReadError('运行时实例标识必须与 JSX 源码锚点分离')
  if (runtimeMap.graphId !== graph.id || runtimeMap.sourceDigest !== graph.revision.sourceDigest || runtimeMap.runtimeFingerprint !== graph.revision.runtimeFingerprint) throw new ProjectReadError('运行时映射不再对应当前源码图或运行环境')
  const observation = runtimeMap.observations.find(item => item.runtimeInstanceId === selection.runtimeInstanceId)
  if (!observation || observation.sourceRef !== selection.sourceRef) throw new ProjectReadError('运行时实例与 JSX 源码锚点的双向映射不匹配')
  if (observation.certainty === 'position-dependent' || observation.certainty === 'unknown') throw new ProjectReadError('列表实例身份不稳定，不能作为精准编辑目标')
  const resolved = resolveJsxSourceElement(graph, selection.sourceRef)
  return { ...resolved, runtimeInstanceId: selection.runtimeInstanceId }
}
