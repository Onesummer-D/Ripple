import { useEffect, useMemo, useRef, useState, type RefObject } from 'react'
import type { CaseId, EditableSlot, Evidence, PreviewEvidenceContext } from '../domain/contracts'
import { measurementEvidence, parseMeasurement } from '../preview/measurement'
import type { PreviewViewport } from '../preview/viewports'

export function usePreviewMeasurement({ frame, requestKey, caseId, route, viewport, values, context, onEvidence }: {
  frame: RefObject<HTMLIFrameElement | null>
  requestKey: string
  caseId: CaseId
  route: string
  viewport: PreviewViewport
  values: EditableSlot[]
  context: PreviewEvidenceContext
  onEvidence: (evidence?: Evidence) => void
}) {
  const [session] = useState(() => crypto.randomUUID())
  const sequence = useRef(0)
  const requestId = useRef('')
  const [sample, setSample] = useState<{ key: string; evidence: Evidence }>()
  const [failedKey, setFailedKey] = useState<string>()
  const current = useRef({ requestKey, caseId, route, viewport, values, context })
  current.current = { requestKey, caseId, route, viewport, values, context }
  const request = () => {
    requestId.current = `${session}-${++sequence.current}`
    frame.current?.contentWindow?.postMessage({ type: 'ripple:measure', requestId: requestId.current }, '*')
  }
  useEffect(() => {
    const timeout = setTimeout(() => setFailedKey(requestKey), 6000)
    const receive = (event: MessageEvent<unknown>) => {
      if (!frame.current?.contentWindow || event.source !== frame.current.contentWindow) return
      const active = current.current
      if (active.requestKey !== requestKey) return
      const measurement = parseMeasurement(event.data, { requestId: requestId.current, caseId: active.caseId, route: active.route, width: active.viewport.width, height: active.viewport.height, slots: active.values })
      if (!measurement) return
      clearTimeout(timeout)
      setSample({ key: requestKey, evidence: measurementEvidence(`E-LIVE-${active.caseId}-${requestId.current}`, active.caseId, active.route, measurement, active.context) })
    }
    window.addEventListener('message', receive)
    request()
    return () => { clearTimeout(timeout); window.removeEventListener('message', receive) }
  }, [requestKey, frame])
  const evidence = useMemo(() => sample?.key === requestKey ? sample.evidence : undefined, [sample, requestKey])
  useEffect(() => { onEvidence(evidence) }, [evidence, onEvidence])
  return { evidence, request, unavailable: failedKey === requestKey && !evidence }
}
