import { act, renderHook } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'
import { fixtures } from '../cases/fixtures'
import { previewViewports } from '../preview/viewports'
import { usePreviewMeasurement } from './usePreviewMeasurement'

describe('preview message lifecycle', () => {
  it('accepts only current iframe/request and clears old results on context change', () => {
    const iframe = document.createElement('iframe')
    document.body.appendChild(iframe)
    const frame = { current: iframe }
    const send = vi.spyOn(iframe.contentWindow!, 'postMessage')
    const onEvidence = vi.fn()
    const base = { frame, caseId: 'qingye' as const, route: '/', viewport: previewViewports[0], values: fixtures.qingye.slots, context: { previewMode: 'candidate' as const }, onEvidence }
    const hook = renderHook(({ requestKey }) => usePreviewMeasurement({ ...base, requestKey }), { initialProps: { requestKey: 'first' } })
    const requestId = (send.mock.calls.at(-1)?.[0] as { requestId: string }).requestId
    const slot = fixtures.qingye.slots[0]
    const message = { type: 'ripple:measurement', requestId, caseId: 'qingye', route: '/', width: 375, height: 812, measuredAt: new Date().toISOString(), slots: [{ slotId: slot.id, instanceId: slot.instanceId, sourceId: slot.sourceId, rect: { x: 0, y: 0, width: 100, height: 50 } }] }
    act(() => window.dispatchEvent(new MessageEvent('message', { source: window, data: message })))
    expect(hook.result.current.evidence).toBeUndefined()
    act(() => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, data: message })))
    expect(hook.result.current.evidence?.measurement?.width).toBe(375)
    hook.rerender({ requestKey: 'second' })
    expect(hook.result.current.evidence).toBeUndefined()
    act(() => window.dispatchEvent(new MessageEvent('message', { source: iframe.contentWindow, data: message })))
    expect(hook.result.current.evidence).toBeUndefined()
    hook.unmount()
    iframe.remove()
  })
})
