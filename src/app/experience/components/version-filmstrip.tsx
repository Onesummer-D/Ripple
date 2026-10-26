import { useState } from 'react'
import type { CandidateLifecycleXp, ExperienceViewModel } from '../view-model'
import { LIFECYCLE_LABEL } from '../view-model'

/** 生命周期角标图标：一眼区分已应用 / 已回滚 / 已失效。 */
const FILM_LIFECYCLE_ICON: Record<CandidateLifecycleXp, string> = {
  candidate: '◐',
  applied: '✓',
  'rolled-back': '↺',
  stale: '✕',
  discarded: '○',
}

type VersionXp = ExperienceViewModel['versions'][number]

/**
 * 版本胶片。
 *
 * 结构上刻意避免交互嵌套：外层是 article（不可聚焦），「选中该版本」与
 * 「展开证据明细」是两个独立 button，各自可 Tab 聚焦、各自响应 Enter/Space，
 * 互不影响（点证据按钮不会触发版本选中）。
 *
 * 缩略图来源强制区分：演示素材图必须带「演示素材图」标注；真实模式只显示
 * 服务端归档的验证截图，缺失时渲染「未归档真实截图」占位，绝不回退 Demo 图。
 */
export function VersionFilmstrip({ model, activeVersionId, onSelect }: {
  model: ExperienceViewModel
  activeVersionId?: string
  onSelect: (version: VersionXp) => void
}) {
  const [evOpen, setEvOpen] = useState<Record<string, boolean>>({})
  const isDemo = model.dataProvenance === 'demo'

  const toggleEvidence = (id: string) => {
    setEvOpen(prev => ({ ...prev, [id]: !prev[id] }))
  }

  return <section className="ripple-xp-filmstrip" aria-label="版本历史" data-testid="version-filmstrip">
    <div className="ripple-xp-film-head">
      <h3>版本历史</h3>
      {/* 面板切换统一由底部标签栏（证据与解释 / 前后对照 / 历史记录）承担，不再设折叠按钮 */}
    </div>
    <ol className="ripple-xp-film-list">
      {model.versions.map(version => {
        const open = evOpen[version.id] ?? false
        const listId = `evidence-list-${version.id}`
        // 演示模式允许素材图；真实模式只允许 real-artifact。来源不符一律不展示图片。
        // realShot 额外要求 !isDemo：演示模式绝不允许渲染"真实截图"——即使数据被误注入
        // real-artifact 来源，也只属于真实模式的可信渲染路径。
        const art = version.thumbnail?.source === 'demo-art' && isDemo ? version.thumbnail.url : undefined
        const realShot = !isDemo && version.thumbnail?.source === 'real-artifact' ? version.thumbnail.url : undefined
        return (
          <li key={version.id}>
            <article
              className={`ripple-xp-film-item ${activeVersionId === version.id ? 'is-active' : ''}`}
              data-testid={`version-card-${version.id}`}
            >
              <button
                type="button"
                className="ripple-xp-film-select"
                data-testid={`version-${version.id}`}
                aria-current={activeVersionId === version.id}
                onClick={() => onSelect(version)}
              >
                <span className="ripple-xp-film-fig">
                  {realShot && <img className="ripple-xp-film-img" src={realShot} alt={`${version.title} 真实验证截图`} loading="lazy" data-testid={`film-shot-real-${version.id}`} />}
                  {art && !realShot && <img className="ripple-xp-film-img" src={art} alt="" loading="lazy" data-testid={`film-shot-demo-${version.id}`} />}
                  {!realShot && !art && (
                    <span className="ripple-xp-film-noshot" data-testid={`film-shot-none-${version.id}`}>
                      {isDemo ? '无演示素材图' : '未归档真实截图'}
                    </span>
                  )}
                  {art && !realShot && <span className="ripple-xp-film-srcbadge" data-testid={`film-src-demo-${version.id}`}>演示素材图</span>}
                  {realShot && <span className="ripple-xp-film-srcbadge is-real" data-testid={`film-src-real-${version.id}`}>真实截图</span>}
                  <span className={`ripple-xp-film-flag ripple-xp-film-flag-${version.lifecycle}`}>
                    <i aria-hidden>{FILM_LIFECYCLE_ICON[version.lifecycle]}</i>
                    {LIFECYCLE_LABEL[version.lifecycle]}
                  </span>
                  <span className="ripple-xp-film-cap">{version.title}</span>
                </span>
              </button>
              <div className="ripple-xp-film-meta">
                <p className="ripple-xp-film-title">{version.summary}</p>
                <div className="ripple-xp-film-tags">
                  {version.evidenceState === 'archived' && (
                    <button
                      type="button"
                      className="ripple-xp-film-ev ripple-xp-film-ev-ready"
                      data-testid={`evidence-toggle-${version.id}`}
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() => toggleEvidence(version.id)}
                    >
                      证据可用
                      <i className="ripple-xp-film-ev-fold" aria-hidden>{open ? '▴' : '▾'}</i>
                    </button>
                  )}
                  {version.evidenceState === 'metadata' && (
                    <button
                      type="button"
                      className="ripple-xp-film-ev ripple-xp-film-ev-meta"
                      data-testid={`evidence-toggle-${version.id}`}
                      aria-expanded={open}
                      aria-controls={listId}
                      onClick={() => toggleEvidence(version.id)}
                    >
                      仅有证据元数据 · 截图未归档
                      <i className="ripple-xp-film-ev-fold" aria-hidden>{open ? '▴' : '▾'}</i>
                    </button>
                  )}
                  {version.evidenceState === 'none' && (
                    <span className="ripple-xp-film-ev ripple-xp-film-ev-none">无证据</span>
                  )}
                  <time>{version.updatedAt}</time>
                </div>
                {(version.evidenceState === 'archived' || version.evidenceState === 'metadata') && open && (
                  <ul className="ripple-xp-film-evlist" id={listId} data-testid={`evidence-list-${version.id}`}>
                    {(version.evidenceList?.length
                      ? version.evidenceList
                      : ['证据明细未随历史接口返回，此处只陈述已归档/已记录的部分']
                    ).map((line, index) => <li key={index}>{line}</li>)}
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
