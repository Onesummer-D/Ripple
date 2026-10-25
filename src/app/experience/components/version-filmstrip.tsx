import { useState } from 'react'
import type { CandidateLifecycleXp, ExperienceViewModel } from '../view-model'
import { LIFECYCLE_LABEL } from '../view-model'

/** 版本配图：胶片条使用编辑式茶器摄影，悬停缩放；无图版本回退首图。 */
const FILM_ART: Record<string, string> = {
  'v:1': 'demo-assets/workshop.jpg',
  'v:2': 'demo-assets/vessels.jpg',
  'v:3': 'demo-assets/seasonal.jpg',
  'candidate-real-1': 'demo-assets/hero-market.jpg',
}
const FILM_ART_FALLBACK = 'demo-assets/hero-market.jpg'

/** 生命周期角标图标：一眼区分已应用 / 已回滚 / 已失效。 */
const FILM_LIFECYCLE_ICON: Record<CandidateLifecycleXp, string> = {
  candidate: '◐',
  applied: '✓',
  'rolled-back': '↺',
  stale: '✕',
  discarded: '○',
}

/**
 * 版本胶片：生命周期以彩色角标压在图片左上角（图标+文字）；
 * 证据可用性独立一行：「证据可用」为可折叠角标，点开展开逐条证据明细，
 * 「无证据」红色标明。点击胶片定位到对应页面；不伪造 Git 提交或恢复成功状态。
 */
export function VersionFilmstrip({ model, activeVersionId, onSelect }: {
  model: ExperienceViewModel
  activeVersionId?: string
  onSelect: (version: ExperienceViewModel['versions'][number]) => void
}) {
  const [evOpen, setEvOpen] = useState<Record<string, boolean>>({})

  const toggleEvidence = (id: string) => {
    setEvOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return <section className="ripple-xp-filmstrip" aria-label="版本历史" data-testid="version-filmstrip">
    <div className="ripple-xp-film-head">
      <h3>版本历史</h3>
      {/* 列表本身 overflow-x 可滚，无需滚动箭头；「收起」已移除——由底部标签栏
       * （证据与解释 / 前后对照 / 历史记录）切换即可离开本面板，无需单独折叠按钮 */}
    </div>
    <ol className="ripple-xp-film-list">
      {model.versions.map(version => {
        const open = evOpen[version.id] ?? false
        return (
          <li key={version.id}>
            <button
              type="button"
              className={`ripple-xp-film-item ${activeVersionId === version.id ? 'is-active' : ''}`}
              data-testid={`version-${version.id}`}
              onClick={() => onSelect(version)}
            >
              <span className="ripple-xp-film-fig">
                <img className="ripple-xp-film-img" src={FILM_ART[version.id] ?? FILM_ART_FALLBACK} alt="" loading="lazy" />
                <span className={`ripple-xp-film-flag ripple-xp-film-flag-${version.lifecycle}`}>
                  <i aria-hidden>{FILM_LIFECYCLE_ICON[version.lifecycle]}</i>
                  {LIFECYCLE_LABEL[version.lifecycle]}
                </span>
                <span className="ripple-xp-film-cap">{version.title}</span>
              </span>
              <span className="ripple-xp-film-meta">
                <span className="ripple-xp-film-title">{version.summary}</span>
                <span className="ripple-xp-film-tags">
                  {version.evidenceAvailable ? (
                    <span
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      data-testid={`evidence-toggle-${version.id}`}
                      className="ripple-xp-film-ev ripple-xp-film-ev-ready"
                      onClick={event => { event.stopPropagation(); toggleEvidence(version.id) }}
                      onKeyDown={event => {
                        if (event.key === 'Enter' || event.key === ' ') {
                          event.preventDefault()
                          event.stopPropagation()
                          toggleEvidence(version.id)
                        }
                      }}
                    >
                      证据可用
                      <i className="ripple-xp-film-ev-fold" aria-hidden>{open ? '▴' : '▾'}</i>
                    </span>
                  ) : (
                    <span className="ripple-xp-film-ev ripple-xp-film-ev-none">无证据</span>
                  )}
                  <time>{version.updatedAt}</time>
                </span>
                {version.evidenceAvailable && open && (
                  <span className="ripple-xp-film-evlist" data-testid={`evidence-list-${version.id}`}>
                    {(version.evidenceList?.length ? version.evidenceList : ['验证截图已归档（明细未随历史接口返回）'])
                      .map((line, index) => <span key={index}>{line}</span>)}
                  </span>
                )}
              </span>
            </button>
          </li>
        )
      })}
    </ol>
  </section>
}
