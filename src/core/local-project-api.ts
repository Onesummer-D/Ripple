import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { assertCandidateCurrent, CandidateError, createCandidate, removeCandidate, type CandidateRecord } from './candidate'
import { startCandidatePreview, stopCandidatePreview } from './candidate-preview'
import { analyzeProject, isProjectWorkingTreeClean, readProjectSnapshot, resolveJsxSourceElement } from './project'
import { sourceProvenPageImpact } from './scope'
import { chooseScope, openSession, recordSourceGraph, registerVerification, stageCandidate, stageOperations } from './session'
import { assertTrustedBrowserExecution } from './verification'
import { runCandidateVerification } from './verification-runner'
import type { EditOperation, EditSession, ScopeDecision, SourceGraph, VerificationRun } from './model'

interface OpenProject { root: string; graph: SourceGraph }
interface LiveCandidate { record: CandidateRecord; session: EditSession }

const projects = new Map<string, OpenProject>()
const candidates = new Map<string, LiveCandidate>()
const bodyLimit = 256 * 1024

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}

function reject(response: ServerResponse, status: number, message: string): void { json(response, status, { error: message }) }

async function readJson(request: IncomingMessage): Promise<Record<string, unknown>> {
  const contentType = request.headers['content-type']?.split(';')[0]
  if (contentType !== 'application/json') throw Object.assign(new Error('请求必须使用 application/json'), { statusCode: 415 })
  const declared = Number(request.headers['content-length'] ?? 0)
  if (declared > bodyLimit) throw Object.assign(new Error('请求体超过 256 KiB 限制'), { statusCode: 413 })
  const chunks: Buffer[] = []
  let size = 0
  for await (const chunk of request) {
    size += chunk.length
    if (size > bodyLimit) throw Object.assign(new Error('请求体超过 256 KiB 限制'), { statusCode: 413 })
    chunks.push(Buffer.from(chunk))
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.concat(chunks).toString('utf8'))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error()
    return parsed as Record<string, unknown>
  } catch { throw Object.assign(new Error('请求 JSON 无效'), { statusCode: 400 }) }
}

function assertLoopbackRequest(request: IncomingMessage): void {
  const address = request.socket.remoteAddress?.replace(/^::ffff:/, '')
  if (address !== '127.0.0.1' && address !== '::1') throw Object.assign(new Error('Project API 仅接受本机请求'), { statusCode: 403 })
  const host = request.headers.host
  if (!host || !/^(127\.0\.0\.1|localhost)(:\d+)?$/i.test(host)) throw Object.assign(new Error('Project API Host 必须为 loopback'), { statusCode: 403 })
  const origin = request.headers.origin
  if (origin && origin !== `http://${host}` && origin !== `https://${host}`) throw Object.assign(new Error('跨源访问 Project API 被拒绝'), { statusCode: 403 })
}

function routeGraph(graph: SourceGraph) {
  return {
    revision: graph.revision,
    graphId: graph.id,
    unresolved: graph.unresolved,
    routes: graph.nodes.filter(node => node.kind === 'route').map(node => ({ id: node.id, label: node.label, page: node.page })),
    components: graph.nodes.filter(node => node.kind === 'component').map(node => ({ id: node.id, label: node.label, pages: node.pages ?? [], location: node.location })),
    targets: graph.nodes.filter(node => ['data', 'media', 'token'].includes(node.kind) && node.location?.start !== undefined && node.location.end !== undefined).map(node => ({ id: node.id, kind: node.kind, label: node.label, value: node.value, pageOverrides: node.pageOverrides, location: node.location, impact: sourceProvenPageImpact(graph, node.id) })),
    relationCounts: Object.fromEntries([...new Set(graph.edges.map(edge => edge.kind))].map(kind => [kind, graph.edges.filter(edge => edge.kind === kind && edge.certainty === 'source-proven').length])),
  }
}

function candidateView(record: CandidateRecord) {
  return {
    id: record.id,
    scopeDecisionId: record.scopeDecisionId,
    scopeVersion: record.scopeVersion,
    baseSourceDigest: record.baseSourceDigest,
    patchHash: record.patchHash,
    candidateTreeDigest: record.candidateTreeDigest,
    operations: record.operations,
    modifiedPaths: record.modifiedPaths,
    diff: fs.readFileSync(record.diffArtifact, 'utf8'),
  }
}

function verificationView(run: VerificationRun | undefined, candidateId: string) {
  if (!run) return { state: 'not-run' as const, reason: '浏览器验证尚未运行。' }
  return {
    state: run.status,
    runId: run.id,
    patchHash: run.patchHash,
    candidateTreeDigest: run.candidateTreeDigest,
    scopeDecisionId: run.scopeDecisionId,
    scopeVersion: run.scopeVersion,
    startedAt: run.startedAt,
    completedAt: run.completedAt,
    assertions: run.assertions,
    evidence: run.evidence.map(evidence => ({
      id: evidence.id, checkId: evidence.checkId, result: evidence.result, pageUrl: evidence.pageUrl,
      viewport: evidence.viewport, runtimeState: evidence.runtimeState, elementRefs: evidence.elementRefs,
      reason: evidence.reason,
      ...(evidence.artifactPath ? { artifactUrl: `/__ripple/api/candidate/${encodeURIComponent(candidateId)}/evidence/${encodeURIComponent(evidence.id)}` } : {}),
    })),
    recordUrl: run.execution ? `/__ripple/api/candidate/${encodeURIComponent(candidateId)}/runs/${encodeURIComponent(run.id)}` : undefined,
    recordHash: run.execution?.recordHash,
  }
}

async function retireProjectCandidates(projectId: string): Promise<void> {
  const matching = [...candidates].filter(([, live]) => live.session.projectRevision.projectId === projectId)
  for (const [id] of matching) await retireCandidate(id)
}

async function retireCandidate(candidateId: string): Promise<void> {
  const live = candidates.get(candidateId)
  if (!live) return
  await stopCandidatePreview(candidateId)
  removeCandidate(live.record)
  candidates.delete(candidateId)
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (!url.pathname.startsWith('/__ripple/api/')) return
  assertLoopbackRequest(request)
  const evidenceMatch = url.pathname.match(/^\/__ripple\/api\/candidate\/([^/]+)\/evidence\/([^/]+)$/)
  if (evidenceMatch) {
    if (request.method !== 'GET') return reject(response, 405, '截图证据仅支持读取')
    const candidateId = decodeURIComponent(evidenceMatch[1])
    const evidenceId = decodeURIComponent(evidenceMatch[2])
    const live = candidates.get(candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const run = [...live.session.runs].reverse().find(item => item.evidence.some(evidence => evidence.id === evidenceId))
    const evidence = run?.evidence.find(item => item.id === evidenceId)
    if (!run || !evidence?.artifactPath || !evidence.artifactHash) return reject(response, 404, '候选没有该截图证据')
    assertTrustedBrowserExecution(run)
    const stat = fs.lstatSync(evidence.artifactPath)
    if (stat.isSymbolicLink() || !stat.isFile()) return reject(response, 404, '截图证据已失效')
    const bytes = fs.readFileSync(evidence.artifactPath)
    if (createHash('sha256').update(bytes).digest('hex') !== evidence.artifactHash) return reject(response, 409, '截图证据哈希已变化')
    response.writeHead(200, { 'content-type': 'image/png', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(bytes)
    return
  }
  const runMatch = url.pathname.match(/^\/__ripple\/api\/candidate\/([^/]+)\/runs\/([^/]+)$/)
  if (runMatch) {
    if (request.method !== 'GET') return reject(response, 405, '浏览器执行记录仅支持读取')
    const candidateId = decodeURIComponent(runMatch[1])
    const runId = decodeURIComponent(runMatch[2])
    const live = candidates.get(candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const run = live.session.runs.find(item => item.id === runId)
    if (!run?.execution) return reject(response, 404, '候选没有该浏览器执行记录')
    assertTrustedBrowserExecution(run)
    const recordPath = run.execution.recordPath
    const stat = fs.lstatSync(recordPath)
    if (stat.isSymbolicLink() || !stat.isFile()) return reject(response, 404, '浏览器执行记录已失效')
    const bytes = fs.readFileSync(recordPath)
    if (createHash('sha256').update(bytes).digest('hex') !== run.execution.recordHash) return reject(response, 409, '浏览器执行记录哈希已变化')
    response.writeHead(200, { 'content-type': 'application/json; charset=utf-8', 'content-length': bytes.length, 'cache-control': 'no-store', 'x-content-type-options': 'nosniff' })
    response.end(bytes)
    return
  }
  if (request.method !== 'POST') return reject(response, 405, '仅支持 POST')

  if (url.pathname === '/__ripple/api/analyze') {
    const body = await readJson(request)
    if (typeof body.projectRoot !== 'string' || !body.projectRoot.trim()) return reject(response, 400, '需要本机项目目录')
    const root = fs.realpathSync(path.resolve(body.projectRoot))
    if (!fs.statSync(root).isDirectory()) return reject(response, 400, '项目路径不是目录')
    const snapshot = readProjectSnapshot(root)
    const graph = analyzeProject(root)
    if (snapshot.revision.sourceDigest !== graph.revision.sourceDigest) return reject(response, 409, '分析期间项目源码发生变化，请重新读取')
    if (typeof body.previousCandidateId === 'string' && candidates.get(body.previousCandidateId)?.session.projectRevision.projectId !== snapshot.revision.projectId) await retireCandidate(body.previousCandidateId)
    await retireProjectCandidates(snapshot.revision.projectId)
    projects.set(snapshot.revision.projectId, { root, graph })
    return json(response, 200, { projectRoot: root, ...routeGraph(graph) })
  }

  if (url.pathname === '/__ripple/api/candidate') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string' || typeof body.rawIntent !== 'string' || !Array.isArray(body.operations) || !body.scope || typeof body.scope !== 'object') return reject(response, 400, '候选需要 projectId、原始意图、操作列表和 Scope 决策')
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 404, '项目分析已过期，请重新读取')
    const operations = body.operations as EditOperation[]
    const scope = body.scope as ScopeDecision
    const sessionId = `session-${randomUUID()}`
    const candidateId = `candidate-${randomUUID()}`
    const stateRoot = path.resolve(process.env.RIPPLE_WORKBENCH_STATE_DIR ?? path.join(os.tmpdir(), 'ripple-workbench'))
    const artifactRoot = path.join(stateRoot, sessionId, 'artifacts')
    const candidateRoot = path.join(stateRoot, sessionId, 'candidate')
    const session = recordSourceGraph(openSession(sessionId, project.graph.revision, body.rawIntent), project.graph.id, project.graph.revision.sourceDigest)
    const scoped = chooseScope(session, scope)
    const staged = stageOperations(scoped, operations)
    const record = createCandidate({ projectRoot: project.root, candidateRoot, artifactRoot, graph: project.graph, scope, operations, candidateId })
    try {
      const candidateSession = stageCandidate(staged, record)
      assertCandidateCurrent(record)
      if (typeof body.previousCandidateId === 'string' && candidates.get(body.previousCandidateId)?.session.projectRevision.projectId !== project.graph.revision.projectId) await retireCandidate(body.previousCandidateId)
      await retireProjectCandidates(project.graph.revision.projectId)
      candidates.set(record.id, { record, session: candidateSession })
      return json(response, 200, {
        sessionId,
        status: candidateSession.status,
        candidate: candidateView(record),
        verification: verificationView(undefined, record.id),
      })
    } catch (error) {
      if (fs.existsSync(record.markerPath)) removeCandidate(record)
      throw error
    }
  }

  if (url.pathname === '/__ripple/api/candidate/preview' || url.pathname === '/__ripple/api/candidate/preview/stop') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    if (url.pathname.endsWith('/stop')) {
      await stopCandidatePreview(body.candidateId)
      return json(response, 200, { stopped: true, candidateId: body.candidateId })
    }
    try {
      assertCandidateCurrent(live.record)
      const preview = await startCandidatePreview(live.record)
      return json(response, 200, { candidateId: preview.candidateId, url: preview.url, verification: verificationView(live.session.runs.at(-1), live.record.id) })
    } catch (error) {
      if (error instanceof CandidateError) await retireCandidate(body.candidateId)
      throw error
    }
  }

  if (url.pathname === '/__ripple/api/candidate/verify') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const project = projects.get(live.session.projectRevision.projectId)
    if (!project) return reject(response, 409, '项目分析状态已过期，请重新读取')
    assertCandidateCurrent(live.record)
    const preview = await startCandidatePreview(live.record)
    const run = await runCandidateVerification(live.record, live.session, project.graph, preview)
    live.session = registerVerification(live.session, run)
    return json(response, 200, { candidateId: live.record.id, previewUrl: preview.url, verification: verificationView(live.session.runs.at(-1), live.record.id) })
  }

  if (url.pathname === '/__ripple/api/candidate/source-selection') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string' || typeof body.sourceRef !== 'string') return reject(response, 400, '源码定位需要 candidateId 和 sourceRef')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    assertCandidateCurrent(live.record)
    const graph = analyzeProject(live.record.candidateRoot!, false)
    if (graph.revision.sourceDigest !== live.record.candidateTreeDigest) throw new CandidateError('候选源码图与当前补丁树摘要不一致')
    const { element, editableText } = resolveJsxSourceElement(graph, body.sourceRef)
    return json(response, 200, {
      candidateId: live.record.id,
      patchHash: live.record.patchHash,
      sourceDigest: graph.revision.sourceDigest,
      element,
      editableText: editableText.map(node => ({ ...node, impact: sourceProvenPageImpact(graph, node.id) })),
    })
  }

  if (url.pathname === '/__ripple/api/candidate/restore') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const projectId = live.session.projectRevision.projectId
    const project = projects.get(projectId)
    if (!project) return reject(response, 409, '项目分析状态已过期，请重新读取')

    const currentRevision = readProjectSnapshot(project.root, false).revision
    if (currentRevision.sourceDigest !== live.record.baseSourceDigest || !isProjectWorkingTreeClean(project.root)) {
      await retireCandidate(body.candidateId)
      return reject(response, 409, '候选基线已过期，隔离 worktree 已清理；请重新分析项目')
    }
    assertCandidateCurrent(live.record)
    return json(response, 200, {
      analysis: { projectRoot: project.root, ...routeGraph(project.graph) },
      rawIntent: live.session.rawIntent,
      scope: live.session.scope,
      candidate: candidateView(live.record),
      verification: verificationView(live.session.runs.at(-1), live.record.id),
    })
  }

  if (url.pathname === '/__ripple/api/discard') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    await retireCandidate(body.candidateId)
    return json(response, 200, { removed: true, candidateId: body.candidateId })
  }
  return reject(response, 404, '未知 Project API 路径')
}

async function cleanupCandidates(): Promise<void> {
  const failures: unknown[] = []
  for (const [id] of candidates) {
    try { await retireCandidate(id) }
    catch (error) { failures.push(error) }
  }
  if (failures.length) throw new AggregateError(failures, 'Some candidate worktrees were preserved because safe cleanup failed')
}

export function localProjectApiPlugin(): Plugin {
  return {
    name: 'ripple-local-project-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/__ripple/api/')) return next()
        void handle(request, response).catch(error => {
          const failure = error instanceof Error ? error as Error & { statusCode?: number } : undefined
          const code = failure && 'code' in failure ? failure.code : undefined
          const status = typeof failure?.statusCode === 'number' ? failure.statusCode : failure?.name === 'CandidatePreviewError' || failure?.name === 'VerificationRunnerError' ? 503 : failure?.name === 'CandidateError' ? 409 : failure?.name === 'SessionInvariantError' || failure?.name === 'ProjectReadError' || code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' ? 400 : 500
          reject(response, status, error instanceof Error ? error.message : 'Project API failed')
        })
      })
      server.httpServer?.once('close', () => {
        void cleanupCandidates().catch(error => server.config.logger.error(String(error)))
      })
    },
  }
}
