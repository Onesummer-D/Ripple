import { describe, expect, it, vi } from 'vitest'
import { act, fireEvent, render } from '@testing-library/react'
import { CandidateEditor } from './CandidateEditor'
import type { MediaResource } from '../adapters/mediaLibrary'

describe('pending image imports', () => {
  it('does not deliver a delayed upload to an editor after selection/reset unmount', async () => {
    let finish!: (resource: MediaResource) => void
    const imported = new Promise<MediaResource>((resolve) => { finish = resolve })
    const onChange = vi.fn()
    const view = render(<CandidateEditor kind="MEDIA" value="" disabled={false} resources={{}} importImage={() => imported} onChange={onChange} />)
    fireEvent.change(view.getByTestId('media-upload'), { target: { files: [new File(['x'], 'poster.png', { type: 'image/png' })] } })
    view.unmount()
    await act(async () => { finish({ id: 'delayed', name: 'poster.png', width: 400, height: 500, mimeType: 'image/png', bytes: 1, dataUrl: 'data:image/png;base64,eA==' }); await imported })
    expect(onChange).not.toHaveBeenCalled()
  })
})
