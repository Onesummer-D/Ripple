import type { CandidateEdit, CaseFixture, Evidence, ScopeDecision } from '../domain/contracts'
import { centerCoverCrop, intersectionArea } from './measurement'

export interface PreviewExplanation {
  id: string
  state: 'risk' | 'observed' | 'unknown'
  title: string
  finding: string
  suggestion: string
  evidenceIds: string[]
}

export function sourceExplanation(fixture: CaseFixture, candidate: CandidateEdit, decision?: ScopeDecision) {
  const consumers = fixture.graph.nodes.filter((node) => node.kind === 'instance' && fixture.graph.edges.some((edge) => edge.type === 'reads' && edge.from === node.id && edge.to === candidate.sourceId))
  const evidence = fixture.evidence.filter((item) => item.type === 'STRUCTURE' && item.verification === 'verified')
  const affected = consumers.filter((node) => decision?.affectedInstanceIds.includes(node.id))
  return { consumers, affected, evidence, sourceId: candidate.sourceId,
    state: evidence.length ? 'observed' as const : 'unknown' as const,
    finding: `${consumers.map((node) => node.route ?? node.label).join('、')} 在关系图中读取同一来源 ${candidate.sourceId}。`,
    scope: !decision ? '选择范围后，可查看哪些消费者会使用候选。' : decision.mode === 'SHARED'
      ? `共享范围将候选同步到 ${affected.length} 个同源实例。` : `局部范围仅覆盖 ${affected.length} 个选中实例，其他消费者保留草稿值。`,
  }
}

/** Explain only the current browser sample; wording stays independent of JSX. */
export function previewExplanations(evidence?: Evidence): PreviewExplanation[] {
  if (!evidence || evidence.verification !== 'verified' || !evidence.measurement) return [{
    id: 'waiting', state: 'unknown', title: '等待当前预览证据',
    finding: '当前页面的浏览器测量尚未就绪。', suggestion: '完成预演后，这里会显示具体发现和可查看的证据。', evidenceIds: [],
  }]
  const report = evidence.measurement
  const cards: PreviewExplanation[] = []
  const make = (card: Omit<PreviewExplanation, 'evidenceIds'>) => ({ ...card, evidenceIds: [evidence.id] })
  if (report.cta) {
    const overlap = report.slots.reduce((sum, slot) => sum + intersectionArea(slot.rect, report.cta!), 0)
    cards.push(make({ id: 'overlap', state: overlap > 0 ? 'risk' : 'observed',
      title: overlap > 0 ? '当前内容碰到了购买按钮' : '当前内容与购买按钮分离',
      finding: `${evidence.route} · ${evidence.viewport} 的可编辑内容与 CTA 交集面积为 ${Math.round(overlap)} px²。`,
      suggestion: overlap > 0 ? '可缩短文案，或在只希望修改当前实例时调整范围，再重新预演活动页。' : '本次检查的元素没有重叠。继续查看其他页面和设备，确认完整修改范围。',
    }))
  }
  for (const slot of report.slots) {
    if (slot.media) {
      const media = slot.media
      const crop = media.objectFit === 'cover' && media.objectPosition === '50% 50%'
        ? centerCoverCrop(media.naturalWidth, media.naturalHeight, slot.rect.width, slot.rect.height) : undefined
      cards.push(make({ id: `media-${slot.slotId}`, state: media.naturalWidth > 0 && media.naturalHeight > 0 ? 'observed' : 'unknown',
        title: crop ? '同一素材由容器决定可见范围' : '图片呈现需要结合当前容器查看',
        finding: crop ? `${slot.slotId} 原图 ${media.naturalWidth} × ${media.naturalHeight}，中心 cover 显示约 ${Math.round(crop.width)} × ${Math.round(crop.height)} 的原图区域。`
          : media.naturalWidth > 0 ? `${slot.slotId} 使用 ${media.objectFit} / ${media.objectPosition}，原图 ${media.naturalWidth} × ${media.naturalHeight}。`
            : `${slot.slotId} 尚未取得可用的原图尺寸。`,
        suggestion: crop ? '放大裁切并对照完整原图，再由你确认主体是否保留；也可切换其他消费页面比较。' : '查看图片加载状态与实际呈现，再决定是否同步其他位置。',
      }))
    }
    if (slot.style) cards.push(make({ id: `style-${slot.slotId}`, state: 'observed', title: '颜色已被当前消费者使用',
      finding: `${slot.slotId} 的计算文字颜色为 ${slot.style.color}，背景为 ${slot.style.backgroundColor}。`,
      suggestion: '切换按钮、标签或图标所在页面查看联动。颜色记录用于确认消费结果，视觉搭配由你判断。',
    }))
  }
  if (!cards.length) cards.push(make({ id: 'geometry', state: 'observed', title: '当前页面的布局已记录',
    finding: `${evidence.route} · ${evidence.viewport} 已记录 ${report.slots.length} 个可编辑位置的矩形。`,
    suggestion: '查看原始证据，继续预演其他页面与设备。',
  }))
  return cards
}
