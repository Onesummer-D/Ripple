import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { CandidatePatch, EditOperation, ScopeDecision, SourceGraph, SourceNode } from './model'
import { analyzeProject, digestTrackedTree, readProjectSnapshot } from './project'
import { sourceProvenPageImpact } from './scope'

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
    if (operation.before === operation.after) throw new CandidateError(`操作没有修改内容：${operation.id}`)
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
      for (const pageRef of impact.pageRefs) {
        if (pageRef !== localPageRef && !excluded.has(pageRef)) throw new CandidateError(`页面覆盖要求明确排除或保护其他共享消费者：${pageRef}`)
      }
      continue
    }
    for (const pageRef of impact.pageRefs) {
      if (excluded.has(pageRef)) throw new CandidateError(`操作会影响 Scope 排除或保护的页面：${pageRef}`)
      if (!included.has(pageRef)) throw new CandidateError(`Scope 尚未明确包含受影响页面：${pageRef}`)
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

function applyOperations(root: string, graph: SourceGraph, scope: ScopeDecision, nodes: Map<string, SourceNode>, operations: EditOperation[]): string[] {
  const byFile = new Map<string, Array<{ operation: EditOperation; node: SourceNode }>>()
  for (const operation of operations) {
    const node = nodes.get(operation.targetRef)!
    const file = node.location!.path
    if (!byFile.has(file)) byFile.set(file, [])
    byFile.get(file)!.push({ operation, node })
  }
  for (const [file, edits] of byFile) {
    const absolute = resolveTargetPath(root, file)
    const original = fs.readFileSync(absolute, 'utf8')
    const pageOverride = scope.strategy === 'page-override'
    const ordered = edits.map(({ operation, node }) => ({
      operation,
      start: node.location!.start!,
      end: node.location!.end!,
      replacement: pageOverride ? `<RippleText targetRef={${JSON.stringify(operation.targetRef)}} fallback={${JSON.stringify(operation.before)}} />` : operation.after,
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
    if (pageOverride) fs.writeFileSync(absolute, `import { RippleText } from ${JSON.stringify(importPath(absolute, path.join(root, '.ripple', 'overrides-runtime.js')))};\n${next}`, 'utf8')
    if (/\.(tsx?|jsx?)$/i.test(file)) {
      const kind = /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const parsed = ts.createSourceFile(file, next, ts.ScriptTarget.Latest, true, kind)
      if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new CandidateError(`源码编辑产生语法错误：${file}`)
    }
  }
  const modifiedPaths = [...byFile.keys()]
  if (scope.strategy !== 'page-override') return modifiedPaths

  const pageRef = scope.localPageRef!
  const route = graph.nodes.find(node => node.id === pageRef && node.kind === 'route')
  if (!route?.location) throw new CandidateError(`本地页面覆盖找不到页面源码锚点：${pageRef}`)
  const appAbsolute = resolveTargetPath(root, route.location.path)
  const appSourceText = fs.readFileSync(appAbsolute, 'utf8')
  const appSource = ts.createSourceFile(route.location.path, appSourceText, ts.ScriptTarget.Latest, true, /\.jsx$/i.test(route.location.path) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX)
  let routeExpression: ts.BinaryExpression | undefined
  const findRoute = (node: ts.Node) => {
    if (ts.isBinaryExpression(node) && ts.isIdentifier(node.left) && ts.isStringLiteral(node.right) && node.right.text === route.label) routeExpression = node
    node.forEachChild(findRoute)
  }
  findRoute(appSource)
  if (!routeExpression) throw new CandidateError(`无法将页面 ${route.label} 映射到 React 页面状态`)
  const routeNodes = graph.nodes.filter(node => node.kind === 'route' && node.location?.path === route.location!.path)
  const stateToPage = Object.fromEntries(routeNodes.map(node => [node.label, node.id]))
  if (Object.keys(stateToPage).length !== routeNodes.length) throw new CandidateError('页面状态标签重复，无法构造确定的局部覆盖映射')
  const returnNodes: ts.ReturnStatement[] = []
  const collectReturns = (node: ts.Node) => {
    if (ts.isReturnStatement(node) && node.expression && node.expression.pos <= routeExpression!.pos && node.expression.end >= routeExpression!.end) returnNodes.push(node)
    node.forEachChild(collectReturns)
  }
  collectReturns(appSource)
  const routeReturn = returnNodes.sort((left, right) => (left.end - left.pos) - (right.end - right.pos))[0]
  if (!routeReturn?.expression) throw new CandidateError(`无法将页面 ${route.label} 映射到 React 组件的返回树`)
  const appNext = appSourceText.slice(0, routeReturn.expression.getStart(appSource)) + `<RipplePageForState state={${routeExpression.left.getText(appSource)}} pageRefs={${JSON.stringify(stateToPage)}}>{${routeReturn.expression.getText(appSource)}}</RipplePageForState>` + appSourceText.slice(routeReturn.expression.getEnd())
  const appImportPath = importPath(appAbsolute, path.join(root, '.ripple', 'overrides-runtime.js'))
  fs.writeFileSync(appAbsolute, `import { RipplePageForState } from ${JSON.stringify(appImportPath)};\n${appNext}`, 'utf8')
  const rewrittenApp = ts.createSourceFile(route.location.path, fs.readFileSync(appAbsolute, 'utf8'), ts.ScriptTarget.Latest, true, /\.jsx$/i.test(route.location.path) ? ts.ScriptKind.JSX : ts.ScriptKind.TSX)
  if ((rewrittenApp as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new CandidateError(`页面覆盖产生语法错误：${route.location.path}`)
  const overrideRoot = path.join(root, '.ripple')
  if (fs.existsSync(overrideRoot) && fs.lstatSync(overrideRoot).isSymbolicLink()) throw new CandidateError('本地覆盖目录不能是符号链接')
  fs.mkdirSync(overrideRoot, { recursive: true })
  const runtimePath = path.join(overrideRoot, 'overrides-runtime.js')
  if (fs.existsSync(runtimePath) && (fs.lstatSync(runtimePath).isSymbolicLink() || fs.readFileSync(runtimePath, 'utf8') !== overrideRuntime)) throw new CandidateError('现有 .ripple 覆盖运行时与 Ripple 契约不同，拒绝覆盖')
  const registryPath = path.join(overrideRoot, 'overrides.json')
  let registry: { schemaVersion: 1; pages: Record<string, Record<string, string>> } = { schemaVersion: 1, pages: {} }
  if (fs.existsSync(registryPath)) {
    if (fs.lstatSync(registryPath).isSymbolicLink() || !fs.lstatSync(registryPath).isFile()) throw new CandidateError('覆盖注册表必须是普通文件')
    try { registry = JSON.parse(fs.readFileSync(registryPath, 'utf8')) as typeof registry }
    catch { throw new CandidateError('现有 .ripple/overrides.json 无法解析') }
    if (registry.schemaVersion !== 1 || !registry.pages || typeof registry.pages !== 'object' || Array.isArray(registry.pages)) throw new CandidateError('现有 .ripple/overrides.json 不符合 Ripple 覆盖契约')
  }
  registry.pages[pageRef] ??= {}
  for (const operation of operations) registry.pages[pageRef][operation.targetRef] = operation.after
  if (!fs.existsSync(runtimePath)) fs.writeFileSync(runtimePath, overrideRuntime, { encoding: 'utf8', flag: 'wx' })
  fs.writeFileSync(registryPath, `${JSON.stringify(registry, null, 2)}\n`, 'utf8')
  execFileSync('git', ['-C', root, 'add', '--intent-to-add', '--force', '--', '.ripple/overrides-runtime.js', '.ripple/overrides.json'], { stdio: 'pipe' })
  return [...new Set([...modifiedPaths, route.location.path, '.ripple/overrides-runtime.js', '.ripple/overrides.json'])]
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
    const modifiedPaths = applyOperations(candidateRoot, currentGraph, request.scope, nodes, request.operations)
    const patch = execFileSync('git', ['-C', candidateRoot, 'diff', '--no-ext-diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (!patch) throw new CandidateError('操作没有产生真实源码差异')
    const patchHash = sha256(patch)
    fs.writeFileSync(artifactPath, patch, { encoding: 'utf8', flag: 'wx' })
    artifactCreated = true
    const candidateTreeDigest = digestTrackedTree(candidateRoot, [...new Set([...snapshot.trackedFiles, ...modifiedPaths])])
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
    }
  } catch (error) {
    if (artifactCreated && fs.existsSync(artifactPath)) fs.unlinkSync(artifactPath)
    if (worktreeCreated) removeWorktree(snapshot.root, candidateRoot)
    throw error
  }
}

export function assertCandidateCurrent(candidate: CandidateRecord): void {
  const marker = JSON.parse(fs.readFileSync(candidate.markerPath, 'utf8')) as { id: string; projectId: string; baseSourceDigest: string }
  const currentRevision = readProjectSnapshot(candidate.projectRoot).revision
  if (currentRevision.sourceDigest !== candidate.baseSourceDigest || marker.id !== candidate.id || marker.projectId !== currentRevision.projectId || marker.baseSourceDigest !== candidate.baseSourceDigest) {
    throw new CandidateError('候选 worktree 标记与候选身份不匹配')
  }
  const patch = execFileSync('git', ['-C', candidate.candidateRoot!, 'diff', '--no-ext-diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
  const artifactHash = candidate.artifactPath && fs.existsSync(candidate.artifactPath) ? sha256(fs.readFileSync(candidate.artifactPath)) : ''
  if (sha256(patch) !== candidate.patchHash || artifactHash !== candidate.patchHash || digestTrackedTree(candidate.candidateRoot!, [...new Set([...candidate.modifiedPaths, ...runGit(candidate.projectRoot, ['ls-files']).split(/\r?\n/).filter(Boolean)])]) !== candidate.candidateTreeDigest) {
    throw new CandidateError('候选代码或补丁哈希已变化，请重新验证')
  }
  const status = runGit(candidate.candidateRoot!, ['status', '--porcelain', '--untracked-files=all'])
  const allowed = new Set([...candidate.modifiedPaths, '.ripple-candidate.json'])
  const unexpected = status.split(/\r?\n/).filter(Boolean).filter(line => !allowed.has(line.slice(3).replace(/^"|"$/g, '')))
  if (unexpected.length) throw new CandidateError('候选包含未经记录的文件变更，不能作为已验证补丁')
}

export function removeCandidate(candidate: CandidateRecord): void {
  const marker = JSON.parse(fs.readFileSync(candidate.markerPath, 'utf8')) as { id: string; projectId: string }
  if (marker.id !== candidate.id || marker.projectId !== readProjectSnapshot(candidate.projectRoot, false).revision.projectId) throw new CandidateError('拒绝清理身份不匹配的 worktree')
  if (candidate.artifactPath && fs.existsSync(candidate.artifactPath)) {
    const patch = fs.readFileSync(candidate.artifactPath)
    if (sha256(patch) !== candidate.patchHash) throw new CandidateError('补丁工件已变化；保留现场以避免删除用户文件')
  }
  removeWorktree(candidate.projectRoot, candidate.candidateRoot!)
  if (candidate.artifactPath && fs.existsSync(candidate.artifactPath)) fs.unlinkSync(candidate.artifactPath)
  const emptyDirectory = (directory: string) => {
    if (!fs.existsSync(directory) || !fs.statSync(directory).isDirectory() || fs.readdirSync(directory).length) return
    fs.rmdirSync(directory)
  }
  if (candidate.artifactPath) emptyDirectory(path.dirname(candidate.artifactPath))
  emptyDirectory(path.dirname(candidate.candidateRoot!))
}
