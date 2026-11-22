import { afterEach, describe, expect, it, vi } from 'vitest'
import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import ProjectWorkbench from './ProjectWorkbench'

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
