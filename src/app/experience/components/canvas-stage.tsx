import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CanvasElementXp, ExperienceViewModel, RealPreviewXp } from '../view-model'
import { CertaintyPill } from './status-pill'

const CANVAS_STATE_LABEL: Record<ExperienceViewModel['canvasState'], string> = {
  ready: '', loading: '预演加载中…', failed: '预演加载失败，请重试', unavailable: '该视口暂不可用',
  'stale-evidence': '证据已过期，需要重新验证',
}

/**
 * 真实项目源码预演 iframe。地址只能来自适配器的 preview 会话（服务端身份核验），
 * sandbox/referrerPolicy 与 A 的工作台预演面板一致；加载状态明确标记，
 * 加载失败不回退任何模拟内容。预览会话的清理由适配器 dispose 负责。
 */
function RealPreviewFrame({ preview, width, height }: { preview: RealPreviewXp; width: number; height: number }) {
  const [loaded, setLoaded] = useState(false)
  const [failed, setFailed] = useState(false)
  useEffect(() => { setLoaded(false); setFailed(false) }, [preview.url])
  return <>
    {!loaded && !failed && (
      <div className="ripple-xp-canvas-state" role="status" data-testid="real-preview-loading">真实预演加载中…</div>
    )}
    {failed && (
      <div className="ripple-xp-canvas-state ripple-xp-canvas-failed" role="status" data-testid="real-preview-failed">
        真实预演加载失败
      </div>
    )}
    <iframe
      data-testid="real-preview-frame"
      title="真实项目预演"
      src={preview.url}
      width={width}
      height={height}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      onLoad={() => setLoaded(true)}
      onError={() => setFailed(true)}
      style={{ display: 'block', opacity: loaded ? 1 : 0, border: 0, background: '#fff' }}
    />
  </>
}

/**
 * 中央画布：真实网页为视觉中心。
 * 演示模式渲染模拟 DOM（data-xp-demo），真实模式由适配器换成项目预演 iframe。
 */
export function CanvasStage({ model, onSelectElement, onViewportChange }: {
  model: ExperienceViewModel
  onSelectElement: (elementId: string) => void
  onViewportChange: (viewportId: string) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const [hoveredId, setHoveredId] = useState<string>()
  const [demoCanvasState, setDemoCanvasState] = useState<ExperienceViewModel['canvasState']>('ready')
  const viewport = model.viewports.find(item => item.id === model.activeViewportId) ?? model.viewports[0]
  const scale = hostWidth ? Math.min(1, hostWidth / viewport.width) : 1
  const canvasState = model.dataProvenance === 'demo' ? demoCanvasState : model.canvasState
  const currentPage = model.pages.find(page => page.id === model.currentPageRef)
  const selected = model.elements.find(item => item.id === model.selectedElementId)

  useEffect(() => {
    const element = hostRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setHostWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const renderElement = (element: CanvasElementXp, children: ReactNode) => {
    const isSelected = element.id === model.selectedElementId
    const isHovered = element.id === hoveredId
    return (
      <div
        key={element.id}
        data-xp-demo={element.demoSelector.replace('[data-xp-demo="', '').replace('"]', '')}
        data-testid={`canvas-el-${element.id}`}
        role="button"
        tabIndex={0}
        aria-pressed={isSelected}
        className={`ripple-xp-demo-el ${isSelected ? 'is-selected' : ''} ${isHovered ? 'is-hovered' : ''} ${element.editable ? '' : 'is-locked'}`}
        onMouseEnter={() => setHoveredId(element.id)}
        onMouseLeave={() => setHoveredId(undefined)}
        onClick={() => onSelectElement(element.id)}
        onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); onSelectElement(element.id) } }}
      >
        {children}
        {(isSelected || isHovered) && (
          <span className="ripple-xp-el-tag">
            {element.label}
            {!element.editable && ' · 来源未知，仅可查看'}
          </span>
        )}
      </div>
    )
  }

  const heroTitle = model.elements.find(item => item.id === 'el:hero-title')
  const heroSubtitle = model.elements.find(item => item.id === 'el:hero-subtitle')
  const seasonal = model.elements.find(item => item.id === 'el:seasonal-banner')
  const promo = model.elements.find(item => item.id === 'el:promo-card')

  const demoPage = (
    <div className="ripple-xp-demo-page" data-testid="demo-canvas">
      <header className="ripple-xp-demo-nav">
        <strong>青野文创</strong>
        <span>首页</span><span>全部商品</span><span>品牌故事</span><span>联系我们</span>
      </header>
      <section className="ripple-xp-demo-hero">
        <img className="ripple-xp-demo-hero-media" src="/demo-assets/hero-market.jpg" alt="" aria-hidden />
        <div className="ripple-xp-demo-hero-overlay">
          {heroTitle && renderElement(heroTitle, <h1>{heroTitle.currentText}</h1>)}
          {heroSubtitle && renderElement(heroSubtitle, <p className="ripple-xp-demo-sub">{heroSubtitle.currentText}</p>)}
          <div className="ripple-xp-demo-cta-row">
            <span className="ripple-xp-demo-cta">逛市集</span>
            {seasonal && renderElement(seasonal, <span className="ripple-xp-demo-banner">{seasonal.currentText}</span>)}
          </div>
        </div>
      </section>
      <section className="ripple-xp-demo-grid">
        {([
          ['柴烧茶壶', '/demo-assets/workshop.jpg'],
          ['素白陶碗', '/demo-assets/vessels.jpg'],
          ['手作风铃', '/demo-assets/seasonal.jpg'],
        ] as const).map(([name, art]) => (
          <div key={name} className="ripple-xp-demo-card">
            <span className="ripple-xp-demo-thumb" style={{ backgroundImage: `url(${art})` }} />
            <strong>{name}</strong>
          </div>
        ))}
        {promo && renderElement(promo, <div className="ripple-xp-demo-card is-promo"><span className="ripple-xp-demo-thumb" /><strong>{promo.currentText}</strong></div>)}
      </section>
    </div>
  )

  return <section className="ripple-xp-stage reveal" aria-label="网页画布" data-testid="canvas-stage">
    <div className="ripple-xp-stage-toolbar">
      <div className="ripple-xp-viewport-switch" role="group" aria-label="视口选择">
        {model.viewports.map(item => (
          <button
            key={item.id}
            type="button"
            className={item.id === model.activeViewportId ? 'is-active' : ''}
            aria-pressed={item.id === model.activeViewportId}
            data-testid={`viewport-${item.id}`}
            onClick={() => onViewportChange(item.id)}
          >
            {item.label}
            {item.verificationStatus === 'in-verification' && <span className="ripple-xp-verify-badge">验证中</span>}
            {item.verificationStatus === 'unavailable' && <span className="ripple-xp-verify-badge">不可用</span>}
          </button>
        ))}
      </div>
      {model.dataProvenance === 'demo' && (
        <label className="ripple-xp-demo-state">
          演示状态
          <select
            data-testid="demo-canvas-state"
            value={demoCanvasState}
            onChange={event => setDemoCanvasState(event.target.value as ExperienceViewModel['canvasState'])}
          >
            <option value="ready">正常</option>
            <option value="loading">加载中</option>
            <option value="failed">加载失败</option>
            <option value="unavailable">不可用</option>
            <option value="stale-evidence">证据过期</option>
          </select>
        </label>
      )}
    </div>

    {model.dataProvenance !== 'demo' && model.elements.length > 0 && (
      // 真实模式：预演页面在隔离 iframe 中（不可跨文档点选），
      // 已分析的编辑目标以列表形式提供选中入口，来源确定性逐条标注。
      <div className="ripple-xp-target-strip" role="group" aria-label="已分析的编辑目标" data-testid="target-strip">
        {model.elements.map(element => (
          <button
            key={element.id}
            type="button"
            className={`ripple-xp-target-chip ${element.id === model.selectedElementId ? 'is-selected' : ''} ${element.editable ? '' : 'is-locked'}`}
            aria-pressed={element.id === model.selectedElementId}
            data-testid={`canvas-el-${element.id}`}
            onClick={() => onSelectElement(element.id)}
          >
            {element.label}
            {!element.editable && ' · 仅可查看'}
            <CertaintyPill certainty={element.certainty} />
          </button>
        ))}
      </div>
    )}

    {selected && (
      <p className="ripple-xp-selection-summary" data-testid="selection-summary">
        已选中：{selected.label} · 源码 <code>{selected.sourcePath ?? '（未定位）'}</code>
        <CertaintyPill certainty={selected.certainty} />
        {selected.impactPageRefs.length > 0 && <span> · 影响 {selected.impactPageRefs.length} 个页面</span>}
      </p>
    )}

    <div
      className="ripple-xp-viewport-shell"
      ref={hostRef}
      data-testid="viewport-shell"
      // surface 使用 transform: scale()，不参与布局：外壳必须显式给出缩放后的高度，
      // 否则画布渲染出来高度塌陷（空白根因修复）
      style={{ height: Math.round(viewport.height * scale) }}
    >
      <div
        className="ripple-xp-viewport-surface"
        style={{ width: viewport.width, height: viewport.height, transform: `scale(${scale})` }}
      >
        {model.dataProvenance !== 'demo' ? (
          model.preview ? (
            // 真实模式：只加载适配器给出的同源预演地址（服务端身份核验响应），
            // 绝不把任意第三方 URL 当作可信 Ripple 页面；隔离属性与 A 的工作台一致。
            <RealPreviewFrame
              preview={model.preview}
              width={viewport.width}
              height={viewport.height}
            />
          ) : (
            <div className="ripple-xp-canvas-state ripple-xp-canvas-unavailable" role="status" data-testid="real-preview-pending">
              {model.blockedReasons?.length ? `真实预览不可用：${model.blockedReasons[0]}` : '真实预览尚未接入'}
              {model.blockedReasons?.length === 0 && model.projectStatus === 'failed' && <button type="button" className="ripple-xp-quiet" onClick={() => window.location.reload()}>重试</button>}
            </div>
          )
        ) : canvasState === 'ready' ? (
          currentPage?.id === 'page:home' ? demoPage : (
            <div className="ripple-xp-demo-page is-placeholder" data-testid="demo-canvas-placeholder">
              <h2>{currentPage?.label}</h2>
              <p>演示数据：该页面的画布内容未包含在本轮演示中。</p>
              <p>页面关系：{currentPage?.relation === 'same-source' ? '与当前修改同源，修改会随范围决策生效。' : '影响范围未证明。'}</p>
            </div>
          )
        ) : (
          <div className={`ripple-xp-canvas-state ripple-xp-canvas-${canvasState}`} role="status" data-testid="canvas-state-banner">
            {CANVAS_STATE_LABEL[canvasState]}
            {canvasState === 'failed' && <button type="button" className="ripple-xp-quiet" data-testid="canvas-retry" onClick={() => setDemoCanvasState('ready')}>重试</button>}
          </div>
        )}
      </div>
    </div>
  </section>
}
