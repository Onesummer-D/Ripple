import type { PageXp } from '../view-model'
import { CertaintyPill } from './status-pill'

const RELATION_LABEL: Record<PageXp['relation'], string> = {
  editing: '正在修改', 'same-source': '同源关联', unrelated: '暂无关联', unproven: '影响未证明',
}

/**
 * 左侧：页面导航 + 与当前修改的关系。
 * 当前页面高亮；关联关系与确定性一目了然。
 */
export function PageRail({ pages, currentPageRef, onSelectPage }: {
  pages: PageXp[]
  currentPageRef: string
  onSelectPage: (pageRef: string) => void
}) {
  const ordered = [...pages].sort((a, b) => {
    const rank = (page: PageXp) => page.relation === 'editing' ? 0 : page.relation === 'same-source' ? 1 : 2
    return rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh')
  })
  return <nav className="ripple-xp-page-rail" aria-label="页面导航" data-testid="page-rail">
    <h3>页面</h3>
    <ul>
      {ordered.map(page => (
        <li key={page.id}>
          <button
            type="button"
            className={`ripple-xp-page-item ${page.id === currentPageRef ? 'is-current' : ''}`}
            aria-current={page.id === currentPageRef ? 'page' : undefined}
            data-testid={`page-item-${page.id}`}
            onClick={() => onSelectPage(page.id)}
          >
            <span className="ripple-xp-page-label">{page.label}</span>
            <span className="ripple-xp-page-meta">
              <span className={`ripple-xp-relation ripple-xp-relation-${page.relation}`}>{RELATION_LABEL[page.relation]}</span>
              <CertaintyPill certainty={page.relationCertainty} />
            </span>
          </button>
        </li>
      ))}
    </ul>
    <p className="ripple-xp-hint">「影响未证明」表示 Ripple 还不能从源码确认该页面是否受影响——它不会被当作安全范围。</p>
  </nav>
}
