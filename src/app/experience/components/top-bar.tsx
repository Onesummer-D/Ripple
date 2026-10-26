import type { ExperienceViewModel } from '../view-model'

const PROJECT_STATUS_LABEL: Record<ExperienceViewModel['projectStatus'], string> = {
  ready: '工程就绪', analyzing: '分析中…', failed: '工程加载失败', unavailable: '工程不可用',
}
const CANDIDATE_STATUS_LABEL: Record<ExperienceViewModel['candidateStatus'], string> = {
  none: '尚无候选', draft: '草稿', candidate: '候选已生成', verified: '验证通过', approved: '已审批',
  applied: '已应用', 'rolled-back': '已回滚', stale: '候选已失效',
}

export function TopBar({ model, onOpenHistory, onRefresh }: { model: ExperienceViewModel; onOpenHistory: () => void; onRefresh?: () => void }) {
  return <header className="ripple-xp-topbar" data-testid="xp-topbar">
    <div className="ripple-xp-brand">
      <span className="ripple-xp-logo" aria-hidden>≈</span>
      <div>
        <strong>{model.projectName}</strong>
      </div>
    </div>
    <div className="ripple-xp-topbar-status">
      <span className={`ripple-xp-chip ripple-xp-chip-${model.projectStatus}`} data-testid="project-status">
        {PROJECT_STATUS_LABEL[model.projectStatus]}
      </span>
      <span className={`ripple-xp-chip ripple-xp-chip-${model.candidateStatus}`} data-testid="candidate-status">
        {CANDIDATE_STATUS_LABEL[model.candidateStatus]}
      </span>
      {model.dataProvenance === 'demo' && (
        <span className="ripple-xp-provenance-compat" data-testid="demo-badge">
          <span className="ripple-xp-provenance-note" data-testid="demo-note">演示预览，内容为模拟数据（演示数据 DEMO）</span>
        </span>
      )}
      {model.dataProvenance === 'real' && (
        <span className="ripple-xp-chip ripple-xp-chip-real" data-testid="real-badge">
          真实工程{model.projectIdentity ? ` · ${model.projectIdentity.projectId.slice(0, 8)}` : ''}
        </span>
      )}
      {model.dataProvenance === 'real' && onRefresh && (
        // 真实模式：候选创建会由服务端停止项目预演，刷新重建预演会话并回读服务端状态
        <button type="button" className="ripple-xp-quiet" onClick={onRefresh} data-testid="refresh-project">
          刷新工程状态
        </button>
      )}
      <button type="button" className="ripple-xp-quiet" onClick={onOpenHistory} data-testid="open-history">
        版本历史
      </button>
    </div>
  </header>
}
