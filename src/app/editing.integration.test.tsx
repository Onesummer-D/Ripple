import 'fake-indexeddb/auto'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import App from './App'
import { listMediaResources, readImage } from '../adapters/mediaLibrary'

afterEach(() => { cleanup(); vi.unstubAllGlobals() })

describe('media and token editing', () => {
  it('imports dimensions and saves a poster, previews local/shared outcomes, applies and restores', async () => {
    vi.stubGlobal('Image', class {
      src = ''
      naturalWidth = 800
      naturalHeight = 1000
      decode() { return Promise.resolve() }
    })
    render(<App />)
    fireEvent.click(screen.getByTestId('case-card-qiguang'))
    fireEvent.click(screen.getByTestId('slot-qiguang-program-poster-slot'))
    const file = new File(['poster'], 'new-poster.png', { type: 'image/png' })
    fireEvent.change(screen.getByTestId('media-upload'), { target: { files: [file] } })
    await waitFor(() => expect((screen.getByTestId('media-upload') as HTMLInputElement).disabled).toBe(false))
    const resources = await listMediaResources()
    const resource = resources.find((item) => item.name === 'new-poster.png')
    expect(resource).toMatchObject({ width: 800, height: 1000, mimeType: 'image/png', bytes: 6 })
    fireEvent.click(screen.getByTestId('create-candidate'))
    fireEvent.click(screen.getByTestId('scope-instance'))
    const layouts = screen.getByTestId('media-layout-grid')
    expect(layouts.querySelectorAll(`article > figure > img[src="${resource?.dataUrl}"]`)).toHaveLength(1)
    fireEvent.click(screen.getByTestId('scope-shared'))
    expect(layouts.querySelectorAll(`article > figure > img[src="${resource?.dataUrl}"]`)).toHaveLength(3)
    expect(layouts.querySelector('article > figure > img[src="/assets/qiguang-archive.svg"]')).not.toBeNull()
    fireEvent.click(screen.getByTestId('apply-draft'))
    expect(screen.getByTestId('history-panel')).not.toBeNull()
    fireEvent.click(screen.getByTestId('restore-previous'))
    expect(layouts.querySelectorAll('article > figure > img[src="/assets/qiguang-original.svg"]')).toHaveLength(3)
    fireEvent.click(screen.getByTestId('restore-qiguang-snapshot-1'))
    expect(layouts.querySelectorAll(`article > figure > img[src="${resource?.dataUrl}"]`)).toHaveLength(3)
    fireEvent.click(screen.getByTestId('reset-case'))
    expect(layouts.querySelectorAll('article > figure > img[src="/assets/qiguang-original.svg"]')).toHaveLength(3)
    expect((await listMediaResources()).some((item) => item.id === resource?.id)).toBe(true)
  })

  it('rejects unsupported files and prevents invalid colors; previews/clears a color candidate', async () => {
    await expect(readImage(new File(['x'], 'text.txt', { type: 'text/plain' }))).rejects.toThrow('PNG')
    render(<App />)
    fireEvent.click(screen.getByTestId('case-card-third-party'))
    fireEvent.click(screen.getByTestId('slot-thirdparty-accent-slot'))
    fireEvent.change(screen.getByTestId('candidate-input'), { target: { value: '#bad-color' } })
    expect((screen.getByTestId('create-candidate') as HTMLButtonElement).disabled).toBe(true)
    fireEvent.change(screen.getByTestId('token-color'), { target: { value: '#ff6633' } })
    fireEvent.click(screen.getByTestId('create-candidate'))
    fireEvent.click(screen.getByTestId('scope-shared'))
    expect(within(screen.getByTestId('token-consumers')).getAllByText('#ff6633')).toHaveLength(3)
    fireEvent.change(screen.getByTestId('candidate-input'), { target: { value: '#009977' } })
    expect(screen.queryByTestId('impact-panel')).toBeNull()
    expect(screen.queryByTestId('candidate-comparison')).toBeNull()
    fireEvent.click(screen.getByTestId('create-candidate'))
    fireEvent.click(screen.getByTestId('scope-instance'))
    fireEvent.click(screen.getByTestId('cancel-draft'))
    expect(within(screen.getByTestId('token-consumers')).getAllByText('#8B5CF6')).toHaveLength(3)
  })
})
