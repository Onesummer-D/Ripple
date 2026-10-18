import { createRequire } from 'node:module'
import path from 'node:path'
import { sourceAnnotationPlugin } from './source-annotation.ts'

const require = createRequire('/ripple/core/package.json')
const ts = require('/ripple/node_modules/typescript')
const reactModule = require('@vitejs/plugin-react')
const react = reactModule.default ?? reactModule

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
  plugins: [sourceAnnotationPlugin('/work'), react()],
  resolve: { alias: typescriptAliases() },
  cacheDir: '/tmp/ripple-vite-cache',
  optimizeDeps: { noDiscovery: true, include: [] },
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
