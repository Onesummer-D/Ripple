import { useEffect, useState } from 'react'
import type { ExperienceViewModel, PageXp } from '../view-model'
import { approvalGate, scopeSummary } from '../view-model'

/** 影响范围选项：动作名 + 一句后果说明，不用胶囊术语（包含/保护/排除只留在内部模型）。 */
const SCOPE_OPTIONS: { value: PageXp['scope']; title: string; desc: string }[] = [
  { value: 'include', title: '一起改', desc: '这页的文字会同步更新成新内容' },
  { value: 'protect', title: '这页保持不动', desc: '即使共用同一段文字，这页也不跟着改' },
  { value: 'exclude', title: '与本次修改无关', desc: '排除这页，之后不再为它提醒' },
]

/** 页面为什么出现在影响范围里：一句人话说明，替代「同源页面/影响未证明」术语。 */
const RELATION_WHY: Record<Exclude<PageXp['relation'], 'editing'>, string> = {
  'same-source': '这页和当前页使用同一段文字',
  unrelated: '已确认这页不受这次修改影响',
  unproven: '还没法确定这页会不会被影响',
}

const STEPS = [
  { id: 1, title: '选择元素' },
  { id: 2, title: '修改内容' },
  { id: 3, title: '影响范围' },
  { id: 4, title: '检查并生成' },
] as const
type StepId = (typeof STEPS)[number]['id']

/**
 * 右侧决策面板：四步流程，一次只呈现一个功能区（参考 VWO/Optimizely 编辑向导
 * 与 GitHub PR 逐文件审查）。步骤可自由前后翻看，但生成/审批仍由 approvalGate
 * 门控——unknown/partial 页面不得被提升为可安全审批的范围。
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
  const selectedId = selected?.id
  const [step, setStep] = useState<StepId>(1)
  // 选中元素后自动进入「修改内容」；在画布上新点一个元素也会回到这一步
  useEffect(() => { if (selectedId) setStep(2) }, [selectedId])
  // 源码视图默认折叠：用户主动点击才展开；切换目标时收回
  const [sourceOpen, setSourceOpen] = useState(false)
  useEffect(() => setSourceOpen(false), [selectedId])
  // 影响范围逐页决策：正在修改的页不参与翻页（它必然一起改）
  const scopePages = model.pages.filter(page => page.relation !== 'editing')
  const [scopeIndex, setScopeIndex] = useState(0)
  useEffect(() => setScopeIndex(0), [selectedId])
  const scopePage = scopePages.length > 0 ? scopePages[Math.min(scopeIndex, scopePages.length - 1)] : undefined
  const decidedCount = scopePages.filter(page => page.scope !== 'undecided').length

  const summary = scopeSummary(model.pages)
  const gate = approvalGate({ pages: model.pages, selectedElement: selected, draftAfterText: model.draftAfterText })
  const editingPage = model.pages.find(page => page.relation === 'editing')

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

  const stepMeta = STEPS.find(item => item.id === step)!
  const prevStep = STEPS.find(item => item.id === step - 1)
  const nextStep = STEPS.find(item => item.id === step + 1)

  // 注意：根类名是 ripple-xp-scope-panel，不是 ripple-xp-scope——后者是整页
  // 工作台根容器的作用域类（携带 min-height:100vh / 整页 flex），右侧面板
  // 误用会继承整页高度，造成大面积空白与布局错乱。
  return <aside className="ripple-xp-scope-panel reveal" data-testid="scope-panel">
    <div className="ripple-xp-stephead">
      <div className="ripple-xp-stepseg" role="tablist" aria-label="修改步骤">
        {STEPS.map(item => (
          <button
            key={item.id}
            type="button"
            role="tab"
            aria-selected={item.id === step}
            className={item.id === step ? 'is-now' : item.id < step ? 'is-done' : ''}
            data-testid={`step-tab-${item.id}`}
            title={item.title}
            onClick={() => setStep(item.id)}
          />
        ))}
      </div>
      <span className="ripple-xp-stepcount">第 {step} 步 / 共 4 步</span>
    </div>
    <h3 className="ripple-xp-steptitle">{stepMeta.title}</h3>

    <div className="ripple-xp-stepbody">
      {step === 1 && (
        selected ? (
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
        ) : <p className="ripple-xp-panel-hint">在中间画布点选想要修改的位置。</p>
      )}

      {step === 2 && (
        selected?.editable ? (
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
            <p className="ripple-xp-panel-hint">改动会实时出现在下方「前后对照」里，随时可以对照确认。</p>
          </div>
        ) : (
          <p className="ripple-xp-panel-hint">
            {selected ? '来源未知的元素不能承诺修改，只能查看。' : '先在画布上点选要修改的位置。'}
          </p>
        )
      )}

      {step === 3 && (
        scopePage ? (
          <div className="ripple-xp-scope-page" data-testid={`scope-row-${scopePage.id}`}>
            <div className="ripple-xp-scope-pager">
              <button
                type="button"
                aria-label="上一页"
                data-testid="scope-pager-prev"
                disabled={scopeIndex <= 0}
                onClick={() => setScopeIndex(scopeIndex - 1)}
              >‹</button>
              <div className="ripple-xp-scope-pager-name">
                <strong>{scopePage.label}</strong>
                <span>第 {scopeIndex + 1} 页 / 共 {scopePages.length} 页</span>
              </div>
              <button
                type="button"
                aria-label="下一页"
                data-testid="scope-pager-next"
                disabled={scopeIndex >= scopePages.length - 1}
                onClick={() => setScopeIndex(scopeIndex + 1)}
              >›</button>
            </div>
            <p className={`ripple-xp-scope-why ${scopePage.relation === 'same-source' ? 'is-green' : ''}`}>
              {RELATION_WHY[scopePage.relation as Exclude<PageXp['relation'], 'editing'>]}
            </p>
            <div className="ripple-xp-scope-options" role="group" aria-label={`${scopePage.label} 范围`}>
              {SCOPE_OPTIONS.map(option => (
                <button
                  key={option.value}
                  type="button"
                  className={`ripple-xp-scope-option ${scopePage.scope === option.value ? 'is-active' : ''}`}
                  aria-pressed={scopePage.scope === option.value}
                  data-testid={`scope-${option.value}-${scopePage.id}`}
                  onClick={() => onPageScope(scopePage.id, option.value)}
                >
                  <span className="ripple-xp-scope-option-dot" aria-hidden />
                  <span>
                    <strong>{option.title}</strong>
                    <small>{option.desc}</small>
                  </span>
                </button>
              ))}
            </div>
            <p className="ripple-xp-scope-progress" data-testid="scope-progress">
              已决定 <b>{decidedCount}</b> / {scopePages.length} 页
            </p>
            {editingPage && (
              <p className="ripple-xp-panel-hint">「{editingPage.label}」是你正在修改的页面，会自动更新。</p>
            )}
          </div>
        ) : (
          <p className="ripple-xp-panel-hint">本次修改不涉及其他页面。</p>
        )
      )}

      {step === 4 && (
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
      )}
    </div>

    <div className="ripple-xp-stepnav">
      {prevStep ? (
        <button type="button" data-testid="step-prev" onClick={() => setStep(prevStep.id)}>‹ 上一步 · {prevStep.title}</button>
      ) : <span />}
      {nextStep && (
        <button type="button" className="is-next" data-testid="step-next" onClick={() => setStep(nextStep.id)}>下一步 · {nextStep.title} ›</button>
      )}
    </div>
  </aside>
}
