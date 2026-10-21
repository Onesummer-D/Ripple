import type { ExperienceViewModel } from '../view-model'
import { LifecyclePill, SectionTitle } from './status-pill'

/**
 * 版本胶片：候选 / 已应用 / 已回滚 / 已失效 + 修改摘要 + 证据可用性。
 * 点击胶片定位到对应页面；不伪造 Git 提交或恢复成功状态。
 */
export function VersionFilmstrip({ model, activeVersionId, onSelect, onClose }: {
  model: ExperienceViewModel
  activeVersionId?: string
  onSelect: (version: ExperienceViewModel['versions'][number]) => void
  onClose: () => void
}) {
  return <section className="ripple-xp-filmstrip" aria-label="版本历史" data-testid="version-filmstrip">
    <SectionTitle aside={<button type="button" className="ripple-xp-quiet" onClick={onClose} data-testid="close-filmstrip">收起</button>}>
      版本历史
    </SectionTitle>
    <ol className="ripple-xp-film-list">
      {model.versions.map(version => (
        <li key={version.id}>
          <button
            type="button"
            className={`ripple-xp-film-item ${activeVersionId === version.id ? 'is-active' : ''}`}
            data-testid={`version-${version.id}`}
            onClick={() => onSelect(version)}
          >
            <span className="ripple-xp-film-frame" aria-hidden>
              <span className="ripple-xp-film-bar" />
              <span className="ripple-xp-film-bar" />
            </span>
            <span className="ripple-xp-film-meta">
              <strong>{version.title}</strong>
              <small>{version.updatedAt} · {version.summary}</small>
              <span className="ripple-xp-film-tags">
                <LifecyclePill lifecycle={version.lifecycle} />
                <span className={`ripple-xp-chip ${version.evidenceAvailable ? 'ripple-xp-chip-ready' : 'ripple-xp-chip-none'}`}>
                  {version.evidenceAvailable ? '证据可用' : '无证据'}
                </span>
              </span>
            </span>
          </button>
        </li>
      ))}
    </ol>
    <p className="ripple-xp-hint">版本切换只定位到对应页面与候选信息；真实的应用与恢复由同一候选补丁生命周期完成。</p>
  </section>
}
