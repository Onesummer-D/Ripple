import type { ExperienceViewModel, PageXp } from '../view-model'
import { approvalGate, scopeSummary } from '../view-model'
import { CertaintyPill, SectionTitle } from './status-pill'

const SCOPE_LABEL: Record<PageXp['scope'], string> = { include: '包含', exclude: '排除', protect: '保护', undecided: '未决定' }

/**
 * 右侧：选中元素 + 修改意图 + 来源信息 + 范围决策。
 * unknown/partial 页面可以被查看，但不得被提升为可安全审批的范围（approvalGate 强制）。
 */
export function ScopePanel({ model, onDraftText, onPageScope, onDemoApprove, onCreateCandidate, onToggleCandidatePreview, onRunVerification, candidateError }: {
  model: ExperienceViewModel
  onDraftText: (text: string) => void
  onPageScope: (pageRef: string, scope: PageXp['scope']) => void
  onDemoApprove: () => void
  /** 真实模式：创建真实候选（POST /candidate，服务端权威）。 */
  onCreateCandidate?: () => void
  /** 真实模式：打开/关闭候选预演。 */
  onToggleCandidatePreview?: () => void
  /** 真实模式（第二批）：运行四视口验证（POST /candidate/verify）。 */
  onRunVerification?: () => void
  /** 真实模式：候选创建/预演失败原因（如实显示）。 */
  candidateError?: string
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

  // 注意：根类名是 ripple-xp-scope-panel，不是 ripple-xp-scope——后者是整页
  // 工作台根容器的作用域类（携带 min-height:100vh / 整页 flex），右侧面板
  // 误用会继承整页高度，造成大面积空白与布局错乱。
  return <aside className="ripple-xp-scope-panel reveal" data-testid="scope-panel">
    {/* 决策面板按操作顺序组织：选中元素 → 修改内容 → 影响范围 → 阻断原因 → 候选操作 → 验证摘要 */}
    <SectionTitle aside={selected && <CertaintyPill certainty={selected.certainty} />}>选中位置</SectionTitle>
    {selected ? (
      <div className="ripple-xp-selection-block">
        <strong>{selected.label}</strong>
        <p>来源：{selected.sourcePath ? <code>{selected.sourcePath}</code> : '运行时内容，静态来源未定位'}</p>
        {selected.unresolvedReasons.map(reason => <p key={reason} className="ripple-xp-warn">· {reason}</p>)}
        {selected.impactPageRefs.length > 0 && <p>源码证明会影响：{selected.impactPageRefs.map(ref => model.pages.find(page => page.id === ref)?.label ?? ref).join('、')}</p>}
        {!selected.editable && <p className="ripple-xp-warn">该元素来源未知：可以先查看，但不能承诺修改范围。</p>}
      </div>
    ) : <p className="ripple-xp-panel-hint">在中间画布点选想要修改的位置。</p>}

    <SectionTitle>修改内容</SectionTitle>
    {selected?.editable ? (
      <label className="ripple-xp-intent">
        改成
        <input
          data-testid="draft-text-input"
          value={model.draftAfterText}
          placeholder="输入修改后的文字"
          onChange={event => onDraftText(event.target.value)}
        />
      </label>
    ) : (
      <p className="ripple-xp-panel-hint">
        {selected ? '来源未知的元素不能承诺修改，只能查看。' : '选中可修改的元素后，在这里输入修改后的文字。'}
      </p>
    )}

    <SectionTitle>影响范围</SectionTitle>
    <ul className="ripple-xp-scope-list">
      {editingPage && scopeRow(editingPage, '本次修改的位置', true)}
      {sameSourcePages.map(page => scopeRow(page, '同源页面：修改会一并生效', false))}
      {unrelatedPages.map(page => scopeRow(page, '来源分析已证明本修改不影响此页', false))}
      {unprovenPages.map(page => scopeRow(page, '影响未证明：选择包含也不会被视为安全', false))}
    </ul>
    <p className="ripple-xp-scope-summary" data-testid="scope-summary">
      包含 {summary.included} · 保护 {summary.protected} · 排除 {summary.excluded} · 未决定 {summary.undecided}
    </p>

    <SectionTitle>候选操作</SectionTitle>
    <div className="ripple-xp-approval" data-testid="approval-area">
      {model.dataProvenance !== 'demo' ? (
        model.activeCandidate ? (
          // 候选已创建：提供候选预演（真实地址来自服务端响应）；审批/应用/回滚后续批次接入
          <div className="ripple-xp-candidate-box" data-testid="candidate-box">
            <span className="ripple-xp-candidate-id">
              活跃候选 <code>{model.activeCandidate.candidateId.slice(0, 18)}…</code>
              {model.activeCandidate.patchHash && ` · 补丁 ${model.activeCandidate.patchHash.slice(0, 12)}…`}
            </span>
            <button
              type="button"
              className="ripple-xp-primary"
              data-testid="candidate-preview-toggle"
              disabled={model.activeCandidate.previewLoading}
              onClick={onToggleCandidatePreview}
            >
              {model.activeCandidate.previewUrl
                ? '关闭候选预演'
                : model.activeCandidate.previewLoading ? '候选预演加载中…' : '打开候选预演'}
            </button>
            {model.activeCandidate.previewUrl && <p className="ripple-xp-candidate-note">候选预演为真实浏览器会话，隔离属性与项目预演一致。</p>}
            {onRunVerification && (
              <button
                type="button"
                className="ripple-xp-primary"
                data-testid="run-verification"
                disabled={model.activeCandidate.verificationRunning}
                onClick={onRunVerification}
              >
                {model.activeCandidate.verificationRunning
                  ? '四视口验证运行中…'
                  : model.activeCandidate.verification?.runId ? '重新运行四视口验证' : '运行四视口验证'}
              </button>
            )}
            {model.activeCandidate.verification && (
              <div className="ripple-xp-verification" data-testid="verification-status">
                <p className="ripple-xp-verification-head">
                  验证{model.activeCandidate.verification.stateLabel}
                  {model.activeCandidate.verification.runId && <> · 运行 <code>{model.activeCandidate.verification.runId.slice(0, 12)}…</code></>}
                  {model.activeCandidate.verification.recordHash && <> · 记录 <code>{model.activeCandidate.verification.recordHash.slice(0, 12)}…</code></>}
                </p>
                {model.activeCandidate.verification.reason && <p className="ripple-xp-candidate-note">{model.activeCandidate.verification.reason}</p>}
                {model.activeCandidate.verification.assertions.length > 0 && (
                  <p className="ripple-xp-candidate-note">
                    断言 {model.activeCandidate.verification.assertions.filter(item => item.result === 'pass').length}/{model.activeCandidate.verification.assertions.length} 通过
                  </p>
                )}
                {model.activeCandidate.verification.shots.length > 0 && (
                  <div className="ripple-xp-verification-shots" data-testid="verification-shots">
                    {model.activeCandidate.verification.shots.map(shot => (
                      <figure key={`${shot.viewportWidth}x${shot.viewportHeight}`}>
                        {shot.imageUrl
                          ? <img src={shot.imageUrl} alt={`候选验证截图 ${shot.viewportWidth}×${shot.viewportHeight}`} />
                          : <figcaption>{shot.reason ?? '本视口未生成截图。'}</figcaption>}
                        <figcaption>{shot.viewportWidth} × {shot.viewportHeight} · {shot.result}{shot.runtimeState ? ` · ${shot.runtimeState}` : ''}</figcaption>
                      </figure>
                    ))}
                  </div>
                )}
                {model.activeCandidate.verification.visualEvidences.length > 0 && (
                  <ul className="ripple-xp-visual-evidences" data-testid="visual-evidences">
                    {model.activeCandidate.verification.visualEvidences.map(entry => (
                      <li key={entry.checkId}>
                        视觉证据 {entry.route} · {entry.view?.stateLabel ?? entry.result}
                        {entry.resultReason ? ` · ${entry.resultReason}` : ''}
                        {entry.view?.summary && <span className="ripple-xp-visual-summary">{entry.view.summary}</span>}
                        {(entry.view?.crossVersion?.pairs ?? []).map((pair, index) => (
                          // A/E 合同：proofLabel 必须逐字渲染，不得以任何形式升级为"实例级已证明"
                          <span key={index} className="ripple-xp-visual-proof">{pair.proofLabel ?? '未证实配对（需人工复核）'}</span>
                        ))}
                      </li>
                    ))}
                  </ul>
                )}
                <p className="ripple-xp-candidate-note">验证结果由服务端 VerificationRun 生成；审批严格绑定此运行与补丁哈希（审批批次接入）。</p>
              </div>
            )}
            <p className="ripple-xp-real-approval-pending" data-testid="real-approval-pending">真实审批尚未接入（审批批次接入）</p>
          </div>
        ) : (
          <>
            {/* 风险与阻断原因先于候选操作展示：先说明为什么还不能生成，再给操作入口 */}
            {!gate.allowed && <ul className="ripple-xp-gate-reasons">{gate.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
            <button
              type="button"
              className="ripple-xp-primary"
              data-testid="create-candidate"
              disabled={!gate.allowed}
              onClick={onCreateCandidate}
            >
              生成真实候选
            </button>
            {candidateError && <p className="ripple-xp-candidate-error" role="alert" data-testid="candidate-error">{candidateError}</p>}
            <p className="ripple-xp-real-approval-pending" data-testid="real-approval-pending">真实审批尚未接入（验证/审批批次接入）</p>
          </>
        )
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
