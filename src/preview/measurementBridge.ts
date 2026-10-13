export const measurementBridge = `
<script>
(() => {
  let latestRequest;
  const bounds = (node) => { const r = node.getBoundingClientRect(); return { x: r.x, y: r.y, width: r.width, height: r.height }; };
  addEventListener('message', async (event) => {
    if (event.source !== parent || !event.data || event.data.type !== 'ripple:measure' || typeof event.data.requestId !== 'string') return;
    const requestId = event.data.requestId;
    latestRequest = requestId;
    await Promise.all(Array.from(document.images, image => image.decode().catch(() => {})));
    await document.fonts.ready;
    // Geometry reads flush layout after resources settle, including offscreen frames.
    // Animation frames can be suspended when the inspector scrolls this frame out of view.
    if (requestId !== latestRequest) return;
    const slots = Array.from(document.querySelectorAll('[data-slot-id]'), node => {
      const observation = { slotId: node.dataset.slotId, instanceId: node.dataset.instanceId, sourceId: node.dataset.sourceId, rect: bounds(node) };
      if (node instanceof HTMLImageElement) { const style = getComputedStyle(node); observation.media = { naturalWidth: node.naturalWidth, naturalHeight: node.naturalHeight, objectFit: style.objectFit, objectPosition: style.objectPosition }; }
      const consumer = node.querySelector('[data-token-consumer]');
      if (consumer) { const style = getComputedStyle(consumer); observation.style = { color: style.color, backgroundColor: style.backgroundColor, borderColor: style.borderTopColor }; }
      return observation;
    });
    const cta = document.querySelector('[data-testid="purchase-cta"]');
    parent.postMessage({ type: 'ripple:measurement', requestId, caseId: document.body.dataset.caseId, route: document.body.dataset.route, measuredAt: new Date().toISOString(), width: innerWidth, height: innerHeight, slots, ...(cta ? { cta: bounds(cta) } : {}) }, '*');
  });
})();
</script>`

export const withMeasurementBridge = (document: string) => document.replace('</body>', measurementBridge + '</body>')
