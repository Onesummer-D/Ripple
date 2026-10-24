import { useState } from 'react'
import type { ExperienceViewModel, PageXp, VerificationContractInteractionXp } from '../view-model'
import { approvalGate, scopeSummary } from '../view-model'
import { CertaintyPill, SectionTitle } from './status-pill'

const SCOPE_LABEL: Record<PageXp['scope'], string> = { include: '包含', exclude: '排除', protect: '保护', undecided: '未决定' }

/**
 * 右侧：选中元素 + 修改意图 + 来源信息 + 范围决策。
 * unknown/partial 页面可以被查看，但不得被提升为可安全审批的范围（approvalGate 强制）。
 */
export function ScopePanel({ model, onDraftText, onPageScope, onDemoApprove, onCreateCandidate, onToggleCandidatePreview, onRunVerification, onApproveCandidate, onApplyCandidate, onRollbackCandidate, onContractMarker, onContractInteractions, candidateError }: {
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
  /** 真实模式（第三批）：审批（POST /candidate/approve，绑定最新 passed 验证的 runId）。 */
  onApproveCandidate?: () => void
  /** 真实模式（第三批）：应用（POST /candidate/apply，两步确认后执行）。 */
  onApplyCandidate?: () => void
  /** 真实模式（第三批）：回滚（POST /candidate/rollback，两步确认后执行）。 */
  onRollbackCandidate?: () => void
  /** 联合验收批次：编辑验证合同页面标记。 */
  onContractMarker?: (pageRef: string, markerText: string) => void
  /** 联合验收批次：整体替换验证合同交互声明（用户显式声明）。 */
  onContractInteractions?: (interactions: VerificationContractInteractionXp[]) => void
  /** 真实模式：候选创建/预演/验证/生命周期失败原因（如实显示）。 */
  candidateError?: string
}) {
  // 应用/回滚的两步确认：第一次点击只进入确认态，第二次点击才真正提交
  const [confirmAction, setConfirmAction] = useState<'apply' | 'rollback' | ''>('')
  // 验证合同交互声明表单（本地草稿；提交时整体写入模型）
  const [interactionDraft, setInteractionDraft] = useState<{ pageRef: string; role: 'button' | 'link'; name: string; expectedText: string }>({ pageRef: '', role: 'button', name: '', expectedText: '' })
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
                  // 七项断言及具体阻断原因逐条如实展示：未通过项不得隐藏
                  <ul className="ripple-xp-assertions" data-testid="verification-assertions">
                    {model.activeCandidate.verification.assertions.map(assertion => (
                      <li key={assertion.id} data-result={assertion.result}>
                        <span className={`ripple-xp-assertion-mark ${assertion.result === 'pass' ? 'is-pass' : 'is-fail'}`}>
                          {assertion.result === 'pass' ? '通过' : '未通过'}
                        </span>
                        {' '}{assertion.id}{assertion.detail ? `：${assertion.detail}` : ''}
                      </li>
                    ))}
                  </ul>
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
                <p className="ripple-xp-candidate-note">验证结果由服务端 VerificationRun 生成；审批严格绑定此运行 ID 与补丁哈希。</p>
              </div>
            )}
            {onApproveCandidate && (() => {
              const candidate = model.activeCandidate
              const lifecycle = candidate.lifecycle ?? 'active'
              const busy = candidate.lifecycleBusy
              const verification = candidate.verification
              const approveOpen = !!onApproveCandidate && !busy && lifecycle === 'active'
              const canApprove = approveOpen && verification?.state === 'passed' && !!verification.runId
              return (
                <div className="ripple-xp-lifecycle" data-testid="lifecycle-actions">
                  {lifecycle === 'active' && (
                    <button
                      type="button"
                      className="ripple-xp-primary"
                      data-testid="approve-candidate"
                      disabled={!canApprove}
                      onClick={onApproveCandidate}
                    >
                      {busy === 'approving' ? '审批提交中…' : '审批此候选'}
                    </button>
                  )}
                  {approveOpen && !canApprove && (
                    <p className="ripple-xp-candidate-note" data-testid="approve-blocked-reason">
                      审批未开放：{verification ? `最新验证为「${verification.stateLabel}」，须全部断言通过后才能审批` : '四视口验证尚未运行'}
                    </p>
                  )}
                  {lifecycle === 'approved' && (
                    <>
                      <button
                        type="button"
                        className="ripple-xp-primary"
                        data-testid="apply-candidate"
                        disabled={busy === 'applying'}
                        onClick={() => {
                          if (confirmAction !== 'apply') { setConfirmAction('apply'); return }
                          setConfirmAction('')
                          onApplyCandidate?.()
                        }}
                      >
                        {busy === 'applying' ? '应用提交中…' : confirmAction === 'apply' ? '确认应用到真实工程？' : '应用到真实工程'}
                      </button>
                      {confirmAction === 'apply' && (
                        <button type="button" className="ripple-xp-quiet" data-testid="apply-cancel" onClick={() => setConfirmAction('')}>取消</button>
                      )}
                    </>
                  )}
                  {lifecycle === 'applied' && (
                    <>
                      <button
                        type="button"
                        className="ripple-xp-primary"
                        data-testid="rollback-candidate"
                        disabled={busy === 'rolling-back' || candidate.rollbackAvailable === false}
                        onClick={() => {
                          if (confirmAction !== 'rollback') { setConfirmAction('rollback'); return }
                          setConfirmAction('')
                          onRollbackCandidate?.()
                        }}
                      >
                        {busy === 'rolling-back' ? '回滚提交中…' : confirmAction === 'rollback' ? '确认回滚此修改？' : '回滚此修改'}
                      </button>
                      {confirmAction === 'rollback' && (
                        <button type="button" className="ripple-xp-quiet" data-testid="rollback-cancel" onClick={() => setConfirmAction('')}>取消</button>
                      )}
                      {candidate.rollbackAvailable === false && (
                        <p className="ripple-xp-candidate-note" data-testid="rollback-blocked-reason">服务端已确认此候选当前不可回滚（源码在应用后发生变化）。</p>
                      )}
                    </>
                  )}
                  <p className="ripple-xp-lifecycle-status" data-testid="lifecycle-status">
                    {lifecycle === 'approved' && candidate.approval
                      ? <>已审批 · 绑定运行 <code>{candidate.approval.verificationRunId.slice(0, 12)}…</code></>
                      : lifecycle === 'applied'
                        ? `已应用${candidate.appliedAt ? ` · ${candidate.appliedAt.slice(0, 16).replace('T', ' ')}` : ''} · 修改已写入真实工程`
                        : lifecycle === 'rolled-back'
                          ? '已回滚 · 工程源码已恢复'
                          : '候选活动 · 验证通过后开放审批'}
                  </p>
                  {candidateError && <p className="ripple-xp-candidate-error" role="alert" data-testid="candidate-error">{candidateError}</p>}
                </div>
              )
            })()}
          </div>
        ) : (
          <>
            {model.verificationContract && onContractInteractions && (
              <div className="ripple-xp-contract" data-testid="verification-contract">
                <p className="ripple-xp-candidate-note">
                  验证合同：创建候选时绑定，四视口验证按它核对每页标记与交互。标记取分析建议、可改；交互由你显式声明，不声明则交互断言保持未证实。
                </p>
                <ul className="ripple-xp-contract-pages">
                  {model.verificationContract.pages.map(page => (
                    <li key={page.pageRef}>
                      <label>
                        <code>{page.path}</code> 页面标记
                        <input
                          data-testid={`contract-marker-${page.pageRef}`}
                          value={page.markerText}
                          onChange={event => onContractMarker?.(page.pageRef, event.target.value)}
                        />
                      </label>
                    </li>
                  ))}
                </ul>
                {model.verificationContract.interactions.length > 0 && (
                  <ul className="ripple-xp-contract-interactions">
                    {model.verificationContract.interactions.map((interaction, index) => (
                      <li key={index} data-testid={`contract-interaction-${index}`}>
                        <span>{model.pages.find(page => page.id === interaction.pageRef)?.label ?? interaction.pageRef} · {interaction.role === 'button' ? '按钮' : '链接'}「{interaction.name}」→ 「{interaction.expectedText}」</span>
                        <button
                          type="button"
                          className="ripple-xp-quiet"
                          data-testid={`contract-interaction-remove-${index}`}
                          onClick={() => onContractInteractions(model.verificationContract!.interactions.filter((_, itemIndex) => itemIndex !== index))}
                        >
                          移除
                        </button>
                      </li>
                    ))}
                  </ul>
                )}
                <form
                  className="ripple-xp-contract-form"
                  onSubmit={event => {
                    event.preventDefault()
                    if (!interactionDraft.name.trim() || !interactionDraft.expectedText.trim()) return
                    onContractInteractions([
                      ...model.verificationContract!.interactions,
                      {
                        pageRef: interactionDraft.pageRef || model.verificationContract!.pages[0]?.pageRef || '',
                        role: interactionDraft.role,
                        name: interactionDraft.name.trim(),
                        expectedText: interactionDraft.expectedText.trim(),
                      },
                    ])
                    setInteractionDraft({ pageRef: interactionDraft.pageRef, role: interactionDraft.role, name: '', expectedText: '' })
                  }}
                >
                  <select
                    data-testid="contract-interaction-page"
                    value={interactionDraft.pageRef || model.verificationContract.pages[0]?.pageRef || ''}
                    onChange={event => setInteractionDraft({ ...interactionDraft, pageRef: event.target.value })}
                  >
                    {model.verificationContract.pages.map(page => <option key={page.pageRef} value={page.pageRef}>{page.path}</option>)}
                  </select>
                  <select
                    data-testid="contract-interaction-role"
                    value={interactionDraft.role}
                    onChange={event => setInteractionDraft({ ...interactionDraft, role: event.target.value as 'button' | 'link' })}
                  >
                    <option value="button">按钮</option>
                    <option value="link">链接</option>
                  </select>
                  <input
                    data-testid="contract-interaction-name"
                    value={interactionDraft.name}
                    placeholder="控件名称（如：展开服务详情）"
                    onChange={event => setInteractionDraft({ ...interactionDraft, name: event.target.value })}
                  />
                  <input
                    data-testid="contract-interaction-expected"
                    value={interactionDraft.expectedText}
                    placeholder="交互后出现的文本"
                    onChange={event => setInteractionDraft({ ...interactionDraft, expectedText: event.target.value })}
                  />
                  <button type="submit" className="ripple-xp-quiet" data-testid="contract-interaction-add">添加交互</button>
                </form>
              </div>
            )}
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
            {!gate.allowed && <ul className="ripple-xp-gate-reasons">{gate.reasons.map(reason => <li key={reason}>{reason}</li>)}</ul>}
            <p className="ripple-xp-real-approval-pending" data-testid="real-approval-pending">审批、应用与回滚均走服务端正式接口：创建候选并通过四视口验证后开放。</p>
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
