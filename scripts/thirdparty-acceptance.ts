/**
 * Generic third-party capability probe (Issue #6).
 *
 * Usage:
 *   node --experimental-transform-types --loader ./scripts/ts-extension-loader.mjs \
 *     scripts/thirdparty-acceptance.ts <projectRoot> [--expect-sha <sha>] [--out <dir>]
 *
 * Positioning: this is a **capability probe**（能力探针）, NOT proof of a
 * successful third-party full-lifecycle acceptance. It runs the public
 * analyzeProject() entry point against one git checkout and reports measured
 * capability boundaries. It does NOT run CandidatePatch / browser preview /
 * VerificationReceipt / Approval / Apply / Rollback.
 *
 * Trust rules (fail-closed, no plausible-looking reports from bad inputs):
 *   - <projectRoot> must be a readable git checkout with a clean worktree
 *     (enforced by analyzeProject → readProjectSnapshot; errors exit non-zero).
 *   - --expect-sha, when given, must match `git rev-parse HEAD` exactly,
 *     otherwise the run refuses to emit a report.
 *   - The committed report JSON never contains absolute local paths.
 */
import { execFileSync } from 'node:child_process'
import { mkdirSync, writeFileSync } from 'node:fs'
import { basename, dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { analyzeProject } from '../src/core/project.ts'
import type { SourceGraph } from '../src/core/model.ts'
import { sourceProvenPageImpact } from '../src/core/scope.ts'

const SCHEMA_VERSION = 1

function fail(message: string): never {
  console.error(`thirdparty-acceptance: ${message}`)
  process.exit(2)
}

const args = process.argv.slice(2)
const usage = 'usage: thirdparty-acceptance.ts <projectRoot> [--expect-sha <sha>] [--out <dir>]'

// 严格参数解析（协调人 P1）：缺失值、选项误作值、重复参数、未知参数、
// 多余位置参数一律非零退出，绝不静默跳过校验后产出貌似可信的报告。
const positionals: string[] = []
let expectSha: string | null = null
let outDir: string | null = null
for (let i = 0; i < args.length; i++) {
  const arg = args[i]
  if (arg === '--expect-sha') {
    if (expectSha !== null) fail('--expect-sha 重复出现')
    const value = args[++i]
    if (!value || value.startsWith('--')) fail('--expect-sha 必须紧跟完整的 40 位 Git SHA')
    if (!/^[0-9a-f]{40}$/i.test(value)) fail(`--expect-sha 值非法（需 40 位十六进制）：${value}`)
    expectSha = value.toLowerCase()
  } else if (arg === '--out') {
    if (outDir !== null) fail('--out 重复出现')
    const value = args[++i]
    if (!value || value.startsWith('--')) fail('--out 必须紧跟非空目录值')
    outDir = value
  } else if (arg.startsWith('--')) {
    fail(`未知参数：${arg}`)
  } else {
    positionals.push(arg)
  }
}
if (positionals.length !== 1) fail(positionals.length === 0 ? `缺少 <projectRoot>\n${usage}` : `多余的位置参数：${positionals.slice(1).join(' ')}\n${usage}`)
const root = resolve(positionals[0])

function headSha(dir: string): string | null {
  try {
    return execFileSync('git', ['-C', dir, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim()
  } catch {
    return null
  }
}

// Ripple's own version: the repo root is two levels above this script, so the
// report stays meaningful even when invoked from another working directory.
const rippleRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..')
const rippleHead = headSha(rippleRoot) ?? 'unavailable'

const projectSha = headSha(root)
if (projectSha === null) fail(`无法读取 Git 仓库：${root}`)
if (expectSha && projectSha !== expectSha) {
  fail(`SHA 不匹配：期望 ${expectSha}，实际 ${projectSha}；拒绝生成报告`)
}

// analyzeProject enforces the clean-worktree / readable-git-project contract.
let graph: SourceGraph
try {
  graph = analyzeProject(root)
} catch (error) {
  fail(`analyzeProject 失败（检出不可用或工作区不干净，拒绝生成报告）：${(error as Error).message}`)
}

const kinds: Record<string, number> = {}
for (const n of graph.nodes) kinds[n.kind] = (kinds[n.kind] ?? 0) + 1

const mediaNodes = graph.nodes.filter(n => n.kind === 'media')
const tokenNodes = graph.nodes.filter(n => n.kind === 'token')
const routeNodes = graph.nodes.filter(n => n.kind === 'route')
const assetConsumers = graph.edges.filter(e => e.kind === 'asset-consumer')
const tokenUsers = graph.edges.filter(e => e.kind === 'uses-token')

const mediaClosure = { total: 0, full: 0, partial: 0, unknown: 0 }
for (const node of mediaNodes) {
  const impact = sourceProvenPageImpact(graph, node.id)
  mediaClosure.total++
  if (impact.certainty === 'source-proven') mediaClosure.full++
  else if (impact.certainty === 'partial') mediaClosure.partial++
  else mediaClosure.unknown++
}

const report = {
  schemaVersion: SCHEMA_VERSION,
  positioning: 'third-party capability probe（能力探针）；非全生命周期验收证明',
  generatedAt: new Date().toISOString(),
  // 故意不写入绝对路径：committed JSON 只含目录名，避免泄露本机布局
  projectDir: basename(root),
  projectSha,
  expectShaMatched: expectSha ? true : null,
  rippleHead,
  stats: {
    nodes: graph.nodes.length,
    edges: graph.edges.length,
    kinds,
    media: { total: mediaNodes.length },
    tokens: { total: tokenNodes.length },
    routes: { total: routeNodes.length },
    assetConsumers: {
      total: assetConsumers.length,
      sourceProven: assetConsumers.filter(e => e.certainty === 'source-proven').length,
      semanticCandidate: assetConsumers.filter(e => e.certainty === 'semantic-candidate').length,
    },
    tokenConsumers: {
      total: tokenUsers.length,
      sourceProven: tokenUsers.filter(e => e.certainty === 'source-proven').length,
      semanticCandidate: tokenUsers.filter(e => e.certainty === 'semantic-candidate').length,
      unknown: tokenUsers.filter(e => e.certainty === 'unknown').length,
    },
  },
  mediaClosure,
  capabilityBoundaries: {
    routeNodesDerived: routeNodes.length,
    unresolvedCount: graph.unresolved.length,
    unresolvedSample: graph.unresolved.slice(0, 20),
  },
}

const json = JSON.stringify(report, null, 2)
if (outDir) {
  mkdirSync(outDir, { recursive: true })
  writeFileSync(join(outDir, 'report.json'), json)
  console.log(`report written: ${join(outDir, 'report.json')}`)
} else {
  console.log(json)
}
