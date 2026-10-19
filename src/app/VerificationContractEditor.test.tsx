import { describe, expect, it, vi } from 'vitest'
import { fireEvent, render, screen } from '@testing-library/react'
import { VerificationContractEditor } from './VerificationContractEditor'
import { createVerificationContractDraft } from './verification-contract-form'

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

  it('copies a source-backed suggestion into the page marker field without treating it as evidence', () => {
    const routes = [{ id: 'page:home', label: '首页' }]
    const onChange = vi.fn()
    const draft = createVerificationContractDraft(routes)
    render(<VerificationContractEditor routes={routes} markerSuggestions={{ 'page:home': ['Home baseline'] }} value={draft} disabled={false} onChange={onChange} />)

    fireEvent.change(screen.getByLabelText('首页 页面标记建议'), { target: { value: 'Home baseline' } })
    expect(onChange).toHaveBeenCalledWith(expect.objectContaining({
      pages: [expect.objectContaining({ pageRef: 'page:home', markerText: 'Home baseline' })],
    }))
    expect(screen.getByText(/不是浏览器证据/)).toBeTruthy()
  })
})
