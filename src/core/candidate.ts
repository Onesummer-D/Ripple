import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { CandidatePatch, EditOperation, ScopeDecision, SourceGraph, SourceNode } from './model'
import { analyzeProject, digestTrackedTree, readProjectSnapshot } from './project'
import { ensureRuntimeImports, findPageOverrideMarkers, newPageOverrideTargetId, readPageOverrideRegistry, removeRuntimeImports, writePageOverrideRegistry, type PageOverrideMarker } from './page-overrides'
import { evaluateOperationPageScope, sourceProvenPageImpact } from './scope'

export class CandidateError extends Error {
  constructor(message: string) { super(message); this.name = 'CandidateError' }
}

export interface CandidateRequest {
  projectRoot: string
  candidateRoot: string
  artifactRoot: string
  graph: SourceGraph
  scope: ScopeDecision
  operations: EditOperation[]
  candidateId?: string
}

export interface CandidateRecord extends CandidatePatch {
  projectRoot: string
  markerPath: string
  modifiedPaths: string[]
  operationTargetRefs: Record<string, string>
}

const sha256 = (value: string | Uint8Array) => createHash('sha256').update(value).digest('hex')
const runGit = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 }).trimEnd()

function outsideProject(projectRoot: string, outputPath: string, label: string): string {
  const resolved = path.resolve(outputPath)
  let existing = resolved
  while (!fs.existsSync(existing)) existing = path.dirname(existing)
  const physical = path.join(fs.realpathSync(existing), path.relative(existing, resolved))
  const relative = path.relative(projectRoot, physical)
  if (!relative || (!relative.startsWith(`..${path.sep}`) && relative !== '..' && !path.isAbsolute(relative))) {
    throw new CandidateError(`${label} 必须放在项目原目录之外`)
  }
  return physical
}

function assertScope(graph: SourceGraph, scope: ScopeDecision, operations: EditOperation[]): Map<string, SourceNode> {
  if (!scope.id || !Number.isInteger(scope.version) || scope.version < 1 || !scope.decidedBy || !scope.decidedAt) throw new CandidateError('Scope 必须有用户、时间和递增版本')
  const unique = (values: string[]) => new Set(values).size === values.length
  if (!unique(scope.includedRefs) || !unique(scope.excludedRefs) || !unique(scope.protectedRefs)) throw new CandidateError('Scope 引用了重复对象')
  const included = new Set(scope.includedRefs)
  if ([...scope.excludedRefs, ...scope.protectedRefs].some(id => included.has(id))) throw new CandidateError('Scope 的 included 与 excluded/protected 冲突')
  if (!operations.length || !unique(operations.map(operation => operation.id))) throw new CandidateError('候选必须包含至少一项且操作 ID 不重复')
  const nodes = new Map(graph.nodes.map(node => [node.id, node]))
  for (const ref of [...scope.includedRefs, ...scope.excludedRefs, ...scope.protectedRefs]) {
    if (!nodes.has(ref)) throw new CandidateError(`Scope 引用了当前源码图中不存在的对象：${ref}`)
  }
  const excluded = new Set([...scope.excludedRefs, ...scope.protectedRefs])
  const localPageRef = scope.strategy === 'page-override' ? scope.localPageRef : undefined
  if (scope.strategy === 'page-override' && (!localPageRef || !included.has(localPageRef) || excluded.has(localPageRef))) throw new CandidateError('页面覆盖需要明确包含一个未排除或未保护的目标页面')
  if (scope.strategy !== 'page-override' && scope.localPageRef) throw new CandidateError('共享来源 Scope 不能携带局部页面引用')
  for (const operation of operations) {
    if (!included.has(operation.targetRef) || excluded.has(operation.targetRef)) throw new CandidateError(`Scope 不允许修改目标：${operation.targetRef}`)
    if (operation.overrideAction === 'remove') {
      if (scope.strategy !== 'page-override' || operation.kind !== 'TEXT' || !operation.targetRef.startsWith('override:') || operation.before !== operation.after) {
        throw new CandidateError(`移除覆盖操作无效：${operation.id}`)
      }
    } else if (operation.before === operation.after) throw new CandidateError(`操作没有修改内容：${operation.id}`)
    const target = nodes.get(operation.targetRef)
    const expectedKind = operation.kind === 'TEXT' ? 'data' : operation.kind === 'MEDIA' ? 'media' : operation.kind === 'TOKEN' ? 'token' : undefined
    if (!target || !expectedKind || target.kind !== expectedKind || !target.location?.path || target.location.start === undefined || target.location.end === undefined) {
      throw new CandidateError(`目标缺少与操作类型匹配的 AST 源位置：${operation.targetRef}`)
    }
    const impact = sourceProvenPageImpact(graph, operation.targetRef)
    if (impact.unresolved.length) throw new CandidateError(`无法证明目标的完整页面影响，拒绝生成候选：${impact.unresolved.join('；')}`)
    if (scope.strategy === 'page-override') {
      if (operation.kind !== 'TEXT' || target.kind !== 'data' || !impact.pageRefs.includes(localPageRef!)) {
        throw new CandidateError('当前页面覆盖只支持具有确定页面消费者的 JSX 文本；MEDIA/TOKEN 和非目标页面尚不支持覆盖')
      }
      if (operation.overrideAction === 'remove' && !operation.targetRef.startsWith('override:')) throw new CandidateError('只能移除已保存的页面覆盖规则')
    }
    for (const pageEffect of evaluateOperationPageScope(scope, impact.pageRefs)) {
      if (pageEffect.effect === 'conflict') throw new CandidateError(pageEffect.reason)
    }
  }
  return nodes
}

function resolveTargetPath(root: string, sourcePath: string): string {
  const absolute = path.resolve(root, sourcePath)
  const relative = path.relative(root, absolute)
  if (!relative || relative === '..' || relative.startsWith(`..${path.sep}`) || path.isAbsolute(relative)) throw new CandidateError(`源文件路径越界：${sourcePath}`)
  let current = root
  for (const part of relative.split(path.sep)) {
    current = path.join(current, part)
    if (fs.existsSync(current) && fs.lstatSync(current).isSymbolicLink()) throw new CandidateError(`不允许通过符号链接写入项目：${sourcePath}`)
  }
  if (!fs.existsSync(absolute) || !fs.statSync(absolute).isFile()) throw new CandidateError(`源文件不存在：${sourcePath}`)
  return absolute
}

const overrideRuntime = `import { createContext, createElement, useContext } from 'react'
import overrides from './overrides.json'

const RipplePageContext = createContext(null)
export function RipplePageForState({ state, pageRefs, children }) {
  return createElement(RipplePageContext.Provider, { value: pageRefs[state] ?? null }, children)
}
export function RippleText({ targetRef, fallback }) {
  const pageRef = useContext(RipplePageContext)
  return overrides.pages?.[pageRef]?.[targetRef] ?? fallback
}
`

function importPath(fromFile: string, targetFile: string): string {
  const relative = path.relative(path.dirname(fromFile), targetFile).replaceAll('\\', '/')
  return relative.startsWith('.') ? relative : `./${relative}`
}

interface SourceEdit { start: number; end: number; replacement: string; operationId: string }

function applySourceEdits(sourceText: string, file: string, edits: SourceEdit[]): string {
  const ordered = [...edits].sort((left, right) => right.start - left.start)
  let priorStart = sourceText.length + 1
  let next = sourceText
  for (const edit of ordered) {
    if (edit.end > priorStart || edit.start < 0 || edit.end < edit.start || edit.end > sourceText.length) throw new CandidateError(`同一文件的操作区间重叠或无效：${file}`)
    next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end)
    priorStart = edit.start
  }
  return next
}

function checkSourceSyntax(sourceText: string, file: string): void {
  if (!/\.(tsx?|jsx?)$/i.test(file)) return
  const kind = /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
  const parsed = ts.createSourceFile(file, sourceText, ts.ScriptTarget.Latest, true, kind)
  if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new CandidateError(`源码编辑产生语法错误：${file}`)
}

function markerForTarget(sourceText: string, file: string, targetRef: string): PageOverrideMarker {
  const found = findPageOverrideMarkers(sourceText, file)
  const matches = found.markers.filter(marker => marker.id === targetRef)
  if (found.invalid.length || matches.length !== 1) throw new CandidateError(`覆盖目标 ${targetRef} 无法唯一映射到源码节点`)
  return matches[0]
}

function routeStateMapping(graph: SourceGraph, routePath: string): Record<string, string> {
  const routeNodes = graph.nodes.filter(node => node.kind === 'route' && node.location?.path === routePath)
  const mapping = Object.fromEntries(routeNodes.map(node => [node.label, node.id]))
  if (!routeNodes.length || Object.keys(mapping).length !== routeNodes.length) throw new CandidateError('页面状态重复或缺失，无法构造确定的局部覆盖映射')
  return mapping
}

function appRouteExpression(source: ts.SourceFile, route: SourceNode): ts.BinaryExpression {
  const matches: ts.BinaryExpression[] = []
  const find = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsEqualsEqualsToken && ts.isIdentifier(node.left) && ts.isStringLiteral(node.right) && node.right.text === route.label) matches.push(node)
    node.forEachChild(find)
  }
  find(source)
  if (matches.length !== 1) throw new CandidateError(`页面 ${route.label} 的源码状态映射不唯一，拒绝猜测覆盖位置`)
  return matches[0]
}

function ensurePageProvider(sourceText: string, appFile: string, appImport: string, route: SourceNode, stateToPage: Record<string, string>): string {
  const source = ts.createSourceFile(appFile, sourceText, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(appFile) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX)
  const routeExpression = appRouteExpression(source, route)
  const returns: ts.ReturnStatement[] = []
  const providers: ts.JsxElement[] = []
  const find = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression && node.expression.pos <= routeExpression.pos && node.expression.end >= routeExpression.end) returns.push(node)
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName) && node.openingElement.tagName.text === 'RipplePageForState' &&
      node.getStart(source) <= routeExpression.getStart(source) && node.getEnd() >= routeExpression.getEnd()) providers.push(node)
    node.forEachChild(find)
  }
  find(source)
  const routeReturn = returns.sort((left, right) => (left.end - left.pos) - (right.end - right.pos))[0]
  if (!routeReturn?.expression) throw new CandidateError(`无法将页面 ${route.label} 映射到 React 页面返回树`)

  let result = sourceText
  if (providers.length > 1) throw new CandidateError('页面覆盖 Provider 出现嵌套或重复结构，拒绝继续叠加')
  if (providers.length === 1) {
    const attr = providers[0].openingElement.attributes.properties.find(item => ts.isJsxAttribute(item) && item.name.getText(source) === 'pageRefs') as ts.JsxAttribute | undefined
    if (!attr?.initializer || !ts.isJsxExpression(attr.initializer)) throw new CandidateError('现有页面覆盖 Provider 缺少可维护的 pageRefs 属性')
    result = applySourceEdits(result, appFile, [{ start: attr.initializer.getStart(source), end: attr.initializer.getEnd(), replacement: `{${JSON.stringify(stateToPage)}}`, operationId: 'page-map' }])
  } else {
    const start = routeReturn.expression.getStart(source)
    const end = routeReturn.expression.getEnd()
    const original = sourceText.slice(start, end)
    const wrapper = `<RipplePageForState state={${routeExpression.left.getText(source)}} pageRefs={${JSON.stringify(stateToPage)}}>{${original}}</RipplePageForState>`
    result = applySourceEdits(result, appFile, [{ start, end, replacement: wrapper, operationId: 'page-provider' }])
  }
  result = ensureRuntimeImports(result, appFile, appImport, ['RipplePageForState'])
  checkSourceSyntax(result, appFile)
  return result
}

function removePageProvider(sourceText: string, appFile: string, appImport: string): string {
  const source = ts.createSourceFile(appFile, sourceText, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(appFile) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX)
  const providers: ts.JsxElement[] = []
  const find = (node: ts.Node) => {
    if (ts.isJsxElement(node) && ts.isIdentifier(node.openingElement.tagName) && node.openingElement.tagName.text === 'RipplePageForState') providers.push(node)
    node.forEachChild(find)
  }
  find(source)
  if (providers.length > 1) throw new CandidateError('页面覆盖 Provider 出现嵌套或重复结构，拒绝自动清理')
  let result = sourceText
  if (providers.length === 1) {
    const provider = providers[0]
    if (provider.children.length !== 1 || !ts.isJsxExpression(provider.children[0]) || !provider.children[0].expression) {
      throw new CandidateError('无法安全还原页面覆盖 Provider 的原始返回树')
    }
    const child = provider.children[0].expression
    result = applySourceEdits(result, appFile, [{ start: provider.getStart(source), end: provider.getEnd(), replacement: child.getText(source), operationId: 'remove-page-provider' }])
  }
  result = removeRuntimeImports(result, appFile, appImport, ['RipplePageForState'])
  checkSourceSyntax(result, appFile)
  return result
}

function applyPageOverrideOperations(root: string, graph: SourceGraph, scope: ScopeDecision, nodes: Map<string, SourceNode>, operations: EditOperation[], operationTargetRefs: Record<string, string>): string[] {
  const registry = readPageOverrideRegistry(root)
  const pageRef = scope.localPageRef!
  const touched = new Map<string, SourceEdit[]>()
  const modified = new Set<string>()
  const sourceTextFor = (file: string) => fs.readFileSync(resolveTargetPath(root, file), 'utf8')
  const addEdit = (file: string, edit: SourceEdit) => {
    const edits = touched.get(file) ?? []
    edits.push(edit)
    touched.set(file, edits)
    modified.add(file)
  }

  for (const operation of operations) {
    const target = nodes.get(operation.targetRef)!
    const file = target.location!.path
    const sourceText = sourceTextFor(file)
    if (operation.targetRef.startsWith('override:')) {
      operationTargetRefs[operation.id] = operation.targetRef
      const marker = markerForTarget(sourceText, file, operation.targetRef)
      const metadata = registry.targets[operation.targetRef]
      if (!metadata || marker.fallback !== metadata.original || marker.fallback !== operation.before) throw new CandidateError(`覆盖目标 ${operation.targetRef} 的共享来源与分析版本不一致`)
      if (operation.overrideAction === 'remove') {
        const pageEntries = registry.pages[pageRef]
        if (!pageEntries || !(operation.targetRef in pageEntries)) throw new CandidateError(`页面 ${pageRef} 没有目标 ${operation.targetRef} 的覆盖规则`)
        delete pageEntries[operation.targetRef]
        if (!Object.keys(pageEntries).length) delete registry.pages[pageRef]
        const stillUsed = Object.values(registry.pages).some(entries => operation.targetRef in entries)
        if (!stillUsed) {
          delete registry.targets[operation.targetRef]
          addEdit(file, { start: marker.start, end: marker.end, replacement: metadata.original, operationId: operation.id })
        }
      } else if (scope.strategy === 'shared') {
        const updated = JSON.stringify(operation.after)
        addEdit(file, { start: marker.fallbackInitializer.start, end: marker.fallbackInitializer.end, replacement: `{${updated}}`, operationId: operation.id })
        registry.targets[operation.targetRef] = { original: operation.after }
      } else {
        registry.pages[pageRef] ??= {}
        registry.pages[pageRef][operation.targetRef] = operation.after
      }
    } else {
      if (scope.strategy !== 'page-override' || operation.overrideAction) throw new CandidateError('新页面覆盖目标的身份或操作类型无效')
      const actual = sourceText.slice(target.location!.start!, target.location!.end!)
      if (actual !== operation.before) throw new CandidateError(`源内容已变化，拒绝应用操作：${operation.id}`)
      const id = newPageOverrideTargetId()
      if (registry.targets[id]) throw new CandidateError('生成的覆盖目标身份重复，请重试')
      operationTargetRefs[operation.id] = id
      registry.targets[id] = { original: operation.before }
      registry.pages[pageRef] ??= {}
      registry.pages[pageRef][id] = operation.after
      addEdit(file, {
        start: target.location!.start!, end: target.location!.end!,
        replacement: `<RippleText targetRef=${JSON.stringify(id)} fallback={${JSON.stringify(operation.before)}} />`, operationId: operation.id,
      })
    }
  }

  for (const [file, edits] of touched) {
    const original = sourceTextFor(file)
    let next = applySourceEdits(original, file, edits)
    const runtimeImport = importPath(path.join(root, file), path.join(root, '.ripple', 'overrides-runtime.js'))
    const existing = findPageOverrideMarkers(next, file)
    if (existing.invalid.length) throw new CandidateError(existing.invalid.join('；'))
    next = existing.markers.length ? ensureRuntimeImports(next, file, runtimeImport, ['RippleText']) : removeRuntimeImports(next, file, runtimeImport, ['RippleText'])
    checkSourceSyntax(next, file)
    fs.writeFileSync(resolveTargetPath(root, file), next, 'utf8')
  }

  const route = graph.nodes.find(node => node.id === pageRef && node.kind === 'route')
  if (!route?.location) throw new CandidateError(`本地页面覆盖找不到页面源码锚点：${pageRef}`)
  const appFile = route.location.path
  const appAbsolute = resolveTargetPath(root, appFile)
  const appImport = importPath(appAbsolute, path.join(root, '.ripple', 'overrides-runtime.js'))
  const appSource = fs.readFileSync(appAbsolute, 'utf8')
  let nextApp: string
  if (Object.keys(registry.targets).length) nextApp = ensurePageProvider(appSource, appFile, appImport, route, routeStateMapping(graph, appFile))
  else nextApp = removePageProvider(appSource, appFile, appImport)
  if (nextApp !== appSource) {
    fs.writeFileSync(appAbsolute, nextApp, 'utf8')
    modified.add(appFile)
  }

  const overrideRoot = path.join(root, '.ripple')
  if (Object.keys(registry.targets).length) {
    fs.mkdirSync(overrideRoot, { recursive: true })
    const runtimePath = path.join(overrideRoot, 'overrides-runtime.js')
    if (fs.existsSync(runtimePath) && (fs.lstatSync(runtimePath).isSymbolicLink() || fs.readFileSync(runtimePath, 'utf8') !== overrideRuntime)) throw new CandidateError('现有 .ripple 覆盖运行时与 Ripple 契约不同，拒绝覆盖')
    if (!fs.existsSync(runtimePath)) fs.writeFileSync(runtimePath, overrideRuntime, { encoding: 'utf8', flag: 'wx' })
    writePageOverrideRegistry(root, registry)
    modified.add('.ripple/overrides-runtime.js')
    modified.add('.ripple/overrides.json')
  } else if (fs.existsSync(overrideRoot)) {
    for (const name of ['overrides.json', 'overrides-runtime.js']) {
      const targetPath = path.join(overrideRoot, name)
      if (fs.existsSync(targetPath)) {
        if (fs.lstatSync(targetPath).isSymbolicLink() || !fs.lstatSync(targetPath).isFile()) throw new CandidateError(`拒绝清理非普通覆盖文件：${targetPath}`)
        fs.unlinkSync(targetPath)
      }
      modified.add(path.posix.join('.ripple', name))
    }
    if (!fs.readdirSync(overrideRoot).length) fs.rmdirSync(overrideRoot)
  }
  const intentToAdd = [...modified].filter(file => fs.existsSync(path.join(root, file)))
  if (intentToAdd.length) execFileSync('git', ['-C', root, 'add', '--intent-to-add', '--force', '--', ...intentToAdd], { stdio: 'pipe' })
  return [...modified]
}

function applyOperations(root: string, graph: SourceGraph, scope: ScopeDecision, nodes: Map<string, SourceNode>, operations: EditOperation[], operationTargetRefs: Record<string, string>): string[] {
  if (scope.strategy === 'page-override') return applyPageOverrideOperations(root, graph, scope, nodes, operations, operationTargetRefs)
  const byFile = new Map<string, Array<{ operation: EditOperation; node: SourceNode }>>()
  for (const operation of operations) {
    operationTargetRefs[operation.id] = operation.targetRef
    const node = nodes.get(operation.targetRef)!
    const file = node.location!.path
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file)!.push({ operation, node })
  }
  for (const [file, edits] of byFile) {
    const absolute = resolveTargetPath(root, file)
    const original = fs.readFileSync(absolute, 'utf8')
    const ordered = edits.map(({ operation, node }) => ({
      operation,
      start: node.location!.start!,
      end: node.location!.end!,
      replacement: operation.after,
    }))
      .sort((a, b) => b.start - a.start)
    let priorStart = original.length + 1
    let next = original
    for (const edit of ordered) {
      if (edit.end > priorStart || edit.start < 0 || edit.end < edit.start) throw new CandidateError(`同一文件的操作区间重叠或无效：${file}`)
      const actual = original.slice(edit.start, edit.end)
      if (actual !== edit.operation.before) throw new CandidateError(`源内容已变化，拒绝应用操作：${edit.operation.id}`)
      next = next.slice(0, edit.start) + edit.replacement + next.slice(edit.end)
      priorStart = edit.start
    }
    fs.writeFileSync(absolute, next, 'utf8')
    checkSourceSyntax(next, file)
  }
  return [...byFile.keys()]
}

function removeWorktree(projectRoot: string, candidateRoot: string): void {
  execFileSync('git', ['-c', 'core.longpaths=true', '-C', projectRoot, 'worktree', 'remove', '--force', candidateRoot])
}

export function createCandidate(request: CandidateRequest): CandidateRecord {
  const snapshot = readProjectSnapshot(request.projectRoot)
  if (snapshot.revision.sourceDigest !== request.graph.revision.sourceDigest) throw new CandidateError('候选图不再对应项目当前源码')
  if (snapshot.revision.gitCommit !== request.graph.revision.gitCommit) throw new CandidateError('候选图不再对应项目当前 Git 基线')
  const candidateRoot = outsideProject(snapshot.root, request.candidateRoot, '候选 worktree')
  const artifactRoot = outsideProject(snapshot.root, request.artifactRoot, '补丁工件目录')
  const candidateRelative = path.relative(candidateRoot, artifactRoot)
  const artifactRelative = path.relative(artifactRoot, candidateRoot)
  if (!candidateRelative || (!candidateRelative.startsWith(`..${path.sep}`) && candidateRelative !== '..') ||
    !artifactRelative || (!artifactRelative.startsWith(`..${path.sep}`) && artifactRelative !== '..')) throw new CandidateError('候选目录与补丁工件目录必须互不包含')
  if (fs.existsSync(candidateRoot)) throw new CandidateError('候选目录已存在，不会覆盖')
  const id = request.candidateId ?? `candidate-${randomUUID()}`
  if (!/^[a-zA-Z0-9._-]+$/.test(id)) throw new CandidateError('候选 ID 只能包含字母、数字、点、下划线和连字符')
  const markerPath = path.join(candidateRoot, '.ripple-candidate.json')
  const artifactPath = path.join(artifactRoot, `${id}.patch`)
  let worktreeCreated = false
  let artifactCreated = false
  try {
    fs.mkdirSync(path.dirname(candidateRoot), { recursive: true })
    fs.mkdirSync(artifactRoot, { recursive: true })
    if (fs.existsSync(artifactPath)) throw new CandidateError(`补丁工件已存在，不会覆盖：${artifactPath}`)
    execFileSync('git', ['-c', 'core.autocrlf=false', '-C', snapshot.root, 'worktree', 'add', '--detach', candidateRoot, snapshot.revision.gitCommit!], { stdio: 'pipe' })
    worktreeCreated = true
    if (digestTrackedTree(candidateRoot) !== snapshot.revision.sourceDigest) throw new CandidateError('隔离 worktree 的检出字节与原工程不同，拒绝对错位源码范围应用补丁')
    fs.writeFileSync(markerPath, JSON.stringify({ id, projectId: snapshot.revision.projectId, baseSourceDigest: snapshot.revision.sourceDigest }), { flag: 'wx' })
    const currentGraph = analyzeProject(snapshot.root)
    if (currentGraph.id !== request.graph.id) throw new CandidateError('源关系图身份不匹配，请重新分析项目')
    const nodes = assertScope(currentGraph, request.scope, request.operations)
    const operationTargetRefs: Record<string, string> = {}
    const modifiedPaths = applyOperations(candidateRoot, currentGraph, request.scope, nodes, request.operations, operationTargetRefs)
    const patch = execFileSync('git', ['-C', candidateRoot, 'diff', '--no-ext-diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (!patch) throw new CandidateError('操作没有产生真实源码差异')
    const patchHash = sha256(patch)
    fs.writeFileSync(artifactPath, patch, { encoding: 'utf8', flag: 'wx' })
    artifactCreated = true
    const candidateFiles = [...new Set([...snapshot.trackedFiles, ...modifiedPaths])].filter(file => fs.existsSync(path.join(candidateRoot, file)))
    const candidateTreeDigest = digestTrackedTree(candidateRoot, candidateFiles)
    const originalDigest = readProjectSnapshot(snapshot.root).revision.sourceDigest
    if (originalDigest !== snapshot.revision.sourceDigest) throw new CandidateError('创建候选期间原工程源码发生变化')
    return {
      id,
      projectRoot: snapshot.root,
      markerPath,
      baseSourceDigest: snapshot.revision.sourceDigest,
      scopeDecisionId: request.scope.id,
      scopeVersion: request.scope.version,
      patchHash,
      candidateTreeDigest,
      candidateRoot,
      artifactPath,
      diffArtifact: artifactPath,
      operations: request.operations.map(operation => ({ ...operation })),
      modifiedPaths: [...new Set(modifiedPaths)].sort(),
      operationTargetRefs,
    }
  } catch (error) {
    if (artifactCreated && fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath)
    if (worktreeCreated) removeWorktree(snapshot.root, candidateRoot)
    throw error
  }
}

export function assertCandidateIntegrity(candidate: CandidateRecord, requireWorktree = true): void {
  const projectId = readProjectSnapshot(candidate.projectRoot, false).revision.projectId
  if (candidate.candidateRoot && fs.existsSync(candidate.candidateRoot)) {
    const markerStat = fs.lstatSync(candidate.markerPath)
    if (markerStat.isSymbolicLink() || !markerStat.isFile()) throw new CandidateError('候选 worktree 标记无效')
    const marker = JSON.parse(fs.readFileSync(candidate.markerPath, 'utf8')) as { id: string; projectId: string; baseSourceDigest: string }
    if (marker.id !== candidate.id || marker.projectId !== projectId || marker.baseSourceDigest !== candidate.baseSourceDigest) {
      throw new CandidateError('候选 worktree 标记与候选身份不匹配')
    }
  } else if (requireWorktree) {
    throw new CandidateError('候选 worktree 已不存在')
  }
  const artifactHash = candidate.artifactPath && fs.existsSync(candidate.artifactPath) ? sha256(fs.readFileSync(candidate.artifactPath)) : ''
  if (artifactHash !== candidate.patchHash) throw new CandidateError('候选补丁哈希已变化，请重新验证')
  if (!requireWorktree) return
  if (!candidate.candidateRoot || !fs.existsSync(candidate.candidateRoot)) throw new CandidateError('候选 worktree 已不存在')
  const patch = execFileSync('git', ['-C', candidate.candidateRoot, 'diff', '--no-ext-diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const candidateFiles = [...new Set([...candidate.modifiedPaths, ...runGit(candidate.projectRoot, ['ls-files']).split(/\r?\n/).filter(Boolean)])].filter(file => fs.existsSync(path.join(candidate.candidateRoot!, file)))
  if (sha256(patch) !== candidate.patchHash || digestTrackedTree(candidate.candidateRoot, candidateFiles) !== candidate.candidateTreeDigest) {
    throw new CandidateError('候选代码或补丁哈希已变化，请重新验证')
  }
  const status = runGit(candidate.candidateRoot!, ['status', '--porcelain', '--untracked-files=all'])
  const allowed = new Set([...candidate.modifiedPaths, '.ripple-candidate.json'])
  const unexpected = status.split(/\r?\n/).filter(Boolean).filter(line => !allowed.has(line.slice(3).replace(/^"|"$/g, '')))
  if (unexpected.length) throw new CandidateError('候选包含未经记录的文件变更，不能作为已验证补丁')
}

export function assertCandidateCurrent(candidate: CandidateRecord): void {
  const currentRevision = readProjectSnapshot(candidate.projectRoot).revision
  if (currentRevision.sourceDigest !== candidate.baseSourceDigest) throw new CandidateError('候选基线已变化，请重新验证')
  assertCandidateIntegrity(candidate)
}

export function removeCandidate(candidate: CandidateRecord, options: { preserveAudit?: boolean } = {}): void {
  const marker = JSON.parse(fs.readFileSync(candidate.markerPath, 'utf8')) as { id: string; projectId: string }
  if (marker.id !== candidate.id || marker.projectId !== readProjectSnapshot(candidate.projectRoot, false).revision.projectId) throw new CandidateError('拒绝清理身份不匹配的 worktree')
  if (candidate.artifactPath && fs.existsSync(candidate.artifactPath)) {
    const patch = fs.readFileSync(candidate.artifactPath)
    if (sha256(patch) !== candidate.patchHash) throw new CandidateError('补丁工件已变化；保留现场以避免删除用户文件')
  }
  let verificationRoot: string | undefined
  let candidateEvidence: string | undefined
  if (candidate.artifactPath) {
    const artifactRoot = path.dirname(candidate.artifactPath)
    if (fs.existsSync(artifactRoot)) {
      const artifactStat = fs.lstatSync(artifactRoot)
      if (artifactStat.isSymbolicLink() || !artifactStat.isDirectory()) throw new CandidateError('拒绝清理非普通候选工件目录')
    }
    verificationRoot = path.join(artifactRoot, 'verification')
    candidateEvidence = path.join(verificationRoot, candidate.id)
    if (fs.existsSync(verificationRoot)) {
      const rootStat = fs.lstatSync(verificationRoot)
      if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new CandidateError('拒绝清理非普通验证证据目录')
      if (fs.existsSync(candidateEvidence)) {
        const evidenceStat = fs.lstatSync(candidateEvidence)
        if (evidenceStat.isSymbolicLink() || !evidenceStat.isDirectory() || path.dirname(candidateEvidence) !== verificationRoot || path.basename(candidateEvidence) !== candidate.id) {
          throw new CandidateError('拒绝清理身份不匹配的候选验证证据')
        }
      }
    }
  }
  removeWorktree(candidate.projectRoot, candidate.candidateRoot!)
  if (options.preserveAudit) {
    emptyCandidateParent(candidate.candidateRoot!)
    return
  }
  if (candidateEvidence && fs.existsSync(candidateEvidence)) fs.rmSync(candidateEvidence, { recursive: true, force: false })
  if (verificationRoot && fs.existsSync(verificationRoot) && !fs.readdirSync(verificationRoot).length) fs.rmdirSync(verificationRoot)
  if (candidate.artifactPath && fs.existsSync(candidate.artifactPath)) fs.unlinkSync(candidate.artifactPath)
  const emptyDirectory = (directory: string) => {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length) return
    fs.rmdirSync(directory)
  }
  if (candidate.artifactPath) emptyDirectory(path.dirname(candidate.artifactPath))
  emptyCandidateParent(candidate.candidateRoot!)
}

function emptyCandidateParent(candidateRoot: string): void {
  const parent = path.dirname(candidateRoot)
  if (!fs.existsSync(parent) || !fs.statSync(parent).isDirectory() || fs.readdirSync(parent).length) return
  fs.rmdirSync(parent)
}

