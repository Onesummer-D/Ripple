import type { CaseId, EditableSlot, ElementRect, Evidence, PreviewEvidenceContext, PreviewMeasurement, SlotObservation } from '../domain/contracts'

const record = (value: unknown): value is Record<string, unknown> => typeof value === 'object' && value !== null
const nonnegative = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value) && value >= 0
const rect = (value: unknown): value is ElementRect => record(value) && typeof value.x === 'number' && Number.isFinite(value.x) && typeof value.y === 'number' && Number.isFinite(value.y) && nonnegative(value.width) && nonnegative(value.height)

export function parseMeasurement(value: unknown, expected: { requestId: string; caseId: CaseId; route: string; width: number; height: number; slots: EditableSlot[] }): PreviewMeasurement | undefined {
  if (!record(value) || value.type !== 'ripple:measurement' || value.requestId !== expected.requestId || value.caseId !== expected.caseId || value.route !== expected.route || value.width !== expected.width || value.height !== expected.height || typeof value.measuredAt !== 'string' || !Number.isFinite(Date.parse(value.measuredAt)) || !Array.isArray(value.slots)) return undefined
  const slots = expected.slots.filter((slot) => slot.route === expected.route)
  if (value.slots.length !== slots.length) return undefined
  const observations: SlotObservation[] = []
  for (const item of value.slots) {
    if (!record(item) || !rect(item.rect)) return undefined
    const slot = slots.find((entry) => entry.id === item.slotId && entry.instanceId === item.instanceId && entry.sourceId === item.sourceId)
    if (!slot || observations.some((entry) => entry.slotId === slot.id)) return undefined
    if (item.media !== undefined && (!record(item.media) || !nonnegative(item.media.naturalWidth) || !nonnegative(item.media.naturalHeight) || typeof item.media.objectFit !== 'string' || typeof item.media.objectPosition !== 'string')) return undefined
    if (item.style !== undefined && (!record(item.style) || typeof item.style.color !== 'string' || typeof item.style.backgroundColor !== 'string' || typeof item.style.borderColor !== 'string')) return undefined
    observations.push({ slotId: slot.id, instanceId: slot.instanceId, sourceId: slot.sourceId, rect: item.rect, ...(item.media ? { media: item.media as SlotObservation['media'] } : {}), ...(item.style ? { style: item.style as SlotObservation['style'] } : {}) })
  }
  if (value.cta !== undefined && !rect(value.cta)) return undefined
  return { measuredAt: value.measuredAt, width: expected.width, height: expected.height, slots: observations, ...(value.cta ? { cta: value.cta as ElementRect } : {}) }
}

export const intersectionArea = (a: ElementRect, b: ElementRect) => Math.max(0, Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x)) * Math.max(0, Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y))

export function centerCoverCrop(naturalWidth: number, naturalHeight: number, width: number, height: number) {
  if (![naturalWidth, naturalHeight, width, height].every((value) => value > 0)) return undefined
  const scale = Math.max(width / naturalWidth, height / naturalHeight)
  return { x: (naturalWidth - width / scale) / 2, y: (naturalHeight - height / scale) / 2, width: width / scale, height: height / scale }
}

export function measurementEvidence(id: string, caseId: CaseId, route: string, measurement: PreviewMeasurement, context: PreviewEvidenceContext): Evidence {
  const overlap = measurement.cta && measurement.slots.some((slot) => intersectionArea(slot.rect, measurement.cta!) > 0)
  return { id, caseId, type: 'LAYOUT', route, viewport: `${measurement.width}x${measurement.height}`, summary: overlap ? '当前页面元素与购买按钮发生重叠' : '当前页面浏览器布局观测', sourcePath: `inline://${id}`, origin: 'real', producer: 'A-preview', verification: 'verified', context, measurement }
}
