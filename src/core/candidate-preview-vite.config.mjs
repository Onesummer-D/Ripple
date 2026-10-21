import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import { resolveProjectConfigGraph, toViteAliasRules } from './project-config-resolver.mjs'
import { sourceAnnotationPlugin } from './source-annotation.ts'
import { buildPreviewCsp } from './preview-csp.mjs'

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
// Snapshot-authorized font dependencies must be loadable by the page, not just
// by the verification route layer; buildPreviewCsp adds the fonts.gstatic.com
// font origin only when a stylesheet was authorized (Run #12: 22,624 blocked-
// font console errors). Per-URL authorization stays enforced by the route.
const contentSecurityPolicy = buildPreviewCsp(approvedResourceUrls)

function selectionBridge() {
  const script = `<script>
(() => {
  let active = false;
  let token = '';
  let previewId = '';
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
    window.parent.postMessage({
      type: 'ripple:element-selected', token, previewId,
      sourceRef: target.getAttribute('data-ripple-source'),
      runtimeInstanceId: target.getAttribute('data-ripple-instance'),
      identityCertainty: target.getAttribute('data-ripple-identity-certainty') || 'unknown',
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
        .replace('</body>', `${script}</body>`),
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
