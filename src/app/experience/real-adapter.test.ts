import { describe, expect, it } from 'vitest'
import { createRealAdapter, StaleResponseError } from './real-adapter'
import type { EvidenceItemXp, ExperienceViewModel } from './view-model'

/**
 * Real Adapter 单元测试：全部通过注入 fetchImpl 拦截 /__ripple/api 请求，
 * 不触碰真实服务端；验证真实响应 → ExperienceViewModel 的映射、
 * 缺失状态的如实表达与异步契约（过期响应丢弃、工程切换失效、dispose 清理）。
 */

interface MockResponse { status: number; body: unknown }

function mockFetch(routes: Record<string, MockResponse | (() => Promise<MockResponse>)>) {
  const calls: Array<{ path: string; body?: unknown }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^.*?\/__ripple\/api\//, '')
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[path]
    if (!route) return { ok: false, status: 404, json: async () => ({ error: `未注册的路由：${path}` }) } as unknown as Response
    const resolved = typeof route === 'function' ? await route() : route
    return {
      ok: resolved.status >= 200 && resolved.status < 300,
      status: resolved.status,
      json: async () => resolved.body,
    } as unknown as Response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const ANALYSIS = {
  status: 200,
  body: {
    projectRoot: '/work/acme-shop',
    revision: { projectId: 'proj-acme', sourceDigest: 'digest-1', gitCommit: 'abc123', runtimeFingerprint: 'fp-1' },
    graphId: 'graph-1',
    unresolved: [],
    routes: [
      { id: 'page:home', label: '首页', page: '/' },
      { id: 'page:about', label: '关于', page: '/about' },
    ],
    targets: [
      {
        id: 'data:hero-title', kind: 'data', label: '首页标题', value: 'Acme 商店',
        location: { path: 'src/data/site.ts', start: 10, end: 20 },
        impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' },
      },
      {
        id: 'data:shared-slogan', kind: 'data', label: '共享标语', value: '更好明天',
        location: { path: 'src/data/site.ts', start: 30, end: 40 },
        impact: { pageRefs: ['page:home', 'page:about'], unresolved: [], certainty: 'source-proven' },
      },
      {
        id: 'data:dynamic-banner', kind: 'data', label: '动态横幅', value: undefined,
        impact: { pageRefs: [], unresolved: ['内容来自运行时接口，静态分析无法确认'], certainty: 'unknown' },
      },
    ],
    relationCounts: { reads: 4, renders: 2 },
  },
}

const HISTORY_NOT_RUN = {
  status: 200,
  body: {
    history: [
      {
        candidateId: 'candidate-1', projectId: 'proj-acme', lifecycle: 'active',
        patchHash: 'hash-abcdef1234567890', updatedAt: '2026-10-22T10:00:00Z',
        verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
      },
    ],
  },
}

const HISTORY_PASSED = {
  status: 200,
  body: {
    history: [
      {
        candidateId: 'candidate-2', projectId: 'proj-acme', lifecycle: 'active',
        patchHash: 'hash-fedcba0987654321', updatedAt: '2026-10-22T12:00:00Z',
        verification: {
          state: 'passed', runId: 'run-9', patchHash: 'hash-fedcba0987654321', scopeVersion: 3,
          assertions: [{ id: 'target-change', result: 'pass', detail: '目标文案已变更' }],
          evidence: [
            { id: 'ev-1440', result: 'pass', viewport: { width: 1440, height: 900 }, artifactUrl: '/__ripple/api/candidate/candidate-2/evidence/ev-1440' },
            { id: 'ev-390', result: 'pass', viewport: { width: 390, height: 844 }, artifactUrl: '/__ripple/api/candidate/candidate-2/evidence/ev-390' },
          ],
        },
      },
    ],
  },
}

const HISTORY_METADATA_ONLY = {
  status: 200,
  body: {
    history: [
      {
        // 验证通过、有断言记录，但服务端没有归档任何截图：
        // 界面必须显示「仅有证据元数据」，不得把它显示成「真实截图已归档」
        candidateId: 'candidate-3', projectId: 'proj-acme', lifecycle: 'active',
        patchHash: 'hash-0011223344556677', updatedAt: '2026-10-22T14:00:00Z',
        verification: {
          state: 'passed', runId: 'run-10', patchHash: 'hash-0011223344556677', scopeVersion: 4,
          assertions: [{ id: 'target-change', result: 'pass', detail: '目标文案已变更' }],
          evidence: [{ id: 'ev-1440', result: 'pass', viewport: { width: 1440, height: 900 } }],
        },
      },
    ],
  },
}

const HISTORY_NO_EVIDENCE = {
  status: 200,
  body: {
    history: [
      {
        candidateId: 'candidate-4', projectId: 'proj-acme', lifecycle: 'discarded',
        patchHash: 'hash-9988776655443322', updatedAt: '2026-10-22T15:00:00Z',
        verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
      },
    ],
  },
}

const PREVIEW = { status: 200, body: { projectId: 'proj-acme', previewId: 'preview-1', sourceDigest: 'digest-1', url: 'http://127.0.0.1:9999/preview/preview-1/' } }
const PREVIEW_STOP = { status: 200, body: { stopped: true } }

function evidence(model: ExperienceViewModel, id: string): EvidenceItemXp {
  const item = model.evidence.find(entry => entry.id === id)
  if (!item) throw new Error(`缺少证据项 ${id}`)
  return item
}

describe('Real Adapter · 真实数据映射', () => {
  it('未提供工程目录：不可用状态 + 准确阻断原因，绝不伪造演示数据', async () => {
    const { fetchImpl, calls } = mockFetch({})
    const adapter = createRealAdapter({ fetchImpl })
    const model = await adapter.load()
    expect(model.projectStatus).toBe('unavailable')
    expect(model.dataProvenance).toBe('real')
    expect(model.blockedReasons?.[0]).toContain('尚未选择工程')
    expect(model.pages).toEqual([])
    expect(model.elements).toEqual([])
    expect(model.versions).toEqual([])
    // 尚未分析工程：来源分析证据如实为未知，不得标记 pass
    expect(evidence(model, 'ev:source-graph').state).toBe('unknown')
    expect(calls).toEqual([]) // 没有工程目录时不发出任何请求
  })

  it('analyze + history + preview：工程身份、页面、目标、历史、预演会话全部来自真实响应', async () => {
    const { fetchImpl, calls } = mockFetch({ analyze: ANALYSIS, history: HISTORY_PASSED, 'project/preview': PREVIEW, 'project/preview/stop': PREVIEW_STOP })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    expect(calls.map(call => call.path)).toEqual(['analyze', 'history', 'project/preview'])
    expect(model.projectStatus).toBe('ready')
    expect(model.projectName).toBe('acme-shop')
    expect(model.projectIdentity).toMatchObject({ projectId: 'proj-acme', sourceDigest: 'digest-1' })
    expect(model.preview).toMatchObject({ previewId: 'preview-1', url: PREVIEW.body.url })
    expect(model.canvasState).toBe('ready')
    // 页面列表来自 routes
    expect(model.pages.map(page => page.id)).toEqual(['page:home', 'page:about'])
    expect(model.pages[0]).toMatchObject({ relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' })
    // 元素来自 targets，来源确定性逐条保留
    const hero = model.elements.find(item => item.id === 'data:hero-title')
    expect(hero).toMatchObject({ currentText: 'Acme 商店', sourcePath: 'src/data/site.ts', certainty: 'source-proven', editable: true, impactPageRefs: ['page:home'] })
    const dynamic = model.elements.find(item => item.id === 'data:dynamic-banner')
    expect(dynamic).toMatchObject({ certainty: 'unknown', editable: false })
    expect(dynamic?.unresolvedReasons[0]).toContain('运行时接口')
    // 历史与候选身份
    expect(model.candidateStatus).toBe('verified')
    expect(model.versions[0]).toMatchObject({ title: '候选 hash-fed', lifecycle: 'candidate', pageRef: '', evidenceAvailable: true })
    // 真实验证证据：来源 runtime-observation，身份字段齐全
    expect(evidence(model, 'ev:verification')).toMatchObject({ state: 'pass', sourceKind: 'runtime-observation' })
    expect(evidence(model, 'ev:verification').detail).toContain('run-9')
    // 视口验证状态由真实 evidence 宽度驱动
    expect(model.viewports.find(item => item.id === 'desktop')?.verificationStatus).toBe('available')
    expect(model.viewports.find(item => item.id === 'mobile-375')?.verificationStatus).toBe('in-verification')
    // 对照：候选侧使用真实截图 artifactUrl，基线侧如实不可用
    expect(model.compare.candidate).toMatchObject({ state: 'ready', imageUrl: '/__ripple/api/candidate/candidate-2/evidence/ev-1440' })
    expect(model.compare.baseline.state).toBe('unavailable')
  })

  it('只有本工程的历史被映射；验证 not-run / failed-to-run / stale 原样透出', async () => {
    const otherProject = { candidateId: 'candidate-x', projectId: 'proj-other', lifecycle: 'applied', patchHash: 'hash-0000', updatedAt: '2026-10-20T08:00:00Z', verification: { state: 'passed' } }
    const { fetchImpl } = mockFetch({
      analyze: ANALYSIS,
      history: { status: 200, body: { history: [otherProject, ...HISTORY_NOT_RUN.body.history] } },
      'project/preview': PREVIEW,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    expect(model.versions).toHaveLength(1)
    expect(model.candidateStatus).toBe('candidate')
    expect(evidence(model, 'ev:verification')).toMatchObject({ state: 'not-run', sourceKind: 'runtime-observation' })
    expect(evidence(model, 'ev:verification').summary).toContain('尚未运行')
    // 无运行 → 无截图 → 对照不可用而非伪造
    expect(model.compare.candidate.state).toBe('unavailable')
    expect(model.compare.baseline.state).toBe('unavailable')
    // 有候选但缺真实截图（基线侧也未提供）→ 对照不完整；不是"已经一致"
    expect(model.compare.compareState).toBe('partial')
    const noHistory = { status: 200, body: { history: [] } } as const
    const { fetchImpl: fetchNone } = mockFetch({ analyze: ANALYSIS, history: noHistory, 'project/preview': PREVIEW })
    const adapterNone = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl: fetchNone })
    const emptyModel = await adapterNone.load()
    // 没有候选：无可比较内容
    expect(emptyModel.compare.compareState).toBe('none')
  })

  it('预演启动失败：画布不可用并给出准确阻断原因，其余真实数据不受影响', async () => {
    const { fetchImpl, calls } = mockFetch({
      analyze: ANALYSIS,
      history: HISTORY_NOT_RUN,
      'project/preview': { status: 503, body: { error: '隔离预演网络池为空；请确认本机 Docker 可用后重新启动预演服务' } },
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    expect(model.preview).toBeUndefined()
    expect(model.canvasState).toBe('unavailable')
    expect(model.blockedReasons?.[0]).toContain('Docker')
    expect(model.projectStatus).toBe('ready') // 工程本身分析成功
    await adapter.dispose?.()
    expect(calls.some(call => call.path === 'project/preview/stop')).toBe(false) // 无会话则不发停止请求
  })

  it('analyze 失败（工程不存在/权限不足）：错误如实抛出，不降级为演示数据', async () => {
    const { fetchImpl } = mockFetch({ analyze: { status: 400, body: { error: '项目路径不是目录' } } })
    const adapter = createRealAdapter({ projectRoot: '/no/such/dir', fetchImpl })
    await expect(adapter.load()).rejects.toThrow('项目路径不是目录')
  })

  it('选中目标：唯一来源证明页投影为编辑页，多页共享目标不臆造所属页', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_NOT_RUN, 'project/preview': PREVIEW })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    // 单页证明目标：首页 → editing / include；关于页保持未证明
    const afterHero = adapter.selectElement(loaded, 'data:hero-title')
    expect(afterHero.pages.find(page => page.id === 'page:home')).toMatchObject({ relation: 'editing', relationCertainty: 'source-proven', scope: 'include' })
    expect(afterHero.pages.find(page => page.id === 'page:about')).toMatchObject({ relation: 'unproven', relationCertainty: 'unknown', scope: 'undecided' })
    expect(afterHero.selectedElementId).toBe('data:hero-title')
    // 草稿属于目标：本地意向写入 Evidence（user-choice），候选生命周期不被本地动作改写
    const withDraft = adapter.setDraftText(afterHero, 'Acme 旗舰店')
    expect(withDraft.draftAfterText).toBe('Acme 旗舰店')
    expect(evidence(withDraft, 'ev:intent')).toMatchObject({ sourceKind: 'user-choice', state: 'pass' })
    expect(evidence(withDraft, 'ev:intent').summary).toContain('Acme 旗舰店')
    expect(withDraft.candidateStatus).toBe('candidate')
    expect(withDraft.elements.find(item => item.id === 'data:hero-title')?.currentText).toBe('Acme 商店')
    // 多页共享目标：没有唯一所属页，任何页面都不升级为 editing
    const afterShared = adapter.selectElement(loaded, 'data:shared-slogan')
    expect(afterShared.pages.every(page => page.relation !== 'editing')).toBe(true)
    // unknown 目标：只能查看
    const afterUnknown = adapter.selectElement(loaded, 'data:dynamic-banner')
    expect(afterUnknown.selectedElementId).toBe('data:dynamic-banner')
    expect(afterUnknown.elements.find(item => item.id === 'data:dynamic-banner')?.editable).toBe(false)
    // 再次点击同一目标：不视为切换，草稿不丢
    const reselect = adapter.selectElement(withDraft, 'data:hero-title')
    expect(reselect).toBe(withDraft)
    // 不存在的目标 id：拒绝选中，模型原样返回（不产生悬空 selectedElementId）
    const invalid = adapter.selectElement(withDraft, 'data:no-such-target')
    expect(invalid).toBe(withDraft)
    expect(invalid.selectedElementId).toBe('data:hero-title')
  })

  it('scope 意向是本地状态；工程刷新后旧选择与旧草稿不残留', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_NOT_RUN, 'project/preview': PREVIEW })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    const selected = adapter.selectElement(loaded, 'data:hero-title')
    const scoped = adapter.setPageScope(selected, 'page:about', 'exclude')
    expect(scoped.pages.find(page => page.id === 'page:about')?.scope).toBe('exclude')
    // refresh 后目标仍在（同一分析），选择保留但服务端状态重建
    const refreshed = await adapter.refresh?.(scoped) ?? scoped
    expect(refreshed.pages.find(page => page.id === 'page:home')).toMatchObject({ relation: 'editing' })
  })

  it('dispose：停止预演会话并忽略其后的响应', async () => {
    let resolveAnalyze: ((value: MockResponse) => void) | undefined
    const { fetchImpl, calls } = mockFetch({
      analyze: () => new Promise<MockResponse>(resolve => { resolveAnalyze = resolve }),
      history: HISTORY_NOT_RUN,
      'project/preview': PREVIEW,
      'project/preview/stop': PREVIEW_STOP,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const pending = adapter.load()
    await adapter.dispose?.()
    resolveAnalyze?.(ANALYSIS)
    // dispose 已使 load 过期：过期响应以 StaleResponseError 拒绝，调用方不得据此更新任何 UI 状态
    await expect(pending).rejects.toBeInstanceOf(StaleResponseError)
    // dispose 时预演会话尚未建立，不应发出停止请求
    expect(calls.some(call => call.path === 'project/preview/stop')).toBe(false)
  })
})

describe('Real Adapter · 异步契约', () => {
  it('openProject 切换工程：旧候选/旧证据不残留，旧响应被丢弃', async () => {
    let resolveFirstAnalyze: ((value: MockResponse) => void) | undefined
    const analyzeCalls: string[] = []
    const { fetchImpl } = mockFetch({
      analyze: () => {
        // 第一次 analyze 故意挂起，第二次立即返回另一个工程
        if (analyzeCalls.length === 0) {
          analyzeCalls.push('first')
          return new Promise<MockResponse>(resolve => { resolveFirstAnalyze = resolve })
        }
        analyzeCalls.push('second')
        return Promise.resolve({
          status: 200,
          body: {
            ...ANALYSIS.body,
            projectRoot: '/work/other-app',
            revision: { projectId: 'proj-other', sourceDigest: 'digest-2', runtimeFingerprint: 'fp-2' },
            routes: [{ id: 'page:main', label: '主页', page: '/' }],
            targets: [],
          },
        })
      },
      history: { status: 200, body: { history: [] } },
      'project/preview': { status: 409, body: { error: '当前项目存在活动候选' } },
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const firstLoad = adapter.load()
    // 切换工程：第一工程的历史绝不能出现在第二工程的模型里
    const switched = await adapter.openProject!('/work/other-app')
    expect(switched.projectName).toBe('other-app')
    expect(switched.projectIdentity?.projectId).toBe('proj-other')
    expect(switched.versions).toEqual([])
    expect(switched.pages.map(page => page.id)).toEqual(['page:main'])
    resolveFirstAnalyze?.(ANALYSIS)
    // 过期 load 以 StaleResponseError 拒绝：不得返回任何模型去覆盖 B 工程状态
    await expect(firstLoad).rejects.toBeInstanceOf(StaleResponseError)
  })

  it('history 请求失败：历史如实为空，工程状态仍可用', async () => {
    const { fetchImpl } = mockFetch({
      analyze: ANALYSIS,
      history: { status: 500, body: { error: '读取历史失败' } },
      'project/preview': PREVIEW,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    expect(model.projectStatus).toBe('ready')
    expect(model.versions).toEqual([])
    expect(model.candidateStatus).toBe('none')
    expect(evidence(model, 'ev:verification').state).toBe('not-run')
  })
})

describe('Real Adapter · 审查返工（终态优先 / Scope 隔离）', () => {
  function historyWith(item: Record<string, unknown>) {
    return { status: 200, body: { history: [{ projectId: 'proj-acme', patchHash: 'hash-abcdef1234567890', updatedAt: '2026-10-22T10:00:00Z', ...item }] } }
  }
  const approval = { approval: { verificationRunId: 'run-9', at: '2026-10-22T11:00:00Z' } }

  async function loadWithHistory(history: unknown) {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: history as MockResponse, 'project/preview': PREVIEW })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    return { adapter, model: await adapter.load() }
  }

  it('候选状态映射：lifecycle 终态优先，旧审批记录不得覆盖终态', async () => {
    // 1. active + 无审批
    const a = await loadWithHistory(historyWith({ candidateId: 'c-1', lifecycle: 'active', verification: { state: 'not-run' } }))
    expect(a.model.candidateStatus).toBe('candidate')
    // 2. active + 已审批
    const b = await loadWithHistory(historyWith({ candidateId: 'c-2', lifecycle: 'active', verification: { state: 'passed' }, ...approval }))
    expect(b.model.candidateStatus).toBe('approved')
    // 3. applied + 保留审批 → 终态 applied，不被旧审批覆盖成 approved
    const c = await loadWithHistory(historyWith({ candidateId: 'c-3', lifecycle: 'applied', verification: { state: 'passed' }, ...approval }))
    expect(c.model.candidateStatus).toBe('applied')
    // 4. rolled-back + 保留审批 → 终态 rolled-back
    const d = await loadWithHistory(historyWith({ candidateId: 'c-4', lifecycle: 'rolled-back', verification: { state: 'passed' }, ...approval }))
    expect(d.model.candidateStatus).toBe('rolled-back')
    // 5a. stale + 保留历史审批 → 终态 stale
    const e = await loadWithHistory(historyWith({ candidateId: 'c-5', lifecycle: 'stale', verification: { state: 'stale' }, ...approval }))
    expect(e.model.candidateStatus).toBe('stale')
    // 5b. discarded + 保留历史审批 → 无活跃候选
    const f = await loadWithHistory(historyWith({ candidateId: 'c-6', lifecycle: 'discarded', verification: { state: 'passed' }, ...approval }))
    expect(f.model.candidateStatus).toBe('none')
  })

  it('切换目标清除旧 Scope 意向：新目标默认 Scope 完全由其来源证明生成', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_NOT_RUN, 'project/preview': PREVIEW })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    // 目标 A（首页标题，唯一证明页=首页）：设置多页范围意向
    const selectedA = adapter.selectElement(loaded, 'data:hero-title')
    const scopedA = adapter.setPageScope(selectedA, 'page:about', 'protect')
    expect(scopedA.pages.find(page => page.id === 'page:about')?.scope).toBe('protect')
    // 切到目标 B（共享标语，影响首页+关于，无唯一所属页）
    const selectedB = adapter.selectElement(scopedA, 'data:shared-slogan')
    // B 的默认 Scope 全部来自 B 的来源证明：关于页是 B 证明的同源页（include），
    // 绝不继承 A 留下的 protect 意向
    expect(selectedB.pages.find(page => page.id === 'page:about'))
      .toMatchObject({ relation: 'same-source', relationCertainty: 'source-proven', scope: 'include' })
    expect(selectedB.pages.every(page => page.scope !== 'protect')).toBe(true)
    // 切回 A：旧意向已清除，回到 A 的默认（首页 editing include，关于页 undecided）
    const backToA = adapter.selectElement(selectedB, 'data:hero-title')
    expect(backToA.pages.find(page => page.id === 'page:home')).toMatchObject({ relation: 'editing', scope: 'include' })
    expect(backToA.pages.find(page => page.id === 'page:about')?.scope).toBe('undecided')
  })

  it('工程切换停止旧预演会话，且 C/D 挂点数据不跨工程残留', async () => {
    const { fetchImpl, calls } = mockFetch({
      analyze: ANALYSIS,
      history: HISTORY_NOT_RUN,
      'project/preview': PREVIEW,
      'project/preview/stop': PREVIEW_STOP,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    const real = adapter as ReturnType<typeof createRealAdapter> & {
      attachSourceRelations(r: unknown): void
      attachRuntimeIdentity(o: unknown): void
    }
    real.attachSourceRelations({ provenUnaffectedRefs: ['page:about'] })
    real.attachRuntimeIdentity({ sourceRef: 'data:hero-title', identityCertainty: 'stable-keyed-instance', reasons: [] })
    // 工程 B：同一 analyze 响应（测试关注会话停止与挂点清除）
    const switched = await adapter.openProject!('/work/other-app')
    expect(switched.projectStatus).toBe('ready')
    // 旧预演会话被停止
    expect(calls.some(call => call.path === 'project/preview/stop')).toBe(true)
    // C/D 挂点数据已清除：若旧的 provenUnaffectedRefs 残留，首页标题的关于页会被错误标记
    // unrelated/source-proven；清除后它回到"清单外未证明"（unknown，不臆造无影响）
    const after = adapter.selectElement(switched, 'data:hero-title')
    expect(after.pages.find(page => page.id === 'page:about')).toMatchObject({ relation: 'unproven', relationCertainty: 'unknown' })
    void loaded
  })
})

describe('Real Adapter · 合并前修订（停止挂起竞态 / 清理失败诊断）', () => {
  it('openProject：旧会话停止请求挂起期间更新的请求先落定，过期续体不得改写 projectRoot', async () => {
    const calls: Array<{ path: string; body?: unknown }> = []
    let releaseStop: (() => void) | undefined
    const stopGate = new Promise<void>(resolve => { releaseStop = resolve })
    const analysisFor = (root: string, projectId: string) => ({
      ...ANALYSIS.body,
      projectRoot: root,
      revision: { ...ANALYSIS.body.revision, projectId },
    })
    const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
      const path = url.replace(/^.*?\/__ripple\/api\//, '')
      calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
      const respond = (status: number, body: unknown) => ({ ok: status >= 200 && status < 300, status, json: async () => body }) as unknown as Response
      if (path === 'project/preview/stop') {
        // 旧会话停止请求故意挂起：模拟停止响应迟迟不到的窗口
        await stopGate
        return respond(200, { stopped: true })
      }
      if (path === 'analyze') {
        const root = (calls.at(-1)?.body as { projectRoot?: string } | undefined)?.projectRoot
        const body = root === '/work/a' ? analysisFor('/work/a', 'proj-a') : root === '/work/init' ? analysisFor('/work/init', 'proj-init') : analysisFor('/work/b', 'proj-b')
        return respond(200, body)
      }
      if (path === 'history') return respond(200, { history: [] })
      if (path === 'project/preview') return respond(200, { projectId: 'proj-acme', previewId: `preview-${calls.length}`, sourceDigest: 'd', url: 'http://127.0.0.1:9999/' })
      return respond(404, { error: `未注册的路由：${path}` })
    }) as typeof fetch

    const adapter = createRealAdapter({ projectRoot: '/work/init', fetchImpl })
    const initial = await adapter.load()
    expect(initial.projectStatus).toBe('ready')
    expect(initial.projectName).toBe('init')

    // 打开 A：reset 后 projectRoot 已同步落定 '/work/a'，但旧会话的停止请求挂起
    const openA = adapter.openProject!('/work/a')
    // 停止挂起期间打开 B：B 不等 A 的停止响应，先完成并接管
    const openB = await adapter.openProject!('/work/b')
    expect(openB.projectStatus).toBe('ready')
    expect(openB.projectName).toBe('b')
    // 放行 A 的停止请求：A 续体随后必须按过期拒绝，不得把 projectRoot 改写回 '/work/a'
    releaseStop!()
    await expect(openA).rejects.toBeInstanceOf(StaleResponseError)
    // refresh 只能基于当前工程 B：analyze 请求体绝不得再出现 /work/a
    const refreshed = await adapter.refresh!(openB)
    expect(refreshed.projectName).toBe('b')
    const analyzeRoots = calls.filter(call => call.path === 'analyze').map(call => (call.body as { projectRoot: string }).projectRoot)
    expect(analyzeRoots.at(-1)).toBe('/work/b')
    expect(analyzeRoots).not.toContain('/work/a')
  })

  it('stopPreview 失败如实诊断：Evidence 呈现 ev:cleanup 风险项，不静默伪装清理成功', async () => {
    const { fetchImpl } = mockFetch({
      analyze: ANALYSIS,
      history: HISTORY_NOT_RUN,
      'project/preview': PREVIEW,
      'project/preview/stop': { status: 500, body: { error: '会话不存在' } },
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    expect(loaded.projectStatus).toBe('ready')
    // 首次加载没有清理动作，不应出现清理风险项
    expect(loaded.evidence.find(item => item.id === 'ev:cleanup')).toBeUndefined()
    // refresh 停止旧会话失败：主流程不中断，但 Evidence 必须如实暴露清理风险
    const refreshed = await adapter.refresh!(loaded)
    expect(refreshed.projectStatus).toBe('ready')
    const cleanup = evidence(refreshed, 'ev:cleanup')
    expect(cleanup.state).toBe('risk')
    expect(cleanup.sourceKind).toBe('runtime-observation')
    expect(cleanup.summary).toContain('preview-1')
    expect(cleanup.summary).toContain('会话不存在')
  })

  it('清理失败保留会话身份并可验证重试：下一轮 refresh 重试成功后风险项移除', async () => {
    let stopCalls = 0
    let previewSeq = 0
    const { fetchImpl, calls } = mockFetch({
      analyze: ANALYSIS,
      history: HISTORY_NOT_RUN,
      'project/preview': () => Promise.resolve({ status: 200, body: { projectId: 'proj-acme', previewId: `preview-${++previewSeq}`, sourceDigest: 'd', url: 'http://127.0.0.1:9999/' } }),
      'project/preview/stop': () => {
        stopCalls += 1
        // 第一次停止失败，之后成功——验证重试确实带同一身份再次发出
        return Promise.resolve(stopCalls === 1 ? { status: 500, body: { error: '会话不存在' } } : { status: 200, body: { stopped: true } })
      },
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    expect(loaded.projectStatus).toBe('ready')
    // 第一次 refresh：停止 preview-1 失败——风险项出现且保留会话身份
    const failed = await adapter.refresh!(loaded)
    const risk = evidence(failed, 'ev:cleanup')
    expect(risk.state).toBe('risk')
    expect(risk.summary).toContain('preview-1')
    // 第二次 refresh：先按身份重试 preview-1（成功，移出待清理），再停止 preview-2——风险项消失
    const retried = await adapter.refresh!(failed)
    expect(retried.projectStatus).toBe('ready')
    expect(retried.evidence.find(item => item.id === 'ev:cleanup')).toBeUndefined()
    // 可验证：preview-1 的停止请求确实带了同一 previewId 发了两次（失败一次 + 重试成功一次）
    const stopsForPreview1 = calls.filter(call => call.path === 'project/preview/stop' && (call.body as { previewId: string }).previewId === 'preview-1')
    expect(stopsForPreview1).toHaveLength(2)
  })

  it('多会话部分成功不误清风险：preview-1 持续失败期间 preview-2 清理成功，ev:cleanup 仍保留 preview-1 诊断', async () => {
    let previewSeq = 0
    let failPreview1 = true
    const { fetchImpl, calls } = mockFetch({
      analyze: ANALYSIS,
      history: HISTORY_NOT_RUN,
      'project/preview': () => Promise.resolve({ status: 200, body: { projectId: 'proj-acme', previewId: `preview-${++previewSeq}`, sourceDigest: 'd', url: 'http://127.0.0.1:9999/' } }),
      'project/preview/stop': () => {
        const body = calls.at(-1)?.body as { previewId?: string } | undefined
        const failing = failPreview1 && body?.previewId === 'preview-1'
        return Promise.resolve(failing ? { status: 500, body: { error: '预览容器无响应' } } : { status: 200, body: { stopped: true } })
      },
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    expect(loaded.projectStatus).toBe('ready')
    // 第一轮 refresh：停止 preview-1 失败——入列待重试
    const round1 = await adapter.refresh!(loaded)
    expect(evidence(round1, 'ev:cleanup').summary).toContain('preview-1')
    // 第二轮 refresh：重试 preview-1 仍失败；同时 preview-2（上一轮新建）清理成功。
    // 回归点：preview-2 的成功绝不允许误清空 preview-1 的风险提示
    const round2 = await adapter.refresh!(round1)
    expect(round2.projectStatus).toBe('ready')
    const risk = evidence(round2, 'ev:cleanup')
    expect(risk.state).toBe('risk')
    expect(risk.summary).toContain('preview-1')
    expect(risk.summary).toContain('预览容器无响应')
    expect(risk.summary).toContain('待清理 1 个会话')
    // 第三轮：preview-1 恢复可清理，重试成功——全部待清理清空，风险项消失
    failPreview1 = false
    const round3 = await adapter.refresh!(round2)
    expect(round3.projectStatus).toBe('ready')
    expect(round3.evidence.find(item => item.id === 'ev:cleanup')).toBeUndefined()
  })
})

describe('Real Adapter · 历史缩略图的诚实边界（禁止 Demo 素材回退）', () => {
  it('有归档截图：缩略图 source 必须是 real-artifact，且地址只来自服务端证据条目', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_PASSED, 'project/preview': PREVIEW, 'project/preview/stop': PREVIEW_STOP })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    const version = model.versions[0]
    expect(version.evidenceState).toBe('archived')
    expect(version.thumbnail).toEqual({
      url: '/__ripple/api/candidate/candidate-2/evidence/ev-1440',
      source: 'real-artifact',
    })
    // 缩略图地址绝不允许包含任何演示素材路径
    expect(version.thumbnail?.url).not.toContain('demo-assets')
    expect(version.evidenceList?.length).toBe(2)
  })

  it('只有证据元数据、无归档截图：evidenceState=metadata 且 thumbnail 必须是 undefined', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_METADATA_ONLY, 'project/preview': PREVIEW, 'project/preview/stop': PREVIEW_STOP })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    const version = model.versions[0]
    // 关键：验证 passed + 有断言 ≠ 截图已归档
    expect(version.evidenceAvailable).toBe(true)
    expect(version.evidenceState).toBe('metadata')
    expect(version.thumbnail).toBeUndefined()
    expect(version.evidenceList?.[0]).toContain('未归档截图')
  })

  it('完全无证据：evidenceState=none、无缩略图、无明细', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_NO_EVIDENCE, 'project/preview': PREVIEW, 'project/preview/stop': PREVIEW_STOP })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const model = await adapter.load()
    const version = model.versions[0]
    expect(version.evidenceState).toBe('none')
    expect(version.evidenceAvailable).toBe(false)
    expect(version.thumbnail).toBeUndefined()
    expect(version.evidenceList).toEqual([])
  })

  it('真实模式的任何历史条目都不得携带 demo-art 来源的缩略图', async () => {
    for (const history of [HISTORY_PASSED, HISTORY_METADATA_ONLY, HISTORY_NO_EVIDENCE, HISTORY_NOT_RUN]) {
      const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history, 'project/preview': PREVIEW, 'project/preview/stop': PREVIEW_STOP })
      const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
      const model = await adapter.load()
      for (const version of model.versions) {
        expect(version.thumbnail?.source).not.toBe('demo-art')
        if (version.thumbnail) expect(version.thumbnail.source).toBe('real-artifact')
      }
    }
  })
})
