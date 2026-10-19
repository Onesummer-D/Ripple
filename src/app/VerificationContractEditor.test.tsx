import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VerificationContractEditor } from './VerificationContractEditor'
import {
  createVerificationContractDraft,
  rebaseVerificationContractDraft,
  toBrowserVerificationContract,
  type VerificationContractDraft,
} from './verification-contract-form'

describe('VerificationContractEditor', () => {
  it('lets users declare page and interaction checks without editing JSON', () => {
    const onChange = vi.fn()
    const routes = [{ id: 'page:home', label: '首页' }, { id: 'page:story', label: '故事页' }]
    const draft = createVerificationContractDraft(routes)
    render(<VerificationContractEditor routes={routes} markerSuggestions={{}} value={draft} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('首页 页面标记文字'), { target: { value: '首页主标题' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      pages: expect.arrayContaining([expect.objectContaining({ pageRef: 'page:home', markerText: '首页主标题' })]),
    }))
    fireEvent.click(screen.getByTestId('add-verification-interaction'))
    expect(onChange).toHaveBeenLastCalledWith(expect.objectContaining({
      interactions: [expect.objectContaining({ pageRef: 'page:home', role: 'button', name: '', expectedText: '' })],
    }))
    expect(screen.queryByRole('textbox', { name: 'verification-contract' })).toBeNull()
  })

  it('copies a source-backed suggestion into the final browser contract and preserves manual markers as suggestions refresh', () => {
    const routes = [{ id: 'page:home', label: '首页' }]
    let selectedDraft: VerificationContractDraft = createVerificationContractDraft(routes)
    const onChange = vi.fn((next: VerificationContractDraft) => { selectedDraft = next })
    const view = render(<VerificationContractEditor routes={routes} markerSuggestions={{ 'page:home': ['Home baseline'] }} value={selectedDraft} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('首页 页面标记建议'), { target: { value: 'Home baseline' } })
    view.rerender(<VerificationContractEditor routes={routes} markerSuggestions={{ 'page:home': ['Home baseline'] }} value={selectedDraft} disabled={false} onChange={onChange} />)
    expect(screen.getByLabelText('首页 页面标记文字')).toHaveValue('Home baseline')

    const withPath = {
      ...selectedDraft,
      pages: selectedDraft.pages.map(page => ({ ...page, path: '/' })),
    }
    expect(toBrowserVerificationContract(withPath)?.pages).toEqual([
      { pageRef: 'page:home', path: '/', markerText: 'Home baseline' },
    ])

    const manualDraft: VerificationContractDraft = {
      ...withPath,
      pages: withPath.pages.map(page => ({ ...page, markerText: 'Manually entered home marker' })),
    }
    const callsBeforeRefresh = onChange.mock.calls.length
    view.rerender(<VerificationContractEditor routes={routes} markerSuggestions={{ 'page:home': ['New source suggestion'] }} value={manualDraft} disabled={false} onChange={onChange} />)
    expect(screen.getByLabelText('首页 页面标记文字')).toHaveValue('Manually entered home marker')
    expect(onChange).toHaveBeenCalledTimes(callsBeforeRefresh)

    const afterReanalysis = rebaseVerificationContractDraft(routes, manualDraft)
    expect(afterReanalysis.pages[0].markerText).toBe('Manually entered home marker')
    expect(toBrowserVerificationContract(afterReanalysis)?.pages[0]).toEqual({
      pageRef: 'page:home', path: '/', markerText: 'Manually entered home marker',
    })
  })
})
