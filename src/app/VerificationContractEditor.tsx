import type { BrowserControlRole } from '../core/model'
import type { VerificationContractDraft } from './verification-contract-form'
import './verification-marker-suggestion.css'

interface RouteOption { id: string; label: string }

interface VerificationContractEditorProps {
  routes: RouteOption[]
  markerSuggestions: Record<string, string[]>
  value: VerificationContractDraft
  disabled: boolean
  onChange: (value: VerificationContractDraft) => void
}

export function VerificationContractEditor({ routes, markerSuggestions, value, disabled, onChange }: VerificationContractEditorProps) {
  function updatePage(pageRef: string, patch: Partial<VerificationContractDraft['pages'][number]>) {
    onChange({ ...value, pages: value.pages.map(page => page.pageRef === pageRef ? { ...page, ...patch } : page) })
  }

  function updateInteraction(id: string, patch: Partial<VerificationContractDraft['interactions'][number]>) {
    onChange({ ...value, interactions: value.interactions.map(item => item.id === id ? { ...item, ...patch } : item) })
  }

  function addInteraction() {
    const pageRef = routes[0]?.id
    if (!pageRef) return
    onChange({
      ...value,
      interactions: [...value.interactions, { id: crypto.randomUUID(), pageRef, role: 'button', name: '', expectedText: '' }],
    })
  }

  return <div className="verification-contract-editor" data-testid="verification-contract-editor">
    <div className="verification-contract-heading">
      <div><strong>浏览器验收清单</strong><small>选择真实页面标记和已有交互。Ripple 会运行原工程与候选工程；没有声明的页面或交互不会被算作通过。</small></div>
      <button type="button" className="quiet-button" data-testid="add-verification-interaction" onClick={addInteraction} disabled={disabled || routes.length === 0}>＋ 添加交互检查</button>
    </div>
    <div className="verification-page-list">
      {routes.map((route, index) => {
        const page = value.pages.find(item => item.pageRef === route.id)
        if (!page) return null
        const suggestions = markerSuggestions[route.id] ?? []
        return <fieldset className="verification-page-row" key={route.id} disabled={disabled}>
          <legend>{route.label} <code>{route.id}</code></legend>
          <label><span>访问路径</span><input aria-label={`${route.label} 页面访问路径`} value={page.path} onChange={event => updatePage(route.id, { path: event.target.value })} placeholder="/" /></label>
          <label><span>页面上可见的独特文字</span><input aria-label={`${route.label} 页面标记文字`} value={page.markerText} onChange={event => updatePage(route.id, { markerText: event.target.value })} placeholder="例如页面主标题" /></label>
          {suggestions.length > 0 && <label className="verification-marker-suggestion"><span>来源已证明的 TEXT 标记建议（可选）</span><select aria-label={`${route.label} 页面标记建议`} value={suggestions.includes(page.markerText) ? page.markerText : ''} onChange={event => updatePage(route.id, { markerText: event.target.value })}><option value="">手动填写或不选择</option>{suggestions.map(text => <option key={text} value={text}>{text}</option>)}</select><small>这只是来自当前源码关系的候选文字，不是浏览器证据；请确认页面路径与含义，再运行真实验证。</small></label>}
          {index > 0 && <div className="verification-navigation"><label><span>如何从首页切换到此页（单页应用）</span><select aria-label={`${route.label} 页面导航控件类型`} value={page.navigationRole} onChange={event => updatePage(route.id, { navigationRole: event.target.value as BrowserControlRole })}><option value="button">按钮</option><option value="link">链接</option></select></label><label><span>控件可访问名称（留空表示使用访问路径）</span><input aria-label={`${route.label} 页面导航控件名称`} value={page.navigationName} onChange={event => updatePage(route.id, { navigationName: event.target.value })} placeholder="例如品牌故事" /></label></div>}
        </fieldset>
      })}
      {routes.length === 0 && <p className="empty-note">尚未解析到页面，无法声明页面验收。</p>}
    </div>
    {value.interactions.length > 0 && <div className="verification-interaction-list">
      {value.interactions.map((interaction, index) => <fieldset className="verification-interaction-row" key={interaction.id} disabled={disabled}>
        <legend>交互检查 {index + 1}</legend>
        <label><span>所在页面</span><select aria-label={`交互检查 ${index + 1} 所在页面`} value={interaction.pageRef} onChange={event => updateInteraction(interaction.id, { pageRef: event.target.value })}>{routes.map(route => <option key={route.id} value={route.id}>{route.label}</option>)}</select></label>
        <label><span>控件类型</span><select aria-label={`交互检查 ${index + 1} 控件类型`} value={interaction.role} onChange={event => updateInteraction(interaction.id, { role: event.target.value as BrowserControlRole })}><option value="button">按钮</option><option value="link">链接</option></select></label>
        <label><span>控件可访问名称</span><input aria-label={`交互检查 ${index + 1} 控件名称`} value={interaction.name} onChange={event => updateInteraction(interaction.id, { name: event.target.value })} placeholder="例如加入购物车" /></label>
        <label><span>触发后应出现的文字</span><input aria-label={`交互检查 ${index + 1} 预期结果`} value={interaction.expectedText} onChange={event => updateInteraction(interaction.id, { expectedText: event.target.value })} placeholder="例如已加入购物车" /></label>
        <button type="button" className="quiet-button" aria-label={`移除交互检查 ${index + 1}`} onClick={() => onChange({ ...value, interactions: value.interactions.filter(item => item.id !== interaction.id) })}>移除</button>
      </fieldset>)}
    </div>}
  </div>
}
