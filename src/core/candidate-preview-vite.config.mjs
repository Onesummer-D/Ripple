import { createRequire } from 'node:module'
import path from 'node:path'
import { sourceAnnotationPlugin } from './source-annotation.ts'

const require = createRequire('/ripple/core/package.json')
const ts = require('/ripple/node_modules/typescript')
const reactModule = require('@vitejs/plugin-react')
const react = reactModule.default ?? reactModule

function selectionBridge() {
  const script = `<script>
(() => {
  let active = false;
  let token = '';
  let candidateId = '';
  let hovered = null;
  const style = document.createElement('style');
  style.textContent = '[data-ripple-select-hover="true"]{outline:2px solid #a8c477!important;outline-offset:2px!important;cursor:crosshair!important}';
  document.head.append(style);
  const clearHover = () => { if (hovered) hovered.removeAttribute('data-ripple-select-hover'); hovered = null; };
  window.addEventListener('message', event => {
    const data = event.data;
    if (event.source !== window.parent || !data || data.type !== 'ripple:selection-mode') return;
    token = typeof data.token === 'string' ? data.token : '';
    candidateId = typeof data.candidateId === 'string' ? data.candidateId : '';
    active = data.enabled === true && !!token && !!candidateId;
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
      type: 'ripple:element-selected', token, candidateId,
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
    transformIndexHtml: { order: 'post', handler: (html) => html.replace('</body>', `${script}</body>`) },
  }
}

function typescriptAliases() {
  const configPath = ['tsconfig.json', 'tsconfig.app.json', 'jsconfig.json']
    .map(name => path.join('/work', name))
    .find(file => ts.sys.fileExists(file))
  if (!configPath) return []

  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) return []
  const parsed = ts.parseJsonConfigFileContent(config.config, ts.sys, path.dirname(configPath), undefined, configPath)
  const aliases = []
  for (const [pattern, destinations] of Object.entries(parsed.options.paths ?? {})) {
    if (destinations.length !== 1) continue
    const target = destinations[0]
    const wildcard = pattern.indexOf('*')
    if (wildcard < 0) {
      if (!target.includes('*')) aliases.push({ find: pattern, replacement: path.resolve(parsed.options.baseUrl ?? '/work', target) })
      continue
    }
    if (pattern.indexOf('*', wildcard + 1) >= 0 || target.indexOf('*') !== target.lastIndexOf('*')) continue
    const prefix = pattern.slice(0, wildcard).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const suffix = pattern.slice(wildcard + 1).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const targetIndex = target.indexOf('*')
    const targetPrefix = target.slice(0, targetIndex)
    const targetSuffix = target.slice(targetIndex + 1)
    aliases.push({
      find: new RegExp(`^${prefix}(.*)${suffix}$`),
      replacement: `${path.resolve(parsed.options.baseUrl ?? '/work', targetPrefix)}$1${targetSuffix}`,
    })
  }
  return aliases
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
    fs: { strict: true, allow: ['/work', '/deps', '/ripple/core', '/ripple/node_modules'] },
    headers: {
      'content-security-policy': "default-src 'self' data: blob:; script-src 'self' 'unsafe-inline' 'unsafe-eval'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' data: https://fonts.gstatic.com; img-src 'self' data: blob: https:; media-src 'self' data: blob:; connect-src 'self'; form-action 'none'; object-src 'none'; base-uri 'none'; frame-src 'none'",
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  },
}
