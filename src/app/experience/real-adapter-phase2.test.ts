import { describe, expect, it } from 'vitest'
import { createRealAdapter } from './real-adapter'
import type { PickerEnvelope } from './real-selection'

/**
 * F 第二阶段第一批测试：真实画布点选 → source-selection 身份校验 →
 * Scope 用户决策 → 真实候选创建与预演。全部通过注入 fetchImpl 拦截
 * /__ripple/api 请求；验证授权永远落在服务端、来源证明不足时正确阻断。
 */

interface MockResponse { status: number; body: unknown }

function mockFetch(routes: Record<string, MockResponse>) {
  const calls: Array<{ path: string; body?: unknown }> = []
  const callCounts = new Map<string, number>()
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url
    const path = url.replace(/^.*?\/__ripple\/api\//, '')
    calls.push({ path, body: init?.body ? JSON.parse(String(init.body)) : undefined })
    const route = routes[path]
    if (!route) return { ok: false, status: 404, json: async () => ({ error: `未注册的路由：${path}` }) } as unknown as Response
    const index = callCounts.get(path) ?? 0
    callCounts.set(path, index + 1)
    // body 可以是按调用序的函数（同一 URL 多次调用返回不同状态，如历史回读）
    const body = typeof route.body === 'function' ? (route.body as (callIndex: number) => unknown)(index) : route.body
    return {
      ok: route.status >= 200 && route.status < 300,
      status: route.status,
      json: async () => body,
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
        id: 'data:dynamic-banner', kind: 'data', label: '动态横幅', value: undefined,
        impact: { pageRefs: [], unresolved: ['内容来自运行时接口，静态分析无法确认'], certainty: 'unknown' },
      },
    ],
    relationCounts: { reads: 2, renders: 1 },
  },
}

const HISTORY_EMPTY = { status: 200, body: { history: [] } }
const PREVIEW = { status: 200, body: { projectId: 'proj-acme', previewId: 'preview-1', sourceDigest: 'digest-1', url: 'http://127.0.0.1:9999/preview/preview-1/' } }
const PREVIEW_STOP = { status: 200, body: { stopped: true } }

function pickedEnvelope(sourceRef = 'jsx:src/App.tsx#42'): PickerEnvelope {
  return {
    type: 'ripple:element-selected',
    protocol: 'ripple-runtime-identity/v1',
    previewId: 'preview-1',
    token: 'nonce-1',
    sourceRef,
    identityCertainty: 'position-dependent',
    reasons: ['identity-not-stable'],
    tagName: 'h1',
    text: 'Acme 商店',
    pageContext: { pathname: '/preview/preview-1/', search: '', hash: '' },
  }
}

function sourceSelectionResponse(overrides: Record<string, unknown> = {}) {
  return {
    status: 200,
    body: {
      projectId: 'proj-acme',
      previewId: 'preview-1',
      sourceDigest: 'digest-1',
      element: { id: 'jsx:src/App.tsx#42', label: '画布标题' },
      sourceVersion: undefined,
      editableText: [{
        id: 'data:hero-title', label: '首页标题', value: 'Acme 商店',
        location: { path: 'src/data/site.ts', start: 10, end: 20 },
        impact: { pageRefs: ['page:home'], unresolved: [], certainty: 'source-proven' },
      }],
      ...overrides,
    },
  }
}

async function loadAdapter(routes: Record<string, MockResponse>) {
  const { fetchImpl, calls } = mockFetch(routes)
  const adapter = createRealAdapter({ projectRoot: '/work/acme-shop', fetchImpl })
  const model = await adapter.load()
  return { adapter, model, calls }
}

describe('画布点选 → source-selection 身份校验', () => {
  it('点选成功：服务端授权路径、响应绑定会话、选中目标映射到可编辑文本目标', async () => {
    const { adapter, model, calls } = await loadAdapter({
      analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW,
      'project/source-selection': sourceSelectionResponse(),
    })
    const picked = await adapter.applyPickedSource!(model, { sourceRef: 'jsx:src/App.tsx#42', envelope: pickedEnvelope() })
    // 授权请求携带预演会话身份 + 信封 sourceRef
    const call = calls.find(item => item.path === 'project/source-selection')
    expect(call?.body).toMatchObject({
      projectId: 'proj-acme', previewId: 'preview-1', sourceDigest: 'digest-1', sourceRef: 'jsx:src/App.tsx#42',
    })
    // 选中点选元素的可编辑文本目标（只选已分析目标，不臆造）
    expect(picked.selectedElementId).toBe('data:hero-title')
    // 运行时身份登记到元素（仅显示；position-dependent 不得升格为可编辑依据）
    const hero = picked.elements.find(item => item.id === 'data:hero-title')
    expect(hero?.runtimeIdentity?.certainty).toBe('unknown')
    expect(hero?.editable).toBe(true) // editable 仍只由来源证明决定
    // 切换目标：草稿与范围意向清空
    expect(picked.draftAfterText).toBe('')
    expect(picked.pages.find(page => page.id === 'page:home')).toMatchObject({ relation: 'editing', scope: 'include' })
  })

  it('响应与当前预演会话不一致：丢弃并阻断，绝不采信过期预览的元素', async () => {
    const { adapter, model } = await loadAdapter({
      analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW,
      'project/source-selection': sourceSelectionResponse({ previewId: 'preview-2' }),
    })
    await expect(adapter.applyPickedSource!(model, { sourceRef: 'jsx:src/App.tsx#42', envelope: pickedEnvelope() }))
      .rejects.toThrow('点选响应与当前预演会话不一致')
  })

  it('点选元素的文本来源不在已分析目标中：拒绝落位，不臆造可编辑目标', async () => {
    const { adapter, model } = await loadAdapter({
      analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW,
      'project/source-selection': sourceSelectionResponse({
        editableText: [{
          id: 'data:never-analyzed', label: '未分析节点', value: 'x',
          impact: { pageRefs: [], unresolved: [], certainty: 'source-proven' },
        }],
      }),
    })
    await expect(adapter.applyPickedSource!(model, { sourceRef: 'jsx:src/App.tsx#42', envelope: pickedEnvelope() }))
      .rejects.toThrow('无法作为修改目标')
  })
})

describe('Scope 用户决策 → 真实候选创建', () => {
  it('来源证明不足时逐条阻断：未选中 / unknown 目标 / 空草稿 / 有未决定页 / 包含未证明页', async () => {
    const { adapter, model } = await loadAdapter({ analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW })
    // 未选中目标
    await expect(adapter.createCandidate!(model, { rawIntent: '改标题' })).rejects.toThrow('尚未选中要修改的真实目标')
    // unknown 目标：只能查看
    const unknown = adapter.selectElement(model, 'data:dynamic-banner')
    await expect(adapter.createCandidate!(unknown, { rawIntent: '改横幅' })).rejects.toThrow('选中目标来源未完全证明')
    // source-proven 目标但草稿为空
    const selected = adapter.selectElement(model, 'data:hero-title')
    await expect(adapter.createCandidate!(selected, { rawIntent: '改标题' })).rejects.toThrow('修改内容为空')
    // 有未决定页面（关于页默认 undecided）
    const withDraft = adapter.setDraftText(selected, 'Acme 旗舰店')
    await expect(adapter.createCandidate!(withDraft, { rawIntent: '改标题' })).rejects.toThrow('未决定范围')
    // 把未证明页面包含进范围：不安全范围不得创建候选
    const unsafe = adapter.setPageScope(withDraft, 'page:about', 'include')
    await expect(adapter.createCandidate!(unsafe, { rawIntent: '改标题' })).rejects.toThrow('来源未完全证明的页面')
  })

  it('成功创建：ScopeDecision + 单条 TEXT operation 提交服务端，候选状态以服务端为权威', async () => {
    const candidateRoute = {
      status: 200,
      body: {
        sessionId: 'session-9',
        candidate: { id: 'candidate-9', patchHash: 'hash-9999abcdef0000' },
        verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
        workflow: { lifecycle: 'active' },
      },
    }
    const historyAfter = {
      status: 200,
      body: {
        history: [{
          candidateId: 'candidate-9', projectId: 'proj-acme', lifecycle: 'active',
          patchHash: 'hash-9999abcdef0000', updatedAt: '2026-10-23T08:30:00Z',
          verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
        }],
      },
    }
    // historyAfter：候选创建后回读历史的权威结果（含 candidate-9）
    const { adapter, model, calls } = await loadAdapter({
      analyze: ANALYSIS, history: historyAfter, 'project/preview': PREVIEW, candidate: candidateRoute, 'candidate/preview/stop': PREVIEW_STOP,
    })
    // 决策路径：选中 → 草稿 → 关于页显式排除
    const selected = adapter.selectElement(model, 'data:hero-title')
    const drafted = adapter.setDraftText(selected, 'Acme 旗舰店')
    const decided = adapter.setPageScope(drafted, 'page:about', 'exclude')
    const created = await adapter.createCandidate!(decided, { rawIntent: '把首页标题改为旗舰店文案' })

    const call = calls.find(item => item.path === 'candidate')
    expect(call?.body).toMatchObject({ projectId: 'proj-acme', rawIntent: '把首页标题改为旗舰店文案' })
    const body = call?.body as { scope: { strategy: string; localPageRef?: string; includedRefs: string[]; excludedRefs: string[]; decidedBy: string }; operations: Array<{ kind: string; targetRef: string; before: string; after: string }> }
    expect(body.scope).toMatchObject({
      strategy: 'shared', includedRefs: ['data:hero-title', 'page:home'], excludedRefs: ['page:about'], decidedBy: 'local-user',
    })
    // A 核心 assertScope：shared Scope 不得携带 localPageRef（否则服务端直接拒绝）
    expect(body.scope.localPageRef).toBeUndefined()
    expect(body.operations).toHaveLength(1)
    expect(body.operations[0]).toMatchObject({ kind: 'TEXT', targetRef: 'data:hero-title', before: 'Acme 商店', after: 'Acme 旗舰店' })

    // 候选以服务端持久化结果为权威；项目预演已由服务端停止，如实呈现
    expect(created.activeCandidate).toMatchObject({ candidateId: 'candidate-9', patchHash: 'hash-9999abcdef0000' })
    expect(created.candidateStatus).toBe('candidate')
    expect(created.preview).toBeUndefined()
    expect(created.blockedReasons?.some(reason => reason.includes('项目预演已由服务端停止'))).toBe(true)
  })

  it('候选被服务端拒绝：预演会话如实失效（不留看似可用的旧会话），刷新后重建预演', async () => {
    const { adapter, model, calls } = await loadAdapter({
      analyze: ANALYSIS,
      history: HISTORY_EMPTY,
      'project/preview': PREVIEW,
      // A 在创建候选前停止项目预演：拒绝时服务端预演已消失
      candidate: { status: 409, body: { error: '共享来源 Scope 不能携带局部页面引用' } },
      'project/preview/stop': PREVIEW_STOP,
    })
    const selected = adapter.selectElement(model, 'data:hero-title')
    const drafted = adapter.setDraftText(selected, 'Acme 旗舰店')
    const decided = adapter.setPageScope(drafted, 'page:about', 'exclude')
    await expect(adapter.createCandidate!(decided, { rawIntent: '改标题' })).rejects.toThrow('局部页面引用')

    // 旧预演会话不再可用：重建模型后无预演、点选能力关闭（绝不保留失效会话充数）
    const observed = adapter.setDraftText(decided, 'Acme 旗舰店')
    expect(observed.preview).toBeUndefined()
    expect(observed.pickerAvailable).toBe(false)

    // 刷新重建预演：重新 analyze + 启动新预演会话，恢复点选能力
    const refreshed = await adapter.refresh!(observed)
    expect(calls.filter(item => item.path === 'project/preview')).toHaveLength(2)
    expect(refreshed.preview).toMatchObject({ previewId: 'preview-1' })
    expect(refreshed.pickerAvailable).toBe(true)
  })
})

describe('候选预演生命周期', () => {
  it('打开候选预演：响应绑定当前候选；关闭时尽力停止会话', async () => {
    const candidateRoute = {
      status: 200,
      body: {
        sessionId: 'session-9',
        candidate: { id: 'candidate-9', patchHash: 'hash-9999abcdef0000' },
        verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
        workflow: { lifecycle: 'active' },
      },
    }
    const { adapter, model, calls } = await loadAdapter({
      analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW, candidate: candidateRoute,
      'candidate/preview': { status: 200, body: { candidateId: 'candidate-9', url: 'http://127.0.0.1:9999/candidate/candidate-9/', verification: { state: 'not-run' } } },
      'candidate/preview/stop': PREVIEW_STOP,
    })
    const selected = adapter.selectElement(model, 'data:hero-title')
    const drafted = adapter.setDraftText(selected, 'Acme 旗舰店')
    const decided = adapter.setPageScope(drafted, 'page:about', 'exclude')
    const created = await adapter.createCandidate!(decided, { rawIntent: '改标题' })

    const opened = await adapter.openCandidatePreview!(created)
    expect(opened.activeCandidate?.previewUrl).toBe('http://127.0.0.1:9999/candidate/candidate-9/')
    // 打开成功后 loading 必须在同一模型快照内复位，否则预演开关按钮被永久禁用
    expect(opened.activeCandidate?.previewLoading).toBe(false)
    const closed = await adapter.closeCandidatePreview!(opened)
    expect(closed.activeCandidate?.previewUrl).toBeUndefined()
    expect(calls.some(item => item.path === 'candidate/preview/stop')).toBe(true)
  })

  it('没有活跃候选时打开预演：如实拒绝', async () => {
    const { adapter, model } = await loadAdapter({ analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW })
    await expect(adapter.openCandidatePreview!(model)).rejects.toThrow('当前没有活跃候选')
  })
})


describe('四视口验证（第二批：POST /candidate/verify）', () => {
  const candidateRoute = {
    status: 200,
    body: {
      sessionId: 'session-9',
      candidate: { id: 'candidate-9', patchHash: 'hash-9999abcdef0000' },
      verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
      workflow: { lifecycle: 'active' },
    },
  }
  const VERIFY_PASSED = {
    status: 200,
    body: {
      candidateId: 'candidate-9',
      previewUrl: 'http://127.0.0.1:9999/candidate/candidate-9/',
      verification: {
        state: 'passed',
        runId: 'run-42',
        patchHash: 'hash-9999abcdef0000',
        scopeVersion: 3,
        startedAt: '2026-10-23T10:00:00Z',
        completedAt: '2026-10-23T10:00:30Z',
        recordHash: 'record-hash-abcdef',
        assertions: [
          { id: 'a:patch-present', result: 'pass', detail: '补丁文字出现在页面' },
          { id: 'a:no-console-error', result: 'pass', detail: '无浏览器错误' },
        ],
        evidence: [
          { id: 'ev-1', checkId: 'c:shot', result: 'pass', viewport: { width: 1440, height: 900 }, runtimeState: 'settled', artifactUrl: '/__ripple/api/candidate/candidate-9/evidence/ev-1' },
          { id: 'ev-2', checkId: 'c:shot', result: 'pass', viewport: { width: 768, height: 1024 }, runtimeState: 'settled', artifactUrl: '/__ripple/api/candidate/candidate-9/evidence/ev-2' },
          { id: 'ev-3', checkId: 'c:shot', result: 'pass', viewport: { width: 375, height: 812 }, runtimeState: 'settled', artifactUrl: '/__ripple/api/candidate/candidate-9/evidence/ev-3' },
          { id: 'ev-4', checkId: 'c:shot', result: 'pass', viewport: { width: 390, height: 844 }, runtimeState: 'settled', artifactUrl: '/__ripple/api/candidate/candidate-9/evidence/ev-4' },
        ],
        visualEvidences: [
          {
            checkId: 'v:home', route: '/', result: 'unchanged', resultReason: '无视觉差异',
            view: {
              schema: 'ripple-visual-evidence-view/v1',
              stateLabel: '视觉未知',
              summary: '未检测到视觉变化。视觉证据仅为补充观察，不构成通过判定。',
              comparable: true,
              changedPixels: 0,
              regionCount: 0,
              identityStatus: 'page-context-proven',
              limitations: [],
              crossVersion: {
                scope: { strictInstanceProofAvailable: false },
                pairs: [{ proofLabel: '实例候选配对（运行时标注支持，未经身份核验）', reasons: ['source-version-unavailable'] }],
              },
            },
          },
        ],
      },
      workflow: { lifecycle: 'active' },
    },
  }
  const historyVerified = {
    status: 200,
    body: {
      history: [{
        candidateId: 'candidate-9', projectId: 'proj-acme', lifecycle: 'active',
        patchHash: 'hash-9999abcdef0000', updatedAt: '2026-10-23T10:00:31Z',
        verification: VERIFY_PASSED.body.verification,
      }],
    },
  }

  async function adapterWithCandidate(routes: Record<string, MockResponse>) {
    const loaded = await loadAdapter({ analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW, candidate: candidateRoute, ...routes })
    const selected = loaded.adapter.selectElement(loaded.model, 'data:hero-title')
    const drafted = loaded.adapter.setDraftText(selected, 'Acme 旗舰店')
    const decided = loaded.adapter.setPageScope(drafted, 'page:about', 'exclude')
    const created = await loaded.adapter.createCandidate!(decided, { rawIntent: '改标题' })
    return { ...loaded, created }
  }

  it('验证通过：消费服务端 VerificationRun（四视口截图/断言/记录哈希/E 视觉证据），历史回读为权威', async () => {
    const { adapter, created, calls } = await adapterWithCandidate({
      'candidate/verify': VERIFY_PASSED,
      history: historyVerified,
    })
    const verified = await adapter.runVerification!(created)
    // 请求绑定当前候选
    expect(calls.find(item => item.path === 'candidate/verify')?.body).toMatchObject({ candidateId: 'candidate-9' })
    // 验证快照全部来自服务端投影；截图地址绝对化
    const verification = verified.activeCandidate?.verification
    expect(verification?.state).toBe('passed')
    expect(verification?.stateLabel).toBe('通过')
    expect(verification?.runId).toBe('run-42')
    expect(verification?.recordHash).toBe('record-hash-abcdef')
    expect(verification?.assertions).toHaveLength(2)
    expect(verification?.shots).toHaveLength(4)
    expect(verification?.shots.map(shot => shot.viewportWidth)).toEqual([1440, 768, 375, 390])
    expect(verification?.shots.every(shot => shot.imageUrl?.startsWith('/__ripple/api/candidate/candidate-9/evidence/'))).toBe(true)
    // E 只读视觉证据：索引字段 + 可读 view 投影（proofLabel 逐字透传，不得改写升级）
    expect(verification?.visualEvidences).toHaveLength(1)
    expect(verification?.visualEvidences[0]).toMatchObject({
      checkId: 'v:home', route: '/', result: 'unchanged', resultReason: '无视觉差异',
    })
    expect(verification?.visualEvidences[0]?.view).toEqual({
      schema: 'ripple-visual-evidence-view/v1',
      stateLabel: '视觉未知',
      summary: '未检测到视觉变化。视觉证据仅为补充观察，不构成通过判定。',
      comparable: true,
      changedPixels: 0,
      regionCount: 0,
      identityStatus: 'page-context-proven',
      limitations: [],
      crossVersion: {
        scope: { strictInstanceProofAvailable: false },
        pairs: [{ proofLabel: '实例候选配对（运行时标注支持，未经身份核验）', reasons: ['source-version-unavailable'] }],
      },
    })
    // loading 在同一模型快照内复位（da94ab7 教训），按钮不得永久禁用
    expect(verified.activeCandidate?.verificationRunning).toBe(false)
    // 历史回读：证据面板与版本胶片以服务端持久化结果为权威
    expect(calls.filter(item => item.path === 'history').length).toBeGreaterThanOrEqual(2)
    expect(verified.evidence.find(item => item.id === 'ev:verification')?.state).toBe('pass')
    expect(verified.versions[0]?.summary).toContain('验证通过')
  })

  it('验证被服务端拒绝：错误如实透出，running 状态复位不残留', async () => {
    const { adapter, created } = await adapterWithCandidate({
      'candidate/verify': { status: 409, body: { error: '候选已被替换，验证运行失败' } },
    })
    await expect(adapter.runVerification!(created)).rejects.toThrow('候选已被替换')
    // 失败后任何后续模型重建都不得残留 running（否则验证按钮永久禁用）
    const observed = adapter.setDraftText(created, 'Acme 旗舰店二号')
    expect(observed.activeCandidate?.verificationRunning).toBeFalsy()
    expect(observed.activeCandidate?.verification).toBeUndefined()
  })

  it('没有活跃候选时运行验证：如实拒绝', async () => {
    const { adapter, model } = await loadAdapter({ analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW })
    await expect(adapter.runVerification!(model)).rejects.toThrow('当前没有活跃候选')
  })
})


describe('第二批复核：候选切换 / 状态如实 / 失败刷新', () => {
  const candidate9Route = {
    status: 200,
    body: {
      sessionId: 'session-9',
      candidate: { id: 'candidate-9', patchHash: 'hash-9999abcdef0000' },
      verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
      workflow: { lifecycle: 'active' },
    },
  }
  const candidate10Route = {
    status: 200,
    body: {
      sessionId: 'session-10',
      candidate: { id: 'candidate-10', patchHash: 'hash-1010abcdef0000' },
      verification: { state: 'not-run', reason: '浏览器验证尚未运行。' },
      workflow: { lifecycle: 'active' },
    },
  }
  const historyItem9 = (lifecycle: string, verification: unknown) => ({
    candidateId: 'candidate-9', projectId: 'proj-acme', lifecycle,
    patchHash: 'hash-9999abcdef0000', updatedAt: '2026-10-23T10:00:31Z', verification,
  })
  const VERIFY_PASSED_RUN = {
    state: 'passed', runId: 'run-42', patchHash: 'hash-9999abcdef0000', scopeVersion: 3,
    recordHash: 'record-hash-abcdef', assertions: [{ id: 'a:1', result: 'pass', detail: '补丁文字出现' }],
    evidence: [
      { id: 'ev-1', result: 'pass', viewport: { width: 1440, height: 900 }, runtimeState: 'settled', artifactUrl: '/__ripple/api/candidate/candidate-9/evidence/ev-1' },
      { id: 'ev-4', result: 'pass', viewport: { width: 390, height: 844 }, runtimeState: 'settled', artifactUrl: '/__ripple/api/candidate/candidate-9/evidence/ev-4' },
    ],
  }
  const verifyResponse = (verification: unknown) => ({
    status: 200,
    body: { candidateId: 'candidate-9', previewUrl: 'http://127.0.0.1:9999/candidate/candidate-9/', verification, workflow: { lifecycle: 'active' } },
  })

  async function adapterWithVerifiedCandidate(routes: Record<string, MockResponse>) {
    const loaded = await loadAdapter({ analyze: ANALYSIS, history: HISTORY_EMPTY, 'project/preview': PREVIEW, candidate: candidate9Route, ...routes })
    const selected = loaded.adapter.selectElement(loaded.model, 'data:hero-title')
    const drafted = loaded.adapter.setDraftText(selected, 'Acme 旗舰店')
    const decided = loaded.adapter.setPageScope(drafted, 'page:about', 'exclude')
    const created = await loaded.adapter.createCandidate!(decided, { rawIntent: '改标题' })
    return { ...loaded, created }
  }

  it('复核点 1：创建新候选后不得残留上一个候选的验证', async () => {
    // 第二次 POST /candidate 返回 candidate-10；历史回读第 4 次起以 candidate-10 为权威
    const { adapter, created, calls } = await adapterWithVerifiedCandidate({
      'candidate/verify': { status: 200, body: () => verifyResponse(VERIFY_PASSED_RUN).body },
      candidate: { status: 200, body: (index: number) => (index === 0 ? candidate9Route.body : candidate10Route.body) },
      history: { status: 200, body: (index: number) => ({
        history: index >= 3
          ? [{ candidateId: 'candidate-10', projectId: 'proj-acme', lifecycle: 'active', patchHash: 'hash-1010abcdef0000', updatedAt: '2026-10-23T10:05:00Z', verification: { state: 'not-run' } }, historyItem9('active', { state: 'not-run' })]
          : [historyItem9('active', { state: 'not-run' })],
      }) },
    })
    const verified = await adapter.runVerification!(created)
    expect(verified.activeCandidate?.verification?.runId).toBe('run-42')
    // 创建第二个候选（同一目标再次提交即可，合同细节不是本用例重点）
    const second = await adapter.createCandidate!(verified, { rawIntent: '再改一次' })
    // 候选身份已切换：旧候选的验证运行（run-42）绝不得展示在新候选上
    expect(second.activeCandidate?.candidateId).toBe('candidate-10')
    expect(second.activeCandidate?.verification).toBeUndefined()
    // 证据面板回到"尚未运行"，版本胶片含两个候选
    expect(second.evidence.find(item => item.id === 'ev:verification')?.state).toBe('not-run')
    expect(second.versions.map(item => item.id).sort()).toEqual(['candidate-10', 'candidate-9'])
    expect(calls.filter(item => item.path === 'candidate')).toHaveLength(2)
  })

  it('复核点 2：stale 与 failed-to-run 状态如实投影，不粉饰', async () => {
    const { adapter, created } = await adapterWithVerifiedCandidate({
      'candidate/verify': { status: 200, body: (index: number) => verifyResponse(index === 0
        ? { state: 'stale', reason: '证据对应的候选或源码已过期。', runId: 'run-stale' }
        : { state: 'failed-to-run', reason: '浏览器验证未能启动。' }).body },
    })
    const stale = await adapter.runVerification!(created)
    expect(stale.activeCandidate?.verification?.state).toBe('stale')
    expect(stale.activeCandidate?.verification?.stateLabel).toBe('已过期')
    expect(stale.activeCandidate?.verification?.reason).toContain('过期')
    const failed = await adapter.runVerification!(stale)
    expect(failed.activeCandidate?.verification?.state).toBe('failed-to-run')
    expect(failed.activeCandidate?.verification?.stateLabel).toBe('运行失败')
    expect(failed.activeCandidate?.verification?.shots).toHaveLength(0)
  })

  it('复核点 2/6：验证失败（服务端拒绝）时回读历史，stale 退役在下一次重建如实反映', async () => {
    const { adapter, created } = await adapterWithVerifiedCandidate({
      'candidate/verify': { status: 409, body: { error: '源码已过期，候选已退役' } },
      // 失败路径会回读历史：第 3 次起服务端已把 candidate-9 退役为 stale
      history: { status: 200, body: (index: number) => ({ history: [historyItem9(index >= 2 ? 'stale' : 'active', { state: 'not-run' })] }) },
    })
    await expect(adapter.runVerification!(created)).rejects.toThrow('候选已退役')
    // 同步派生保留传入模型的 candidateStatus（设计使然）；异步动作重建时才重算——
    // 用户下一次刷新/异步操作即见 stale 生命周期如实呈现
    const observed = adapter.setDraftText(created, 'Acme 旗舰店二号')
    expect(observed.activeCandidate?.verificationRunning).toBeFalsy()
    expect(observed.activeCandidate?.verification).toBeUndefined()
    const refreshed = await adapter.refresh!(observed)
    expect(refreshed.candidateStatus).toBe('stale')
  })

  it('复核点 1 补充：刷新后服务端已退役候选时，本地绝不展示幽灵候选或旧验证', async () => {
    // A 语义：重新分析（refresh 会触发）使活跃候选退役。历史第 3 次回读（refresh）起为空。
    const { adapter, created } = await adapterWithVerifiedCandidate({
      'candidate/verify': { status: 200, body: () => verifyResponse(VERIFY_PASSED_RUN).body },
      history: { status: 200, body: (index: number) => ({ history: index >= 2 ? [] : [historyItem9('active', { state: 'not-run' })] }) },
    })
    const verified = await adapter.runVerification!(created)
    expect(verified.activeCandidate?.verification?.runId).toBe('run-42')
    const refreshed = await adapter.refresh!(verified)
    // 服务端已无活跃候选：本地候选/验证/候选预演全部清掉，状态如实为 none
    expect(refreshed.activeCandidate).toBeUndefined()
    expect(refreshed.candidateStatus).toBe('none')
    expect(refreshed.evidence.find(item => item.id === 'ev:verification')?.state).toBe('not-run')
    expect(refreshed.versions).toHaveLength(0)
  })
})
