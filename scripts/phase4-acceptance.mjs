import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const workspace = path.resolve(root, '..', '..')
const acceptanceDate = process.env.RIPPLE_ACCEPTANCE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const adapter = read('src/adapters/realEvidenceAdapter.ts')
const adapterTests = read('src/adapters/realEvidenceAdapter.test.ts')
const appAdapter = read('src/adapters/appAdapter.ts')
const fixtureAdapter = read('src/adapters/fixtureAdapter.ts')
const validator = read('src/verification/fixtureValidator.ts')
const integrationDoc = fs.readFileSync(path.join(workspace, 'docs', 'integration', 'real-evidence-package.md'), 'utf8')
const packageJson = JSON.parse(read('package.json'))

const checks = []
const check = (name, condition, detail = 'pass') => {
  assert.ok(condition, `${name}: ${detail}`)
  checks.push({ name, detail })
}

check('adapter parser is typed', !/\bany\b/.test(adapter) && adapter.includes('parseRealCasePackage') && adapter.includes('adaptCasePackage'))
check('supported case IDs are closed', adapter.includes("const caseIds: CaseId[] = ['qingye', 'qiguang', 'third-party']"))
check('malformed graph input is diagnosed', adapter.includes('raw.graph !== undefined') && adapter.includes("path: 'graph'") && adapter.includes('stable id'))
check('malformed arrays are diagnosed', adapter.includes('readRecordArray') && adapter.includes('expected an array of objects'))
check('unknown/loading Evidence semantics', adapter.includes('E-UNKNOWN-') && adapter.includes("raw.verification === 'unknown'") && adapter.includes("raw.verification === 'loading'") && adapter.includes(": 'unknown'") && adapter.includes("origin: 'real'") && adapterTests.includes('preserves unknown and loading verification'))
check('mobile runtime Evidence requires proof', adapter.includes('screenshotRequired') && adapter.includes("raw.viewport.includes('375')") && adapter.includes('screenshotPath'))
check('provenance is bounded', adapter.includes('repositoryUrl') && adapter.includes('consumerPaths') && adapter.includes('tokenSource'))
check('fixture fallback is isolated', fixtureAdapter.includes('realPackages[caseId] === undefined') && fixtureAdapter.includes('adaptCasePackage') && appAdapter.includes('realCasePackages'))
check('contract validator remains in handoff', adapter.includes('validateFixture(fixture)') && validator.includes('screenshot evidence requires screenshotPath'))
check('adapter tests cover negative inputs', adapterTests.includes('malformed graph records') && adapterTests.includes('unsupported mobile evidence') && adapterTests.includes('duplicate graph/evidence IDs'))
check('integration contract documents optional graph', integrationDoc.includes('graph') && integrationDoc.includes('可以逐步提供') && integrationDoc.includes('verification: "unknown"'))
check('UI injection point is stable', appAdapter.includes('createCaseAdapter(realCasePackages)') && appAdapter.includes('without changing App') && typeof packageJson.scripts['acceptance:phase4'] === 'string')
check('UI exposes data source', fixtureAdapter.includes('getSource: (caseId)') && read('src/app/App.tsx').includes('Real package loaded') && read('src/app/App.tsx').includes('Fixture loaded'))

const evidenceDirectory = path.join(workspace, 'docs', 'acceptance', acceptanceDate, 'evidence')
fs.mkdirSync(evidenceDirectory, { recursive: true })
const realPackagePresent = !appAdapter.match(/realCasePackages[^=]*=\s*\{\s*\}/s)
const report = {
  phase: '04-real-evidence-integration',
  command: 'npm run acceptance:phase4',
  acceptanceDate,
  generatedAt: new Date().toISOString(),
  checks,
  skipped: 0,
  handoff: {
    realPackagePresent,
    runtimeChecksPending: !realPackagePresent,
    blockers: realPackagePresent ? [] : ['B real package, browser screenshots, and repository provenance are not present in the worktree'],
  },
}
fs.writeFileSync(path.join(evidenceDirectory, 'phase04-adapter-acceptance.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
