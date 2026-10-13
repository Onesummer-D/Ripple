import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fixtures } from '../cases/fixtures'
import type { MediaResource } from '../adapters/mediaLibrary'
import { previewViewports } from '../preview/viewports'
import { PagePreview } from './PagePreview'

describe('preview document lifetime', () => {
  it('replaces the browsing context when restored media, scope or viewport changes', () => {
    const values = fixtures.qiguang.slots.map((slot) => slot.route === '/program' ? { ...slot, value: 'media://restored' } : slot)
    const callbacks = { onViewportChange: vi.fn(), onModeChange: vi.fn(), onRepreview: vi.fn(), onEvidence: vi.fn() }
    const base = { ...callbacks, caseId: 'qiguang' as const, route: '/program', values, viewport: previewViewports[0], mode: 'candidate' as const, hasCandidate: true, revision: 0, context: { previewMode: 'candidate' as const, previewKey: 'initial', scopeMode: 'INSTANCE' as const } }
    const view = render(<PagePreview {...base} resources={{}} />)
    const unloaded = screen.getByTestId('page-frame')
    const resource: MediaResource = { id: 'restored', name: 'poster.png', mimeType: 'image/png', bytes: 1, width: 400, height: 500, dataUrl: 'data:image/png;base64,cG9zdGVy' }
    const resources = { restored: resource }
    view.rerender(<PagePreview {...base} resources={resources} />)
    const loaded = screen.getByTestId('page-frame')
    expect(loaded).not.toBe(unloaded)
    expect(loaded.getAttribute('srcdoc')).toContain(resource.dataUrl)
    // Unrelated parent render preserves the current document and its report.
    view.rerender(<PagePreview {...base} resources={resources} />)
    expect(screen.getByTestId('page-frame')).toBe(loaded)
    const context = { ...base.context, scopeMode: 'SHARED' as const, previewKey: 'shared' }
    view.rerender(<PagePreview {...base} resources={resources} context={context} />)
    const shared = screen.getByTestId('page-frame')
    expect(shared).not.toBe(loaded)
    view.rerender(<PagePreview {...base} resources={resources} context={context} viewport={previewViewports[1]} />)
    expect(screen.getByTestId('page-frame')).not.toBe(shared)
    view.unmount()
  })
})
