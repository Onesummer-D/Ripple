import { useState } from 'react'
import type { ExperienceViewModel } from '../view-model'
import { LIFECYCLE_LABEL } from '../view-model'
import type { CandidateLifecycleXp } from '../view-model'

const FILM_LIFECYCLE_ICON: Record<CandidateLifecycleXp, string> = {
  candidate: '◐', applied: '✓', 'rolled-back': '↺', stale: '✕', discarded: '○',
}

type ThumbnailLoadState = 'loading' | 'ready' | 'failed'

function FilmThumbnail({ version, provenance, loadState, retryCount, onLoad, onError }: {
  version: ExperienceViewModel['versions'][number]
  provenance: ExperienceViewModel['dataProvenance']
  loadState: ThumbnailLoadState
  retryCount: number
  onLoad: () => void
  onError: () => void
}) {
  const thumbnail = version.thumbnail
  const isDemo = provenance === 'demo'
  const allowed = thumbnail && (isDemo
    ? thumbnail.source === 'demo-art'
    : provenance === 'real' && version.evidenceState === 'archived' && thumbnail.source === 'real-artifact')
  if (!allowed || !thumbnail) {
    return <span className="ripple-xp-film-noshot" data-testid={`film-shot-none-${version.id}`}>
      {isDemo ? '无演示素材图' : '未归档真实截图'}
    </span>
  }
  if (loadState === 'failed') {
    return <span className="ripple-xp-film-noshot is-failed" data-testid={`film-shot-failed-${version.id}`}>
      {thumbnail.source === 'real-artifact' ? '真实截图加载失败' : '演示素材图加载失败'}
    </span>
  }
  return <>
    {loadState === 'loading' && <span className="ripple-xp-film-noshot" data-testid={`film-shot-loading-${version.id}`}>
      {thumbnail.source === 'real-artifact' ? '真实截图加载中…' : '演示素材图加载中…'}
    </span>}
    <img
      key={retryCount}
      className={`ripple-xp-film-img ${loadState === 'loading' ? 'is-loading' : ''}`}
      src={thumbnail.url}
      alt={thumbnail.source === 'real-artifact' ? `${version.title} 真实验证截图` : ''}
      loading="lazy"
      data-testid={thumbnail.source === 'real-artifact' ? `film-shot-real-${version.id}` : `film-shot-demo-${version.id}`}
      onLoad={onLoad}
      onError={onError}
    />
    {loadState === 'ready' && <span
      className={`ripple-xp-film-srcbadge ${thumbnail.source === 'real-artifact' ? 'is-real' : ''}`}
      data-testid={thumbnail.source === 'real-artifact' ? `film-src-real-${version.id}` : `film-src-demo-${version.id}`}
    >{thumbnail.source === 'real-artifact' ? '真实截图' : '演示素材图'}</span>}
  </>
}

/**
 * 历史卡片的版本选择与证据展开是两个独立按钮，键盘操作互不触发。
 * Demo thumbnail 与 Real artifact 分开标注；缺图和加载失败均明确展示。
 */
export function VersionFilmstrip({ model, activeVersionId, onSelect, onClose }: {
  model: ExperienceViewModel
  activeVersionId?: string
  onSelect: (version: ExperienceViewModel['versions'][number]) => void
  onClose: () => void
}) {
  const [evOpen, setEvOpen] = useState<Record<string, boolean>>({})
  const [thumbnailStates, setThumbnailStates] = useState<Record<string, { state: ThumbnailLoadState; retryCount: number }>>({})
  const isDemo = model.dataProvenance === 'demo'

  return <section className="ripple-xp-filmstrip" aria-label="版本历史" data-testid="version-filmstrip">
    <div className="ripple-xp-film-head">
      <h3>版本历史</h3>
      <button type="button" className="ripple-xp-quiet" onClick={onClose} data-testid="close-filmstrip">收起</button>
    </div>
    <ol className="ripple-xp-film-list">
      {model.versions.map(version => {
        const open = evOpen[version.id] ?? false
        const listId = `evidence-list-${version.id}`
        const thumbnail = version.thumbnail
        const thumbnailSignature = `${version.id}:${thumbnail?.source ?? 'none'}:${thumbnail?.url ?? ''}:${model.dataProvenance}:${version.evidenceState}`
        const thumbnailStatus = thumbnailStates[thumbnailSignature] ?? { state: 'loading' as const, retryCount: 0 }
        const thumbnailAllowed = thumbnail && (isDemo
          ? thumbnail.source === 'demo-art'
          : model.dataProvenance === 'real' && version.evidenceState === 'archived' && thumbnail.source === 'real-artifact')
        const updateThumbnailState = (state: ThumbnailLoadState, retryCount = thumbnailStatus.retryCount) => {
          setThumbnailStates(previous => ({ ...previous, [thumbnailSignature]: { state, retryCount } }))
        }
        return (
          <li key={version.id}>
            <article className={`ripple-xp-film-card ${activeVersionId === version.id ? 'is-active' : ''}`} data-testid={`version-card-${version.id}`}>
              <button type="button" className="ripple-xp-film-select" data-testid={`version-${version.id}`}
                aria-current={activeVersionId === version.id} onClick={() => onSelect(version)}>
                <span className="ripple-xp-film-fig">
                  <FilmThumbnail
                    key={thumbnailSignature}
                    version={version}
                    provenance={model.dataProvenance}
                    loadState={thumbnailStatus.state}
                    retryCount={thumbnailStatus.retryCount}
                    onLoad={() => updateThumbnailState('ready')}
                    onError={() => updateThumbnailState('failed')}
                  />
                  <span className={`ripple-xp-film-flag ripple-xp-film-flag-${version.lifecycle}`}>
                    <i aria-hidden>{FILM_LIFECYCLE_ICON[version.lifecycle]}</i>{LIFECYCLE_LABEL[version.lifecycle]}
                  </span>
                  <span className="ripple-xp-film-cap">{version.title}</span>
                </span>
              </button>
              <div className="ripple-xp-film-meta">
                <p className="ripple-xp-film-title">{version.summary}</p>
                <div className="ripple-xp-film-tags">
                  {version.evidenceState !== 'none' ? (
                    <button type="button" className={`ripple-xp-film-ev ripple-xp-film-ev-${version.evidenceState}`}
                      data-testid={`evidence-toggle-${version.id}`} aria-expanded={open} aria-controls={open ? listId : undefined}
                      onClick={() => setEvOpen(previous => ({ ...previous, [version.id]: !previous[version.id] }))}>
                      {version.evidenceState === 'archived' ? (isDemo ? '演示证据可用' : '截图已归档') : '仅有证据元数据 · 截图未归档'}
                      <i className="ripple-xp-film-ev-fold" aria-hidden>{open ? '▴' : '▾'}</i>
                    </button>
                  ) : <span className="ripple-xp-film-ev ripple-xp-film-ev-none">无证据</span>}
                  <time>{version.updatedAt}</time>
                </div>
                {thumbnailAllowed && thumbnailStatus.state === 'failed' && (
                  <button
                    type="button"
                    className="ripple-xp-film-retry"
                    data-testid={`film-shot-retry-${version.id}`}
                    onClick={() => updateThumbnailState('loading', thumbnailStatus.retryCount + 1)}
                  >重试截图</button>
                )}
                {version.evidenceState !== 'none' && open && (
                  <ul className="ripple-xp-film-evlist" id={listId} data-testid={`evidence-list-${version.id}`}>
                    {(version.evidenceList?.length ? version.evidenceList : ['证据明细未随历史接口返回，未补造内容']).map((line, index) => <li key={index}>{line}</li>)}
                  </ul>
                )}
              </div>
            </article>
          </li>
        )
      })}
    </ol>
  </section>
}
