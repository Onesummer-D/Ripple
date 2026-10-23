import { describe, expect, it } from 'vitest'
import { createRealAdapter } from './real-adapter'

/**
 * 联合验收批次：验证合同（A 核心 BrowserVerificationContract 的 F 体验层接线）。
 * - 页面标记初始建议来自分析结果（每页取"不被其他路由共享且较短"的 source-proven 文本）；
 * - 任一页面提不出可信标记则不提交合同（服务端对缺合同如实给出 unknown 断言，fail-closed）；
 * - 交互只能由用户显式声明，绝不自动臆造；
 * - 创建候选时合同随 POST /candidate 提交并由服务端绑定（合同哈希校验执行记录）。
 */

interface MockResponse { status: number; body: unknown }

function mockFetch(routes: Record<string, MockResponse>) {
  const calls: Array<{ path: string; body?: unknown }> = []
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^.*?\/__ripple\/api\//, '')
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[path]
    if (!route) return { ok: false, status: 404, json: async () => ({ error: `未注册的路由：${path}` }) } as unknown as Response
    return { ok: route.status >= 200 && route.status < 300, status: route.status, json: async () => route.body } as unknown as Response
  }) as typeof fetch
  return { fetchImpl, calls }
}

const HISTORY_EMPTY = { status: 200, body: { history: [] } }
const PREVIEW_UNAVAILABLE = { status: 503, body: { error: '隔离预演网络池为空' } }
const PREVIEW_STOP = { status: 200, body: { stopped: true } }
const CANDIDATE = {
  status: 200,
  body: {
    sessionId: 'session-c',
    candidate: { id: 'candidate-c', patchHash: 'hash-cccc' },
    verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
    workflow: { lifecycle: 'active' },
  },
}

function analysisWith(targets: Array<Record<string, unknown>>) {
  return {
    status: 200,
    body: {
      projectRoot: '/work/shop',
      revision: { projectId: 'proj-shop', sourceDigest: 'digest-1', gitCommit: 'abc', runtimeFingerprint: 'fp-1' },
      graphId: 'graph-1',
      unresolved: [],
      routes: [
        { id: 'page:home', label: '首页', page: '/' },
        { id: 'page:about', label: '关于', page: '/about' },
      ],
      targets,
      relationCounts: { reads: 2 },
    },
  }
}

const target = (id: string, value: string | undefined, pageRefs: string[], certainty = 'source-proven') => ({
  id, kind: 'data', label: id, value,
  location: { path: 'src/data/site.ts', start: 1, end: 5 },
  impact: { pageRefs, unresolved: [], certainty },
})

async function loadAdapter(routes: Record<string, MockResponse>) {
  const { fetchImpl, calls } = mockFetch(routes)
  const adapter = createRealAdapter({ projectRoot: '/work/shop', fetchImpl })
  const model = await adapter.load()
  return { adapter, model, calls }
}

describe('验证合同：页面标记提案', () => {
  it('每页取不被其他路由共享且较短的 source-proven 文本；共享文本不被选为标记', async () => {
    const { model } = await loadAdapter({
      analyze: analysisWith([
        target('data:home-title', '青野家居生活馆', ['page:home']),
        target('data:home-sub', '精选天然材质的家居用品。', ['page:home']),
        target('data:about-title', '关于青野', ['page:about']),
        target('data:about-sub', '青野家居成立于 2016 年，专注天然材质。', ['page:about']),
        target('data:footer', '青野家居 · 共同页脚文案', ['page:home', 'page:about']),
      ]),
      history: HISTORY_EMPTY,
      'project/preview': PREVIEW_UNAVAILABLE,
    })
    expect(model.verificationContract).toEqual({
      pages: [
        { pageRef: 'page:home', path: '/', markerText: '青野家居生活馆' },
        { pageRef: 'page:about', path: '/about', markerText: '关于青野' },
      ],
      interactions: [],
    })
  })

  it('任一页面提不出可信标记：不提交合同（fail-closed，绝不臆造标记）', async () => {
    const { model } = await loadAdapter({
      analyze: analysisWith([target('data:home-title', '只有首页有', ['page:home'])]),
      history: HISTORY_EMPTY,
      'project/preview': PREVIEW_UNAVAILABLE,
    })
    expect(model.verificationContract).toBeUndefined()
  })

  it('unknown/partial 目标不参与标记提案', async () => {
    const { model } = await loadAdapter({
      analyze: analysisWith([
        target('data:home-title', '首页', ['page:home'], 'source-proven'),
        target('data:about-runtime', undefined, [], 'unknown'),
        target('data:about-title', '关于', ['page:about'], 'partial'),
      ]),
      history: HISTORY_EMPTY,
      'project/preview': PREVIEW_UNAVAILABLE,
    })
    expect(model.verificationContract).toBeUndefined()
  })
})

describe('验证合同：用户编辑与候选绑定', () => {
  const ANALYSIS = analysisWith([
    target('data:home-title', '首页', ['page:home']),
    target('data:about-title', '关于', ['page:about']),
  ])

  it('标记可改、交互由用户显式声明；创建候选时合同随请求提交', async () => {
    const { adapter, model, calls } = await loadAdapter({
      analyze: ANALYSIS,
      history: HISTORY_EMPTY,
      'project/preview': { status: 200, body: { projectId: 'proj-shop', previewId: 'preview-1', sourceDigest: 'digest-1', url: 'http://127.0.0.1:9999/p/preview-1/' } },
      candidate: CANDIDATE,
      'candidate/preview/stop': PREVIEW_STOP,
    })
    const marked = adapter.setContractMarker!(model, 'page:about', '关于我们')
    expect(marked.verificationContract?.pages.find(page => page.pageRef === 'page:about')?.markerText).toBe('关于我们')
    const withInteraction = adapter.setContractInteractions!(marked, [{ pageRef: 'page:home', role: 'button', name: '展开服务详情', expectedText: '服务详情已展开' }])
    expect(withInteraction.verificationContract?.interactions).toHaveLength(1)

    const selected = adapter.selectElement(withInteraction, 'data:home-title')
    const drafted = adapter.setDraftText(selected, '新首页')
    const decided = adapter.setPageScope(drafted, 'page:about', 'exclude')
    await adapter.createCandidate!(decided, { rawIntent: '改文案' })

    const call = calls.find(item => item.path === 'candidate')
    const body = call?.body as { verificationContract: { pages: Array<{ pageRef: string; path: string; markerText: string }>; interactions: Array<{ pageRef: string; role: string; name: string; expectedText: string }> } }
    expect(body.verificationContract.pages).toEqual([
      { pageRef: 'page:home', path: '/', markerText: '首页' },
      { pageRef: 'page:about', path: '/about', markerText: '关于我们' },
    ])
    expect(body.verificationContract.interactions).toEqual([{ pageRef: 'page:home', role: 'button', name: '展开服务详情', expectedText: '服务详情已展开' }])
  })

  it('无合同时不发送 verificationContract 字段（服务端如实给出 unknown 断言）', async () => {
    const { adapter, model, calls } = await loadAdapter({
      analyze: analysisWith([target('data:home-title', '首页', ['page:home'])]),
      history: HISTORY_EMPTY,
      'project/preview': PREVIEW_UNAVAILABLE,
      candidate: CANDIDATE,
    })
    expect(model.verificationContract).toBeUndefined()
    const selected = adapter.selectElement(model, 'data:home-title')
    const drafted = adapter.setDraftText(selected, '新首页')
    const decided = adapter.setPageScope(drafted, 'page:about', 'exclude')
    await adapter.createCandidate!(decided, { rawIntent: '改文案' })
    const call = calls.find(item => item.path === 'candidate')
    expect(call, '候选请求必须发出').toBeTruthy()
    expect('verificationContract' in (call?.body as Record<string, unknown>)).toBe(false)
  })
})
