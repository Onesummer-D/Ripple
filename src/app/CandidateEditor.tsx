import { useEffect, useRef, useState } from 'react'
import type { EditKind } from '../domain/contracts'
import { mediaReference, type MediaResource } from '../adapters/mediaLibrary'

export const validCandidateValue = (kind: EditKind, value: string) => kind === 'TOKEN' ? /^#[0-9a-f]{6}$/i.test(value) : value.trim().length > 0

export function CandidateEditor({ kind, value, onChange, disabled, importImage, resources }: {
  kind: EditKind
  value: string
  onChange: (value: string) => void
  disabled: boolean
  importImage: (file: File) => Promise<MediaResource>
  resources: Record<string, MediaResource>
}) {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string>()
  const requestId = useRef(0)
  const onValueChange = useRef(onChange)
  onValueChange.current = onChange
  useEffect(() => () => { requestId.current += 1 }, [])
  const upload = async (file?: File) => {
    if (!file) return
    const request = ++requestId.current
    setBusy(true)
    setError(undefined)
    try {
      const resource = await importImage(file)
      if (request === requestId.current) onValueChange.current(mediaReference(resource.id))
    } catch (cause) {
      if (request === requestId.current) setError(cause instanceof Error ? cause.message : '图片导入失败')
    } finally { if (request === requestId.current) setBusy(false) }
  }
  return <div className="candidate-control">
    {kind === 'MEDIA' ? <>
      <label className="upload-control" htmlFor="media-upload">{busy ? '正在保存图片…' : '选择新海报'}<input id="media-upload" data-testid="media-upload" type="file" accept="image/png,image/jpeg,image/webp,image/gif" disabled={disabled || busy} onChange={(event) => { void upload(event.target.files?.[0]); event.target.value = '' }} /></label>
      <span className="input-help">图片保存在本机资源库 · 最大 8 MB</span>
      {Object.keys(resources).length > 0 && <select className="candidate-input" aria-label="本地海报库" data-testid="media-library" disabled={disabled || busy} value={value.startsWith('media://') ? value.slice(8) : ''} onChange={(event) => { if (event.target.value) onChange(mediaReference(event.target.value)) }}><option value="">从已保存海报中选择</option>{Object.values(resources).map((resource) => <option key={resource.id} value={resource.id}>{resource.name} · {resource.width} × {resource.height}</option>)}</select>}
    </> : <div className="color-input-row">
      {kind === 'TOKEN' && <input type="color" aria-label="候选强调色" data-testid="token-color" value={/^#[0-9a-f]{6}$/i.test(value) ? value : '#8b5cf6'} disabled={disabled} onChange={(event) => onChange(event.target.value)} />}
      <input id="candidate-input" className="candidate-input" value={value} disabled={disabled} onChange={(event) => onChange(event.target.value)} placeholder={kind === 'TOKEN' ? '#8B5CF6' : '输入新的文案'} data-testid="candidate-input" aria-label="候选值" />
    </div>}
    {error && <span role="alert" className="input-error">{error}</span>}
    {kind === 'TOKEN' && value && !validCandidateValue(kind, value) && <span className="input-error">请输入完整六位十六进制颜色</span>}
  </div>
}
