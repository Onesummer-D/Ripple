import type { ExperienceViewModel } from '../view-model'

export function TopBar({ model, onOpenHistory, onRefresh }: { model: ExperienceViewModel; onOpenHistory: () => void; onRefresh?: () => void }) {
  return <header className="ripple-xp-topbar" data-testid="xp-topbar">
    <div className="ripple-xp-brand">
      <span className="ripple-xp-logo" aria-hidden>≈</span>
      <div>
        <strong>网页变更工作台</strong>
        {/* 顶栏标识工具本身；被编辑网站的品牌只出现在预览内部，两者不混用 */}
        <span className="ripple-xp-brand-sub">{model.projectName}</span>
      </div>
    </div>
    <div className="ripple-xp-topbar-status">
      {/* 演示/真实来源标记是唯一保留的状态徽章：它是演示数据与真实验证的分界线，必须常显 */}
      {model.dataProvenance === 'demo' && (
        <span className="ripple-xp-chip ripple-xp-chip-demo" data-testid="demo-badge">演示数据 DEMO</span>
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
