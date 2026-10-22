import type { PageXp } from '../view-model'
import { CertaintyPill } from './status-pill'

const RELATION_LABEL: Record<PageXp['relation'], string> = {
  editing: '正在修改', 'same-source': '同源关联', unrelated: '暂无关联', unproven: '影响未证明',
}

/**
 * 左侧：页面导航 + 与当前修改的关系。
 * 当前页面高亮；关联关系与确定性一目了然。
 * 真实模式第一阶段：iframe 预演尚不支持页面切换，导航明确停用并标注未接入，
 * 绝不只是高亮变化而让用户误以为画布已经切页。
 */
export function PageRail({ pages, currentPageRef, onSelectPage, navigationDisabled }: {
  pages: PageXp[]
  currentPageRef: string
  onSelectPage: (pageRef: string) => void
  navigationDisabled?: boolean
}) {
  const ordered = [...pages].sort((a, b) => {
    const rank = (page: PageXp) => page.relation === 'editing' ? 0 : page.relation === 'same-source' ? 1 : 2
    return rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh')
  })
  return <nav className="ripple-xp-page-rail" aria-label="页面导航" data-testid="page-rail">
    <h3>页面</h3>
    {navigationDisabled && (
      <p className="ripple-xp-nav-pending" role="note" data-testid="page-nav-pending">
        真实页面导航尚未接入（第二阶段接入）：当前画布为整站预演，切换页面不影响画布。
      </p>
    )}
    <ul>
      {ordered.map(page => (
        <li key={page.id}>
          <button
            type="button"
            className={`ripple-xp-page-item ${page.id === currentPageRef ? 'is-current' : ''}`}
            aria-current={page.id === currentPageRef ? 'page' : undefined}
            aria-disabled={navigationDisabled || undefined}
            disabled={navigationDisabled}
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
  </nav>
}
