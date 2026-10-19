import { createHash, randomUUID } from 'node:crypto'
import { isIP } from 'node:net'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { workbenchStateRoot } from './workbench-store'
import { trackedProjectFiles } from './project'

const allowedSourceExtensions = /\.(?:[cm]?[jt]sx?|css|html?|svg|json)$/i
const urlPattern = /https:\/\/[^\s"'`<>()[\]{}]+/g

export class PreviewResourcePolicyError extends Error {
  constructor(message: string) { super(message); this.name = 'PreviewResourcePolicyError' }
}

export function validatePreviewResourceUrls(value: unknown): string[] {
  if (!Array.isArray(value) || value.length > 200) throw new PreviewResourcePolicyError('外部资源授权必须是最多 200 项的 URL 列表')
  const urls = new Set<string>()
  for (const entry of value) {
    if (typeof entry !== 'string' || entry.length > 2048) throw new PreviewResourcePolicyError('外部资源 URL 无效')
    let url: URL
    try { url = new URL(entry) } catch { throw new PreviewResourcePolicyError(`外部资源 URL 无效：${entry}`) }
    const hostname = url.hostname.replace(/^\[|\]$/g, '')
    if (url.protocol !== 'https:' || url.username || url.password || url.hash || /[;\s'"<>\\]/.test(url.pathname) || url.pathname === '/' || url.pathname.endsWith('/') || !hostname || isIP(hostname) || hostname === 'localhost' || hostname.endsWith('.localhost') || hostname.endsWith('.local')) {
      throw new PreviewResourcePolicyError(`仅能授权无凭证、非本机的 HTTPS 静态资源：${entry}`)
    }
    urls.add(url.href)
  }
  const normalized = [...urls].sort()
  if (normalized.reduce((size, url) => size + url.length + 3, 0) > 6000) throw new PreviewResourcePolicyError('预演资源授权总长度不能超过 6 KiB')
  return normalized
}

function extractUrls(sources: string[]): string[] {
  const urls = new Set<string>()
  for (const source of sources) {
    for (const match of source.matchAll(urlPattern)) {
      const candidate = match[0].replace(/[),.;]+$/, '')
      try {
        const url = new URL(candidate)
        if (url.protocol === 'https:' && !url.username && !url.password && !url.hash) urls.add(url.href)
      } catch { /* Invalid references are omitted from suggestions. */ }
    }
  }
  return [...urls].sort()
}

export function referencedPreviewResourceUrls(projectRoot: string): string[] {
  const sources: string[] = []
  for (const relative of trackedProjectFiles(projectRoot)) {
    if (!allowedSourceExtensions.test(relative)) continue
    const file = path.join(projectRoot, relative)
    const stat = fs.lstatSync(file)
    if (stat.isSymbolicLink() || !stat.isFile() || stat.size > 2 * 1024 * 1024) continue
    sources.push(fs.readFileSync(file, 'utf8'))
  }
  return extractUrls(sources)
}

function policyPath(projectId: string): string {
  if (!projectId || projectId.length > 256) throw new PreviewResourcePolicyError('项目身份无效')
  const root = workbenchStateRoot()
  return path.join(root, 'preview-resource-authorizations', `${createHash('sha256').update(projectId).digest('hex')}.json`)
}

export function trustedPreviewResourceUrls(projectId: string): string[] {
  const root = workbenchStateRoot()
  if (!fs.existsSync(root)) return []
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new PreviewResourcePolicyError('Workbench state root is not a normal directory')
  const file = policyPath(projectId)
  if (!fs.existsSync(file)) return []
  const directoryStat = fs.lstatSync(path.dirname(file))
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new PreviewResourcePolicyError('资源授权目录无效')
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new PreviewResourcePolicyError('资源授权记录不是普通文件')
  const value: unknown = JSON.parse(fs.readFileSync(file, 'utf8'))
  if (!value || typeof value !== 'object' || !('projectId' in value) || value.projectId !== projectId || !('urls' in value)) throw new PreviewResourcePolicyError('资源授权记录无效')
  return validatePreviewResourceUrls(value.urls)
}

export function saveTrustedPreviewResourceUrls(projectId: string, urls: unknown): string[] {
  const normalized = validatePreviewResourceUrls(urls)
  const file = policyPath(projectId)
  const root = workbenchStateRoot()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new PreviewResourcePolicyError('Workbench state root is not a normal directory')
  const directory = path.dirname(file)
  fs.mkdirSync(directory, { recursive: true, mode: 0o700 })
  const directoryStat = fs.lstatSync(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new PreviewResourcePolicyError('资源授权目录无效')
  const temporary = path.join(directory, `.resources-${randomUUID()}.tmp`)
  fs.writeFileSync(temporary, JSON.stringify({ projectId, urls: normalized }), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try { fs.renameSync(temporary, file) }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
  return normalized
}

export function previewResourceCspSources(urls: unknown): string[] {
  return validatePreviewResourceUrls(urls).map(value => {
    const url = new URL(value)
    return `${url.origin}${url.pathname}`
  })
}
