import type { PageXp, SourceCertainty } from '../view-model'
import { CERTAINTY_LABEL } from '../view-model'
import { CertaintyPill } from './status-pill'

const RELATION_LABEL: Record<PageXp['relation'], string> = {
  editing: '正在修改', 'same-source': '同源关联', unrelated: '暂无关联', unproven: '影响未证明',
}

/** 线性「页面」图标：只借参考图的图标+文字形式，不引入图片资源。 */
function PageIcon() {
  return (
    <svg className="ripple-xp-page-icon" viewBox="0 0 16 16" width="16" height="16" aria-hidden="true">
      <rect x="3" y="2" width="10" height="12" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.2" />
      <line x1="5.5" y1="5.5" x2="10.5" y2="5.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5.5" y1="8" x2="10.5" y2="8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <line x1="5.5" y1="10.5" x2="8.5" y2="10.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

const CERTAINTY_ORDER: SourceCertainty[] = ['source-proven', 'partial', 'unknown']

/**
 * 左侧：页面导航 + 与当前修改的关系 + 来源概览。
 * 参考视觉：图标菜单式导航——当前项为浅色圆角条 + 左侧墨绿短竖线；
 * 组标题右侧带页面计数；细分隔线后是与全局状态语言一致的概览统计（真实数据）。
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
  const certaintyCount = (certainty: SourceCertainty) =>
    pages.filter(page => page.relationCertainty === certainty).length
  return <nav className="ripple-xp-page-rail reveal" aria-label="页面导航" data-testid="page-rail">
    <h3><span>页面</span><span className="ripple-xp-rail-count">{pages.length}</span></h3>
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
            <PageIcon />
            <span className="ripple-xp-page-main">
              <span className="ripple-xp-page-label">{page.label}</span>
              <span className="ripple-xp-page-meta">
                <span className={`ripple-xp-relation ripple-xp-relation-${page.relation}`}>{RELATION_LABEL[page.relation]}</span>
                <CertaintyPill certainty={page.relationCertainty} />
              </span>
            </span>
          </button>
        </li>
      ))}
    </ul>
    <div className="ripple-xp-rail-overview" aria-label="网站概览">
      <h4>网站概览</h4>
      <ul>
        {CERTAINTY_ORDER.map(certainty => (
          <li key={certainty} className="ripple-xp-rail-overview-row">
            <span className={`ripple-xp-rail-dot ripple-xp-rail-dot-${certainty}`} aria-hidden="true" />
            <span className="ripple-xp-rail-overview-label">{CERTAINTY_LABEL[certainty]}</span>
            <span className="ripple-xp-rail-count">{certaintyCount(certainty)}</span>
          </li>
        ))}
      </ul>
    </div>
  </nav>
}
