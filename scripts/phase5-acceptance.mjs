import assert from 'node:assert/strict'
import fs from 'node:fs'
import path from 'node:path'
import { sourceDigest } from './verification-context.mjs'

const root = process.cwd()
const workspace = path.resolve(root, '..', '..')
const acceptanceDate = process.env.RIPPLE_ACCEPTANCE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
const read = (relative) => fs.readFileSync(path.join(root, relative), 'utf8')
const app = read('src/app/App.tsx')
const candidateEditor = read('src/app/CandidateEditor.tsx')
const evidencePanel = read('src/app/EvidencePanel.tsx')
const viewportSources = read('src/app/PagePreview.tsx') + read('src/preview/viewports.ts')
const contracts = read('src/domain/contracts.ts')
const state = read('src/domain/state.ts')
const fixtures = read('src/cases/fixtures.ts')
const truthMatrix = read('src/cases/truthMatrix.ts')
const truthMatrixTest = read('src/cases/truthMatrix.test.ts')
const selectors = read('src/app/selectors.ts')
const selectorsTest = read('src/app/selectors.test.ts')
const styles = read('src/styles.css')
const readme = read('README.md')
const integrationDoc = fs.readFileSync(path.join(workspace, 'docs', 'integration', 'real-evidence-package.md'), 'utf8')
const architectureDoc = fs.readFileSync(path.join(workspace, 'docs', 'architecture', 'ripple-editor.md'), 'utf8')
const previewServer = read('scripts/preview-server.mjs')
const runtimeSmoke = read('scripts/runtime-smoke.mjs')
const tsLoader = read('scripts/ts-extension-loader.mjs')
const packageJson = JSON.parse(read('package.json'))

const checks = []
const check = (name, condition, detail = 'pass') => {
  assert.ok(condition, `${name}: ${detail}`)
  checks.push({ name, detail })
}

const fixtureIds = [...fixtures.matchAll(/'F(?:0[1-9]|10)'/g)].map((match) => match[0].slice(1, -1))
const matrixIds = [...truthMatrix.matchAll(/fixtureId: 'F(?:0[1-9]|10)'/g)].map((match) => match[0].match(/F(?:0[1-9]|10)/)?.[0])
const coreSources = [contracts, state, fixtures, truthMatrix, selectors]

check('fixture coverage', [...new Set(fixtureIds)].join(',') === 'F01,F02,F03,F04,F05,F06,F07,F08,F09,F10')
check('truth matrix coverage', matrixIds.length === 10 && [...new Set(matrixIds)].join(',') === 'F01,F02,F03,F04,F05,F06,F07,F08,F09,F10')
check('fixture-derived local scope', truthMatrix.includes('selectedSlotId') && truthMatrixTest.includes('selectedSlot?.route'))
check('derived selector boundary', ['projectValues', 'affectedInstanceIdsFor', 'impactProjection', 'evidencePresentation', 'routePreviewProjection'].every((name) => selectors.includes(`export const ${name}`)) && selectorsTest.includes('describe(\'app selectors\''))
check('core contracts remain typed', coreSources.every((source) => !/\bany\b/.test(source)))
check('state transition coverage', ['selectSlot', 'setCandidate', 'chooseScope', 'applyDraft', 'restorePrevious', 'restoreSnapshot', 'resetRuntime'].every((name) => state.includes(`export const ${name}`)))
check('stable editor controls', ['candidate-input', 'create-candidate', 'scope-instance', 'scope-shared', 'route-preview-grid', 'impact-panel', 'apply-draft', 'cancel-draft', 'restore-previous', 'replay-flow', 'reset-case-inline'].every((id) => (app + candidateEditor).includes(`data-testid="${id}"`)))
check('accessible state controls', ['aria-current', 'aria-pressed', 'role="status"', 'focus-visible'].every((marker) => app.includes(marker) || styles.includes(marker)))
check('responsive viewport contract', ['375 × 812', '768 × 1024', '1440 × 900'].every((marker) => viewportSources.includes(marker)) && styles.includes('@media (max-width: 720px)'))
check('route preview responsive', styles.includes('.route-preview-grid') && styles.includes('.route-preview-grid { grid-template-columns: 1fr; }'))
check('horizontal overflow guard', styles.includes('overflow-x: hidden') && styles.includes('min-width: 0'))
check('offline font fallback', !styles.includes('fonts.googleapis.com') && styles.includes("'Noto Sans SC'"))
check('adapter handoff docs', readme.includes('createCaseAdapter') && integrationDoc.includes('appAdapter.ts'))
check('architecture boundary docs', architectureDoc.includes('app/selectors.ts') && architectureDoc.includes('domain state machine'))
check('unknown evidence semantics', evidencePanel.includes('evidencePresentation') && selectors.includes("item.verification === 'unknown'") && selectors.includes("label: unknown ? 'UNKNOWN'"))
check('required scripts', ['typecheck', 'build', 'test', 'smoke:static', 'acceptance:phase4', 'acceptance:phase5', 'preview:static', 'acceptance:runtime-node'].every((name) => typeof packageJson.scripts[name] === 'string'))
check('node runtime smoke entry', runtimeSmoke.includes("validateFixture") && runtimeSmoke.includes("parseRealCasePackage") && tsLoader.includes('nextResolve'))
check('dependency-free preview server', previewServer.includes("from 'node:http'") && previewServer.includes('server.listen') && previewServer.includes('preview.html'))
check('deterministic preview entry', fs.existsSync(path.join(root, 'preview.html')) && fs.existsSync(path.join(root, 'scripts', 'static-acceptance.mjs')))

const evidenceDirectory = path.join(workspace, 'docs', 'acceptance', acceptanceDate, 'evidence')
fs.mkdirSync(evidenceDirectory, { recursive: true })
const dependenciesInstalled = fs.existsSync(path.join(root, 'node_modules'))
const nodeRuntimeSmokeEvidence = fs.existsSync(path.join(evidenceDirectory, 'node-runtime-smoke.json'))
const formalPath = path.join(evidenceDirectory, 'formal-verification.json')
const formalReport = fs.existsSync(formalPath) ? JSON.parse(fs.readFileSync(formalPath, 'utf8')) : undefined
const formalVerificationCurrent = formalReport?.passed === true && formalReport.sourceDigest === sourceDigest(root)
const report = {
  phase: '05-hardening-and-acceptance',
  command: 'npm run acceptance:phase5',
  acceptanceDate,
  generatedAt: new Date().toISOString(),
  checks,
  skipped: 0,
  runtime: {
    dependenciesInstalled,
    nodeRuntimeSmokeEvidence,
    formalVerificationCurrent,
    runtimeChecksPending: !formalVerificationCurrent,
    blockers: formalVerificationCurrent ? [] : [dependenciesInstalled ? 'Run npm run verify against the current source to finish formal runtime/browser verification' : 'node_modules unavailable; install dependencies to run formal verification'],
  },
}
fs.writeFileSync(path.join(evidenceDirectory, 'phase05-static-acceptance.json'), JSON.stringify(report, null, 2) + '\n')
fs.writeFileSync(path.join(evidenceDirectory, 'phase05-static-acceptance.txt'), JSON.stringify({ command: report.command, acceptanceDate, skipped: report.skipped, dependenciesInstalled, nodeRuntimeSmokeEvidence, runtimeChecksPending: report.runtime.runtimeChecksPending, blockers: report.runtime.blockers }, null, 2) + '\n')
console.log(JSON.stringify(report, null, 2))
