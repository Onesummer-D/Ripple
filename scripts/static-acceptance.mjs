import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'

const root = process.cwd()
const workspace = path.resolve(root, '..', '..')
const acceptanceDate = process.env.RIPPLE_ACCEPTANCE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const app = read('src/app/App.tsx')
const candidateEditor = read('src/app/CandidateEditor.tsx')
const viewportSources = read('src/app/PagePreview.tsx') + read('src/preview/viewports.ts')
const contracts = read('src/domain/contracts.ts')
const fixtures = read('src/cases/fixtures.ts')
const state = read('src/domain/state.ts')
const adapter = read('src/adapters/realEvidenceAdapter.ts')
const truthMatrix = read('src/cases/truthMatrix.ts')
const selectors = read('src/app/selectors.ts')
const styles = read('src/styles.css')
const packageJson = JSON.parse(read('package.json'))

const checks = []
const check = (name, condition, detail) => {
  assert.ok(condition, detail ?? name)
  checks.push({ name, detail: detail ?? 'pass' })
}

const braceDelta = (source) => [...source].filter((char) => char === '{').length - [...source].filter((char) => char === '}').length
const fixtureIds = [...fixtures.matchAll(/'F(?:0[1-9]|10)'/g)].map((match) => match[0].slice(1, -1))
const uniqueFixtureIds = [...new Set(fixtureIds)]

check('fixture IDs F01-F10', uniqueFixtureIds.length === 10 && uniqueFixtureIds.join(',') === 'F01,F02,F03,F04,F05,F06,F07,F08,F09,F10')
check('source brace balance', [app, contracts, fixtures, state, adapter, selectors].every((source) => braceDelta(source) === 0))
check('typed contract names', ['RippleGraph', 'CandidateEdit', 'ScopeDecision', 'Evidence', 'Snapshot'].every((name) => contracts.includes(`interface ${name}`)))
check('case identities', ['qingye', 'qiguang', 'third-party', 'qingye-about-source', 'qiguang-archive-poster'].every((value) => fixtures.includes(value)))
const truthMatrixIds = [...truthMatrix.matchAll(/fixtureId: 'F(?:0[1-9]|10)'/g)].map((match) => match[0].match(/F(?:0[1-9]|10)/)?.[0])
check('truth matrix F01-F10', truthMatrixIds.length === 10 && [...new Set(truthMatrixIds)].join(',') === 'F01,F02,F03,F04,F05,F06,F07,F08,F09,F10' && truthMatrix.includes('expectedRoutesFor'))
check('editor test IDs', ['candidate-input', 'create-candidate', 'scope-instance', 'scope-shared', 'impact-panel', 'apply-draft', 'restore-previous', 'replay-flow'].every((value) => (app + candidateEditor).includes(`data-testid="${value}"`)))
check('adapter diagnostics UI', app.includes('data-testid="adapter-diagnostics"') && app.includes('appAdapter.getDiagnostics()') && app.includes('appAdapter.getSource(activeCase)'))
check('history state commands', ['cancelDraft', 'createSnapshot', 'resetCase', 'restorePrevious', 'restoreSnapshot'].every((name) => state.includes(`export const ${name}`)))
check('derived app selectors', ['projectValues', 'affectedInstanceIdsFor', 'impactProjection', 'evidencePresentation', 'routePreviewProjection'].every((name) => selectors.includes(`export const ${name}`)) && app.includes("from './selectors'"))
check('adapter safety markers', ['readRecordArray', 'verification: valid ?', 'screenshotRequired', 'repositoryUrl', 'raw.graph !== undefined'].every((value) => adapter.includes(value)))
check('viewport coverage markers', ['375 × 812', '768 × 1024', '1440 × 900'].every((value) => viewportSources.includes(value)) && styles.includes('@media (max-width: 720px)'))
check('package scripts', ['dev', 'build', 'typecheck', 'test', 'smoke:static'].every((name) => typeof packageJson.scripts[name] === 'string'))
check('static preview entry', typeof packageJson.scripts['preview:static'] === 'string' && fs.existsSync(path.join(root, 'scripts', 'preview-server.mjs')))

const evidenceDirectory = path.join(workspace, 'docs', 'acceptance', acceptanceDate, 'evidence')
fs.mkdirSync(evidenceDirectory, { recursive: true })
const report = {
  command: 'npm run smoke:static',
  acceptanceDate,
  generatedAt: new Date().toISOString(),
  checks,
  runtime: { dependenciesInstalled: fs.existsSync(path.join(root, 'node_modules')) },
}
fs.writeFileSync(path.join(evidenceDirectory, 'offline-static-acceptance.json'), JSON.stringify(report, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
