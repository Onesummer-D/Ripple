// @vitest-environment node
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { previewResourceCspSources, referencedPreviewResourceUrls, saveTrustedPreviewResourceUrls, trustedPreviewResourceUrls, validatePreviewResourceUrls } from './preview-resource-policy'
import { removeTree } from './test-fixture-dir'

const originalStateRoot = process.env.RIPPLE_WORKBENCH_STATE_DIR
let stateRoot = ''
let projectRoot = ''

afterEach(() => {
  if (originalStateRoot === undefined) delete process.env.RIPPLE_WORKBENCH_STATE_DIR
  else process.env.RIPPLE_WORKBENCH_STATE_DIR = originalStateRoot
  if (stateRoot) removeTree(stateRoot)
  if (projectRoot) removeTree(projectRoot)
  stateRoot = ''
  projectRoot = ''
})

describe('preview external resource authorization', () => {
  it('keeps hostile source references as suggestions until the user explicitly authorizes an exact HTTPS path', () => {
    stateRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-resource-state-'))
    projectRoot = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-resource-project-'))
    process.env.RIPPLE_WORKBENCH_STATE_DIR = stateRoot
    fs.mkdirSync(path.join(projectRoot, 'src'))
    fs.writeFileSync(path.join(projectRoot, 'src', 'App.jsx'), `// attacker suggestion https://untrusted.invalid/pixel.png\nexport const image = 'https://assets.example.test/static/hero.webp'`)
    const git = (...args: string[]) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe' })
    git('init', '-q'); git('config', 'user.email', 'policy@example.invalid'); git('config', 'user.name', 'Ripple policy test'); git('add', '.'); git('commit', '-qm', 'source with external references')
    const projectId = 'project-policy-test'

    expect(referencedPreviewResourceUrls(projectRoot)).toEqual([
      'https://assets.example.test/static/hero.webp',
      'https://untrusted.invalid/pixel.png',
    ])
    expect(trustedPreviewResourceUrls(projectId)).toEqual([])

    const saved = saveTrustedPreviewResourceUrls(projectId, ['https://assets.example.test/static/hero.webp'])
    expect(saved).toEqual(['https://assets.example.test/static/hero.webp'])
    expect(trustedPreviewResourceUrls(projectId)).toEqual(saved)
    expect(previewResourceCspSources(saved)).toEqual(['https://assets.example.test/static/hero.webp'])
    expect(previewResourceCspSources(['https://assets.example.test/static/hero.webp'])).not.toContain('https://assets.example.test')
  })

  it('rejects unsafe schemes, local targets, credentials, and CSP directive injection', () => {
    for (const url of [
      'http://assets.example.test/image.webp',
      'https://localhost/image.webp',
      'https://127.0.0.1/image.webp',
      'https://[::1]/image.webp',
      'https://assets.example.test/',
      'https://assets.example.test/static/',
      'https://user:password@assets.example.test/image.webp',
      'https://assets.example.test/image.webp; img-src https://attacker.invalid',
      'https://assets.example.test/image.webp#fragment',
    ]) expect(() => validatePreviewResourceUrls([url])).toThrow()
  })
})
