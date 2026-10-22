import type { ExperienceViewModel, PageXp } from '../view-model'
import { approvalGate, scopeSummary } from '../view-model'
import { CertaintyPill, SectionTitle } from './status-pill'

const SCOPE_LABEL: Record<PageXp['scope'], string> = { include: '包含', exclude: '排除', protect: '保护', undecided: '未决定' }

/**
 * 右侧：选中元素 + 修改意图 + 来源信息 + 范围决策。
 * unknown/partial 页面可以被查看，但不得被提升为可安全审批的范围（approvalGate 强制）。
 */
export function ScopePanel({ model, onDraftText, onPageScope, onDemoApprove }: {
  model: ExperienceViewModel
  onDraftText: (text: string) => void
  onPageScope: (pageRef: string, scope: PageXp['scope']) => void
  onDemoApprove: () => void
}) {
  const selected = model.elements.find(item => item.id === model.selectedElementId)
  const summary = scopeSummary(model.pages)
  const gate = approvalGate({ pages: model.pages, selectedElement: selected, draftAfterText: model.draftAfterText })
  const editingPage = model.pages.find(page => page.relation === 'editing')
  const sameSourcePages = model.pages.filter(page => page.relation === 'same-source')
  const unrelatedPages = model.pages.filter(page => page.relation === 'unrelated')
  const unprovenPages = model.pages.filter(page => page.relation === 'unproven')

  const scopeRow = (page: PageXp, reason: string, locked: boolean) => (
    <li key={page.id} className={`ripple-xp-scope-row ${locked ? 'is-locked' : ''}`} data-testid={`scope-row-${page.id}`}>
      <div className="ripple-xp-scope-head">
        <strong>{page.label}</strong>
        <span className="ripple-xp-scope-reason">{reason}</span>
        <CertaintyPill certainty={page.relationCertainty} />
      </div>
      <div className="ripple-xp-scope-actions" role="group" aria-label={`${page.label} 范围`}>
        {(['include', 'protect', 'exclude'] as const).map(choice => (
          <button
            key={choice}
            type="button"
            className={page.scope === choice ? 'is-active' : ''}
            aria-pressed={page.scope === choice}
            disabled={locked}
            data-testid={`scope-${choice}-${page.id}`}
            onClick={() => onPageScope(page.id, choice)}
          >
            {SCOPE_LABEL[choice]}
          </button>
        ))}
        <span className={`ripple-xp-scope-mark ripple-xp-mark-${page.scope}`}>{SCOPE_LABEL[page.scope]}</span>
      </div>
    </li>
  )

  return <aside className="ripple-xp-scope reveal" data-testid="scope-panel">
    <SectionTitle aside={selected && <CertaintyPill certainty={selected.certainty} />}>选中位置</SectionTitle>
    {selected ? (
      <div className="ripple-xp-selection-block">
        <strong>{selected.label}</strong>
        <p>来源：{selected.sourcePath ? <code>{selected.sourcePath}</code> : '运行时内容，静态来源未定位'}</p>
        {selected.unresolvedReasons.map(reason => <p key={reason} className="ripple-xp-warn">· {reason}</p>)}
        {selected.impactPageRefs.length > 0 && <p>源码证明会影响：{selected.impactPageRefs.map(ref => model.pages.find(page => page.id === ref)?.label ?? ref).join('、')}</p>}
        {selected.editable ? (
          <label className="ripple-xp-intent">
            改成
            <input
              data-testid="draft-text-input"
              value={model.draftAfterText}
              placeholder="输入修改后的文字"
              onChange={event => onDraftText(event.target.value)}
            />
          </label>
        ) : <p className="ripple-xp-warn">该元素来源未知：可以先查看，但不能承诺修改范围。</p>}
      </div>
    ) : <p>在左侧画布中悬停并点击想修改的位置。</p>}

    <SectionTitle>范围决策</SectionTitle>
    <ul className="ripple-xp-scope-list">
      {editingPage && scopeRow(editingPage, '本次修改的位置', true)}
      {sameSourcePages.map(page => scopeRow(page, '同源页面：修改会一并生效', false))}
      {unrelatedPages.map(page => scopeRow(page, '来源分析已证明本修改不影响此页', false))}
      {unprovenPages.map(page => scopeRow(page, '影响未证明：选择包含也不会被视为安全', false))}
    </ul>
    <p className="ripple-xp-scope-summary" data-testid="scope-summary">
      包含 {summary.included} · 保护 {summary.protected} · 排除 {summary.excluded} · 未决定 {summary.undecided}
    </p>

    <div className="ripple-xp-approval" data-testid="approval-area">
      {model.dataProvenance !== 'demo' ? (
        // real 模式未接入正式 Approval：不显示可执行入口，也不回演示确认。
        <p className="ripple-xp-real-approval-pending" data-testid="real-approval-pending">真实审批尚未接入（集成阶段接入）</p>
      ) : gate.allowed ? (
        <button type="button" className="ripple-xp-primary" data-testid="demo-approve" onClick={onDemoApprove}>
          演示审批（不写入真实工程）
        </button>
      ) : (
        <ul className="ripple-xp-gate-reasons">{gate.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>
      )}
    </div>
  </aside>
}
