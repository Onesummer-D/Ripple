import { createHash, randomUUID } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import type { CandidatePatch, EditOperation, ScopeDecision, SourceGraph, SourceNode } from './model'
import { analyzeProject, digestTrackedTree, readProjectSnapshot } from './project'

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
  const excluded = new Set([...scope.excludedRefs, ...scope.protectedRefs])
  for (const operation of operations) {
    if (!included.has(operation.targetRef) || excluded.has(operation.targetRef)) throw new CandidateError(`Scope 不允许修改目标：${operation.targetRef}`)
    if (operation.before === operation.after) throw new CandidateError(`操作没有修改内容：${operation.id}`)
    const target = nodes.get(operation.targetRef)
    const expectedKind = operation.kind === 'TEXT' ? 'data' : operation.kind === 'MEDIA' ? 'media' : operation.kind === 'TOKEN' ? 'token' : undefined
    if (!target || !expectedKind || target.kind !== expectedKind || !target.location?.path || target.location.start === undefined || target.location.end === undefined) {
      throw new CandidateError(`目标缺少与操作类型匹配的 AST 源位置：${operation.targetRef}`)
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

function applyOperations(root: string, nodes: Map<string, SourceNode>, operations: EditOperation[]): void {
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
    const ordered = edits.map(({ operation, node }) => ({ operation, start: node.location!.start!, end: node.location!.end! }))
      .sort((a, b) => b.start - a.start)
    let priorStart = original.length + 1
    let next = original
    for (const edit of ordered) {
      if (edit.end > priorStart || edit.start < 0 || edit.end < edit.start) throw new CandidateError(`同一文件的操作区间重叠或无效：${file}`)
      const actual = original.slice(edit.start, edit.end)
      if (actual !== edit.operation.before) throw new CandidateError(`源内容已变化，拒绝应用操作：${edit.operation.id}`)
      next = next.slice(0, edit.start) + edit.operation.after + next.slice(edit.end)
      priorStart = edit.start
    }
    fs.writeFileSync(absolute, next, 'utf8')
    if (/\.(tsx?|jsx?)$/i.test(file)) {
      const kind = /\.(tsx|jsx)$/i.test(file) ? ts.ScriptKind.TSX : ts.ScriptKind.TS
      const parsed = ts.createSourceFile(file, next, ts.ScriptTarget.Latest, true, kind)
      if ((parsed as ts.SourceFile & { parseDiagnostics: readonly ts.Diagnostic[] }).parseDiagnostics.length) throw new CandidateError(`源码编辑产生语法错误：${file}`)
    }
  }
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
    applyOperations(candidateRoot, nodes, request.operations)
    const patch = execFileSync('git', ['-C', candidateRoot, 'diff', '--no-ext-diff', '--binary', 'HEAD'], { encoding: 'utf8', maxBuffer: 32 * 1024 * 1024 })
    if (!patch) throw new CandidateError('操作没有产生真实源码差异')
    const patchHash = sha256(patch)
    fs.writeFileSync(artifactPath, patch, { encoding: 'utf8', flag: 'wx' })
    artifactCreated = true
    const candidateTreeDigest = digestTrackedTree(candidateRoot)
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
      modifiedPaths: [...new Set(request.operations.map(operation => nodes.get(operation.targetRef)!.location!.path!))].sort(),
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
  if (sha256(patch) !== candidate.patchHash || artifactHash !== candidate.patchHash || digestTrackedTree(candidate.candidateRoot!) !== candidate.candidateTreeDigest) {
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
}
