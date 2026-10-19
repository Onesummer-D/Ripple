import { createRequire } from 'node:module'
import { isIP } from 'node:net'
import path from 'node:path'
import { sourceAnnotationPlugin } from './source-annotation.ts'

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

function parseProjectConfig(configPath) {
  const config = ts.readConfigFile(configPath, ts.sys.readFile)
  if (config.error) return undefined
  const parsed = ts.getParsedCommandLineOfConfigFile(configPath, {}, {
    ...ts.sys,
    onUnRecoverableConfigFileDiagnostic: () => {},
  })
  return { configPath, raw: config.config, parsed }
}

function entryFiles() {
  const html = ts.sys.readFile('/work/index.html') ?? ''
  const moduleTags = [...html.matchAll(/<script\b[^>]*\btype=["']module["'][^>]*>/gi)].map(match => match[0])
  return moduleTags
    .map(tag => tag.match(/\bsrc=["']([^"']+)["']/i)?.[1])
    .filter(source => source && !/^(?:[a-z]+:|\/\/)/i.test(source))
    .map(source => path.resolve('/work', source.replace(/^\/+/, '').split(/[?#]/, 1)[0]))
}

function typescriptAliases() {
  const roots = ['tsconfig.json', 'jsconfig.json']
    .map(name => path.join('/work', name))
    .filter(file => ts.sys.fileExists(file))
  const pending = [...roots]
  const visited = new Set()
  const configs = []

  while (pending.length) {
    const configPath = path.resolve(pending.shift())
    if (visited.has(configPath)) continue
    visited.add(configPath)

    const config = parseProjectConfig(configPath)
    if (!config) continue
    configs.push(config)

    for (const reference of Array.isArray(config.raw.references) ? config.raw.references : []) {
      if (typeof reference?.path !== 'string') continue
      const referencePath = path.resolve(path.dirname(configPath), reference.path)
      const target = ts.sys.directoryExists(referencePath)
        ? path.join(referencePath, 'tsconfig.json')
        : referencePath
      if (ts.sys.fileExists(target)) pending.push(target)
    }
  }

  const aliasConfigs = configs.filter(({ parsed }) => Object.keys(parsed?.options.paths ?? {}).length > 0)
  if (!aliasConfigs.length) return []

  const entries = new Set(entryFiles())
  const containingEntry = aliasConfigs.filter(({ parsed }) =>
    parsed?.fileNames.some(file => entries.has(path.resolve(file))),
  )
  const jsxConfigs = aliasConfigs.filter(({ parsed }) => parsed?.options.jsx !== undefined)
  const candidates = containingEntry.length
    ? containingEntry
    : jsxConfigs.length
      ? jsxConfigs
      : aliasConfigs
  const signatures = new Set(candidates.map(({ configPath, parsed }) => JSON.stringify({
    baseUrl: parsed?.options.baseUrl ?? parsed?.options.pathsBasePath ?? path.dirname(configPath),
    paths: parsed?.options.paths,
  })))
  if (signatures.size > 1) {
    throw new Error('Ripple preview cannot safely resolve conflicting TypeScript path aliases in referenced configs')
  }

  const { configPath, parsed } = candidates[0]
  if (!parsed) return []
  const baseUrl = parsed.options.baseUrl ?? parsed.options.pathsBasePath ?? path.dirname(configPath)
  const aliases = []
  for (const [pattern, destinations] of Object.entries(parsed.options.paths ?? {})) {
    if (destinations.length !== 1) continue
    const target = destinations[0]
    const wildcard = pattern.indexOf('*')
    if (wildcard < 0) {
      if (!target.includes('*')) aliases.push({ find: pattern, replacement: path.resolve(baseUrl, target) })
      continue
    }
    if (pattern.indexOf('*', wildcard + 1) >= 0 || target.indexOf('*') !== target.lastIndexOf('*')) continue
    const prefix = pattern.slice(0, wildcard).replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    const suffix = pattern.slice(wildcard + 1).replace(/[.*+?^$()|[\]\\]/g, '\\$&')
    const targetIndex = target.indexOf('*')
    const targetPrefix = target.slice(0, targetIndex)
    const targetSuffix = target.slice(targetIndex + 1)
    aliases.push({
      find: new RegExp('^' + prefix + '(.*)' + suffix + '$'),
      replacement: path.resolve(baseUrl, targetPrefix) + path.sep + '$1' + targetSuffix,
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
      'content-security-policy': contentSecurityPolicy,
      'referrer-policy': 'no-referrer',
      'x-content-type-options': 'nosniff',
    },
  },
}
