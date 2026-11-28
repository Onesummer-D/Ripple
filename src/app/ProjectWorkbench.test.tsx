import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProjectWorkbench from './ProjectWorkbench'
import { ReadOnlyAnalysisPanel } from './ReadOnlyAnalysisPanel'

describe('Project-first workbench surface', () => {
  it('starts with a real local-project flow and does not present Fixture data as project state', () => {
    render(<ProjectWorkbench />)
    expect(screen.getByRole('heading', { name: /从真实源码开始/ })).toBeTruthy()
    expect(screen.getByLabelText('Git 项目目录')).toBeTruthy()
    expect((screen.getByRole('button', { name: /分析工程/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/Qingye|Qiguang|第三方案例|CaseFixture/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /应用|批准|浏览器预演/ })).toBeNull()
    expect(screen.queryByTestId('verification-contract')).toBeNull()
  })
})

const sourceDigest = 'a'.repeat(64)
const graphDigest = 'b'.repeat(64)
const summary = {
  projectId: 'project:one', sourceDigest, graphDigest, mappingCount: 252, unresolvedCount: 253,
  hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence',
}

function deferred() {
  let resolve!: (response: Response) => void
  const promise = new Promise<Response>(finish => { resolve = finish })
  return { promise, resolve }
}

function mockWorkbench(...responses: Array<Response | Promise<Response>>) {
  const readonly = vi.fn().mockImplementation(() => {
    if (!responses.length) throw new Error('Unexpected read-only analysis request')
    return responses.shift()
  })
  vi.stubGlobal('fetch', vi.fn((url: string, init?: RequestInit) => {
    if (url === '/__ripple/api/history') return Promise.resolve(Response.json({ history: [] }))
    if (url.startsWith('/__ripple/api/project/read-only-history?')) {
      const projectId = new URL(`http://test${url}`).searchParams.get('projectId') ?? 'project:one'
      return Promise.resolve(Response.json({ schemaVersion: 'ripple/read-only-analysis-history/v1', projectId, records: [] }))
    }
    if (url === '/__ripple/api/project/read-only-history/capture') return Promise.resolve(new Response(JSON.stringify({ schemaVersion: 'ripple/read-only-analysis-history/v1', recordId: 'record-test', deduplicated: false }), { status: 201, headers: { 'content-type': 'application/json' } }))
    if (url === '/__ripple/api/analyze') {
      const { projectRoot } = JSON.parse(String(init?.body))
      const projectId = projectRoot === 'second-project' ? 'project:two' : 'project:one'
      return Promise.resolve(Response.json({
        projectRoot, revision: { projectId, sourceDigest, gitCommit: 'commit', runtimeFingerprint: 'runtime' },
        graphId: projectId, unresolved: [], routes: [], components: [], targets: [], relationCounts: {},
        previewResources: { referencedUrls: [], authorizedUrls: [] },
      }))
    }
    if (url === '/__ripple/api/project/read-only-analysis') return readonly(init)
    throw new Error('Unexpected URL')
  }))
  return readonly
}

async function openProject(directory: string) {
  fireEvent.change(screen.getByLabelText('Git 项目目录'), { target: { value: directory } })
  fireEvent.click(screen.getByTestId('analyze-project'))
  await screen.findByTestId('read-only-analysis-panel')
  await waitFor(() => {
    expect((screen.getByRole('button', { name: '运行只读分析' }) as HTMLButtonElement).disabled).toBe(false)
  })
}

const panel = () => within(screen.getByTestId('read-only-analysis-panel'))
const run = () => fireEvent.click(panel().getByRole('button', { name: '运行只读分析' }))

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

describe('Read-only project analysis', () => {
  it('distinguishes history loading from empty history and rejects malformed protocol data', async () => {
    const pending = deferred()
    vi.stubGlobal('fetch', vi.fn((url: string) => {
      if (url.startsWith('/__ripple/api/project/read-only-history?')) return pending.promise
      throw new Error(`Unexpected URL: ${url}`)
    }))
    render(<ReadOnlyAnalysisPanel projectId="project:one" sourceDigest={sourceDigest} opening={false} />)
    const readOnly = within(screen.getByTestId('read-only-analysis-panel'))
    expect(readOnly.getByTestId('read-only-history-loading').textContent).toContain('正在加载历史')
    pending.resolve(Response.json({ schemaVersion: 'ripple/read-only-analysis-history/v1', projectId: 'project:one', records: [{ recordId: 'malformed' }] }))
    await readOnly.findByTestId('read-only-history-error')
    expect(readOnly.getByTestId('read-only-history-error').textContent).toContain('历史服务返回了无效数据')
    expect(readOnly.queryByText('暂无保存记录。')).toBeNull()
  })

  it('captures trusted history and compares two immutable records locally', async () => {
    const records = [
      { schemaVersion: 'ripple/read-only-analysis-history/v1', recordId: 'record-b', capturedAt: '2026-11-25T01:00:00Z', projectId: 'project:one', repository: 'fixture/repo', gitHead: 'b'.repeat(40), rootTree: '2'.repeat(40), sourceDigest: 'c'.repeat(64), graphDigest: 'd'.repeat(64), mappingCount: 4, unresolvedCount: 1, hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence' },
      { schemaVersion: 'ripple/read-only-analysis-history/v1', recordId: 'record-a', capturedAt: '2026-11-24T01:00:00Z', projectId: 'project:one', repository: 'fixture/repo', gitHead: 'a'.repeat(40), rootTree: '1'.repeat(40), sourceDigest, graphDigest, mappingCount: 2, unresolvedCount: 3, hostReceiptStatus: 'verified', producerEvidenceStatus: 'available-producer-evidence' },
    ]
    const fetchMock = vi.fn((url: string, init?: RequestInit) => {
      if (url.startsWith('/__ripple/api/project/read-only-history?')) return Promise.resolve(Response.json({ schemaVersion: 'ripple/read-only-analysis-history/v1', projectId: 'project:one', records }))
      if (url === '/__ripple/api/project/read-only-history/capture') {
        expect(JSON.parse(String(init?.body))).toEqual({ projectId: 'project:one' })
        return Promise.resolve(new Response(JSON.stringify({ schemaVersion: 'ripple/read-only-analysis-history/v1', recordId: 'record-b', deduplicated: true }), { status: 200, headers: { 'content-type': 'application/json' } }))
      }
      if (url === '/__ripple/api/project/read-only-analysis') return Promise.resolve(Response.json(summary))
      throw new Error(`Unexpected URL: ${url}`)
    })
    vi.stubGlobal('fetch', fetchMock)
    render(<ReadOnlyAnalysisPanel projectId="project:one" sourceDigest={sourceDigest} opening={false} />)
    const readOnly = within(screen.getByTestId('read-only-analysis-panel'))
    await waitFor(() => expect(readOnly.getAllByRole('checkbox')).toHaveLength(2))
    fireEvent.click(readOnly.getByRole('button', { name: '运行只读分析' }))
    await readOnly.findByRole('heading', { name: /内容摘要.*content-only/ })
    fireEvent.click(readOnly.getByRole('button', { name: '保存分析记录' }))
    await readOnly.findByTestId('read-only-history-saved')
    fireEvent.click(readOnly.getAllByRole('checkbox')[0])
    fireEvent.click(readOnly.getAllByRole('checkbox')[1])
    expect(readOnly.getByTestId('read-only-analysis-comparison').textContent).toContain('Git HEAD：已变化')
    expect(readOnly.getByTestId('read-only-analysis-comparison').querySelectorAll('.is-changed').length).toBeGreaterThan(0)
    expect(readOnly.getByTestId('read-only-analysis-comparison').querySelectorAll('.is-count-delta').length).toBe(1)
    fireEvent.click(readOnly.getAllByText('展开版本身份')[0])
    expect(readOnly.getAllByRole('button', { name: '复制SourceDigest' })).toHaveLength(2)
  })

  it('uses the opened project ID, suppresses duplicates and displays content and evidence separately', async () => {
    const pending = deferred()
    const request = mockWorkbench(pending.promise)
    render(<ProjectWorkbench />)
    expect(screen.queryByTestId('read-only-analysis-panel')).toBeNull()
    await openProject('first-project')
    run()
    const button = panel().getByRole('button', { name: '正在运行…' }) as HTMLButtonElement
    expect(button.disabled).toBe(true)
    fireEvent.click(button)
    expect(request).toHaveBeenCalledTimes(1)
    expect(JSON.parse(request.mock.calls[0][0].body)).toEqual({ projectId: 'project:one' })
    expect((screen.getByTestId('toggle-project-preview') as HTMLButtonElement).disabled).toBe(false)
    pending.resolve(Response.json(summary))
    await panel().findByRole('heading', { name: /内容摘要.*content-only/ })
    expect(panel().getByRole('heading', { name: '来源证明' })).toBeTruthy()
    for (const value of Object.values(summary)) expect(panel().getByText(String(value), { exact: true })).toBeTruthy()
  })

  it.each([
    ['project-unregistered', 404],
    ['host-config-unavailable', 503],
    ['analysis-failed', 503],
    ['project-drift', 409],
    ['host-receipt-rejected', 409],
    ['producer-evidence-unavailable', 503],
  ])('shows %s without retaining a previous success', async (code, status) => {
    mockWorkbench(Response.json(summary), Response.json({ code, graphDigest }, { status }))
    render(<ProjectWorkbench />)
    await openProject('first-project')
    run()
    await panel().findByText(graphDigest)
    run()
    expect((await panel().findByRole('alert')).textContent).toContain(code)
    expect(panel().queryByText(graphDigest)).toBeNull()
    expect(panel().getByRole('button', { name: '运行只读分析' })).toBeTruthy()
  })

  it.each(['first-project', 'second-project'])('clears and cancels analysis when opening %s again', async directory => {
    const pending = deferred()
    const request = mockWorkbench(Response.json(summary), pending.promise)
    render(<ProjectWorkbench />)
    await openProject('first-project')
    run()
    await panel().findByText(graphDigest)
    await openProject(directory)
    expect(panel().queryByText(graphDigest)).toBeNull()
    run()
    const signal = request.mock.calls[1][0].signal as AbortSignal
    expect(signal.aborted).toBe(false)
    await openProject('first-project')
    expect(signal.aborted).toBe(true)
    await act(async () => pending.resolve(Response.json(summary)))
    expect(panel().queryByText(graphDigest)).toBeNull()
  })

  it.each([
    { projectId: 'project:other' },
    { sourceDigest: 'c'.repeat(64) },
    { hostReceiptStatus: 'unavailable' },
  ])('rejects success data with an unexpected binding or evidence status', async changed => {
    mockWorkbench(Response.json({ ...summary, ...changed }))
    render(<ProjectWorkbench />)
    await openProject('first-project')
    run()
    expect((await panel().findByRole('alert')).textContent).toMatch(/返回结果与当前工程版本不一致/)
    expect(panel().queryByText(graphDigest)).toBeNull()
  })
})
