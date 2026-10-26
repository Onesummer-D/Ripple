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
      {/* 演示身份用一句简洁文字说明（不恢复胶囊徽章）：告诉用户当前看到的是模拟数据，
       * 而不是真实工程的验证结果。真实模式改为显示「真实工程」标识，两者互斥。 */}
      {model.dataProvenance === 'demo' && (
        <span className="ripple-xp-provenance-note" data-testid="demo-note">演示预览，内容为模拟数据</span>
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
