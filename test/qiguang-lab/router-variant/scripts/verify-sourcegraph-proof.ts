/**
 * 栖光 data-router 变体 · SourceGraph 自动消费证明核验 harness。
 *
 * 回答的问题：PR #28 合同的 SourceGraph 能否**自动证明**三个页面共享同一媒体消费，
 * 且档案页独立素材不被共享替换波及——无需 Fixture 式结构声明。
 *
 * 用法（cwd = 宿主 Ripple checkout，须含 PR #28 合同源码）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     test/qiguang-lab/router-variant/scripts/verify-sourcegraph-proof.ts --core .
 *
 * 机制：把变体源（本文件上一级目录）复制到临时目录，git init/add/commit 成干净
 * 迷你工程（analyzeProject 要求 git 跟踪 + 干净树），动态导入宿主 core 的
 * analyzeProject / sourceProvenPageImpact 做断言：
 *   1. 共享媒体节点存在且页面影响恰含 / /program / /tickets（source-proven）；
 *   2. 档案独立媒体节点页面影响恰含 /archive，且不含三个共享页面；
 *   3. 任一断言不满足 → 非零退出（fail-closed，不升级不猜）。
 *
 * 边界：本 harness 验证的是"PR #28 合同下变体形态可证明"，不是 A 集成基线的
 * 最终签署；基线就绪后以同一 harness 复跑为准。
 */
import { execFileSync } from 'node:child_process'
import { createRequire } from 'node:module'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const variantDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..')
const args = process.argv.slice(2)
const coreIndex = args.indexOf('--core')
const coreRoot = path.resolve(coreIndex >= 0 ? args[coreIndex + 1] : '../..')
const sharedValue = '/media/qiguang-hero-wide.jpg'
const archiveValue = '/media/qiguang-archive.jpg'

function git(cwd: string, argv: string[]): string {
  return execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()
}

interface SourceNodeLike { id: string; kind: string; value?: string }
interface PageImpactLike { pageRefs: string[]; unresolved: string[]; certainty: string }

async function main(): Promise<void> {
  const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'qiguang-router-proof-'))
  try {
    const project = path.join(temp, 'project')
    fs.cpSync(variantDir, project, {
      recursive: true,
      filter: source => !source.includes(`${path.sep}dist-`) && !source.includes(`${path.sep}scripts${path.sep}verify-sourcegraph-proof`),
    })
    git(project, ['init', '-q'])
    // react-router 依赖随变体带入临时工程：主入口文件的未解析导入会落入受影响
    // 子图并把确定性拖成 partial（fail-closed 的正确行为），证明路由表必须可解析。
    const require = createRequire(path.join(variantDir, 'index.js'))
    for (const pkg of ['react-router-dom', 'react-router']) {
      try {
        const pkgJson = require.resolve(`${pkg}/package.json`)
        const dest = path.join(project, 'node_modules', pkg)
        fs.cpSync(path.dirname(pkgJson), dest, { recursive: true })
      } catch {
        console.warn(`[proof] 警告：无法解析 ${pkg}，未解析导入将按 fail-closed 计入`)
      }
    }
    git(project, ['add', '-A'])
    git(project, ['-c', 'user.email=lab@ripple.local', '-c', 'user.name=RippleLab', 'commit', '-qm', 'qiguang router variant'])

    const core = await import(pathToFileURL(path.join(coreRoot, 'src', 'core', 'project.ts')).href) as {
      analyzeProject: (input: string) => { nodes: SourceNodeLike[]; edges: unknown[]; unresolved: string[] }
    }
    const scope = await import(pathToFileURL(path.join(coreRoot, 'src', 'core', 'scope.ts')).href) as {
      sourceProvenPageImpact: (graph: unknown, sourceRef: string) => PageImpactLike
    }
    const graph = core.analyzeProject(project)
    const shared = graph.nodes.find(node => node.kind === 'media' && node.value === sharedValue)
    const archive = graph.nodes.find(node => node.kind === 'media' && node.value === archiveValue)
    const failures: string[] = []
    if (!shared) {
      failures.push(`共享媒体节点缺失：${sharedValue}`)
    } else {
      const impact = scope.sourceProvenPageImpact(graph, shared.id)
      const expected = ['page:/', 'page:/program', 'page:/tickets']
      const missing = expected.filter(page => !impact.pageRefs.includes(page))
      console.log(`[proof] 共享媒体影响：certainty=${impact.certainty} pages=[${impact.pageRefs.join(', ')}] unresolved=[${impact.unresolved.join(' | ')}]`)
      if (missing.length) failures.push(`共享媒体页面影响缺少：${missing.join(', ')}`)
      if (impact.pageRefs.includes('page:/archive')) failures.push('共享媒体影响错误包含 /archive')
      if (impact.certainty !== 'source-proven') failures.push(`共享媒体确定性=${impact.certainty}，期望 source-proven`)
    }
    if (!archive) {
      failures.push(`档案媒体节点缺失：${archiveValue}`)
    } else {
      const impact = scope.sourceProvenPageImpact(graph, archive.id)
      console.log(`[proof] 档案媒体影响：certainty=${impact.certainty} pages=[${impact.pageRefs.join(', ')}]`)
      if (impact.pageRefs.join(',') !== 'page:/archive') failures.push(`档案页面影响=${impact.pageRefs.join(',')}，期望恰为 page:/archive`)
      for (const page of ['/program', '/tickets']) {
        if (impact.pageRefs.includes(`page:${page}`)) failures.push(`档案影响泄漏到 ${page}`)
      }
    }
    if (failures.length) {
      console.error(`[proof] FAIL：\n- ${failures.join('\n- ')}`)
      process.exitCode = 1
      return
    }
    console.log('[proof] PASS：PR #28 合同下，data-router 变体的三页共享媒体消费自动证明成立，档案页独立素材影响恰为 /archive。')
  } finally {
    fs.rmSync(temp, { recursive: true, force: true })
  }
}

main().then(() => undefined, error => {
  console.error(error)
  process.exitCode = 1
})
