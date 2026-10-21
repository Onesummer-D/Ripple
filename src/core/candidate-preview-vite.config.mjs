import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import { resolveProjectConfigGraph, toViteAliasRules } from './project-config-resolver.mjs'
import { sourceAnnotationPlugin } from './source-annotation.ts'
import { collectRuntimeIdentitySnapshot } from './runtime-identity.ts'

const require = createRequire('/ripple/core/package.json')
const ts = require('/ripple/node_modules/typescript')
const reactModule = require('@vitejs/plugin-react')
const react = reactModule.default ?? reactModule
const approvedResourceUrls = JSON.parse(process.env.RIPPLE_PREVIEW_RESOURCE_URLS ?? '[]')
if (!Array.isArray(approvedResourceUrls) || approvedResourceUrls.some(value => {
  if (typeof value !== 'string') return true
  try {
    const url = new URL(value)
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    return url.protocol !== 'https:' || !!url.username || !!url.password || !!url.hash || /[;\s'"<>\\]/.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/') || isIP(hostname) !== 0 || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')
  } catch { return true }
})) throw new Error('Ripple preview resource authorization is invalid')
if (approvedResourceUrls.reduce((size, value) => size + value.length + 3, 0) > 6000) throw new Error('Ripple preview resource authorization is too large')
const externalResources = approvedResourceUrls.map(value => {
  const url = new URL(value)
  return `${url.origin}${url.pathname}`
}).join(' ')
const contentSecurityPolicy = [
  "default-src 'self' data: blob:",
  "script-src 'self' 'unsafe-inline' 'unsafe-eval'",
  `style-src 'self' 'unsafe-inline' ${externalResources}`,
  `font-src 'self' data: ${externalResources}`,
  `img-src 'self' data: blob: ${externalResources}`,
  `media-src 'self' data: blob: ${externalResources}`,
  "connect-src 'self'",
  "form-action 'none'",
  "object-src 'none'",
  "base-uri 'none'",
  "frame-src 'none'",
  "worker-src 'none'",
].join('; ')

function selectionBridge() {
  const script = `<script type="module">
const collectRuntimeIdentitySnapshot = ${collectRuntimeIdentitySnapshot.toString()};
(() => {
  let active = false;
  let token = '';
  let previewId = '';
  let candidateContext = null;
  let hovered = null;
  const style = document.createElement('style');
  style.textContent = '[data-ripple-select-hover="true"]{outline:2px solid #a8c477!important;outline-offset:2px!important;cursor:crosshair!important}';
  document.head.append(style);
  document.addEventListener('click', event => {
    if (!(event.target instanceof Element)) return;
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;
    const destination = new URL(anchor.getAttribute('href'), location.href);
    if (destination.origin !== location.origin) {
      event.preventDefault();
      event.stopImmediatePropagation();
    }
  }, true);
  document.addEventListener('submit', event => {
    event.preventDefault();
    event.stopImmediatePropagation();
  }, true);
  const clearHover = () => { if (hovered) hovered.removeAttribute('data-ripple-select-hover'); hovered = null; };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.type !== 'ripple:selection-mode') return;
    token = typeof data.token === 'string' ? data.token : '';
    previewId = typeof data.previewId === 'string' ? data.previewId : '';
    candidateContext = data.candidateId === previewId && typeof data.patchHash === 'string' && typeof data.candidateTreeDigest === 'string'
      ? { candidateId: data.candidateId, patchHash: data.patchHash, candidateTreeDigest: data.candidateTreeDigest }
      : null;
    active = data.enabled === true && !!token && !!previewId;
    if (!active) clearHover();
    document.documentElement.style.cursor = active ? 'crosshair' : '';
  });
  document.addEventListener('pointerover', event => {
    if (!active || !(event.target instanceof Element)) return;
    const target = event.target.closest('[data-ripple-source]');
    if (target === hovered) return;
    clearHover();
    hovered = target;
    if (hovered) hovered.setAttribute('data-ripple-select-hover', 'true');
  }, true);
  document.addEventListener('click', event => {
    if (!active || !(event.target instanceof Element)) return;
    const target = event.target.closest('[data-ripple-source]');
    if (!target) return;
    event.preventDefault();
    event.stopImmediatePropagation();
    // A collector pass considers the ENTIRE document when checking duplicate IDs.
    // The temporary nonce associates the clicked DOM node with exactly one record;
    // it never enters React's render tree or becomes an edit authorization.
    const sourceRef = target.getAttribute('data-ripple-source');
    const marker = crypto.randomUUID();
    const correlation = 'data-ripple-collector-target';
    let snapshot;
    let record;
    try {
      target.setAttribute(correlation, marker);
      snapshot = collectRuntimeIdentitySnapshot({ root: '[' + correlation + '="' + marker + '"]', label: correlation });
      // A selected host may itself contain annotated descendant elements. Only the
      // explicitly marked host is the clicked target; do not confuse it with children.
      const matches = snapshot.records.filter(item => item.label === marker && item.sourceRef === sourceRef);
      if (matches.length === 1) record = matches[0];
    } catch {
      // Missing Fiber/collector support always reduces the observation to unknown.
    } finally {
      if (target.getAttribute(correlation) === marker) target.removeAttribute(correlation);
    }
    const pageContext = snapshot?.page ?? { pathname: location.pathname, search: location.search, hash: location.hash };
    window.parent.postMessage({
      type: 'ripple:element-selected', protocol: 'ripple-runtime-identity/v1',
      token, previewId, ...(candidateContext || {}),
      sourceRef,
      runtimeInstanceId: record?.runtimeInstanceId,
      identityCertainty: record?.certainty || 'unknown',
      declaredCertainty: record?.declaredCertainty || 'unknown',
      reasons: record?.reasons || ['instance-unavailable'],
      sourceVersion: record?.sourceVersion,
      pageContext, sameSourceCount: record?.sameSourceCount ?? 0,
      domNode: record?.domNode,
      record: record || { sourceRef, declaredCertainty: 'unknown', certainty: 'unknown', reasons: ['instance-unavailable'], sameSourceCount: 0, domNode: 0 },
      tagName: target.tagName.toLowerCase(), text: (target.textContent || '').trim().slice(0, 300)
    }, '*');
  }, true);
})();
</script>`
  return {
    name: 'ripple-candidate-selection-bridge',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => html
        .replace(/<script\b(?=[^>]*\bsrc=["']\/@vite\/client["'])[^>]*>\s*<\/script>/g, '')
        // Function replacer is mandatory: collector source contains React's "$'" fragment.
        // A string replacer would inject the suffix of the HTML and break script syntax.
        .replace('</body>', () => `${script}</body>`),
    },
  }
}

function typescriptAliases() {
  const graph = resolveProjectConfigGraph('/work', ts)
  if (graph.aliases.status === 'ambiguous') throw new Error(graph.aliases.reason)
  return toViteAliasRules(graph)
}

export default {
  configFile: false,
  root: '/work',
  plugins: [sourceAnnotationPlugin('/work'), react(), selectionBridge()],
  resolve: { alias: typescriptAliases(), preserveSymlinks: true },
  cacheDir: '/tmp/ripple-vite-cache',
  optimizeDeps: { noDiscovery: true, include: ['react', 'react-dom/client'], esbuildOptions: { preserveSymlinks: true } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    cors: { origin: 'null' },
    fs: { strict: true, allow: ['/work', '/ripple/core', '/ripple/node_modules'] },
    headers: {
      'content-security-policy': contentSecurityPolicy,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  },
}
