// 7/7 passed 全链路标准回归驱动（A 集成交付物）。
//
// 流程（全部走正式公共 API，无任何模拟/手工注册）：
//   1. 复制 test/fixtures/passed-text-lifecycle 到临时沙箱，git 基线
//      （固定作者时间 → 可复现 fixture SHA；.gitattributes 锁定 LF 字节口径）。
//   2. 启动 vite dev（含 /__ripple/api 插件，独立 RIPPLE_WORKBENCH_STATE_DIR）。
//   3. analyze → 前置证明：共享页脚文本的 PageImpact 在修改前即
//      source-proven 覆盖两个页面（sourceProvenPageImpact 口径）。
//   4. 负例门控：缺页 Scope 的 createCandidate 必须被 409 拒绝。
//   5. 正式候选：显式完整 Scope（includedRefs = 全部 routeRefs + targetRef）。
//   6. POST /candidate/verify → 真实 Docker VerificationRunner；
//      断言 verification.state === 'passed' 且执行记录七断言全 pass。
//   7. 同一候选连续生命周期：approve → apply（磁盘字节变化断言）→
//      rollback（磁盘字节还原断言）。
//   8. PASSED_FIXTURE_REPEAT 控制完整循环次数（默认 2），每次独立候选。
//
// 产出（--out，默认 test-results/passed-fixture/）：
//   summary.json              全量证据索引（fixture SHA、candidateId、runId、
//                             patchHash、recordHash、七断言、生命周期状态）
//   cycle-<n>-verification.json   verify 响应（只读视图）
//   cycle-<n>-record.json         浏览器执行记录（七断言明细、检查与证据清单）
//   cycle-<n>-workflow-*.json     approve/apply/rollback 各步工作流状态
//   cycle-<n>-run-artifacts/      验证运行工件（截图、进度、诊断）
//
// 用法：node scripts/a-passed-fixture-e2e.mjs [--out <dir>]
// 需要：Linux + Docker（mcr.microsoft.com/playwright:v1.64.0-noble 已预热）。
import { execFileSync, spawn } from 'node:child_process'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'

const argOut = process.argv.indexOf('--out')
const outDir = path.resolve(argOut >= 0 ? process.argv[argOut + 1] : 'test-results/passed-fixture')
const repeat = Math.max(1, Number(process.env.PASSED_FIXTURE_REPEAT ?? 2))
const port = Number(process.env.PASSED_FIXTURE_PORT ?? 4397)
const base = `http://127.0.0.1:${port}`
const fixtureSrc = path.resolve('test/fixtures/passed-text-lifecycle')
const repoRoot = process.cwd()

const FOOTER_BEFORE = '青野家居 · 共同页脚文案'
const FOOTER_AFTER = '青野家居 · 升级后的共同页脚文案'
const HOME_MARKER = '青野家居生活馆'
const ABOUT_MARKER = '关于青野'
const INTERACTION = { role: 'button', name: '展开服务详情', expectedText: '服务详情已展开' }
const REQUIRED_ASSERTIONS = ['target-change', 'non-target-preserved', 'scope-propagation', 'interaction', 'responsive-layout', 'source-mapping', 'browser-errors']

fs.mkdirSync(outDir, { recursive: true })

const failures = []
function check(name, condition, detail) {
  if (condition) { console.log(`ok ${name}`); return }
  failures.push(`${name}${detail ? `：${detail}` : ''}`)
  console.error(`FAIL ${name}${detail ? `：${detail}` : ''}`)
}

const sandbox = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-passed-fixture-'))
const stateDir = path.join(sandbox, 'state')
const projectRoot = path.join(sandbox, 'site')
fs.mkdirSync(projectRoot, { recursive: true })
fs.cpSync(fixtureSrc, projectRoot, { recursive: true })
fs.symlinkSync(path.join(repoRoot, 'node_modules'), path.join(projectRoot, 'node_modules'), process.platform === 'win32' ? 'junction' : 'dir')

const gitEnv = { ...process.env, GIT_AUTHOR_DATE: '2026-10-23T12:00:00+08:00', GIT_COMMITTER_DATE: '2026-10-23T12:00:00+08:00' }
const git = (...args) => execFileSync('git', ['-C', projectRoot, ...args], { stdio: 'pipe', env: gitEnv })
git('init', '-q')
git('config', 'user.email', 'passed-fixture@ripple.example.invalid')
git('config', 'user.name', 'Ripple passed fixture')
git('add', '.')
git('commit', '-qm', 'baseline: 两页共享页脚文本')
const fixtureSha = git('rev-parse', 'HEAD').toString().trim()
console.log(`fixture baseline SHA: ${fixtureSha}`)

const server = spawn(process.execPath, [path.resolve('node_modules/vite/bin/vite.js'), '--host', '127.0.0.1', '--port', String(port), '--strictPort'], {
  env: { ...process.env, RIPPLE_WORKBENCH_STATE_DIR: stateDir },
  stdio: 'ignore',
})
const stopServer = () => { try { server.kill() } catch { /* 已退出 */ } }
process.on('exit', stopServer)

let serverUp = false
for (let attempt = 0; attempt < 60; attempt += 1) {
  try { const res = await fetch(base); if (res.status < 500) { serverUp = true; break } } catch { /* 尚未就绪 */ }
  await new Promise(resolve => setTimeout(resolve, 500))
}
check('vite dev 服务就绪', serverUp)

const post = async (route, body) => {
  const res = await fetch(`${base}/__ripple/api/${route}`, { method: 'POST', headers: { 'content-type': 'application/json', origin: base }, body: JSON.stringify(body ?? {}) })
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}
const getJson = async (urlPath) => {
  const res = await fetch(`${base}${urlPath}`)
  const text = await res.text()
  let data = {}
  try { data = JSON.parse(text) } catch { data = { raw: text } }
  return { status: res.status, data }
}

const summary = { fixtureSha, fixtureSource: 'test/fixtures/passed-text-lifecycle', baseSourceControl: 'git, fixed author/committer date, LF via .gitattributes', cycles: [], negativeGate: null, startedAt: new Date().toISOString() }

let routes = []
let targets = []
let projectId = ''
let routeIds = []
let footerTarget = null

if (serverUp) {
  // ── 3) analyze + 修改前来源证明 ──────────────────────────────
  const analyze = await post('analyze', { projectRoot })
  check('analyze 成功', analyze.status === 200, JSON.stringify(analyze.data).slice(0, 200))
  if (analyze.status === 200) {
    projectId = analyze.data.revision.projectId
    routes = analyze.data.routes ?? []
    targets = analyze.data.targets ?? []
    routeIds = routes.map(route => route.id).sort()
    console.log(`routes: ${routeIds.join(', ')}`)
    check('路由集合为两页 data-router', JSON.stringify(routeIds) === JSON.stringify(['page:/', 'page:/about']), routeIds.join(','))
    footerTarget = targets.find(target => target.value === FOOTER_BEFORE) ?? null
    check('找到共享页脚文本目标', !!footerTarget)
    if (footerTarget) {
      const impact = footerTarget.impact ?? {}
      console.log(`footer impact: certainty=${impact.certainty} pages=${JSON.stringify(impact.pageRefs ?? [])} unresolved=${JSON.stringify(impact.unresolved ?? [])}`)
      check('修改前 PageImpact 即 source-proven', impact.certainty === 'source-proven')
      check('PageImpact 覆盖全部两个页面', JSON.stringify([...(impact.pageRefs ?? [])].sort()) === JSON.stringify(routeIds))
      check('PageImpact 无 unresolved', (impact.unresolved ?? []).length === 0, JSON.stringify(impact.unresolved ?? []))
    }
  }

  const footerFile = path.join(projectRoot, 'src', 'components', 'SiteFooter.tsx')
  const scopeFor = included => ({ id: `scope-passed-fixture-${included.length}`, version: 1, includedRefs: included, excludedRefs: [], protectedRefs: [], decidedBy: 'passed-fixture-agent', decidedAt: new Date().toISOString() })
  const candidateBody = scope => ({
    projectId,
    rawIntent: '更新两页共享页脚文案，并保持其余页面内容不变',
    scope,
    operations: [{ id: 'op-footer-text', kind: 'TEXT', targetRef: footerTarget.id, before: FOOTER_BEFORE, after: FOOTER_AFTER }],
    verificationContract: {
      pages: [
        { pageRef: 'page:/', path: '/', markerText: HOME_MARKER },
        { pageRef: 'page:/about', path: '/about', markerText: ABOUT_MARKER },
      ],
      interactions: [{ pageRef: 'page:/', ...INTERACTION }],
    },
  })

  // ── 4) 负例门控：缺页 Scope 必须拒绝 ─────────────────────────
  if (footerTarget) {
    const negative = await post('candidate', candidateBody(scopeFor([footerTarget.id, 'page:/'])))
    summary.negativeGate = { status: negative.status, body: JSON.stringify(negative.data).slice(0, 300) }
    check('负例：缺页 Scope 被 409 拒绝', negative.status === 409, `实际 ${negative.status} ${JSON.stringify(negative.data).slice(0, 200)}`)
  }

  // ── 5-8) 正式循环：候选 → 7/7 验证 → 审批 → 应用 → 回滚 ──────
  for (let cycle = 1; cycle <= repeat && footerTarget; cycle += 1) {
    console.log(`\n=== cycle ${cycle}/${repeat} ===`)
    const cycleInfo = { cycle }
    const created = await post('candidate', candidateBody(scopeFor([...routeIds, footerTarget.id].sort())))
    check(`cycle-${cycle} 候选创建`, created.status === 200, JSON.stringify(created.data).slice(0, 300))
    if (created.status !== 200) { summary.cycles.push(cycleInfo); continue }
    const { sessionId } = created.data
    const candidateId = created.data.candidate?.id
    cycleInfo.candidateId = candidateId
    cycleInfo.sessionId = sessionId
    cycleInfo.patchHash = created.data.candidate?.patchHash
    console.log(`candidate: ${candidateId}`)

    const verified = await post('candidate/verify', { candidateId })
    fs.writeFileSync(path.join(outDir, `cycle-${cycle}-verification.json`), JSON.stringify(verified.data, null, 2))
    const verification = verified.data?.verification ?? {}
    cycleInfo.runId = verification.runId
    cycleInfo.recordHash = verification.recordHash
    check(`cycle-${cycle} verify 状态 passed`, verification.state === 'passed', `实际 ${verification.state} ${verification.reason ?? ''}`)
    if (verification.recordUrl) {
      const record = await getJson(verification.recordUrl)
      fs.writeFileSync(path.join(outDir, `cycle-${cycle}-record.json`), JSON.stringify(record.data, null, 2))
      const assertions = record.data?.manifest?.assertions ?? []
      for (const id of REQUIRED_ASSERTIONS) {
        const found = assertions.find(item => item.id === id)
        check(`cycle-${cycle} 断言 ${id} pass`, found?.result === 'pass', found ? `${found.result}: ${found.detail}` : '缺失')
      }
      check(`cycle-${cycle} 断言集合完整`, assertions.length === REQUIRED_ASSERTIONS.length)
      const runArtifactDir = path.join(stateDir, sessionId, 'artifacts', 'verification', candidateId, verification.runId ?? '')
      const copied = path.join(outDir, `cycle-${cycle}-run-artifacts`)
      if (fs.existsSync(runArtifactDir)) fs.cpSync(runArtifactDir, copied, { recursive: true })
    }

    const approved = await post('candidate/approve', { candidateId, runId: verification.runId })
    fs.writeFileSync(path.join(outDir, `cycle-${cycle}-workflow-approved.json`), JSON.stringify(approved.data, null, 2))
    check(`cycle-${cycle} 审批通过`, approved.status === 200, JSON.stringify(approved.data).slice(0, 200))

    const applied = await post('candidate/apply', { candidateId })
    fs.writeFileSync(path.join(outDir, `cycle-${cycle}-workflow-applied.json`), JSON.stringify(applied.data, null, 2))
    check(`cycle-${cycle} 应用成功`, applied.status === 200, JSON.stringify(applied.data).slice(0, 200))
    const appliedBytes = fs.readFileSync(footerFile, 'utf8')
    check(`cycle-${cycle} 应用后磁盘字节为候选文案`, appliedBytes.includes(FOOTER_AFTER) && !appliedBytes.includes(FOOTER_BEFORE))

    const rolledBack = await post('candidate/rollback', { candidateId })
    fs.writeFileSync(path.join(outDir, `cycle-${cycle}-workflow-rolled-back.json`), JSON.stringify(rolledBack.data, null, 2))
    check(`cycle-${cycle} 回滚成功`, rolledBack.status === 200, JSON.stringify(rolledBack.data).slice(0, 200))
    const restoredBytes = fs.readFileSync(footerFile, 'utf8')
    check(`cycle-${cycle} 回滚后磁盘字节还原基线`, restoredBytes.includes(FOOTER_BEFORE) && !restoredBytes.includes(FOOTER_AFTER))
    cycleInfo.lifecycle = {
      approved: approved.status === 200,
      applied: applied.status === 200,
      rolledBack: rolledBack.status === 200,
      sameCandidateChain: true,
    }
    summary.cycles.push(cycleInfo)
  }
}

summary.finishedAt = new Date().toISOString()
summary.result = failures.length ? 'FAILED' : 'PASSED'
fs.writeFileSync(path.join(outDir, 'summary.json'), JSON.stringify(summary, null, 2))
console.log(`\nsummary -> ${path.join(outDir, 'summary.json')}`)

stopServer()
for (let attempt = 0; attempt < 3; attempt += 1) {
  try { fs.rmSync(sandbox, { recursive: true, force: true }); break } catch { /* Windows 句柄释放延迟 */ }
}
if (failures.length) {
  console.error(`\n${failures.length} 项失败：`)
  for (const failure of failures) console.error(` - ${failure}`)
  process.exit(1)
}
console.log('\npassed fixture E2E: PASSED (7/7 × ' + repeat + ' cycle, 同一候选 Approval → Apply → Rollback 连续证据)')
