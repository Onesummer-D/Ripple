/**
 * 栖光 data-router 变体 · SourceGraph 自动消费证明核验 harness（协调人第六轮返工版）。
 *
 * 回答的问题：固定 C+D 合同的 SourceGraph 能否**自动证明**三个页面共享同一媒体
 * 消费，且档案页独立素材不被共享替换波及——无需 Fixture 式结构声明。
 *
 * 用法（cwd = 宿主 Ripple checkout，须为固定 C+D SHA 的检出）：
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     test/qiguang-lab/router-variant/scripts/verify-sourcegraph-proof.ts --core .
 *
 * 严格断言（任一不满足即非零退出，fail-closed，不删 unresolved、不跳异常、不按名猜）：
 *   A. 共享媒体节点唯一（重复匹配即拒绝）；档案媒体节点唯一。
 *   B. 共享媒体 PageImpact.pageRefs 恰好等于 {/, /program, /tickets}。
 *   C. 档案媒体 PageImpact.pageRefs 恰好等于 {/archive}。
 *   D. 两个媒体目标 certainty 均为 source-proven。
 *   E. 两个 PageImpact 的 unresolved 均为空；graph.unresolved 为空（显式断言）。
 *   F. 最小负例自测：多出意外页面 / 缺少预期页面 / certainty 降级 / unresolved
 *      增加，任一使断言通过即判 harness 失效。
 *
 * 输出：C+D SHA、Lab SHA、媒体节点、页面集合、certainty、unresolved、最终 verdict。
 * 边界：验证"固定 C+D 合同下变体形态可证明"；A 正式稳定集成基线发布后对该 SHA 复跑。
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
const EXPECTED_SHARED_PAGES = ['page:/', 'page:/program', 'page:/tickets']
const EXPECTED_ARCHIVE_PAGES = ['page:/archive']

interface SourceNodeLike { id: string; kind: string; value?: string }
interface PageImpactLike { pageRefs: string[]; unresolved: string[]; certainty: string }
interface GraphLike { nodes: SourceNodeLike[]; edges: unknown[]; unresolved: string[] }

function git(cwd: string, argv: string[]): string {
  return execFileSync('git', argv, { cwd, encoding: 'utf8' }).trim()
}

/** 严格证明断言（纯函数，负例自测也走这里）。 */
function assertStrictProof(
  label: string,
  impact: PageImpactLike,
  expectedPages: string[],
  graphUnresolved: string[],
): void {
  const actual = [...impact.pageRefs].sort()
  const expected = [...expectedPages].sort()
  if (actual.join(',') !== expected.join(',')) {
    throw new Error(`${label} pageRefs 集合不相等：实际=[${actual.join(', ')}] 期望=[${expected.join(', ')}]`)
  }
  if (impact.certainty !== 'source-proven') {
    throw new Error(`${label} certainty=${impact.certainty}，期望 source-proven`)
  }
  if (impact.unresolved.length) {
    throw new Error(`${label} unresolved 非空：${impact.unresolved.join(' | ')}`)
  }
  if (graphUnresolved.length) {
    throw new Error(`graph.unresolved 非空：${graphUnresolved.join(' | ')}`)
  }
}

/** 最小负例自测：证明断言链对四类破坏敏感。若任一突变体未触发拒绝，harness 判失败。 */
function runNegativeSelfTests(): void {
  const base: PageImpactLike = { pageRefs: [...EXPECTED_SHARED_PAGES], unresolved: [], certainty: 'source-proven' }
  const mutants: Array<{ name: string; impact: PageImpactLike; graphUnresolved?: string[] }> = [
    { name: '多出意外页面', impact: { ...base, pageRefs: [...EXPECTED_SHARED_PAGES, 'page:/archive'] } },
    { name: '缺少预期页面', impact: { ...base, pageRefs: EXPECTED_SHARED_PAGES.slice(0, 2) } },
    { name: 'certainty 降级', impact: { ...base, certainty: 'partial' } },
    { name: 'unresolved 增加', impact: { ...base, unresolved: ['目标存在非确定的消费者关系'] } },
    { name: 'graph.unresolved 增加', impact: base, graphUnresolved: ['route-coverage: 示例'] },
  ]
  for (const mutant of mutants) {
    let caught: string | null = null
    try {
      assertStrictProof(`[负例:${mutant.name}]`, mutant.impact, EXPECTED_SHARED_PAGES, mutant.graphUnresolved ?? [])
    } catch (error) {
      caught = error instanceof Error ? error.message : String(error)
    }
    if (!caught) throw new Error(`负例未生效：${mutant.name} 竟然通过严格断言，断言链失效`)
    console.log(`[proof] 负例符合预期：${mutant.name} → 拒绝（${caught.slice(0, 72)}…）`)
  }
}

async function main(): Promise<void> {
  const cdSha = git(coreRoot, ['rev-parse', 'HEAD'])
  let labSha = '(变体未提交)'
  try { labSha = git(path.resolve(variantDir, '../../..'), ['rev-parse', 'HEAD']) } catch { /* 变体在非 git 环境 */ }

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
      const pkgJson = require.resolve(`${pkg}/package.json`)
      fs.cpSync(path.dirname(pkgJson), path.join(project, 'node_modules', pkg), { recursive: true })
    }
    git(project, ['add', '-A'])
    git(project, ['-c', 'user.email=lab@ripple.local', '-c', 'user.name=RippleLab', 'commit', '-qm', 'qiguang router variant'])

    const core = await import(pathToFileURL(path.join(coreRoot, 'src', 'core', 'project.ts')).href) as {
      analyzeProject: (input: string) => GraphLike
    }
    const scope = await import(pathToFileURL(path.join(coreRoot, 'src', 'core', 'scope.ts')).href) as {
      sourceProvenPageImpact: (graph: unknown, sourceRef: string) => PageImpactLike
    }
    const graph = core.analyzeProject(project)

    const sharedNodes = graph.nodes.filter(node => node.kind === 'media' && node.value === sharedValue)
    const archiveNodes = graph.nodes.filter(node => node.kind === 'media' && node.value === archiveValue)
    if (sharedNodes.length !== 1) {
      throw new Error(`共享媒体节点匹配数=${sharedNodes.length}（期望唯一），无法消歧即拒绝验收`)
    }
    if (archiveNodes.length !== 1) {
      throw new Error(`档案媒体节点匹配数=${archiveNodes.length}（期望唯一），无法消歧即拒绝验收`)
    }
    const sharedImpact = scope.sourceProvenPageImpact(graph, sharedNodes[0].id)
    const archiveImpact = scope.sourceProvenPageImpact(graph, archiveNodes[0].id)

    console.log(`[proof] C+D SHA: ${cdSha}`)
    console.log(`[proof] Lab SHA: ${labSha}`)
    console.log(`[proof] 共享媒体节点: ${sharedNodes[0].id} value=${sharedValue}`)
    console.log(`[proof] 共享媒体 PageImpact: pages=[${sharedImpact.pageRefs.join(', ')}] certainty=${sharedImpact.certainty} unresolved=[${sharedImpact.unresolved.join(' | ')}]`)
    console.log(`[proof] 档案媒体节点: ${archiveNodes[0].id} value=${archiveValue}`)
    console.log(`[proof] 档案媒体 PageImpact: pages=[${archiveImpact.pageRefs.join(', ')}] certainty=${archiveImpact.certainty} unresolved=[${archiveImpact.unresolved.join(' | ')}]`)
    console.log(`[proof] graph.unresolved=[${graph.unresolved.join(' | ')}]`)

    assertStrictProof('共享媒体', sharedImpact, EXPECTED_SHARED_PAGES, graph.unresolved)
    assertStrictProof('档案媒体', archiveImpact, EXPECTED_ARCHIVE_PAGES, graph.unresolved)
    runNegativeSelfTests()

    console.log(`[proof] verdict=PASS (C+D ${cdSha.slice(0, 7)}): 三页共享媒体消费与档案页隔离的 SourceGraph 自动证明成立，5 项负例全部按预期拒绝。`)
  } finally {
    try { fs.rmSync(temp, { recursive: true, force: true }) } catch { /* Windows 瞬时句柄锁，内容寻址临时目录可手工清理 */ }
  }
}

main().then(() => undefined, error => {
  console.error(error)
  process.exitCode = 1
})
