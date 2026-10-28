import { useEffect, useRef, useState, type ReactNode } from 'react'
import type { CanvasElementXp, ExperienceViewModel, RealPreviewXp } from '../view-model'
import { isCurrentEnvelope, selectionModeMessage, type PickerEnvelope } from '../real-selection'
import { CertaintyPill } from './status-pill'
import { demoRenderedElementIds, renderDemoPage } from './demo-pages'

const CANVAS_STATE_LABEL: Record<ExperienceViewModel['canvasState'], string> = {
  ready: '', loading: '预演加载中…', failed: '预演加载失败，请重试', unavailable: '该视口暂不可用',
  'stale-evidence': '证据已过期，需要重新验证',
}

/**
 * 真实项目源码预演 iframe。地址只能来自适配器的 preview 会话（服务端身份核验），
 * sandbox/referrerPolicy 与 A 的工作台预演面板一致；加载状态明确标记，
 * 加载失败不回退任何模拟内容。预览会话的清理由适配器 dispose 负责。
 */
function RealPreviewFrame({ preview, width, height, frameRef, onReady }: { preview: RealPreviewXp; width: number; height: number; frameRef?: React.RefObject<HTMLIFrameElement | null>; onReady?: () => void }) {
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
      ref={frameRef}
      data-testid="real-preview-frame"
      title="真实项目预演"
      src={preview.url}
      width={width}
      height={height}
      sandbox="allow-scripts"
      referrerPolicy="no-referrer"
      // iframe 每次重新加载后桥脚本重新注入：必须把当前有效的点选模式与 nonce 重新同步
      onLoad={() => { setLoaded(true); onReady?.() }}
      onError={() => setFailed(true)}
      style={{ display: 'block', opacity: loaded ? 1 : 0, border: 0, background: '#fff' }}
    />
  </>
}

/**
 * 中央画布：真实网页为视觉中心。
 * 演示模式渲染模拟 DOM（data-xp-demo），真实模式由适配器换成项目预演 iframe。
 */
export function CanvasStage({ model, onSelectElement, onViewportChange, pickerActive, pickerNonce, pickerError, onTogglePicker, onPicked }: {
  model: ExperienceViewModel
  onSelectElement: (elementId: string) => void
  onViewportChange: (viewportId: string) => void
  /** 画布点选模式（仅真实模式有意义）。 */
  pickerActive?: boolean
  /** 当前点选令牌（空串=未激活）。 */
  pickerNonce?: string
  /** 点选失败原因（如实显示）。 */
  pickerError?: string
  onTogglePicker?: () => void
  /** 合法信封到达（已通过 D 桥会话校验）。 */
  onPicked?: (envelope: PickerEnvelope) => void
}) {
  const hostRef = useRef<HTMLDivElement>(null)
  const realFrameRef = useRef<HTMLIFrameElement>(null)
  const [hostWidth, setHostWidth] = useState(0)
  const [hoveredId, setHoveredId] = useState<string>()
  const [demoCanvasState, setDemoCanvasState] = useState<ExperienceViewModel['canvasState']>('ready')
  const [demoLayer, setDemoLayer] = useState<'baseline' | 'candidate'>('baseline')
  const viewport = model.viewports.find(item => item.id === model.activeViewportId) ?? model.viewports[0]
  const scale = hostWidth ? Math.min(1, hostWidth / viewport.width) : 1
  const canvasState = model.dataProvenance === 'demo' ? demoCanvasState : model.canvasState
  const currentPage = model.pages.find(page => page.id === model.currentPageRef)
  const selected = model.elements.find(item => item.id === model.selectedElementId)
  const isReal = model.dataProvenance !== 'demo'
  const renderedDemoElementIds = model.dataProvenance === 'demo' && currentPage
    ? demoRenderedElementIds(model, currentPage.id as Parameters<typeof demoRenderedElementIds>[1])
    : new Set<string>()
  const hideRenderedDemoTargets = model.dataProvenance === 'demo' && canvasState === 'ready'

  /**
   * 点选模式同步：把【当前有效状态】发给预演 iframe——进入携带 nonce、退出发
   * enabled=false（绝不残留 iframe 内的旧点选模式）、令牌轮换按新 nonce 生效。
   * 只在有效状态变化时发送，避免每次模型重建都向 iframe 刷屏；
   * iframe 重新加载后的同步由 RealPreviewFrame onReady 完成。
   */
  const syncPickerMode = () => {
    if (!isReal || !model.preview) return
    const frame = realFrameRef.current
    if (!frame?.contentWindow) return
    frame.contentWindow.postMessage(
      selectionModeMessage(pickerNonce ?? '', model.preview.previewId, !!pickerActive && !!pickerNonce),
      '*',
    )
  }
  const pickerSyncKeyRef = useRef('')
  useEffect(() => {
    const key = isReal && model.preview
      ? `${model.preview.previewId}|${pickerActive && pickerNonce ? pickerNonce : ''}`
      : ''
    if (!key || pickerSyncKeyRef.current === key) return
    pickerSyncKeyRef.current = key
    syncPickerMode()
    // eslint-disable-next-line react-hooks/exhaustive-deps -- syncPickerMode 读取的均为本 effect 已列出的值
  }, [isReal, model.preview, pickerActive, pickerNonce])

  // 点选信封监听：来源窗口 + previewId + token 必须与当前会话一致（A 核心校验），
  // 过期/跨会话信封一律丢弃
  useEffect(() => {
    if (!isReal || !model.preview || !pickerActive || !pickerNonce) return
    const previewId = model.preview.previewId
    const token = pickerNonce
    const onMessage = (event: MessageEvent) => {
      const frame = realFrameRef.current
      if (!frame?.contentWindow) return
      if (!isCurrentEnvelope(event.data, { eventSource: event.source, iframeSource: frame.contentWindow, previewId, token })) return
      onPicked?.(event.data)
    }
    window.addEventListener('message', onMessage)
    return () => window.removeEventListener('message', onMessage)
  }, [isReal, model.preview, pickerActive, pickerNonce, onPicked])

  useEffect(() => {
    const element = hostRef.current
    if (!element || typeof ResizeObserver === 'undefined') return
    const observer = new ResizeObserver(entries => setHostWidth(entries[0]?.contentRect.width ?? 0))
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const renderElement = (element: CanvasElementXp, children: ReactNode, note?: string) => {
    const isSelected = element.id === model.selectedElementId
    const isHovered = element.id === hoveredId
    return (
      <div
        key={element.id}
        data-xp-demo={element.demoSelector.replace('[data-xp-demo="', '').replace('"]', '')}
        data-demo-source-key={element.demoSourceKey}
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
        {note && <span className="ripple-xp-demo-slot-note" data-testid={`demo-slot-note-${element.id}`}>{note}</span>}
      </div>
    )
  }

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
        <>
          <label className="ripple-xp-demo-state">
            预演层
            <select
              data-testid="demo-layer"
              value={demoLayer}
              onChange={event => setDemoLayer(event.target.value as 'baseline' | 'candidate')}
            >
              <option value="baseline">修改前</option>
              <option value="candidate">候选预演</option>
            </select>
          </label>
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
        </>
      )}
      {isReal && (
        // 画布点选（D 桥）：仅在项目预演会话可用时出现；不可用时不隐藏入口而给出准确原因
        <button
          type="button"
          className={`ripple-xp-picker-toggle ${pickerActive ? 'is-active' : ''}`}
          data-testid="picker-toggle"
          aria-pressed={!!pickerActive}
          disabled={!model.pickerAvailable}
          title={model.pickerAvailable ? '在预演画布中点选要修改的文本' : '项目预演不可用，无法画布点选'}
          onClick={onTogglePicker}
        >
          {pickerActive ? '退出画布点选' : '画布点选'}
        </button>
      )}
    </div>

    {isReal && pickerActive && (
      <p className="ripple-xp-picker-hint" role="note" data-testid="picker-hint">
        点选模式：在上方预演画布中点击要修改的文本元素；点击只用于定位，修改授权由来源证明决定。
      </p>
    )}
    {isReal && pickerError && (
      <p className="ripple-xp-picker-error" role="alert" data-testid="picker-error">{pickerError}</p>
    )}

    {model.elements.length > 0 && (
      // 真实模式的 iframe 与 Demo 当前页都保留显式目标入口，保证目标切换不依赖
      // 当前浏览页；Demo 只隐藏当前页已经渲染的元素，避免冻结 testid 重复。
      <div className="ripple-xp-target-strip" role="group" aria-label="已分析的编辑目标" data-testid="target-strip">
        {model.elements
          .filter(element => model.dataProvenance !== 'demo' || !hideRenderedDemoTargets || !renderedDemoElementIds.has(element.id))
          .map(element => (
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
    {selected?.runtimeIdentity && (
      <p className="ripple-xp-selection-summary" data-testid="runtime-identity">
        实例身份（画布点选）：{selected.runtimeIdentity.certainty === 'stable-keyed-instance' || selected.runtimeIdentity.certainty === 'stable-react-instance'
          ? '已证实'
          : '未证实'}
        {selected.runtimeIdentity.reasons.length > 0 && ` · ${selected.runtimeIdentity.reasons.join('、')}`}
        {selected.runtimeIdentity.sameSourceCount !== undefined && selected.runtimeIdentity.sameSourceCount > 1
          && ` · 同源渲染 ${selected.runtimeIdentity.sameSourceCount} 处，改源影响全部`}
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
          model.activeCandidate?.previewUrl ? (
            // 候选预演：地址来自 POST /candidate/preview 的服务端响应（唯一可信来源）
            <iframe
              data-testid="candidate-preview-frame"
              title="真实候选预演"
              src={model.activeCandidate.previewUrl}
              width={viewport.width}
              height={viewport.height}
              sandbox="allow-scripts"
              referrerPolicy="no-referrer"
              style={{ display: 'block', border: 0, background: '#fff' }}
            />
          ) : model.preview ? (
            // 真实模式：只加载适配器给出的同源预演地址（服务端身份核验响应），
            // 绝不把任意第三方 URL 当作可信 Ripple 页面；隔离属性与 A 的工作台一致。
            <RealPreviewFrame
              preview={model.preview}
              width={viewport.width}
              height={viewport.height}
              frameRef={realFrameRef}
              onReady={syncPickerMode}
            />
          ) : (
            <div className="ripple-xp-canvas-state ripple-xp-canvas-unavailable" role="status" data-testid="real-preview-pending">
              {model.activeCandidate && (model.activeCandidate.lifecycle ?? 'active') !== 'applied' && (model.activeCandidate.lifecycle ?? 'active') !== 'rolled-back'
                ? '项目预演已在候选创建时停止；候选预演入口在下方提供。'
                : model.blockedReasons?.length ? `真实预览不可用：${model.blockedReasons[0]}` : '真实预览尚未接入'}
              {model.blockedReasons?.length === 0 && model.projectStatus === 'failed' && <button type="button" className="ripple-xp-quiet" onClick={() => window.location.reload()}>重试</button>}
            </div>
          )
        ) : canvasState === 'ready' ? (
          renderDemoPage({
            model,
            pageRef: (currentPage?.id ?? 'page:home') as 'page:home' | 'page:products' | 'page:seasonal' | 'page:contact',
            layer: demoLayer,
            renderElement,
          })
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
