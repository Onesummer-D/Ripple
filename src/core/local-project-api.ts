import { createHash, randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { assertCandidateCurrent, assertCandidateIntegrity, CandidateError, createCandidate, removeCandidate, type CandidateRecord } from './candidate'
import { applyApprovedCandidate, isAppliedCandidateRollbackable, PatchApplyError, rollbackAppliedCandidate } from './apply'
import { startCandidatePreview, stopCandidatePreview } from './candidate-preview'
import { referencedPreviewResourceUrls, saveTrustedPreviewResourceUrls, trustedPreviewResourceUrls } from './preview-resource-policy'
import { analyzeProject, isProjectWorkingTreeClean, readProjectSnapshot, resolveJsxSourceElement } from './project'
import { sourceProvenPageImpact } from './scope'
import { approve, beginVerification, chooseScope, openSession, recordAppliedRevision, recordRollback, recordSourceGraph, recordVerificationFailure, registerVerification, SessionInvariantError, stageCandidate, stageOperations } from './session'
import { assertTrustedBrowserExecution, restoreBrowserExecution } from './verification-receipt'
import { runCandidateVerification } from './verification-runner'
import type { EditOperation, EditSession, ScopeDecision, SourceGraph, VerificationRun } from './model'
import { normalizeVerificationContract, VerificationContractError } from './verification-contract'
import { listStoredCandidates, readStoredCandidate, workbenchStateRoot, writeStoredCandidate, type CandidateLifecycle } from './workbench-store'

interface OpenProject { root: string; graph: SourceGraph }
interface LiveCandidate { record: CandidateRecord; session: EditSession; lifecycle: CandidateLifecycle }

const projects = new Map<string, OpenProject>()
const candidates = new Map<string, LiveCandidate>()
const candidateLocks = new Set<string>()
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

  if (url.pathname === '/__ripple/api/preview/resources') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string' || !Array.isArray(body.urls)) return reject(response, 400, '资源授权需要 projectId 和 URL 列表')
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 409, '请先分析项目，再修改其预演资源授权')
    const authorizedUrls = saveTrustedPreviewResourceUrls(body.projectId, body.urls)
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
    if (typeof body.previousCandidateId === 'string' && candidates.get(body.previousCandidateId)?.session.projectRevision.projectId !== snapshot.revision.projectId) await retireCandidate(body.previousCandidateId)
    await retireProjectCandidates(snapshot.revision.projectId)
    projects.set(snapshot.revision.projectId, { root, graph })
    return json(response, 200, { projectRoot: root, ...routeGraph(graph, root) })
  }

  if (url.pathname === '/__ripple/api/candidate') {
    const body = await readJson(request)
    if (typeof body.projectId !== 'string' || typeof body.rawIntent !== 'string' || !Array.isArray(body.operations) || !body.scope || typeof body.scope !== 'object') return reject(response, 400, '候选需要 projectId、原始意图、操作列表和 Scope 决策')
    const project = projects.get(body.projectId)
    if (!project) return reject(response, 404, '项目分析已过期，请重新读取')
    const routeRefs = project.graph.nodes.filter(node => node.kind === 'route').map(node => node.id)
    const verificationContract = normalizeVerificationContract(body.verificationContract, routeRefs)
    const operations = body.operations as EditOperation[]
    const scope = body.scope as ScopeDecision
    const candidateId = `candidate-${randomUUID()}`
    const sessionId = `session-${candidateId.slice('candidate-'.length)}`
    const stateRoot = workbenchStateRoot()
    const artifactRoot = path.join(stateRoot, sessionId, 'artifacts')
    const candidateRoot = path.join(stateRoot, sessionId, 'candidate')
    const session = recordSourceGraph(openSession(sessionId, project.graph.revision, body.rawIntent, [], verificationContract), project.graph.id, project.graph.revision.sourceDigest)
    const scoped = chooseScope(session, scope)
    const staged = stageOperations(scoped, operations)
    const record = createCandidate({ projectRoot: project.root, candidateRoot, artifactRoot, graph: project.graph, scope, operations, candidateId })
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
  candidates.clear()
  projects.clear()
  candidateLocks.clear()
  if (failures.length) throw new AggregateError(failures, 'Some candidate worktrees were preserved because safe cleanup failed')
}

export function localProjectApiPlugin(): Plugin {
  let shutdown: Promise<void> | undefined
  const stopRuntime = () => shutdown ??= cleanupCandidates()
  return {
    name: 'ripple-local-project-api',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        if (!request.url?.startsWith('/__ripple/api/')) return next()
        void handle(request, response).catch(error => {
          const failure = error instanceof Error ? error as Error & { statusCode?: number } : undefined
          const code = failure && 'code' in failure ? failure.code : undefined
          const status = typeof failure?.statusCode === 'number' ? failure.statusCode : failure?.name === 'CandidatePreviewError' || failure?.name === 'VerificationRunnerError' ? 503 : failure instanceof PatchApplyError || failure?.name === 'CandidateError' || failure?.name === 'SessionInvariantError' || failure?.name === 'VerificationEvidenceError' ? 409 : failure instanceof VerificationContractError || failure?.name === 'PreviewResourcePolicyError' || failure?.name === 'ProjectReadError' || code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' ? 400 : 500
          const sessionError = error instanceof SessionInvariantError ? { code: error.code, ...(error.path ? { path: error.path } : {}) } : undefined
          reject(response, status, error instanceof Error ? error.message : 'Project API failed', sessionError)
        })
      })
      server.httpServer?.once('close', () => {
        void stopRuntime().catch(error => server.config.logger.error(String(error)))
      })
    },
    closeBundle: stopRuntime,
  }
}
