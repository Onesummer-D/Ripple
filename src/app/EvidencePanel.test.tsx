import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { fixtures } from '../cases/fixtures'
import { EvidencePanel } from './EvidencePanel'

beforeEach(() => {
  Object.defineProperty(HTMLDialogElement.prototype, 'showModal', { configurable: true, value() { this.setAttribute('open', '') } })
  Object.defineProperty(HTMLDialogElement.prototype, 'close', { configurable: true, value() { this.removeAttribute('open'); this.dispatchEvent(new Event('close')) } })
})
afterEach(() => { cleanup(); vi.unstubAllGlobals(); delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).showModal; delete (HTMLDialogElement.prototype as Partial<HTMLDialogElement>).close })

describe('Evidence navigation', () => {
  it('loads a served file, opens details and focuses its route without changing candidate state', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'application/json' }), text: async () => '{"origin":"fixture"}' })))
    const item = fixtures.qingye.evidence[0]
    const focus = vi.fn()
    render(<EvidencePanel evidence={[item]} onFocus={focus} />)
    fireEvent.click(screen.getByTestId(`evidence-${item.id}`))
    await screen.findByRole('link', { name: '打开证据文件' })
    expect(screen.getByText('{"origin":"fixture"}')).not.toBeNull()
    fireEvent.click(screen.getByTestId('focus-evidence-route'))
    expect(focus).toHaveBeenCalledWith(item)
    await waitFor(() => expect(screen.queryByTestId('evidence-details')).toBeNull())
  })

  it('does not fetch unknown or loading proof; unavailable HTML fallback is not a source file', async () => {
    const fetchMock = vi.fn(async () => ({ ok: true, headers: new Headers({ 'content-type': 'text/html' }), text: async () => '<html>SPA fallback</html>' }))
    vi.stubGlobal('fetch', fetchMock)
    const unknown = fixtures['third-party'].evidence[1]
    const loading = { ...fixtures.qingye.evidence[0], id: 'E-LOADING', verification: 'loading' as const, origin: 'real' as const }
    render(<EvidencePanel evidence={[unknown, loading, fixtures.qingye.evidence[0]]} onFocus={() => {}} />)
    fireEvent.click(screen.getByTestId(`evidence-${unknown.id}`))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.queryByRole('link')).toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByTestId('evidence-E-LOADING'))
    expect(fetchMock).not.toHaveBeenCalled()
    expect(screen.getByText('该证据仍在加载，检测结果尚未就绪。')).not.toBeNull()
    fireEvent.click(screen.getByRole('button', { name: '关闭' }))
    fireEvent.click(screen.getByTestId(`evidence-${fixtures.qingye.evidence[0].id}`))
    await screen.findByText('证据文件尚未放入可访问的资源目录。')
    expect(screen.queryByRole('link')).toBeNull()
  })
})
