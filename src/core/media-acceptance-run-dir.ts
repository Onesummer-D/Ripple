import { randomBytes } from 'node:crypto'
import * as fs from 'node:fs'
import * as path from 'node:path'

/**
 * MEDIA 验收的运行目录分配与事故现场发现（独立审查 P1-2）。
 *
 * 每次验收在 <workRoot>/run-<时间戳>-<随机> 下获得独占目录；历史运行目录
 * （含保留现场）永远不会被后续运行触碰——"保留现场"的承诺由目录隔离构造保证，
 * 不依赖调用方记得清理。
 *
 * - `detectPreservedScenes`：扫描 workRoot 下所有历史 run 目录，发现
 *   `SCENE-PRESERVED.json` 现场清单（含 v3 之前的旧版布局 workRoot/project-src），
 *   供调用方警告/拒绝自动覆盖；
 * - `allocateRunDir`：创建本次独占运行目录并返回发现的保留现场列表。
 */

export interface PreservedSceneInfo {
  /** 保留现场所在目录（run 目录或旧版 workRoot 本身） */
  location: string
  manifestPath?: string
  /** 现场副本路径（project-src worktree） */
  scenePath?: string
  preservedAt?: string
  recoveryState?: string
  candidateId?: string
}

const SCENE_MANIFEST = 'SCENE-PRESERVED.json'

export function detectPreservedScenes(workRoot: string): PreservedSceneInfo[] {
  const scenes: PreservedSceneInfo[] = []
  if (!fs.existsSync(workRoot)) return scenes
  for (const entry of fs.readdirSync(workRoot)) {
    const location = path.join(workRoot, entry)
    let stat: fs.Stats
    try {
      stat = fs.lstatSync(location)
    } catch {
      continue // 符号链接或不可读条目：跳过，绝不在发现阶段跟随链接
    }
    if (!stat.isDirectory()) continue
    if (entry.startsWith('run-')) {
      const manifestPath = path.join(location, SCENE_MANIFEST)
      if (fs.existsSync(manifestPath)) {
        let manifest: Record<string, unknown> = {}
        try {
          manifest = JSON.parse(fs.readFileSync(manifestPath, 'utf8')) as Record<string, unknown>
        } catch { /* 清单损坏也按现场保留对待 */ }
        scenes.push({
          location,
          manifestPath,
          scenePath: typeof manifest.projectSrc === 'string' ? manifest.projectSrc : undefined,
          preservedAt: typeof manifest.preservedAt === 'string' ? manifest.preservedAt : undefined,
          recoveryState: typeof manifest.recoveryState === 'string' ? manifest.recoveryState : undefined,
          candidateId: typeof manifest.candidate === 'object' && manifest.candidate !== null
            ? (manifest.candidate as { id?: string }).id
            : undefined,
        })
      }
    }
  }
  // 旧版布局（v3 之前）：project-src 直接位于 workRoot 下且仍存在——可能是中断残留或保留现场
  const legacyScene = path.join(workRoot, 'project-src')
  if (fs.existsSync(legacyScene)) {
    try {
      if (fs.lstatSync(legacyScene).isDirectory()) {
        scenes.push({ location: workRoot, scenePath: legacyScene })
      }
    } catch { /* 不可读同样按现场保留 */ }
  }
  return scenes
}

export function allocateRunDir(workRoot: string, now = new Date()): { workDir: string; preservedScenes: PreservedSceneInfo[] } {
  fs.mkdirSync(workRoot, { recursive: true })
  const stamp = now.toISOString().replace(/[:.]/g, '-').slice(0, 19)
  const workDir = path.join(workRoot, `run-${stamp}-${randomBytes(3).toString('hex')}`)
  // 竞态防护：同一毫秒重试也不会拿到已存在目录
  let attempt = 0
  let candidate = workDir
  while (fs.existsSync(candidate) && attempt < 10) {
    attempt += 1
    candidate = path.join(workRoot, `run-${stamp}-${randomBytes(3).toString('hex')}`)
  }
  if (fs.existsSync(candidate)) throw new Error(`无法分配唯一运行目录（${attempt} 次尝试均冲突）：${workRoot}`)
  fs.mkdirSync(candidate)
  return { workDir: candidate, preservedScenes: detectPreservedScenes(workRoot) }
}
