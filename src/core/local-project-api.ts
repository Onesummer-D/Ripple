import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { assertCandidateCurrent, assertCandidateIntegrity, CandidateError, createCandidate, removeCandidate, type CandidateRecord } from './candidate'
import { applyApprovedCandidate, isAppliedCandidateRollbackable, PatchApplyError, rollbackAppliedCandidate } from './apply'
import { isCurrentProjectSourcePreview, preparePreviewNetworkPool, readProjectSourcePreviewDiagnostics, startCandidatePreview, startProjectSourcePreview, stopCandidatePreview, stopPreviewNetworkPool, stopProjectSourcePreview } from './candidate-preview'
import { referencedPreviewResourceUrls, saveTrustedPreviewResourceUrls, trustedPreviewResourceUrls } from './preview-resource-policy'
import { analyzeProject, createRuntimeSourceMap, isProjectWorkingTreeClean, readProjectSnapshot, resolveJsxSourceElement, resolveRuntimeInstance } from './project'
import { assessRuntimeIdentity, selectableRuntimeObservations, RUNTIME_IDENTITY_PROTOCOL } from './runtime-identity'
import type { RuntimeIdentityRecord, RuntimeIdentitySnapshot } from './runtime-identity'
import { sourceProvenPageImpact } from './scope'
import { approve, beginVerification, chooseScope, openSession, recordAppliedRevision, recordRollback, recordSourceGraph, recordVerificationFailure, registerVerification, SessionInvariantError, stageCandidate, stageOperations } from './session'
import { assertTrustedBrowserExecution, restoreBrowserExecution } from './verification-receipt'
import { runCandidateVerification } from './verification-runner'
import type { EditOperation, EditSession, ScopeDecision, SourceGraph, VerificationRun } from './model'
import { normalizeVerificationContract, VerificationContractError } from './verification-contract'
import { listStoredCandidates, readStoredCandidate, workbenchStateRoot, writeStoredCandidate, type CandidateLifecycle } from './workbench-store'
import type { CandidateOperationRegistry } from './candidate-operation-executors'
import { inspectProjectCapabilities } from './project-capabilities'

interface OpenProject { root: string; graph: SourceGraph }
interface LiveCandidate { record: CandidateRecord; session: EditSession; lifecycle: CandidateLifecycle }

const projects = new Map<string, OpenProject>()
const candidates = new Map<string, LiveCandidate>()
const candidateLocks = new Set<string>()
const projectPreviewLocks = new Set<string>()
const bodyLimit = 256 * 1024

function json(response: ServerResponse, status: number, value: unknown): void {
  const body = JSON.stringify(value)
  response.writeHead(status, { 'content-type': 'application/json; charset=utf-8', 'content-length': Buffer.byteLength(body), 'cache-control': 'no-store' })
  response.end(body)
}

function reject(response: ServerResponse, status: number, message: string, details?: { code: string; path?: string }): void { json(response, status, { error: message, ...details }) }

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

function routeGraph(graph: SourceGraph, projectRoot: string) {
  const projectId = graph.revision.projectId
  return {
    revision: graph.revision,
    capabilities: inspectProjectCapabilities(projectRoot, graph),
    graphId: graph.id,
    unresolved: graph.unresolved,
    routes: graph.nodes.filter(node => node.kind === 'route').map(node => ({ id: node.id, label: node.label, page: node.page })),
    components: graph.nodes.filter(node => node.kind === 'component').map(node => ({ id: node.id, label: node.label, pages: node.pages ?? [], location: node.location })),
    targets: graph.nodes.filter(node => ['data', 'media', 'token'].includes(node.kind) && node.location?.start !== undefined && node.location.end !== undefined).map(node => ({ id: node.id, kind: node.kind, label: node.label, value: node.value, pageOverrides: node.pageOverrides, location: node.location, impact: sourceProvenPageImpact(graph, node.id) })),
    relationCounts: Object.fromEntries([...new Set(graph.edges.map(edge => edge.kind))].map(kind => [kind, graph.edges.filter(edge => edge.kind === kind && edge.certainty === 'source-proven').length])),
    previewResources: { referencedUrls: referencedPreviewResourceUrls(projectRoot), authorizedUrls: trustedPreviewResourceUrls(projectId) },
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

function verificationView(run: VerificationRun | undefined, candidateId: string, failure?: EditSession['verificationFailure']) {
  if (failure?.candidateId === candidateId) return { state: 'failed-to-run' as const, reason: failure.reason, patchHash: failure.patchHash }
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
    ...(run.browserErrorDetails ? { browserErrorDetails: run.browserErrorDetails } : {}),
  }
}

async function retireProjectCandidates(projectId: string): Promise<void> {
  const matching = [...candidates].filter(([, live]) => live.session.projectRevision.projectId === projectId && live.lifecycle === 'active')
  for (const [id] of matching) await retireCandidate(id)
  for (const stored of listStoredCandidates(projectId).filter(item => item.lifecycle === 'active' && !candidates.has(item.record.id))) {
    if (stored.record.candidateRoot && fs.existsSync(stored.record.candidateRoot)) removeCandidate(stored.record, { preserveAudit: true })
    writeStoredCandidate({ ...stored, lifecycle: 'discarded', updatedAt: new Date().toISOString() })
  }
}

function assertProjectAnalysisCurrent(project: OpenProject): void {
  if (!isProjectWorkingTreeClean(project.root)) throw new CandidateError('项目工作树已发生修改，请重新分析后再预演或定位源码')
  const revision = readProjectSnapshot(project.root, false).revision
  if (revision.projectId !== project.graph.revision.projectId || revision.sourceDigest !== project.graph.revision.sourceDigest) {
    throw new CandidateError('预览对应的项目源码已过期，请重新分析工程')
  }
}

async function retireCandidate(candidateId: string, lifecycle: CandidateLifecycle = 'discarded', alreadyLocked = false): Promise<void> {
  const live = candidates.get(candidateId)
  if (!live) return
  if (!alreadyLocked && candidateLocks.has(candidateId)) throw new CandidateError('候选正在验证或变更中，请稍后重试')
  if (live.lifecycle === 'applied' || live.lifecycle === 'rolled-back') return
  await stopCandidatePreview(candidateId)
  if (live.record.candidateRoot && fs.existsSync(live.record.candidateRoot)) removeCandidate(live.record, { preserveAudit: true })
  live.lifecycle = lifecycle
  writeStoredCandidate({ schemaVersion: 1, lifecycle, updatedAt: new Date().toISOString(), record: live.record, session: live.session })
  candidates.delete(candidateId)
}

export async function withCandidateLock<T>(candidateId: string, action: () => Promise<T>): Promise<T> {
  if (candidateLocks.has(candidateId)) throw new CandidateError('候选已有验证或生命周期操作正在执行')
  candidateLocks.add(candidateId)
  try { return await action() }
  finally { candidateLocks.delete(candidateId) }
}

async function withProjectPreviewLock<T>(projectId: string, action: () => Promise<T>): Promise<T> {
  if (projectPreviewLocks.has(projectId)) throw new CandidateError('项目预览已有启动、停止或源码定位操作正在执行')
  projectPreviewLocks.add(projectId)
  try { return await action() }
  finally { projectPreviewLocks.delete(projectId) }
}

function assertNoActiveProjectCandidate(projectId: string): void {
  if ([...candidates.values()].some(live => live.lifecycle === 'active' && live.session.projectRevision.projectId === projectId)) {
    throw new CandidateError('当前项目存在活动候选；请先完成或清理候选，再启动只读项目预览')
  }
}

async function assertCurrentOrRetire(candidateId: string, live: LiveCandidate, alreadyLocked: boolean): Promise<void> {
  try { assertCandidateCurrent(live.record) }
  catch (error) {
    const baselineChanged = !isProjectWorkingTreeClean(live.record.projectRoot) || readProjectSnapshot(live.record.projectRoot, false).revision.sourceDigest !== live.record.baseSourceDigest
    if (baselineChanged || error instanceof CandidateError) await retireCandidate(candidateId, 'stale', alreadyLocked)
    throw error
  }
}

function persistCandidate(live: LiveCandidate): void {
  writeStoredCandidate({ schemaVersion: 1, lifecycle: live.lifecycle, updatedAt: new Date().toISOString(), record: live.record, session: live.session })
}

function savedVerificationView(stored: ReturnType<typeof listStoredCandidates>[number]) {
  const run = stored.session.runs.at(-1)
  if (!run) return verificationView(undefined, stored.record.id, stored.session.verificationFailure)
  try { return verificationView(restoreBrowserExecution(run), stored.record.id, stored.session.verificationFailure) }
  catch (error) { return { state: 'stale' as const, reason: error instanceof Error ? `保存的浏览器证据已失效：${error.message}` : '保存的浏览器证据已失效。' } }
}

function workflowView(live: LiveCandidate) {
  const rollbackAvailable = live.lifecycle === 'applied' && isAppliedCandidateRollbackable(live.session, live.record)
  return {
    lifecycle: live.lifecycle,
    approval: live.session.approval,
    applied: live.session.applied,
    rollback: live.session.rollback,
    rollbackAvailable,
  }
}

function restoreStoredCandidate(candidateId: string): LiveCandidate | undefined {
  const stored = readStoredCandidate(candidateId)
  if (!stored || stored.lifecycle === 'discarded' || stored.lifecycle === 'stale') return undefined
  const record = stored.record
  const root = fs.realpathSync(record.projectRoot)
  if (root !== record.projectRoot) throw new CandidateError('保存候选的项目路径已变化，必须重新分析')
  const currentGraph = analyzeProject(root, false)
  if (currentGraph.revision.projectId !== stored.session.projectRevision.projectId) throw new CandidateError('保存候选对应的项目身份已变化')
  const session = { ...stored.session, runs: stored.session.runs.map(restoreBrowserExecution) }
  const live: LiveCandidate = { record, session, lifecycle: stored.lifecycle }
  projects.set(currentGraph.revision.projectId, { root, graph: currentGraph })
  candidates.set(candidateId, live)
  return live
}

async function handle(request: IncomingMessage, response: ServerResponse, options: LocalProjectApiOptions = {}): Promise<void> {
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
  if (url.pathname === '/__ripple/api/project/preview/report') {
    if (request.method !== 'GET') return reject(response, 405, '预演诊断仅支持读取')
    const projectId = url.searchParams.get('projectId')
    const previewId = url.searchParams.get('previewId')
    if (!projectId || !previewId) return reject(response, 400, '预演诊断需要 projectId 与 previewId')
    return json(response, 200, await readProjectSourcePreviewDiagnostics(projectId, previewId))
  }
  if (url.pathname === '/__ripple/api/history') {
    if (request.method !== 'GET') return reject(response, 405, '候选历史仅支持读取')
    const projectId = url.searchParams.get('projectId') ?? undefined
    const history = listStoredCandidates(projectId).slice(-100).reverse().map(stored => ({
      candidateId: stored.record.id,
      projectId: stored.session.projectRevision.projectId,
      lifecycle: stored.lifecycle,
      patchHash: stored.record.patchHash,
      baseSourceDigest: stored.record.baseSourceDigest,
      candidateTreeDigest: stored.record.candidateTreeDigest,
      updatedAt: stored.updatedAt,
      approval: stored.session.approval,
      applied: stored.session.applied,
      rollback: stored.session.rollback,
      verification: savedVerificationView(stored),
    }))
    return json(response, 200, { history })
  }
  if (request.method !== 'POST') return reject(response, 405, '仅支持 POST')

  if (url.pathname === '/__ripple/api/project/preview' || url.pathname === '/__ripple/api/project/preview/stop') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string') return reject(response, 400, '项目预演需要 projectId')
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 404, '项目分析已过期，请重新读取')
    const result = await withProjectPreviewLock(body.projectId, async () => {
      if (url.pathname.endsWith('/stop')) {
        if (typeof body.previewId !== 'string') throw new CandidateError('停止项目预演需要 previewId')
        await stopProjectSourcePreview(body.projectId as string, body.previewId as string)
        return { projectId: body.projectId, previewId: body.previewId, stopped: true }
      }
      assertNoActiveProjectCandidate(body.projectId as string)
      assertProjectAnalysisCurrent(project)
      const preview = await startProjectSourcePreview(body.projectId as string, project.root, project.graph.revision.sourceDigest, trustedPreviewResourceUrls(body.projectId as string))
      try { assertProjectAnalysisCurrent(project) }
      catch (error) {
        await stopProjectSourcePreview(body.projectId as string, preview.previewId)
        throw error
      }
      return preview
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/project/source-selection') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string' || typeof body.previewId !== 'string' || typeof body.sourceDigest !== 'string' || typeof body.sourceRef !== 'string') {
      return reject(response, 400, '项目源码定位需要 projectId、previewId、sourceDigest 和 sourceRef')
    }
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 404, '项目分析已过期，请重新读取')
    const result = await withProjectPreviewLock(body.projectId, async () => {
      if (!isCurrentProjectSourcePreview(body.projectId as string, body.previewId as string, body.sourceDigest as string)) throw new CandidateError('页面点选来自已关闭或已替换的项目预览')
      assertProjectAnalysisCurrent(project)
      const { element, editableText } = resolveJsxSourceElement(project.graph, body.sourceRef as string)
      return {
        projectId: body.projectId,
        previewId: body.previewId,
        sourceDigest: project.graph.revision.sourceDigest,
        element,
        editableText: editableText.map(node => ({ ...node, impact: sourceProvenPageImpact(project.graph, node.id) })),
      }
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/preview/resources') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string' || !Array.isArray(body.urls)) return reject(response, 400, '资源授权需要 projectId 和 URL 列表')
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 409, '请先分析项目，再修改其预演资源授权')
    const authorizedUrls = await withProjectPreviewLock(body.projectId, async () => {
      assertNoActiveProjectCandidate(body.projectId as string)
      await stopProjectSourcePreview(body.projectId as string)
      return saveTrustedPreviewResourceUrls(body.projectId as string, body.urls as unknown[])
    })
    return json(response, 200, { previewResources: { referencedUrls: referencedPreviewResourceUrls(project.root), authorizedUrls } })
  }

  if (url.pathname === '/__ripple/api/analyze') {
    const body = await readJson(request)
    if (typeof body.projectRoot !== 'string' || !body.projectRoot.trim()) return reject(response, 400, '需要本机项目目录')
    const root = fs.realpathSync(path.resolve(body.projectRoot))
    if (!fs.statSync(root).isDirectory()) return reject(response, 400, '项目路径不是目录')
    const snapshot = readProjectSnapshot(root)
    const graph = analyzeProject(root)
    if (snapshot.revision.sourceDigest !== graph.revision.sourceDigest) return reject(response, 409, '分析期间项目源码发生变化，请重新读取')
    for (const projectId of projects.keys()) await withProjectPreviewLock(projectId, async () => stopProjectSourcePreview(projectId))
    if (typeof body.previousCandidateId === 'string' && candidates.get(body.previousCandidateId)?.session.projectRevision.projectId !== snapshot.revision.projectId) await retireCandidate(body.previousCandidateId)
    await retireProjectCandidates(snapshot.revision.projectId)
    projects.set(snapshot.revision.projectId, { root, graph })
    return json(response, 200, { projectRoot: root, ...routeGraph(graph, root) })
  }

  if (url.pathname === '/__ripple/api/candidate') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string' || typeof body.rawIntent !== 'string' || !Array.isArray(body.operations) || !body.scope || typeof body.scope !== 'object') return reject(response, 400, '候选需要 projectId、原始意图、操作列表和 Scope 决策')
    const rawIntent = body.rawIntent
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 404, '项目分析已过期，请重新读取')
    return withProjectPreviewLock(project.graph.revision.projectId, async () => {
      const routeRefs = project.graph.nodes.filter(node => node.kind === 'route').map(node => node.id)
      const verificationContract = normalizeVerificationContract(body.verificationContract, routeRefs)
      const operations = body.operations as EditOperation[]
      const scope = body.scope as ScopeDecision
      const candidateId = `candidate-${randomUUID()}`
      const sessionId = `session-${candidateId.slice('candidate-'.length)}`
      const stateRoot = workbenchStateRoot()
      const artifactRoot = path.join(stateRoot, sessionId, 'artifacts')
      const candidateRoot = path.join(stateRoot, sessionId, 'candidate')
      const session = recordSourceGraph(openSession(sessionId, project.graph.revision, rawIntent, [], verificationContract), project.graph.id, project.graph.revision.sourceDigest)
      const scoped = chooseScope(session, scope)
      const executors = options.candidateOperationExecutors ?? []
      const staged = stageOperations(scoped, operations, executors)
      await stopProjectSourcePreview(project.graph.revision.projectId)
      const record = createCandidate({ projectRoot: project.root, candidateRoot, artifactRoot, graph: project.graph, scope, operations, executors, readStagedAsset: options.readStagedAsset, candidateId })
      try {
        const candidateSession = stageCandidate(staged, record)
        assertCandidateCurrent(record)
        if (typeof body.previousCandidateId === 'string' && candidates.get(body.previousCandidateId)?.session.projectRevision.projectId !== project.graph.revision.projectId) await retireCandidate(body.previousCandidateId)
        await retireProjectCandidates(project.graph.revision.projectId)
        const live: LiveCandidate = { record, session: candidateSession, lifecycle: 'active' }
        persistCandidate(live)
        candidates.set(record.id, live)
        return json(response, 200, {
          sessionId,
          status: candidateSession.status,
          candidate: candidateView(record),
          verification: verificationView(undefined, record.id, candidateSession.verificationFailure),
          workflow: workflowView(live),
        })
      } catch (error) {
        if (fs.existsSync(record.markerPath)) removeCandidate(record)
        throw error
      }
    })
  }

  if (url.pathname === '/__ripple/api/candidate/preview' || url.pathname === '/__ripple/api/candidate/preview/stop') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const candidateId = body.candidateId
    const live = candidates.get(candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const result = await withCandidateLock(candidateId, async () => {
      if (live.lifecycle !== 'active') throw new CandidateError('只有活动候选可以预演')
      if (url.pathname.endsWith('/stop')) {
        await stopCandidatePreview(candidateId)
        return { stopped: true, candidateId }
      }
      await assertCurrentOrRetire(candidateId, live, true)
      const preview = await startCandidatePreview(live.record, trustedPreviewResourceUrls(live.session.projectRevision.projectId))
      return { candidateId: preview.candidateId, url: preview.url, verification: verificationView(live.session.runs.at(-1), live.record.id, live.session.verificationFailure) }
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/candidate/verify') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const result = await withCandidateLock(body.candidateId, async () => {
      if (live.lifecycle !== 'active') throw new CandidateError('只有活动候选可以运行验证')
      const project = projects.get(live.session.projectRevision.projectId)
      if (!project) throw new CandidateError('项目分析状态已过期，请重新读取')
      await assertCurrentOrRetire(body.candidateId as string, live, true)
      live.session = beginVerification(live.session)
      persistCandidate(live)
      try {
        const preview = await startCandidatePreview(live.record, trustedPreviewResourceUrls(live.session.projectRevision.projectId))
        const run = await runCandidateVerification(live.record, live.session, project.graph, preview)
        live.session = registerVerification(live.session, run)
        persistCandidate(live)
        return { candidateId: live.record.id, previewUrl: preview.url, verification: verificationView(live.session.runs.at(-1), live.record.id, live.session.verificationFailure), workflow: workflowView(live) }
      } catch (error) {
        live.session = recordVerificationFailure(live.session, error instanceof Error ? error.message : 'Verification runner failed')
        persistCandidate(live)
        throw error
      }
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/candidate/approve') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string' || typeof body.runId !== 'string') return reject(response, 400, '审批需要 candidateId 和 runId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const result = await withCandidateLock(body.candidateId, async () => {
      if (live.lifecycle !== 'active') throw new CandidateError('只有活动候选可以审批')
      await assertCurrentOrRetire(body.candidateId as string, live, true)
      live.session = approve(live.session, { candidateId: live.record.id, verificationRunId: body.runId as string, by: 'local-user', at: new Date().toISOString() })
      persistCandidate(live)
      return { candidateId: live.record.id, workflow: workflowView(live) }
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/candidate/apply') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '应用需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const result = await withCandidateLock(body.candidateId, async () => {
      if (live.lifecycle !== 'active') throw new CandidateError('只有已审批的活动候选可以应用')
      await assertCurrentOrRetire(body.candidateId as string, live, true)
      await stopCandidatePreview(body.candidateId as string)
      const applied = applyApprovedCandidate(live.session, live.record)
      live.session = recordAppliedRevision(live.session, applied)
      live.lifecycle = 'applied'
      persistCandidate(live)
      if (live.record.candidateRoot && fs.existsSync(live.record.candidateRoot)) removeCandidate(live.record, { preserveAudit: true })
      const graph = analyzeProject(live.record.projectRoot, false)
      projects.set(graph.revision.projectId, { root: live.record.projectRoot, graph })
      return { candidateId: live.record.id, applied: live.session.applied, workflow: workflowView(live), analysis: { projectRoot: live.record.projectRoot, ...routeGraph(graph, live.record.projectRoot) } }
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/candidate/rollback') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '回滚需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const result = await withCandidateLock(body.candidateId, async () => {
      if (live.lifecycle !== 'applied') throw new CandidateError('只有仍与原应用状态一致的候选可以回滚')
      await stopCandidatePreview(body.candidateId as string)
      const rollback = rollbackAppliedCandidate(live.session, live.record)
      live.session = recordRollback(live.session, rollback)
      live.lifecycle = 'rolled-back'
      persistCandidate(live)
      if (live.record.candidateRoot && fs.existsSync(live.record.candidateRoot)) removeCandidate(live.record, { preserveAudit: true })
      const graph = analyzeProject(live.record.projectRoot, false)
      projects.set(graph.revision.projectId, { root: live.record.projectRoot, graph })
      return { candidateId: live.record.id, rollback: live.session.rollback, workflow: workflowView(live), analysis: { projectRoot: live.record.projectRoot, ...routeGraph(graph, live.record.projectRoot) } }
    })
    return json(response, 200, result)
  }

  if (url.pathname === '/__ripple/api/candidate/source-selection') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string' || typeof body.sourceRef !== 'string') return reject(response, 400, '源码定位需要 candidateId 和 sourceRef')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    assertCandidateCurrent(live.record)
    if (body.previewId !== live.record.id || body.patchHash !== live.record.patchHash ||
      body.candidateTreeDigest !== live.record.candidateTreeDigest) throw new CandidateError('点选消息来自不匹配的候选预览、补丁或源码树')
    const graph = analyzeProject(live.record.candidateRoot!, false)
    if (graph.revision.sourceDigest !== live.record.candidateTreeDigest) throw new CandidateError('候选源码图与当前补丁树摘要不一致')

    // The page sends observations, NOT a trusted certainty or an editing capability.
    // The host always reconstructs source version evidence from this exact worktree.
    const identity = body.runtimeIdentity
    if (!identity || typeof identity !== 'object' || Array.isArray(identity)) throw new CandidateError('点选缺少运行时采集证据')
    const packet = identity as Record<string, unknown>
    const page = packet.page as Record<string, unknown> | undefined
    const expected = packet.expectedPage as Record<string, unknown> | undefined
    const record = packet.record as Record<string, unknown> | undefined
    if (packet.protocol !== RUNTIME_IDENTITY_PROTOCOL || !page || !expected || !record ||
      typeof page.pathname !== 'string' || typeof page.search !== 'string' || typeof page.hash !== 'string' ||
      typeof expected.pathname !== 'string' || typeof expected.search !== 'string' || typeof expected.hash !== 'string' ||
      page.pathname !== expected.pathname || page.search !== expected.search || page.hash !== expected.hash ||
      record.sourceRef !== body.sourceRef ||
      typeof record.certainty !== 'string' ||
      !['stable-keyed-instance', 'stable-react-instance', 'position-dependent', 'unknown', 'unmapped'].includes(record.certainty) ||
      typeof record.declaredCertainty !== 'string' ||
      !Array.isArray(record.reasons) || record.reasons.length > 24 || record.reasons.some(reason => typeof reason !== 'string') ||
      typeof record.sameSourceCount !== 'number' || !Number.isSafeInteger(record.sameSourceCount) || record.sameSourceCount < 0 ||
      typeof record.domNode !== 'number' || !Number.isSafeInteger(record.domNode) || record.domNode < 0 ||
      (record.runtimeInstanceId !== undefined && typeof record.runtimeInstanceId !== 'string') ||
      (record.sourceVersion !== undefined && typeof record.sourceVersion !== 'string')) {
      throw new CandidateError('运行时采集格式无效或与当前页面上下文不一致')
    }
    const snapshot: RuntimeIdentitySnapshot = {
      protocol: RUNTIME_IDENTITY_PROTOCOL,
      page: { pathname: page.pathname, search: page.search, hash: page.hash },
      records: [record as unknown as RuntimeIdentityRecord],
    }
    const fileDigest = (file: string): string | undefined => {
      if (!graph.nodes.some(node => node.kind === 'jsx-element' && node.id === body.sourceRef && node.location?.path === file)) return undefined
      if (path.isAbsolute(file) || file.split(/[\\/]/).includes('..')) return undefined
      const filename = path.resolve(live.record.candidateRoot!, file)
      if (!filename.startsWith(path.resolve(live.record.candidateRoot!) + path.sep) || fs.lstatSync(filename).isSymbolicLink()) return undefined
      return createHash('sha256').update(fs.readFileSync(filename)).digest('hex')
    }
    const assessment = assessRuntimeIdentity(graph, snapshot, snapshot.records[0], { fileDigest, expectedPage: snapshot.page })
    if (!assessment.locatable || assessment.reasons.includes('source-version-mismatch') || assessment.reasons.includes('page-context-mismatch') ||
      assessment.reasons.includes('source-version-ambiguous')) throw new CandidateError('运行时身份对应的源码版本或页面已失效，必须重新点选')
    if (assessment.instanceIdentityProven) {
      // Strict mapping is still ONLY for navigation/display; it cannot grant Scope or Override.
      const map = createRuntimeSourceMap(graph, selectableRuntimeObservations(snapshot))
      resolveRuntimeInstance(graph, { sourceRef: assessment.sourceRef, runtimeInstanceId: assessment.runtimeInstanceId! }, map, { fileDigest, page: snapshot.page })
    }
    const { element, editableText } = resolveJsxSourceElement(graph, body.sourceRef)
    return json(response, 200, {
      candidateId: live.record.id,
      patchHash: live.record.patchHash,
      sourceDigest: graph.revision.sourceDigest,
      element,
      editableText: editableText.map(node => ({ ...node, impact: sourceProvenPageImpact(graph, node.id) })),
      runtimeIdentity: {
        runtimeInstanceId: assessment.runtimeInstanceId,
        identityCertainty: assessment.instanceIdentityProven ? assessment.certainty : 'unknown',
        instanceIdentityProven: assessment.instanceIdentityProven,
        sameSourceCount: assessment.sameSourceCount,
        reasons: assessment.reasons,
      },
    })
  }

  if (url.pathname === '/__ripple/api/candidate/restore') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    let live = candidates.get(body.candidateId)
    if (!live) live = restoreStoredCandidate(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const projectId = live.session.projectRevision.projectId
    const project = projects.get(projectId)
    if (!project) return reject(response, 409, '项目分析状态已过期，请重新读取')

    if (live.lifecycle === 'active') {
      const currentRevision = readProjectSnapshot(project.root, false).revision
      if (currentRevision.sourceDigest !== live.record.baseSourceDigest || !isProjectWorkingTreeClean(project.root)) {
        await retireCandidate(body.candidateId, 'stale')
        return reject(response, 409, '候选基线已过期，隔离 worktree 已清理；审计记录已保留，请重新分析项目')
      }
      assertCandidateCurrent(live.record)
    } else {
      assertCandidateIntegrity(live.record, false)
    }
    return json(response, 200, {
      analysis: { projectRoot: project.root, ...routeGraph(project.graph, project.root) },
      rawIntent: live.session.rawIntent,
      verificationContract: live.session.verificationContract,
      scope: live.session.scope,
      candidate: candidateView(live.record),
      verification: verificationView(live.session.runs.at(-1), live.record.id, live.session.verificationFailure),
      workflow: workflowView(live),
    })
  }

  if (url.pathname === '/__ripple/api/discard') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    const result = await withCandidateLock(body.candidateId, async () => {
      if (live.lifecycle === 'applied' || live.lifecycle === 'rolled-back') throw new CandidateError('应用与回滚历史不能丢弃')
      await retireCandidate(body.candidateId as string, 'discarded', true)
      return { removed: true, candidateId: body.candidateId }
    })
    return json(response, 200, result)
  }
  return reject(response, 404, '未知 Project API 路径')
}

async function cleanupCandidates(): Promise<void> {
  const failures: unknown[] = []
  for (const [id] of candidates) {
    try { await stopCandidatePreview(id) }
    catch (error) { failures.push(error) }
  }
  for (const projectId of projects.keys()) {
    try { await stopProjectSourcePreview(projectId) }
    catch (error) { failures.push(error) }
  }
  candidates.clear()
  projects.clear()
  candidateLocks.clear()
  projectPreviewLocks.clear()
  if (failures.length) throw new AggregateError(failures, 'Some candidate worktrees were preserved because safe cleanup failed')
}

export interface LocalProjectApiOptions {
  candidateOperationExecutors?: CandidateOperationRegistry
  readStagedAsset?: (sha256: string) => Uint8Array
}

export function localProjectApiPlugin(options: LocalProjectApiOptions = {}): Plugin {
  let shutdown: Promise<void> | undefined
  const stopRuntime = () => shutdown ??= cleanupCandidates()
  return {
    name: 'ripple-local-project-api',
    apply: 'serve',
    async configureServer(server) {
      await preparePreviewNetworkPool()
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/__ripple/api/')) return next()
        void handle(request, response, options).catch(error => {
          const failure = error instanceof Error ? error as Error & { statusCode?: number } : undefined
          const code = failure && 'code' in failure ? failure.code : undefined
          const status = typeof failure?.statusCode === 'number' ? failure.statusCode : failure?.name === 'CandidatePreviewError' || failure?.name === 'VerificationRunnerError' ? 503 : failure instanceof PatchApplyError || failure?.name === 'CandidateError' || failure?.name === 'SessionInvariantError' || failure?.name === 'VerificationEvidenceError' ? 409 : failure instanceof VerificationContractError || failure?.name === 'PreviewResourcePolicyError' || failure?.name === 'ProjectReadError' || code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' ? 400 : 500
          const sessionError = error instanceof SessionInvariantError ? { code: error.code, ...(error.path ? { path: error.path } : {}) } : undefined
          reject(response, status, error instanceof Error ? error.message : 'Project API failed', sessionError)
        })
      })
      server.httpServer?.once('close', () => {
        void stopRuntime().then(() => stopPreviewNetworkPool()).catch(error => server.config.logger.error(String(error)))
      })
    },
    closeBundle: async () => {
      await stopRuntime()
      await stopPreviewNetworkPool()
    },
  }
}
