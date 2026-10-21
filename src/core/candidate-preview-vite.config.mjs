import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import { resolveProjectConfigGraph, toViteAliasRules } from './project-config-resolver.mjs'
import { sourceAnnotationPlugin } from './source-annotation.ts'
import { previewCspForRequest } from './preview-csp.mjs'
import { analyzeNodeModulesDeps } from './preview-optimize-deps-excludes.mjs'
import { collectRuntimeIdentitySnapshot } from './runtime-identity.ts'
import { insertCandidateSelectionBridge } from './candidate-selection-bridge-html.ts'

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
// The CSP is set per request, not via server.headers: only the isolated
// verification runner's navigations carry the font-dependency header
// (see preview-csp.mjs), so interactive workbench previews keep the strict
// authorized-URL-only font-src while verification pages can load their
// hash-verified snapshot fonts. Pages cannot attach custom headers to document
// navigations, so the widened shape cannot leak into interactive sessions.
function requestCsp() {
  return {
    name: 'ripple-request-csp',
    configureServer(server) {
      server.middlewares.use((request, response, next) => {
        // Shape follows the request, not the response type: API-style fetches
        // (Accept: */*) must see the same policy as navigations, and only
        // requests carrying the runner header ever get the widened shape.
        response.setHeader('content-security-policy', previewCspForRequest(request.headers, approvedResourceUrls))
        // Document responses must never replay one shape's CSP from a
        // heuristic cache into the other context.
        if (request.method === 'GET' && String(request.headers.accept ?? '').includes('text/html')) {
          response.setHeader('cache-control', 'no-store')
        }
        next()
      })
    },
  }
}

function selectionBridge() {
  // The collector is self-contained by contract; serialization uses Vite's compiled JS function.
  const collectorCode = `(${collectRuntimeIdentitySnapshot.toString()})`
  const script = `<script>
(() => {
  let active = false;
  let token = '';
  let previewId = '';
  let hovered = null;
  const collectRuntimeIdentitySnapshot = ${collectorCode};
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
    // Correlate the clicked DOM node with one collector record. The collector checks
    // global duplicates and completes keyed host :~ identities from React Fiber.
    const marker = 'data-ripple-selection-correlation';
    const previous = target.getAttribute(marker);
    const correlation = crypto.randomUUID();
    let snapshot;
    try {
      target.setAttribute(marker, correlation);
      snapshot = collectRuntimeIdentitySnapshot({ label: marker });
    } catch {
      snapshot = null;
    } finally {
      if (previous === null) target.removeAttribute(marker);
      else target.setAttribute(marker, previous);
    }
    const matches = snapshot?.records.filter(record => record.label === correlation) || [];
    const record = matches.length === 1 && matches[0].sourceRef === target.getAttribute('data-ripple-source')
      ? matches[0] : null;
    const valid = !!record && !!record.runtimeInstanceId && !record.runtimeInstanceId.endsWith(':~') &&
      record.certainty !== 'unmapped' && record.certainty !== 'unknown' &&
      !record.reasons.some(reason => reason !== 'source-version-unavailable');
    window.parent.postMessage({
      type: 'ripple:element-selected', protocol: 'ripple-runtime-identity/v1', token, previewId,
      sourceRef: target.getAttribute('data-ripple-source'),
      runtimeInstanceId: valid ? record.runtimeInstanceId : undefined,
      identityCertainty: valid ? record.certainty : 'unknown',
      reasons: record?.reasons || ['instance-unavailable'],
      sourceVersion: record?.sourceVersion,
      pageContext: snapshot?.page || { pathname: location.pathname, search: location.search, hash: location.hash },
      sameSourceCount: record?.sameSourceCount || 0,
      domNode: record?.domNode,
      tagName: target.tagName.toLowerCase(), text: (target.textContent || '').trim().slice(0, 300)
    }, '*');
  }, true);
})();
</script>`
  return {
    name: 'ripple-candidate-selection-bridge',
    transformIndexHtml: {
      order: 'post',
      handler: (html) => insertCandidateSelectionBridge(html, script),
    },
  }
}

function typescriptAliases() {
  const graph = resolveProjectConfigGraph('/work', ts)
  if (graph.aliases.status === 'ambiguous') throw new Error(graph.aliases.reason)
  return toViteAliasRules(graph)
}

// Dependency-origin classification for the restricted discovery below. A
// scan failure MUST NOT open every dependency to prebundling: when the
// analysis reports ok:false, refuse optimization entirely and keep the
// previous noDiscovery behavior.
const depDiscovery = analyzeNodeModulesDeps('/work')

export default {
  configFile: false,
  root: '/work',
  plugins: [requestCsp(), sourceAnnotationPlugin('/work'), react(), selectionBridge()],
  resolve: { alias: typescriptAliases(), preserveSymlinks: true },
  cacheDir: '/tmp/ripple-vite-cache',
  // Restricted dependency discovery (approved experiment, coordinator
  // 2026-10-22): esbuild statically scans the entry and prebundles bare
  // node_modules imports of CONFIRMED third-party deps only. Project source
  // and workspace-linked packages (realpath outside node_modules) keep
  // flowing through sourceAnnotationPlugin module by module — data-
  // ripple-source annotations, SourceGraph bindings and Runtime Identity are
  // never skipped by prebundling. Unknown-origin symlinks are conservatively
  // excluded; a failed node_modules scan refuses optimization and falls back
  // to noDiscovery. No project Vite config, plugins or build scripts ever
  // run: configFile stays false, the plugin set is pinned here, and
  // esbuildOptions keep the production pins. holdUntilCrawlEnd collapses
  // late-discovered dynamic imports into a single re-optimization instead of
  // reloading per dependency. A prebundle failure degrades to per-module
  // serving (the previous behavior), never to skipped annotations.
  optimizeDeps: depDiscovery.ok
    ? { include: ['react', 'react-dom/client'], exclude: depDiscovery.excludes, holdUntilCrawlEnd: true, esbuildOptions: { preserveSymlinks: true } }
    : { noDiscovery: true, include: ['react', 'react-dom/client'], esbuildOptions: { preserveSymlinks: true } },
  server: {
    host: '0.0.0.0',
    port: 5173,
    strictPort: true,
    hmr: false,
    cors: { origin: 'null' },
    fs: { strict: true, allow: ['/work', '/ripple/core', '/ripple/node_modules'] },
    headers: {
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  },
}
