import { useEffect, useState } from 'react'
import type { ExperienceViewModel, PageXp } from '../view-model'
import { approvalGate, scopeSummary } from '../view-model'
import { SectionTitle } from './status-pill'

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
  // 源码视图默认折叠：用户主动点击才展开；切换目标时收回
  const [sourceOpen, setSourceOpen] = useState(false)
  useEffect(() => setSourceOpen(false), [selected?.id])
  const summary = scopeSummary(model.pages)
  const gate = approvalGate({ pages: model.pages, selectedElement: selected, draftAfterText: model.draftAfterText })
  const editingPage = model.pages.find(page => page.relation === 'editing')
  const sameSourcePages = model.pages.filter(page => page.relation === 'same-source')
  const unrelatedPages = model.pages.filter(page => page.relation === 'unrelated')
  const unprovenPages = model.pages.filter(page => page.relation === 'unproven')

  // 修改前检查清单：状态从真实模型读取（与 approvalGate 同源的判定输入），不虚构任何检查结果。
  const selectReason = !selected ? '尚未选中要修改的位置'
    : !selected.editable ? '选中位置来源未知，不能作为修改目标'
    : selected.certainty !== 'source-proven' ? '选中位置来源未完全证明，不能作为安全修改目标' : ''
  const draftOk = !!model.draftAfterText.trim()
  const checks = [
    { key: 'select', title: '选择要修改的元素', ok: !selectReason },
    { key: 'draft', title: '填写修改内容', ok: draftOk },
    { key: 'scope', title: '确认影响范围', ok: summary.undecided === 0 },
  ]
  if (summary.unprovenIncluded > 0) {
    checks.push({ key: 'risk', title: '风险检查', ok: false })
  }
  const precheck = (
    <div className="ripple-xp-precheck">
      <div className="ripple-xp-precheck-head">
        <strong>修改前检查</strong>
      </div>
      <ul className="ripple-xp-precheck-list">
        {checks.map(check => (
          <li key={check.key} className={check.ok ? 'is-ok' : 'is-pending'}>
            <span className="ripple-xp-precheck-icon" aria-hidden>{check.ok ? '✓' : '!'}</span>
            <strong>{check.title}</strong>
          </li>
        ))}
      </ul>
    </div>
  )

  const scopeRow = (page: PageXp, reason: string, locked: boolean) => (
    <li key={page.id} className={`ripple-xp-scope-row ${locked ? 'is-locked' : ''}`} data-testid={`scope-row-${page.id}`}>
      <div className="ripple-xp-scope-head">
        <strong>{page.label}</strong>
        <span className="ripple-xp-scope-reason">{reason}</span>
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
      </div>
    </li>
  )

  // 注意：根类名是 ripple-xp-scope-panel，不是 ripple-xp-scope——后者是整页
  // 工作台根容器的作用域类（携带 min-height:100vh / 整页 flex），右侧面板
  // 误用会继承整页高度，造成大面积空白与布局错乱。
  return <aside className="ripple-xp-scope-panel reveal" data-testid="scope-panel">
    {/* 决策面板按编辑器流程组织：选择元素 → 编辑修改内容 → 影响范围 → 生成候选并检查。
     * 不用步骤编号——面板随操作状态变化，而不是操作向导式的静态表单。 */}
    <SectionTitle>
      选择元素
    </SectionTitle>
    {selected ? (
      <div className="ripple-xp-selection-block">
        <strong>{selected.label}</strong>
        {selected.unresolvedReasons.map(reason => <p key={reason} className="ripple-xp-warn">· {reason}</p>)}
        {!selected.editable && <p className="ripple-xp-warn">该元素来源未知：可以先查看，但不能承诺修改范围。</p>}
        {selected.sourcePath && (
          // 源码位置不抢占首屏：折叠在「选择元素」内，点击展开后圈选文字所在行高亮
          <div className="ripple-xp-source" data-testid="selection-source">
            <button
              type="button"
              className="ripple-xp-source-toggle"
              data-testid="source-toggle"
              aria-expanded={sourceOpen}
              onClick={() => setSourceOpen(!sourceOpen)}
            >
              {sourceOpen ? '收起源码' : '查看源码'} · {selected.sourcePath}
            </button>
            {sourceOpen && (selected.sourceExcerpt ? (
              <pre className="ripple-xp-source-code" data-testid="source-excerpt">{selected.sourceExcerpt.lines.map((line, index) => (
                <span key={index} className={index === selected.sourceExcerpt!.highlightLine ? 'is-hit' : ''}>{line}{'\n'}</span>
              ))}</pre>
            ) : (
              <p className="ripple-xp-panel-hint">已定位到文件；代码摘录视图将在真实工程中接入。</p>
            ))}
          </div>
        )}
      </div>
    ) : <p className="ripple-xp-panel-hint">在中间画布点选想要修改的位置。</p>}

    <SectionTitle>编辑修改内容</SectionTitle>
    {selected?.editable ? (
      <div className="ripple-xp-intent-block">
        <p className="ripple-xp-current-text">当前内容：{selected.currentText}</p>
        <label className="ripple-xp-intent">
          修改后
          <input
            data-testid="draft-text-input"
            value={model.draftAfterText}
            placeholder="输入修改后的文字"
            onChange={event => onDraftText(event.target.value)}
          />
        </label>
      </div>
    ) : (
      <p className="ripple-xp-panel-hint">
        {selected ? '来源未知的元素不能承诺修改，只能查看。' : '选中可修改的元素后，在这里输入修改后的文字。'}
      </p>
    )}

    <SectionTitle>影响范围</SectionTitle>
    <ul className="ripple-xp-scope-list">
      {editingPage && scopeRow(editingPage, '本次修改的位置', true)}
      {sameSourcePages.map(page => scopeRow(page, '同源页面', false))}
      {unrelatedPages.map(page => scopeRow(page, '已证明不受影响', false))}
      {unprovenPages.map(page => scopeRow(page, '影响未证明', false))}
    </ul>

    <SectionTitle>生成候选并检查</SectionTitle>
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
            {/* 先说明为什么还不能生成（检查清单），再给操作入口 */}
            {precheck}
            <button
              type="button"
              className="ripple-xp-primary"
              data-testid="create-candidate"
              disabled={!gate.allowed}
              onClick={onCreateCandidate}
            >
              {gate.allowed ? '生成真实候选' : '生成修改候选 · 完成检查后可用'}
            </button>
            {candidateError && <p className="ripple-xp-candidate-error" role="alert" data-testid="candidate-error">{candidateError}</p>}
            <p className="ripple-xp-real-approval-pending" data-testid="real-approval-pending">真实审批尚未接入（验证/审批批次接入）</p>
          </>
        )
      ) : (
        // 演示模式：主按钮常显但受检查清单门控——未完成时禁用并说明原因，
        // 全部就绪后切换为墨绿实色可用的演示审批
        <>
          {precheck}
          <button
            type="button"
            className="ripple-xp-primary"
            data-testid="demo-approve"
            disabled={!gate.allowed}
            onClick={onDemoApprove}
          >
            {gate.allowed ? '演示审批（不写入真实工程）' : '生成修改候选 · 完成检查后可用'}
          </button>
        </>
      )}
    </div>
  </aside>
}
