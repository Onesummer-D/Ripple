import type { DataProvenance, PageXp } from '../view-model'
import { CertaintyPill } from './status-pill'

const RELATION_LABEL: Record<PageXp['relation'], string> = {
  editing: '正在修改', 'same-source': '同源关联', unrelated: '暂无关联', unproven: '影响未证明',
}
const CERTAINTY_GROUPS: Array<{ certainty: PageXp['relationCertainty']; label: string }> = [
  { certainty: 'source-proven', label: '来源已证实' },
  { certainty: 'partial', label: '部分证明' },
  { certainty: 'unknown', label: '来源未知' },
]

/**
 * 左侧：页面导航 + 与当前修改的关系。
 * 当前页面高亮；关联关系与确定性一目了然。
 * 真实模式第一阶段：iframe 预演尚不支持页面切换，导航明确停用并标注未接入，
 * 绝不只是高亮变化而让用户误以为画布已经切页。
 */
export function PageRail({ pages, currentPageRef, onSelectPage, navigationDisabled, provenance = 'real' }: {
  pages: PageXp[]
  currentPageRef: string
  onSelectPage: (pageRef: string) => void
  navigationDisabled?: boolean
  provenance?: DataProvenance
}) {
  const demo = provenance === 'demo'
  const certaintyGroups = CERTAINTY_GROUPS.map(group => ({
    ...group,
    label: demo ? `DEMO · 演示关系${group.certainty === 'source-proven' ? '已设定（来源已证实）' : group.certainty === 'partial' ? '部分证明' : '未知'}` : group.label,
  }))
  const ordered = [...pages].sort((a, b) => {
    const rank = (page: PageXp) => page.relation === 'editing' ? 0 : page.relation === 'same-source' ? 1 : 2
    return rank(a) - rank(b) || a.label.localeCompare(b.label, 'zh')
  })
  const grouped = certaintyGroups.map(group => ({
    ...group,
    pages: ordered.filter(page => page.relationCertainty === group.certainty),
  }))
  return <nav className="ripple-xp-page-rail reveal" aria-label="页面导航" data-testid="page-rail">
    <h3>网站概览</h3>
    {navigationDisabled && (
      <p className="ripple-xp-nav-pending" role="note" data-testid="page-nav-pending">
        真实页面导航尚未接入（第二阶段接入）：当前画布为整站预演，切换页面不影响画布。
      </p>
    )}
    <div className="ripple-xp-overview-groups">
      {grouped.map(group => (
        <details className="ripple-xp-overview-group" key={group.certainty} open>
          <summary data-testid={`overview-toggle-${group.certainty}`}>
            <span>{group.label}</span>
            <span className="ripple-xp-overview-count">{group.pages.length}</span>
          </summary>
          <ul data-testid={`overview-list-${group.certainty}`}>
            {group.pages.length ? group.pages.map(page => (
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
                    <CertaintyPill certainty={page.relationCertainty} demo={demo} />
                  </span>
                </button>
              </li>
            )) : <li className="ripple-xp-overview-empty">暂无页面</li>}
          </ul>
        </details>
      ))}
    </div>
  </nav>
}
