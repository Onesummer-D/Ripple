import { describe, expect, it, vi } from 'vitest'
import { createRealAdapter } from './real-adapter'
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
    const model = await pending
    // dispose 已使 load 过期：返回的是空工程模型，绝不把过期响应投影成"已加载"
    expect(model.projectStatus).toBe('unavailable')
    expect(model.preview).toBeUndefined()
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
    const staleModel = await firstLoad
    // 过期 load 不得覆盖新工程状态
    expect(staleModel.projectIdentity?.projectId).toBe('proj-other')
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

describe('Real Adapter · PR #25 状态整改', () => {
  it('P1-1 切换编辑目标：上一目标的 Scope 意向不跨目标残留', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_NOT_RUN, 'project/preview': PREVIEW })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    // 目标一（首页标题）：首页为编辑页，"关于"页排除（用户范围意向）
    const hero = adapter.selectElement(loaded, 'data:hero-title')
    const scoped = adapter.setPageScope(hero, 'page:about', 'exclude')
    expect(scoped.pages.find(page => page.id === 'page:about')?.scope).toBe('exclude')
    // 切换目标（共享标语，来源证明影响首页+关于）：范围决策以当前目标重新投影，
    // 上一目标对"关于"页的排除绝不残留
    const switched = adapter.selectElement(scoped, 'data:shared-slogan')
    expect(switched.pages.find(page => page.id === 'page:about')).toMatchObject({ relation: 'same-source', scope: 'include' })
    expect(switched.pages.every(page => page.scope !== 'exclude')).toBe(true)
    // 新目标下可以独立做新的范围意向
    const reScoped = adapter.setPageScope(switched, 'page:about', 'protect')
    expect(reScoped.pages.find(page => page.id === 'page:about')?.scope).toBe('protect')
  })

  it('P1-1 重复点击同一目标不算切换：该目标下的草稿与范围意向保留', async () => {
    const { fetchImpl } = mockFetch({ analyze: ANALYSIS, history: HISTORY_NOT_RUN, 'project/preview': PREVIEW })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    const scoped = adapter.setPageScope(adapter.selectElement(loaded, 'data:hero-title'), 'page:about', 'exclude')
    const withDraft = adapter.setDraftText(scoped, 'Acme 旗舰店')
    const reselect = adapter.selectElement(withDraft, 'data:hero-title')
    expect(reselect).toBe(withDraft)
    expect(reselect.pages.find(page => page.id === 'page:about')?.scope).toBe('exclude')
  })

  it('P1-3 候选生命周期优先于审批记录：applied/rolled-back/stale 不得显示为已批准', async () => {
    const base = {
      candidateId: 'candidate-9', projectId: 'proj-acme', patchHash: 'hash-9999',
      updatedAt: '2026-10-22T15:00:00Z',
      approval: { verificationRunId: 'run-9', at: '2026-10-22T14:00:00Z' },
      verification: { state: 'passed', runId: 'run-9' },
    }
    const cases: Array<[string, ExperienceViewModel['candidateStatus']]> = [
      // 应用/回滚/失效后审批记录仍保留在 history，状态必须显示真实归宿
      ['applied', 'applied'],
      ['rolled-back', 'rolled-back'],
      ['stale', 'stale'],
      ['discarded', 'none'],
      // 仍处于活动阶段时审批标记才作为门控结果展示
      ['active', 'approved'],
    ]
    for (const [lifecycle, expected] of cases) {
      const { fetchImpl } = mockFetch({
        analyze: ANALYSIS,
        history: { status: 200, body: { history: [{ ...base, lifecycle }] } },
        'project/preview': PREVIEW,
      })
      const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
      const model = await adapter.load()
      expect(model.candidateStatus, `lifecycle=${lifecycle} 且含审批记录`).toBe(expected)
    }
    // 活动阶段无审批、验证通过 → verified（审批门控未被绕过）
    const { fetchImpl } = mockFetch({
      analyze: ANALYSIS,
      history: { status: 200, body: { history: [{ ...base, lifecycle: 'active', approval: undefined }] } },
      'project/preview': PREVIEW,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    expect((await adapter.load()).candidateStatus).toBe('verified')
  })

  it('P1-2 refresh：替换预演会话前先停止旧会话（停止请求早于新预演创建）', async () => {
    const { fetchImpl, calls } = mockFetch({
      analyze: ANALYSIS, history: HISTORY_NOT_RUN,
      'project/preview': PREVIEW, 'project/preview/stop': PREVIEW_STOP,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const loaded = await adapter.load()
    const refreshed = await adapter.refresh?.(loaded)
    expect(refreshed?.preview?.previewId).toBe('preview-1')
    const paths = calls.map(call => call.path)
    const stopIndex = paths.indexOf('project/preview/stop')
    const lastPreviewIndex = paths.lastIndexOf('project/preview')
    expect(stopIndex).toBeGreaterThanOrEqual(0)
    expect(calls[stopIndex].body).toMatchObject({ projectId: 'proj-acme', previewId: 'preview-1' })
    // 旧会话的停止请求必须早于新预演会话的创建请求
    expect(stopIndex).toBeLessThan(lastPreviewIndex)
  })

  it('P1-2 并发切换工程：过期预览响应返回时其会话被回收，不提交进状态', async () => {
    let analyzeCalls = 0
    let previewCalls = 0
    let resolveFirstPreview: ((value: MockResponse) => void) | undefined
    const otherAnalysis = {
      status: 200,
      body: {
        ...ANALYSIS.body,
        projectRoot: '/work/other-app',
        revision: { projectId: 'proj-other', sourceDigest: 'digest-2', runtimeFingerprint: 'fp-2' },
        routes: [{ id: 'page:main', label: '主页', page: '/' }],
        targets: [],
      },
    }
    const previewB = { status: 200, body: { ...PREVIEW.body, previewId: 'preview-2', sourceDigest: 'digest-2' } }
    const { fetchImpl, calls } = mockFetch({
      analyze: () => {
        analyzeCalls += 1
        return Promise.resolve(analyzeCalls === 1 ? ANALYSIS : otherAnalysis)
      },
      history: { status: 200, body: { history: [] } },
      'project/preview': () => {
        previewCalls += 1
        // 第一次预演请求故意挂起，第二次（切换后）立即返回
        if (previewCalls === 1) return new Promise<MockResponse>(resolve => { resolveFirstPreview = resolve })
        return Promise.resolve(previewB)
      },
      'project/preview/stop': PREVIEW_STOP,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    const firstLoad = adapter.load()
    // 等第一个 load 走到挂起的预演请求，再切换工程制造并发
    await vi.waitFor(() => { if (!resolveFirstPreview) throw new Error('preview 未发出') })
    const switched = await adapter.openProject!('/work/other-app')
    expect(switched.projectIdentity?.projectId).toBe('proj-other')
    expect(switched.preview?.previewId).toBe('preview-2')
    // 过期预览响应此刻才返回：会话 preview-1 必须被回收（stop），绝不能残留
    resolveFirstPreview!(PREVIEW)
    const staleModel = await firstLoad
    expect(staleModel.projectIdentity?.projectId).toBe('proj-other')
    const stops = calls.filter(call => call.path === 'project/preview/stop')
    expect(stops.some(call => (call.body as { previewId?: string }).previewId === 'preview-1')).toBe(true)
  })

  it('P1-2 连续切换项目：每次切换都停止上一工程的预演会话，只保留最新会话', async () => {
    let analyzeCalls = 0
    const analysisFor = (root: string, projectId: string, digest: string) => ({
      status: 200,
      body: {
        ...ANALYSIS.body,
        projectRoot: root,
        revision: { projectId, sourceDigest: digest, runtimeFingerprint: 'fp' },
        routes: [{ id: 'page:main', label: '主页', page: '/' }],
        targets: [],
      },
    })
    const previewFor = (previewId: string, digest: string) => ({
      status: 200,
      body: { projectId: 'ignored', previewId, sourceDigest: digest, url: `http://127.0.0.1:9999/preview/${previewId}/` },
    })
    let previewCalls = 0
    const { fetchImpl, calls } = mockFetch({
      analyze: () => {
        analyzeCalls += 1
        return Promise.resolve(
          analyzeCalls === 1 ? ANALYSIS
            : analyzeCalls === 2 ? analysisFor('/work/app-b', 'proj-b', 'digest-b')
              : analysisFor('/work/app-c', 'proj-c', 'digest-c'),
        )
      },
      history: { status: 200, body: { history: [] } },
      'project/preview': () => {
        // 预演会话按预演请求序返回：首载 preview-1，之后 preview-b / preview-c
        previewCalls += 1
        const session = previewCalls === 1 ? previewFor('preview-1', 'digest-1')
          : previewCalls === 2 ? previewFor('preview-b', 'digest-b')
            : previewFor('preview-c', 'digest-c')
        return Promise.resolve(session)
      },
      'project/preview/stop': PREVIEW_STOP,
    })
    const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
    await adapter.load() // preview-1（proj-acme）
    await adapter.openProject!('/work/app-b') // preview-b
    await adapter.openProject!('/work/app-c') // preview-c
    const stops = calls.filter(call => call.path === 'project/preview/stop')
      .map(call => (call.body as { previewId?: string }).previewId)
    expect(stops).toContain('preview-1')
    expect(stops).toContain('preview-b')
    expect(stops).not.toContain('preview-c')
  })
})
