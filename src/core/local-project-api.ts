import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { IncomingMessage, ServerResponse } from 'node:http'
import type { Plugin } from 'vite'
import { assertCandidateCurrent, createCandidate, removeCandidate, type CandidateRecord } from './candidate'
import { analyzeProject, readProjectSnapshot } from './project'
import { sourceProvenPageImpact } from './scope'
import { chooseScope, openSession, recordSourceGraph, stageCandidate, stageOperations } from './session'
import type { EditOperation, EditSession, ScopeDecision, SourceGraph } from './model'

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
    targets: graph.nodes.filter(node => ['data', 'media', 'token'].includes(node.kind) && node.location?.start !== undefined && node.location.end !== undefined).map(node => ({ id: node.id, kind: node.kind, label: node.label, value: node.value, location: node.location, impact: sourceProvenPageImpact(graph, node.id) })),
    relationCounts: Object.fromEntries([...new Set(graph.edges.map(edge => edge.kind))].map(kind => [kind, graph.edges.filter(edge => edge.kind === kind && edge.certainty === 'source-proven').length])),
  }
}

async function handle(request: IncomingMessage, response: ServerResponse): Promise<void> {
  const url = new URL(request.url ?? '/', `http://${request.headers.host ?? '127.0.0.1'}`)
  if (!url.pathname.startsWith('/__ripple/api/')) return
  assertLoopbackRequest(request)
  if (request.method !== 'POST') return reject(response, 405, '仅支持 POST')

  if (url.pathname === '/__ripple/api/analyze') {
    const body = await readJson(request)
    if (typeof body.projectRoot !== 'string' || !body.projectRoot.trim()) return reject(response, 400, '需要本机项目目录')
    const root = fs.realpathSync(path.resolve(body.projectRoot))
    if (!fs.statSync(root).isDirectory()) return reject(response, 400, '项目路径不是目录')
    const snapshot = readProjectSnapshot(root)
    const graph = analyzeProject(root)
    if (snapshot.revision.sourceDigest !== graph.revision.sourceDigest) return reject(response, 409, '分析期间项目源码发生变化，请重新读取')
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
      const diff = fs.readFileSync(record.diffArtifact, 'utf8')
      candidates.set(record.id, { record, session: candidateSession })
      return json(response, 200, {
        sessionId,
        status: candidateSession.status,
        candidate: { id: record.id, baseSourceDigest: record.baseSourceDigest, patchHash: record.patchHash, candidateTreeDigest: record.candidateTreeDigest, operations: record.operations, modifiedPaths: record.modifiedPaths, diff },
        verification: { state: 'not-run', reason: '当前工作台阶段不会执行目标项目代码；浏览器预演、审核与应用入口保持关闭。' },
      })
    } catch (error) {
      removeCandidate(record)
      throw error
    }
  }

  if (url.pathname === '/__ripple/api/discard') {
    const body = await readJson(request)
    if (typeof body.candidateId !== 'string') return reject(response, 400, '需要 candidateId')
    const live = candidates.get(body.candidateId)
    if (!live) return reject(response, 404, '候选不存在或已清理')
    removeCandidate(live.record)
    candidates.delete(body.candidateId)
    return json(response, 200, { removed: true, candidateId: body.candidateId })
  }
  return reject(response, 404, '未知 Project API 路径')
}

function cleanupCandidates(): void {
  for (const [id, live] of candidates) {
    try { removeCandidate(live.record); candidates.delete(id) }
    catch { /* Keep the candidate on disk when identity or patch integrity no longer matches. */ }
  }
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
          const status = typeof failure?.statusCode === 'number' ? failure.statusCode : failure?.name === 'CandidateError' ? 409 : failure?.name === 'SessionInvariantError' || failure?.name === 'ProjectReadError' || code === 'ENOENT' || code === 'ENOTDIR' || code === 'EACCES' ? 400 : 500
          reject(response, status, error instanceof Error ? error.message : 'Project API failed')
        })
      })
      server.httpServer?.once('close', cleanupCandidates)
    },
  }
}
