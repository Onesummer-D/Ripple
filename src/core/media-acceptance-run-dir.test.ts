import { afterEach, describe, expect, it } from 'vitest'
import * as fs from 'node:fs'
import * as path from 'node:path'
import { allocateRunDir, detectPreservedScenes } from './media-acceptance-run-dir'
import { removeTree } from './test-fixture-dir'

const temporaryRoots: string[] = []
const temp = () => {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-run-dir-'))
  temporaryRoots.push(root)
  return root
}
afterEach(() => {
  // git 夹具的只读对象文件在 Windows 上触发 rmSync EPERM；统一走 test-fixture-dir 的
  // chmod-first + 重试清理（Linux 行为不变）。
  for (const root of temporaryRoots.splice(0)) {
    try { removeTree(root) } catch { /* 已知环境噪音 */ }
  }
})

const writeSceneManifest = (runDir: string, manifest: Record<string, unknown>) => {
  fs.mkdirSync(runDir, { recursive: true })
  fs.writeFileSync(path.join(runDir, 'SCENE-PRESERVED.json'), JSON.stringify(manifest, null, 2))
}

describe('media-acceptance-run-dir（P1-2：运行目录隔离与保留现场发现）', () => {
  it('空 workRoot：分配唯一 run 目录，无历史现场', () => {
    const workRoot = path.join(temp(), 'acceptance')
    const { workDir, preservedScenes } = allocateRunDir(workRoot, new Date('2026-10-21T06:00:00Z'))
    expect(path.basename(workDir)).toMatch(/^run-2026-10-21T06-00-00-[0-9a-f]{6}$/)
    expect(fs.existsSync(workDir)).toBe(true)
    expect(preservedScenes).toEqual([])
  })

  it('回滚失败 → 保留现场 → 同 workRoot 重试：旧现场不被覆盖、清单字段可读', () => {
    const workRoot = path.join(temp(), 'acceptance')
    // 第一轮：保留现场
    const first = allocateRunDir(workRoot, new Date('2026-10-21T06:00:00Z'))
    const sceneCopy = path.join(first.workDir, 'project-src')
    fs.mkdirSync(sceneCopy)
    fs.writeFileSync(path.join(sceneCopy, 'products.ts'), '// 应用后状态')
    writeSceneManifest(first.workDir, {
      schemaVersion: 'ripple-media-scene-preserved/v1',
      preservedAt: '2026-10-21T06:05:00.000Z',
      recoveryState: 'recovery-failed',
      projectSrc: sceneCopy,
      candidate: { id: 'cand-1', patchHash: 'p'.repeat(64) },
    })

    // 第二轮（同 workRoot 重试）：必须获得新目录且检测到旧现场
    const second = allocateRunDir(workRoot, new Date('2026-10-21T06:10:00Z'))
    expect(second.workDir).not.toBe(first.workDir)
    expect(second.preservedScenes).toHaveLength(1)
    expect(second.preservedScenes[0]!.location).toBe(first.workDir)
    expect(second.preservedScenes[0]!.recoveryState).toBe('recovery-failed')
    expect(second.preservedScenes[0]!.candidateId).toBe('cand-1')

    // 旧现场完好：副本与清单都未被触碰
    expect(fs.readFileSync(path.join(sceneCopy, 'products.ts'), 'utf8')).toBe('// 应用后状态')
    expect(fs.existsSync(path.join(first.workDir, 'SCENE-PRESERVED.json'))).toBe(true)
  })

  it('成功运行目录（无清单）不被误报为保留现场', () => {
    const workRoot = path.join(temp(), 'acceptance')
    const first = allocateRunDir(workRoot)
    fs.writeFileSync(path.join(first.workDir, 'acceptance.json'), '{}')
    const second = allocateRunDir(workRoot)
    expect(second.preservedScenes).toEqual([])
  })

  it('旧版布局 workRoot/project-src 视为潜在现场并被新运行目录避开', () => {
    const workRoot = path.join(temp(), 'acceptance')
    fs.mkdirSync(workRoot, { recursive: true })
    fs.mkdirSync(path.join(workRoot, 'project-src'))
    const { workDir, preservedScenes } = allocateRunDir(workRoot)
    expect(preservedScenes).toHaveLength(1)
    expect(preservedScenes[0]!.scenePath).toBe(path.join(workRoot, 'project-src'))
    // 新运行在 run-* 子目录中，与旧现场隔离
    expect(path.dirname(workDir)).toBe(workRoot)
    expect(workDir).not.toBe(path.join(workRoot, 'project-src'))
    expect(fs.existsSync(path.join(workRoot, 'project-src'))).toBe(true)
  })

  it('符号链接条目在发现阶段不被跟随', () => {
    const workRoot = path.join(temp(), 'acceptance')
    const outside = path.join(temp(), 'outside')
    fs.mkdirSync(outside)
    const targetFile = path.join(outside, 'secret.txt')
    fs.writeFileSync(targetFile, 'sensitive')
    fs.mkdirSync(workRoot)
    fs.symlinkSync(outside, path.join(workRoot, 'run-evil'), 'junction')
    const scenes = detectPreservedScenes(workRoot)
    // 链接目录下没有 SCENE-PRESERVED.json，且绝不能因跟随链接而读到外部内容
    expect(scenes).toEqual([])
    expect(fs.readFileSync(targetFile, 'utf8')).toBe('sensitive')
  })
})
