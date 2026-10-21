import { describe, expect, it } from 'vitest'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * scripts/thirdparty-acceptance.ts 的 smoke test（协调人 P1：探针自身要有测试）。
 *
 * 验证报告字段、错误退出路径与"committed JSON 不含本机绝对路径"的红线。
 * 用例是真实 git fixture + 真实子进程调用，不 mock 脚本行为。
 */

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-acceptance-smoke-'))
  temporaryRoots.push(root)
  return root
}
const git = (root: string, ...args: string[]) => execFileSync('git', ['-C', root, ...args], { stdio: 'pipe' })
const cleanup = () => {
  for (const root of temporaryRoots.splice(0)) {
    try { fs.rmSync(root, { recursive: true, force: true }) } catch { /* 已知 Windows 噪音 */ }
  }
}

function makeProject(): string {
  const root = temp()
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'smoke-project', private: true }))
  fs.mkdirSync(path.join(root, 'src'), { recursive: true })
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `export const App = () => <main><h1>Smoke Title</h1></main>`)
  git(root, 'init', '-q')
  git(root, 'config', 'user.email', 'ripple-tests@example.invalid')
  git(root, 'config', 'user.name', 'Ripple tests')
  git(root, 'add', '.')
  git(root, 'commit', '-qm', 'baseline')
  return root
}

const runScript = (args: string[]): { status: number; stdout: string; stderr: string } => {
  try {
    const stdout = execFileSync(process.execPath, [
      '--experimental-transform-types', '--loader', './scripts/ts-extension-loader.mjs',
      'scripts/thirdparty-acceptance.ts', ...args,
    ], { encoding: 'utf8', cwd: process.cwd() })
    return { status: 0, stdout, stderr: '' }
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string }
    return { status: e.status ?? -1, stdout: e.stdout ?? '', stderr: e.stderr ?? '' }
  }
}

describe('thirdparty-acceptance.ts smoke（能力探针自身的验收边界）', () => {
  it('正常路径：报告含 schemaVersion/SHA/定位声明，且不泄露本机绝对路径', () => {
    const root = makeProject()
    const head = git(root, 'rev-parse', 'HEAD').toString().trim()
    try {
      const { status, stdout } = runScript([root, '--expect-sha', head])
      expect(status).toBe(0)
      const report = JSON.parse(stdout)
      expect(report.schemaVersion).toBe(1)
      expect(report.positioning).toContain('capability probe')
      expect(report.projectDir).toBe(path.basename(root))
      expect(report.projectSha).toBe(head)
      expect(report.expectShaMatched).toBe(true)
      expect(report.rippleHead).toMatch(/^[0-9a-f]{40}$/)
      expect(report.stats.nodes).toBeGreaterThan(0)
      expect(report).not.toHaveProperty('projectRoot')
      // 红线：输出中不得出现本机绝对路径（Windows 盘符形态）
      expect(stdout).not.toMatch(/[A-Za-z]:[\\/][^\s"]+/)
    } finally { cleanup() }
  })

  it('--expect-sha 不匹配：拒绝生成报告并非零退出', () => {
    const root = makeProject()
    try {
      const { status, stdout } = runScript([root, '--expect-sha', '0'.repeat(40)])
      expect(status).not.toBe(0)
      expect(stdout).toBe('')
    } finally { cleanup() }
  })

  it('目录不存在或不是 git 仓库：非零退出，无貌似可信的报告', () => {
    const missing = path.join(process.cwd(), 'node_modules', '.tmp', 'definitely-not-here-12345')
    const { status, stdout } = runScript([missing])
    expect(status).not.toBe(0)
    expect(stdout).toBe('')
  })

  it('工作区不干净：复用 analyzeProject 的 clean-worktree 检查，拒绝生成报告', () => {
    const root = makeProject()
    try {
      fs.writeFileSync(path.join(root, 'src', 'App.tsx'), `export const App = () => <main><h1>Dirty</h1></main>`)
      const { status, stdout } = runScript([root])
      expect(status).not.toBe(0)
      expect(stdout).toBe('')
    } finally { cleanup() }
  })

  it('CLI 严格校验：--expect-sha 缺值/选项误作值/非法 SHA/重复 均非零退出且无报告', () => {
    const root = makeProject()
    const head = git(root, 'rev-parse', 'HEAD').toString().trim()
    try {
      // 缺值
      expect(runScript([root, '--expect-sha']).status).not.toBe(0)
      // 下一个选项被误当参数值
      expect(runScript([root, '--expect-sha', '--out', 'x']).status).not.toBe(0)
      // 非法 SHA（非 40 位十六进制）
      expect(runScript([root, '--expect-sha', 'xyz']).status).not.toBe(0)
      expect(runScript([root, '--expect-sha', '0'.repeat(39)]).status).not.toBe(0)
      // 重复出现
      const dup = runScript([root, '--expect-sha', head, '--expect-sha', head])
      expect(dup.status).not.toBe(0)
      expect(dup.stdout).toBe('')
      // 对照：合法大写 SHA 应被接受（大小写不敏感，正常路径不破）
      expect(runScript([root, '--expect-sha', head.toUpperCase()]).status).toBe(0)
    } finally { cleanup() }
  })

  it('CLI 严格校验：--out 缺值/未知参数/多余位置参数 均非零退出且无报告', () => {
    const root = makeProject()
    try {
      expect(runScript([root, '--out']).status).not.toBe(0)
      expect(runScript([root, '--out', '--expect-sha']).status).not.toBe(0)
      const unknown = runScript([root, '--bogus'])
      expect(unknown.status).not.toBe(0)
      expect(unknown.stdout).toBe('')
      const extra = runScript([root, 'extra-positional'])
      expect(extra.status).not.toBe(0)
      expect(extra.stdout).toBe('')
    } finally { cleanup() }
  })
})
