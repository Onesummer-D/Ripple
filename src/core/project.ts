import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { ProjectRevision, Relation, RuntimeElementObservation, RuntimeIdentityReason, RuntimePageContext, RuntimeSourceMap, SourceGraph, SourceNode } from './model'
import { findPageOverrideMarkers, readPageOverrideRegistry } from './page-overrides'
import type { ProjectConfigGraph } from './project-config-resolver.mjs'
import { resolveProjectConfigGraph } from './project-config-resolver.mjs'
import { inspectDataRouter } from './project-data-routes'

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

// AC-P2a audited host-propagation allowlist. Only react-router v6/v7 `Link` and
// `NavLink` are listed: in both majors the component renders exactly one <a>
// host element and forwards its JSX children unmodified (semantics verified
// against the published v6/v7 distributions). Any other major version, a
// missing/unreadable package.json, or an unresolvable install is NOT on the
// allowlist and keeps the conservative semantic-candidate edge. The allowlist
// never matches by component name alone: the local binding must be the same
// import symbol, which excludes shadowed locals and re-exports from other files.
const auditedRouterHostMajor = (version: string): boolean => {
  // Only a complete, stable SemVer release of an audited major qualifies.
  // Prereleases (6.0.0-beta.0), partial versions (6.4), tagged values (v6.4.1)
  // or ranges never prove a runtime version; parseInt on the first dotted
  // segment would wrongly admit several of those.
  const match = /^(\d+)\.\d+\.\d+$/.exec(version.trim())
  return match !== null && (match[1] === '6' || match[1] === '7')
}

const routerHostBasis = (root: string, containingFile: string, specifier: string): string | undefined => {
  const resolved = ts.resolveModuleName(specifier, containingFile, { moduleResolution: ts.ModuleResolutionKind.Bundler }, ts.sys)
    .resolvedModule?.resolvedFileName
  // The allowlist must reflect the ANALYZED PROJECT's own installation,
  // never a router reached by walking past the project root (for example the
  // analyzer's own devDependencies).
  const projectRoot = path.resolve(root)
  if (resolved) {
    const resolvedPath = path.resolve(resolved)
    if (resolvedPath === projectRoot || resolvedPath.startsWith(projectRoot + path.sep)) {
      // Walk up from the resolved module to the owning package directory so a
      // nested path (dist/index.d.ts, cjs/react-router-dom.js, …) still lands on
      // the same package.json the analyzed project actually links. When an
      // installation exists its verdict is definitive: an unaudited installed
      // major must NOT be laundered through a friendly declared range.
      let dir = path.dirname(resolved)
      const rootDir = path.parse(dir).root
      while (dir !== rootDir) {
        const manifest = path.join(dir, 'package.json')
        if (fs.existsSync(manifest)) {
          try {
            const parsed = JSON.parse(fs.readFileSync(manifest, 'utf8')) as { name?: string; version?: string }
            if (parsed.name === specifier && parsed.version && auditedRouterHostMajor(parsed.version)) {
              return `${parsed.name}@${parsed.version}(installed)`
            }
            return undefined
          } catch { return undefined }
        }
        dir = path.dirname(dir)
      }
      return undefined
    }
    // A resolution that walked past the project root (ancestor node_modules
    // visible on the analysis host) is not the project's installation. The
    // isolated preview mounts only the project, so analysis models the same
    // root-bounded resolution world: treat it exactly like an unresolvable
    // module and let the declared-dependency fallback below stand in. This
    // keeps proofs stable regardless of what happens to be installed around
    // the checkout. Candidate creation re-validates declared bases against a
    // later local installation and forces re-analysis on divergence.
  }
  // Clean-clone analyses (for example B's pinned candidate gate) have no
  // node_modules. Fall back to the version the project DECLARES for the
  // package, and only accept ranges whose every possible version is an
  // audited major: an exact x.y.z, or a caret/tilde range on major 6/7.
  try {
    const manifest = JSON.parse(fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')) as {
      dependencies?: Record<string, string>; devDependencies?: Record<string, string>; peerDependencies?: Record<string, string>
    }
    const declared = manifest.dependencies?.[specifier] ?? manifest.devDependencies?.[specifier] ?? manifest.peerDependencies?.[specifier]
    if (!declared) return undefined
    // Only a complete, vetted SemVer form may be promoted: an exact x.y.z, or
    // a caret/tilde range pinned to audited major 6/7 (by construction such a
    // range cannot cross into an unaudited major). The anchored shape rejects
    // prereleases (^6.4.1-beta.0), partial versions (6.27), .x ranges,
    // comparators and hyphen/|| ranges (6.0.0 - 8.0.0) outright; the previous
    // prefix match admitted several of those.
    const match = /^(\^|~)?(\d+)\.\d+\.\d+$/.exec(declared.trim())
    if (!match) return undefined
    if (match[2] === '6' || match[2] === '7') {
      return `${specifier}@${declared.trim()}(declared)`
    }
    return undefined
  } catch { return undefined }
}

// Re-analysis gate for declared-basis host proofs. Composite JSX child edges
// promoted via the declared-dependency fallback (see routerHostBasis) were
// analyzed in a project without a local router installation. If such an
// installation has appeared since, the declared verdict is no longer the
// definitive one: candidate creation must fail closed and require a fresh
// analysis instead of trusting a graph computed under a different dependency
// state. Returns the list of specifiers whose state changed.
export function declaredHostProofsDiverged(graph: SourceGraph, root: string): string[] {
  const diverged: string[] = []
  for (const edge of graph.edges) {
    if (!edge.id.startsWith('composite-jsx-child:') || edge.certainty !== 'source-proven') continue
    const basis = /:host-proven:[^:]+:((?:react-router)(?:-dom)?)@.+\(declared\)$/.exec(edge.id)
    if (!basis) continue
    const specifier = basis[1]
    const fromPath = edge.from.replace(/^component:/, '').split('#')[0]
    const current = routerHostBasis(root, path.resolve(root, fromPath), specifier)
    if (current?.endsWith('(installed)')) diverged.push(specifier)
  }
  return [...new Set(diverged)]
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

interface ComponentInfo { id: string; name: string; file: string; node: ts.Node; isDefaultExport?: boolean }
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

function componentInfos(root: string, sources: Map<string, ts.SourceFile>): ComponentInfo[] {
  const result: ComponentInfo[] = []
  for (const [absolute, source] of sources) {
    const file = relativeTo(root, absolute)
    const add = (name: string, node: ts.Node) => {
      if (hasJsx(node)) result.push({ id: nodeId(file, 'component', node.getStart(source)), name, file, node,
        isDefaultExport: ts.canHaveModifiers(node) && Boolean(ts.getModifiers(node)?.some(mod => mod.kind === ts.SyntaxKind.DefaultKeyword)) })
    }
    const visit = (node: ts.Node) => {
      if (ts.isFunctionDeclaration(node) && node.name) add(node.name.text, node)
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer &&
        (ts.isArrowFunction(node.initializer) || ts.isFunctionExpression(node.initializer))) add(node.name.text, node)
      node.forEachChild(visit)
    }
    visit(source)
    // Handle `const Page = () => <...>; export default Page` without
    // inventing a component from the export assignment itself.
    for (const statement of source.statements) {
      if (!ts.isExportAssignment(statement) || !ts.isIdentifier(statement.expression)) continue
      const exportedName = statement.expression.text
      const component = result.find(item => item.file === file && item.name === exportedName)
      if (component) component.isDefaultExport = true
    }
  }
  return result
}

/** Follow TypeScript's actual imported/exported symbol, including barrel chains.
 * A file import is not, by itself, component consumption evidence: the JSX tag
 * must bind to the exact component declaration tracked in this graph.
 */
function declarationComponentName(
  tag: ts.Identifier | undefined,
  checker: ts.TypeChecker,
  byDeclaration: Map<ts.Node, ComponentInfo>,
  localImports: Map<string, ImportTarget>,
  byExport: Map<string, ComponentInfo>,
): ComponentInfo | undefined {
  if (!tag) return undefined
  const symbol = checker.getSymbolAtLocation(tag)
  if (symbol) {
    const actual = symbol.flags & ts.SymbolFlags.Alias ? checker.getAliasedSymbol(symbol) : symbol
    // The resolved declaration must be an actual JSX component, not a barrel
    // import/export alias or another value with the same spelling.
    for (const declaration of actual?.declarations ?? []) {
      const component = byDeclaration.get(declaration)
      if (component) return component
    }
    return undefined
  }
  // The program may omit symbol information for unsupported script shapes;
  // retain the established *direct-import* behavior, not arbitrary re-exports.
  const target = localImports.get(tag.text)
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
  const configGraph: ProjectConfigGraph = resolveProjectConfigGraph(snapshot.root, ts)
  if (configGraph.application.status === 'supported') Object.assign(compilerOptions, configGraph.application.parsed.options)
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
  // Explicit named default exports can be imported through any local identifier.
  for (const component of components) {
    if (component.isDefaultExport) {
      byExport.set(`${component.file}#default`, component)
    }
  }
  const byDeclaration = new Map<ts.Node, ComponentInfo>(components.map(component => [component.node, component]))
  for (const component of components) {
    const loc = { path: component.file, start: component.node.getStart(), end: component.node.getEnd() }
    addNode({ id: component.id, kind: 'component', label: component.name, location: loc })
    addEdge(component.id, `file:${component.file}`, 'imports', `source:${component.id}`)
  }

  // 接收方类型定向收窄（符号身份 + 类型流闭包）：
  // product.image 这类成员访问解析不到字面量声明时，旧逻辑按属性名链接到全项目同名媒体
  // （会把 categories[].image 误挂到 ProductCard）；209cf4f 起改为按接收方声明类型收窄，
  // 但纯文本区间匹配会把别名/展开/返回值等真实数据流误排除，导致消费者边静默丢失——
  // PageImpact 漏掉真实页面且误成 source-proven，候选在缺页 Scope 下被误放行。
  // 现规则：仅当候选媒体字面量位于「类型 T 的构造闭包」内才保留——
  // ① T 由 checker 符号身份解析（interface/type alias；同名异模块类型不混淆）；
  // ② 闭包覆盖 T 标注/推断绑定初始化、T 返回函数体、T 形参/JSX 属性实参，
  //    并沿别名变量、展开元素、属性访问声明递归追踪；
  // ③ 闭包外的候选视为可证明排除；类型不可解析时返回 undefined 走原名级候选（fail-closed）。
  // 已知残余风险（如实记录）：显式不安全断言（as unknown as T）、any 边界改写、
  // 计算属性动态键——这些路径类型系统本身不保证，收窄不宣称覆盖。
  const typeFlowRangesBySymbol = new Map<ts.Symbol, Array<{ path: string; start: number; end: number }> | undefined>()
  const narrowMediaByReceiverType = (node: ts.PropertyAccessExpression, pool: SourceNode[]): SourceNode[] | undefined => {
    if (pool.length <= 1) return pool
    const symbol = checker.getTypeAtLocation(node.expression).getSymbol()
    const declaration = symbol?.declarations?.[0]
    if (!symbol || !declaration || (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration))) return undefined
    if (!typeFlowRangesBySymbol.has(symbol)) typeFlowRangesBySymbol.set(symbol, collectTypeFlowRanges(symbol))
    const ranges = typeFlowRangesBySymbol.get(symbol)
    if (!ranges) return undefined
    return pool.filter(media => {
      const location = media.location
      return location !== undefined && ranges.some(range => range.path === location.path && location.start !== undefined && location.end !== undefined && location.start >= range.start && location.end <= range.end)
    })
  }
  const collectTypeFlowRanges = (targetSymbol: ts.Symbol): Array<{ path: string; start: number; end: number }> | undefined => {
    const declaration = targetSymbol.declarations?.[0]
    if (!declaration || (!ts.isInterfaceDeclaration(declaration) && !ts.isTypeAliasDeclaration(declaration))) return undefined
    const typeMatches = (type: ts.Type | undefined, seen: Set<ts.Type> = new Set()): boolean => {
      if (!type || seen.has(type)) return false
      seen.add(type)
      if (type.symbol === targetSymbol || type.aliasSymbol === targetSymbol) return true
      const unionLike = type as ts.UnionOrIntersectionType
      if (Array.isArray(unionLike.types) && unionLike.types.length) return unionLike.types.some(entry => typeMatches(entry, seen))
      const reference = type as ts.TypeReference
      if (Array.isArray(reference.typeArguments)) return reference.typeArguments.some(entry => typeMatches(entry, seen))
      return false
    }
    // N11：无显式返回标注的工厂函数。推断返回类型结构兼容 T（含数组元素/联合成员，
    // 经 checker 赋值关系判定）时同样覆盖函数体——返回体内的媒体是真实消费，
    // 静默排除会让下游把缺失关系当作不存在、来源证明误升级。宁可过度保留（安全方向）。
    const targetDeclaredType = checker.getDeclaredTypeOfSymbol(targetSymbol)
    const isTypeAssignableTo = (checker as unknown as { isTypeAssignableTo?: (source: ts.Type, target: ts.Type) => boolean }).isTypeAssignableTo
    const isAssignableSafe = (type: ts.Type): boolean => {
      // 类型关系判断不可用时不得静默排除潜在真实消费者：按过度保留方向覆盖（安全方向）。
      if (!isTypeAssignableTo) return true
      try { return isTypeAssignableTo(type, targetDeclaredType) } catch { return true }
    }
    const relatedToTarget = (type: ts.Type | undefined, seen: Set<ts.Type> = new Set()): boolean => {
      if (!type || seen.has(type)) return false
      seen.add(type)
      if (typeMatches(type) || isAssignableSafe(type)) return true
      const unionLike = type as ts.UnionOrIntersectionType
      if (Array.isArray(unionLike.types) && unionLike.types.length) return unionLike.types.some(entry => relatedToTarget(entry, seen))
      const reference = type as ts.TypeReference
      if (Array.isArray(reference.typeArguments) && reference.typeArguments.length) return reference.typeArguments.some(entry => relatedToTarget(entry, seen))
      return false
    }
    const ranges: Array<{ path: string; start: number; end: number }> = []
    const visited = new Set<ts.Node>()
    const cover = (expression: ts.Node): void => {
      if (visited.has(expression)) return
      visited.add(expression)
      const sourceFile = expression.getSourceFile()
      ranges.push({ path: relativeTo(snapshot.root, normalize(sourceFile.fileName)), start: expression.getStart(sourceFile), end: expression.getEnd() })
      // 数据流追踪：别名变量 / 展开元素 / 属性访问声明 → 递归覆盖其初始化表达式
      const trace = (current: ts.Node): void => {
        if (ts.isSpreadElement(current) || ts.isSpreadAssignment(current)) { cover(current.expression); return }
        if (ts.isShorthandPropertyAssignment(current)) { trace(current.name); return }
        if (ts.isPropertyAccessExpression(current) || ts.isElementAccessExpression(current)) {
          const accessSymbol = checker.getSymbolAtLocation(ts.isPropertyAccessExpression(current) ? current.name : current.argumentExpression)
          const accessDeclaration = accessSymbol?.valueDeclaration ?? accessSymbol?.declarations?.[0]
          if (accessDeclaration && (ts.isPropertyAssignment(accessDeclaration) || ts.isVariableDeclaration(accessDeclaration)) && accessDeclaration.initializer) cover(accessDeclaration.initializer)
          return
        }
        if (ts.isIdentifier(current)) {
          const identifierSymbol = checker.getSymbolAtLocation(current)
          let identifierDeclaration = identifierSymbol?.valueDeclaration ?? identifierSymbol?.declarations?.[0]
          if (identifierDeclaration && (ts.isImportSpecifier(identifierDeclaration) || ts.isImportClause(identifierDeclaration) || ts.isNamespaceImport(identifierDeclaration)) && identifierSymbol) {
            const aliased = checker.getAliasedSymbol(identifierSymbol)
            if (aliased && !(aliased as { unresolved?: boolean }).unresolved) identifierDeclaration = aliased.valueDeclaration ?? aliased.declarations?.[0]
          }
          if (identifierDeclaration && ts.isVariableDeclaration(identifierDeclaration) && identifierDeclaration.initializer) cover(identifierDeclaration.initializer)
          else if (identifierDeclaration && ts.isBindingElement(identifierDeclaration)) {
            const bindingSource = identifierDeclaration.parent?.parent
            if (bindingSource && ts.isVariableDeclaration(bindingSource) && bindingSource.initializer) cover(bindingSource.initializer)
          }
          return
        }
        ts.forEachChild(current, trace)
      }
      trace(expression)
    }
    for (const [, source] of sourceFiles) {
      const visit = (current: ts.Node): void => {
        if (ts.isVariableDeclaration(current) && current.initializer) {
          const matches = current.type ? typeMatches(checker.getTypeFromTypeNode(current.type)) : typeMatches(checker.getTypeAtLocation(current.initializer))
          if (matches) cover(current.initializer)
        } else if (ts.isFunctionLike(current)) {
          const body = (current as ts.FunctionLikeDeclaration).body
          const signature = body ? checker.getSignatureFromDeclaration(current as ts.SignatureDeclaration) : undefined
          if (body && signature && relatedToTarget(signature.getReturnType())) cover(body)
        } else if (ts.isCallExpression(current)) {
          for (const argument of current.arguments) {
            const contextual = checker.getContextualType(argument) ?? checker.getTypeAtLocation(argument)
            if (typeMatches(contextual)) cover(argument)
          }
        } else if (ts.isJsxAttribute(current)) {
          const expression = current.initializer && ts.isJsxExpression(current.initializer) ? current.initializer.expression : undefined
          if (expression && typeMatches(checker.getContextualType(expression) ?? checker.getTypeAtLocation(expression))) cover(expression)
        }
        ts.forEachChild(current, visit)
      }
      visit(source)
    }
    return ranges
  }
  const tokenNodes = new Map<string, SourceNode[]>()
  const mediaNodes = new Map<string, SourceNode[]>()
  const mediaBySource = new Map<string, SourceNode>()
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
              addIndexedValue({
                id: nodeId(file, 'token', start), kind: 'token', label: token, value: literal.text,
                location: { path: file, start, end }, tokenOrigin: 'tailwind-palette',
              }, tokenNodes, token)
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
      const token: SourceNode = {
        id: nodeId(file, 'token', start), kind: 'token', label: match[1], value,
        location: { path: file, start, end: start + value.length }, tokenOrigin: 'css-custom-property',
      }
      addIndexedValue(token, tokenNodes, match[1])
    }
    for (const match of css.matchAll(/var\((--[\w-]+)/g)) {
      const definitionsForToken = tokenNodes.get(match[1]) ?? []
      if (definitionsForToken.length === 1) addEdge(`file:${file}`, definitionsForToken[0].id, 'uses-token', `css-token-use:${file}:${match.index}`)
    }
  }

  const componentRenders = new Map<string, Set<string>>()
  const importsByFile = new Map<string, Map<string, ImportTarget>>()
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

  for (const [absolute, source] of sourceFiles) {
    const relative = relativeTo(snapshot.root, absolute)
    const imports = new Map<string, ImportTarget>()
    const importedModules = new Map<string, string>()
    // AC-P2a: named Link/NavLink imports from react-router(-dom). These are
    // external packages (not tracked project files), so the project-import
    // pass below intentionally skips them; the host-propagation allowlist
    // needs their local binding symbols to reject shadowed lookalikes.
    const routerHostBindings = new Map<string, { specifier: string; exportName: string; symbol: ts.Symbol }>()
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      if (specifier !== 'react-router' && specifier !== 'react-router-dom') continue
      const names = statement.importClause?.namedBindings
      if (!names || !ts.isNamedImports(names)) continue
      for (const item of names.elements) {
        const exportName = item.propertyName?.text ?? item.name.text
        if (exportName !== 'Link' && exportName !== 'NavLink') continue
        const bound = checker.getSymbolAtLocation(item.name)
        if (bound) routerHostBindings.set(item.name.text, { specifier, exportName, symbol: bound })
      }
    }
    for (const statement of source.statements) {
      if (!ts.isImportDeclaration(statement) || !ts.isStringLiteral(statement.moduleSpecifier)) continue
      const specifier = statement.moduleSpecifier.text
      const scriptResolved = ts.resolveModuleName(specifier, absolute, compilerOptions, ts.sys).resolvedModule?.resolvedFileName
      const cssResolved = /\.css$/i.test(specifier) ? path.resolve(path.dirname(absolute), specifier) : undefined
      const resolved = scriptResolved ?? (cssResolved && tracked.has(normalize(cssResolved)) ? cssResolved : undefined)
      if (!resolved || !tracked.has(normalize(resolved))) {
        // Bare npm imports are external by default, not failed project aliases.
        // A declared paths mapping, however, is explicit evidence of an
        // expected project-local resolution. Do not silently lose that edge.
        const internalAlias = Object.keys(compilerOptions.paths ?? {}).some(pattern => {
          if (pattern === '*') return false // TypeScript tries npm fallback for this mapping.
          const parts = pattern.split('*')
          return parts.length === 1 ? specifier === pattern
            : parts.length === 2 && specifier.startsWith(parts[0]) && specifier.endsWith(parts[1])
        })
        if ((specifier.startsWith('.') || specifier.startsWith('@/') || internalAlias) && !/\.css$/i.test(specifier)) {
          unresolved.push(`${relative} → ${specifier}`)
        }
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
    }
    importsByFile.set(absolute, imports)
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
          if (media) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
            linked = true
          }
        }
        if (!linked) {
          const pool = mediaNodes.get(node.name.text) ?? []
          for (const media of narrowMediaByReceiverType(node, pool) ?? pool) {
            addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset-candidate:${ownerComponent.id}:${media.id}:${node.getStart(source)}`, 'semantic-candidate')
          }
        }
      }
      if (ownerComponent && ts.isJsxAttribute(node) && node.name.getText(source) === 'src') {
        const literal = stringValue(node.initializer)
        if (literal && imageLike(literal.text)) {
          const media = mediaNodes.get('src')?.find(candidate => candidate.location?.path === relative && candidate.location.start === literal.getStart(source) + 1)
          if (media) addEdge(ownerComponent.id, media.id, 'asset-consumer', `asset:${ownerComponent.id}:${media.id}:${node.getStart(source)}`)
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
        if (ts.isJsxElement(parentElement) && ownerComponent) {
          const tag = jsxTagName(parentElement.openingElement)
          if (!tag || !/^[a-z]/.test(tag)) {
            // Passing a JSX text child to a composite component is statically
            // visible, but whether it forwards children into the DOM is not.
            // Keep the owner's lexical read, with independent uncertain DOM
            // consumption evidence so downstream Scope remains fail-closed.
            // AC-P2a: the audited host-propagation allowlist upgrades the edge
            // only for a same-symbol react-router v6/v7 Link/NavLink binding
            // with a verifiable audited installation; everything else — unknown
            // composites, shadowed lookalikes, unaudited majors — stays
            // semantic-candidate. The edge id carries the whitelist basis so the
            // proof remains auditable after the fact.
            let certainty: 'source-proven' | 'semantic-candidate' = 'semantic-candidate'
            let basis = ''
            if (tag) {
              const binding = routerHostBindings.get(tag)
              const used = binding && checker.getSymbolAtLocation(parentElement.openingElement.tagName)
              if (binding && used === binding.symbol) {
                const versioned = routerHostBasis(snapshot.root, absolute, binding.specifier)
                if (versioned) {
                  certainty = 'source-proven'
                  basis = `:host-proven:${binding.exportName}:${versioned}`
                }
              }
            }
            addEdge(ownerComponent.id, sourceNode.id, 'reads',
              `composite-jsx-child:${ownerComponent.id}:${sourceNode.id}${basis}`, certainty)
          }
        }
        if (ts.isJsxElement(parentElement)) {
          const opening = parentElement.openingElement
          const elementId = nodeId(relative, 'jsx', opening.getStart(source))
          // Only intrinsic JSX tags have a trusted source-to-DOM annotation.
          // Composite tags such as React Router <Link> receive children but
          // must not be conflated with HTML anchors or phantom JSX nodes.
          const tag = jsxTagName(opening)
          if (tag && /^[a-z]/.test(tag)) addEdge(elementId, sourceNode.id, 'reads', `jsx-text:${elementId}:${sourceNode.id}`)
        }
      }
      if (ts.isJsxOpeningElement(node) || ts.isJsxSelfClosingElement(node)) {
        const tag = jsxTagName(node)
        if (tag && /^[a-z]/.test(tag)) {
          const start = node.getStart(source)
          const elementEnd = ts.isJsxOpeningElement(node) && ts.isJsxElement(node.parent) ? node.parent.getEnd() : node.getEnd()
          addNode({ id: nodeId(relative, 'jsx', start), kind: 'jsx-element', label: `<${tag}>`, location: { path: relative, start, end: elementEnd }, selector: `[data-ripple-source="jsx:${relative}#${start}"]` })
        }
        // JSX declared inside a data-router route object is a route configuration
        // value, not JSX actually rendered by App. In particular errorElement
        // must never become a source-proven global page consumer.
        let routeConfigJsx = false
        for (let ancestor = node.parent; ancestor && ancestor !== ownerComponent?.node; ancestor = ancestor.parent) {
          if (ts.isPropertyAssignment(ancestor) && ['element', 'errorElement', 'hydrateFallbackElement', 'fallbackElement'].includes(propertyName(ancestor) ?? '')) {
            routeConfigJsx = true
            break
          }
        }
        const target = routeConfigJsx ? undefined : declarationComponentName(ts.isIdentifier(node.tagName) ? node.tagName : undefined, checker, byDeclaration, imports, byExport)
        if (target && ownerComponent) {
          if (!componentRenders.has(ownerComponent.id)) componentRenders.set(ownerComponent.id, new Set())
          componentRenders.get(ownerComponent.id)!.add(target.id)
          addEdge(ownerComponent.id, target.id, 'renders', `render:${ownerComponent.id}:${node.getStart(source)}`)
          if (appComponent?.id === ownerComponent.id) appDirect.add(target.id)
        }
      }
      if (relative === appComponent?.file && ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken &&
        ts.isIdentifier(node.left) && pageStateNames.has(node.left.text) && ts.isStringLiteral(node.right)) {
        const state = node.right.text
        const targets = new Set<string>()
        const collectTags = (child: ts.Node) => {
          if (ts.isJsxOpeningElement(child) || ts.isJsxSelfClosingElement(child)) {
            const target = declarationComponentName(ts.isIdentifier(child.tagName) ? child.tagName : undefined, checker, byDeclaration, imports, byExport)
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

  const dataRouter = inspectDataRouter(snapshot.root, sourceFiles, importsByFile, components, checker, configGraph.entries)
  unresolved.push(...dataRouter.unresolved)
  if (dataRouter.incomplete) unresolved.push('route-coverage: 静态路由表存在无法证明的消费者或条件分支')
  for (const route of dataRouter.routes) {
    const routeId = `page:${route.page}`
    addNode({ id: routeId, kind: 'route', label: route.page, page: route.page,
      location: { path: route.sourceFile, start: route.offset } })
    addEdge(routeId, route.componentId, 'renders',
      `data-router:${route.sourceFile}:${route.offset}:${route.componentId}:${route.page}`,
      route.certain ? 'source-proven' : 'semantic-candidate')
    if (!pageTargets.has(route.page)) pageTargets.set(route.page, new Set())
    if (route.certain) pageTargets.get(route.page)!.add(route.componentId)
  }
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

/** sha256 of one tracked project file, comparable with the runtime `sourceVersion` of its JSX. */
export function sourceFileDigest(root: string, relative: string): string {
  return sha256(fileBytes(gitRoot(root), relative))
}

// Only "the page did not report a version" is tolerated (navigation still works); every other
// collection reason, including an ambiguous version history, blocks instance use.
const blocksRuntimeInstance = (reason: RuntimeIdentityReason) => reason !== 'source-version-unavailable'

export function createRuntimeSourceMap(graph: SourceGraph, observations: RuntimeElementObservation[]): RuntimeSourceMap {
  const nodes = new Map(graph.nodes.filter(node => node.kind === 'jsx-element').map(node => [node.id, node]))
  const ids = new Set<string>()
  for (const observation of observations) {
    if (!nodes.has(observation.sourceRef)) throw new ProjectReadError(`运行时元素引用了未映射的 JSX 源码：${observation.sourceRef}`)
    if (!observation.runtimeInstanceId || ids.has(observation.runtimeInstanceId)) throw new ProjectReadError('运行时实例标识缺失或重复')
    if (observation.certainty === 'unmapped' || observation.certainty === 'unknown') throw new ProjectReadError('未确认映射身份的运行时元素不能进入源码选择')
    if (observation.reasons?.some(blocksRuntimeInstance)) throw new ProjectReadError('运行时实例身份在采集时已被降级，不能进入源码选择')
    ids.add(observation.runtimeInstanceId)
  }
  return { graphId: graph.id, sourceDigest: graph.revision.sourceDigest, runtimeFingerprint: graph.revision.runtimeFingerprint, observations: observations.map(item => ({ ...item, ...(item.pageContext ? { pageContext: { ...item.pageContext } } : {}), ...(item.reasons ? { reasons: [...item.reasons] } : {}) })) }
}

export interface RuntimeElementVerification {
  /** Reads the digest of a file in the same revision as `graph`; requires a matching `sourceVersion`. */
  fileDigest?: (file: string) => string | undefined
  /** Requires the observation to carry exactly this page context. */
  page?: RuntimePageContext
}

/**
 * `verification: 'strict'` only when BOTH the source version (via fileDigest) and the page
 * were checked. The legacy call without them still resolves for source navigation, but it
 * reports 'navigation-only' and must never be treated as a proven runtime instance.
 */
export interface ResolvedRuntimeElement { element: SourceNode; runtimeInstanceId: string; editableText: SourceNode[]; verification: 'strict' | 'navigation-only' }

export function resolveRuntimeElement(graph: SourceGraph, selection: { sourceRef: string; runtimeInstanceId: string }, runtimeMap: RuntimeSourceMap, verification: RuntimeElementVerification = {}): ResolvedRuntimeElement {
  if (!selection.runtimeInstanceId || selection.runtimeInstanceId === selection.sourceRef) throw new ProjectReadError('运行时实例标识必须与 JSX 源码锚点分离')
  if (runtimeMap.graphId !== graph.id || runtimeMap.sourceDigest !== graph.revision.sourceDigest || runtimeMap.runtimeFingerprint !== graph.revision.runtimeFingerprint) throw new ProjectReadError('运行时映射不再对应当前源码图或运行环境')
  const observation = runtimeMap.observations.find(item => item.runtimeInstanceId === selection.runtimeInstanceId)
  if (!observation || observation.sourceRef !== selection.sourceRef) throw new ProjectReadError('运行时实例与 JSX 源码锚点的双向映射不匹配')
  if (observation.certainty === 'position-dependent' || observation.certainty === 'unknown' || observation.certainty === 'unmapped') throw new ProjectReadError('列表实例身份不稳定，不能作为精准编辑目标')
  if (observation.reasons?.some(blocksRuntimeInstance)) throw new ProjectReadError('运行时实例身份在采集时已被降级，不能作为精准编辑目标')
  if (verification.fileDigest) {
    const file = /^jsx:(.+)#\d+$/.exec(observation.sourceRef)?.[1]
    let expected: string | undefined
    try { expected = file ? verification.fileDigest(file) : undefined } catch { expected = undefined }
    if (!observation.sourceVersion || !expected || observation.sourceVersion !== expected) throw new ProjectReadError('运行时元素的源码版本与当前源码图不一致，旧身份不能继续使用')
  }
  if (verification.page) {
    const page = observation.pageContext
    if (!page || page.pathname !== verification.page.pathname || page.search !== verification.page.search || page.hash !== verification.page.hash) throw new ProjectReadError('运行时元素缺少或不匹配页面上下文')
  }
  const resolved = resolveJsxSourceElement(graph, selection.sourceRef)
  return { ...resolved, runtimeInstanceId: selection.runtimeInstanceId, verification: verification.fileDigest && verification.page ? 'strict' : 'navigation-only' }
}

/** Strict form for any future instance-level use: refuses to run without version and page evidence. */
export function resolveRuntimeInstance(graph: SourceGraph, selection: { sourceRef: string; runtimeInstanceId: string }, runtimeMap: RuntimeSourceMap, verification: Required<RuntimeElementVerification>): ResolvedRuntimeElement {
  if (typeof verification?.fileDigest !== 'function' || !verification.page) throw new ProjectReadError('实例级身份校验需要源码版本读取器和页面上下文')
  return resolveRuntimeElement(graph, selection, runtimeMap, verification)
}
