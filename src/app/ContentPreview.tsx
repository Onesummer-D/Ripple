import { useRef, type CSSProperties } from 'react'
import type { EditableSlot } from '../domain/contracts'
import type { MediaResource } from '../adapters/mediaLibrary'

export function ContentPreview({ slot, resources }: { slot: EditableSlot; resources: Record<string, MediaResource> }) {
  const dialog = useRef<HTMLDialogElement>(null)
  if (slot.editKind === 'MEDIA') {
    const resource = slot.value.startsWith('media://') ? resources[slot.value.slice(8)] : undefined
    const src = resource?.dataUrl ?? (slot.value.startsWith('/assets/') ? slot.value : undefined)
    const ratio = slot.route === '/' ? '16 / 9' : slot.route === '/tickets' ? '1 / 1' : '4 / 5'
    return <><figure className="media-preview" style={{ aspectRatio: ratio }}>
      {src ? <img src={src} alt={resource?.name ?? slot.label} /> : <div className="media-placeholder">图片资源待接入</div>}
      {src && <button className="media-zoom" type="button" aria-label={`放大${slot.label}裁切`} onClick={() => dialog.current?.showModal()}>放大裁切</button>}
      <figcaption>{resource ? `${resource.name} · ${resource.width} × ${resource.height}` : slot.label} · cover / center</figcaption>
    </figure><dialog ref={dialog} className="crop-dialog" aria-label={`${slot.label}裁切对照`}><header><h3>{slot.label} · 裁切对照</h3><button type="button" className="ghost-button" onClick={() => dialog.current?.close()}>关闭</button></header><p>左侧展示容器中的 cover / center 裁切，右侧显示完整原图。构图是否合适由你确认。</p><div className="crop-comparison"><div><h4>当前容器 · {ratio}</h4><figure className="media-preview" style={{ aspectRatio: ratio }}>{src && <img src={src} alt="当前容器裁切" />}</figure></div><div><h4>完整原图</h4>{src && <img className="uncropped-image" src={src} alt="完整原图" />}</div></div>{resource && <p>{resource.name} · 自然尺寸 {resource.width} × {resource.height}</p>}</dialog></>
  }
  if (slot.editKind === 'TOKEN') return <div className="token-preview" style={{ '--token-color': /^#[0-9a-f]{6}$/i.test(slot.value) ? slot.value : '#8b5cf6' } as CSSProperties}>
    <span className="token-consumer">{slot.label}</span><span className="token-swatch" /><strong>{slot.value}</strong>
  </div>
  return <div className="text-preview"><span>青野文创 · {slot.route}</span><h4>{slot.value}</h4><span className="text-cta">探索秋日精选</span></div>
}
