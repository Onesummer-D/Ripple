import { useRef, useState, useEffect } from 'react'
import type { ExperienceViewModel } from '../view-model'
import { LifecyclePill } from './status-pill'

/** 版本配图：胶片条使用编辑式茶器摄影，悬停缩放；无图版本回退首图。 */
const FILM_ART: Record<string, string> = {
  'v:1': 'demo-assets/workshop.jpg',
  'v:2': 'demo-assets/vessels.jpg',
  'v:3': 'demo-assets/seasonal.jpg',
  'candidate-real-1': 'demo-assets/hero-market.jpg',
}
const FILM_ART_FALLBACK = 'demo-assets/hero-market.jpg'

/**
 * 版本胶片：候选 / 已应用 / 已回滚 / 已失效 + 修改摘要 + 证据可用性。
 * smartify 式横向轮播：大图圆角矩形、左右箭头、滚动吸附。
 * 点击胶片定位到对应页面；不伪造 Git 提交或恢复成功状态。
 */
export function VersionFilmstrip({ model, activeVersionId, onSelect, onClose }: {
  model: ExperienceViewModel
  activeVersionId?: string
  onSelect: (version: ExperienceViewModel['versions'][number]) => void
  onClose: () => void
}) {
  const listRef = useRef<HTMLOListElement>(null)
  const [atStart, setAtStart] = useState(true)
  const [atEnd, setAtEnd] = useState(false)

  // 箭头可用性：跟随实际滚动位置，窗口尺寸变化时重算
  useEffect(() => {
    const list = listRef.current
    if (!list) return
    const sync = () => {
      setAtStart(list.scrollLeft <= 4)
      setAtEnd(list.scrollLeft + list.clientWidth >= list.scrollWidth - 4)
    }
    sync()
    list.addEventListener('scroll', sync, { passive: true })
    if (typeof ResizeObserver !== 'undefined') {
      const observer = new ResizeObserver(sync)
      observer.observe(list)
      return () => { list.removeEventListener('scroll', sync); observer.disconnect() }
    }
    return () => list.removeEventListener('scroll', sync)
  }, [model.versions.length])

  const scrollByPage = (direction: 1 | -1) => {
    listRef.current?.scrollBy({ left: direction * 340, behavior: 'smooth' })
  }

  return <section className="ripple-xp-filmstrip" aria-label="版本历史" data-testid="version-filmstrip">
    <div className="ripple-xp-film-head">
      <h3>版本历史</h3>
      <div className="ripple-xp-film-nav">
        <button type="button" className="ripple-xp-film-arrow" aria-label="上一组版本" disabled={atStart} onClick={() => scrollByPage(-1)}>←</button>
        <button type="button" className="ripple-xp-film-arrow" aria-label="下一组版本" disabled={atEnd} onClick={() => scrollByPage(1)}>→</button>
        <button type="button" className="ripple-xp-quiet" onClick={onClose} data-testid="close-filmstrip">收起</button>
      </div>
    </div>
    <ol className="ripple-xp-film-list" ref={listRef}>
      {model.versions.map(version => (
        <li key={version.id}>
          <button
            type="button"
            className={`ripple-xp-film-item ${activeVersionId === version.id ? 'is-active' : ''}`}
            data-testid={`version-${version.id}`}
            onClick={() => onSelect(version)}
          >
            <span className="ripple-xp-film-fig" aria-hidden>
              <img className="ripple-xp-film-img" src={FILM_ART[version.id] ?? FILM_ART_FALLBACK} alt="" loading="lazy" />
              <span className="ripple-xp-film-cap">{version.title}</span>
            </span>
            <span className="ripple-xp-film-meta">
              <span className="ripple-xp-film-title">{version.summary}</span>
              <span className="ripple-xp-film-tags">
                <LifecyclePill lifecycle={version.lifecycle} />
                <span className={`ripple-xp-chip ${version.evidenceAvailable ? 'ripple-xp-chip-ready' : 'ripple-xp-chip-none'}`}>
                  {version.evidenceAvailable ? '证据可用' : '无证据'}
                </span>
                <time>{version.updatedAt}</time>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
  </section>
}
