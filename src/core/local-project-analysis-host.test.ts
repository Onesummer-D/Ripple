// @vitest-environment node
import { execFileSync } from 'node:child_process'
import { generateKeyPairSync } from 'node:crypto'
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'
import { createGraphProducerEvidenceVerifier, measureAnalyzerSourceBuild } from './graph-producer-evidence-v1'
import { createHostRegistryVerifierV1 } from './host-registry-issuer-v1'
import {
  createLocalProjectAnalysisHost, loadLocalProjectAnalysisHost,
  type LocalProjectAnalysisHostFileV1, type LocalProjectAnalysisRegistration,
} from './local-project-analysis-host'

const projectId = 'test-only:read-only-analysis'
const keyPair = generateKeyPairSync('ed25519')
const other = generateKeyPairSync('ed25519')

function git(checkout: string, ...args: string[]): void {
  execFileSync('git', ['-C', checkout, '-c', 'core.autocrlf=false', '-c', 'commit.gpgsign=false',
    '-c', 'user.name=Ripple dev fixture', '-c', 'user.email=dev@example.test', ...args])
}

function producerInput(registration: LocalProjectAnalysisRegistration) {
  const issued = registration.issueReceipt()
  if (issued.status !== 'issued') throw new Error(issued.reason)
  const verify = createHostRegistryVerifierV1({ publicKey: registration.publicKey, expected: registration.expected })
  const verified = verify(JSON.parse(JSON.stringify(issued.receipt)))
  if (verified.status !== 'verified') throw new Error(verified.reason)
  const { gitHead, ...binding } = verified.binding
  return { snapshot: captureFrozenSourceSnapshot(registration.checkoutRoot), binding: { ...binding, head: gitHead } }
}

describe('server-only local project analysis configuration', () => {
  let root: string
  let checkout: string
  let file: LocalProjectAnalysisHostFileV1
  let configPath: string
  const original = 'import "./theme.css"; export const App = () => <main className="card">Dev</main>\n'

  beforeAll(() => {
    root = realpathSync(mkdtempSync(path.join(tmpdir(), 'ripple-host-config-')))
    checkout = path.join(root, 'checkout')
    const keys = path.join(root, 'keys')
    mkdirSync(checkout)
    mkdirSync(keys)
    git(checkout, 'init', '--quiet', '--object-format=sha1')
    writeFileSync(path.join(checkout, 'App.tsx'), original)
    writeFileSync(path.join(checkout, 'theme.css'), ':root{--ink:blue} .card{color:var(--ink)}\n')
    git(checkout, 'add', 'App.tsx', 'theme.css')
    git(checkout, 'commit', '--quiet', '--no-verify', '-m', 'Development fixture')
    const snapshot = captureFrozenSourceSnapshot(checkout)
    const privateKeyPath = path.join(keys, 'dev-private.pem')
    const publicKeyPath = path.join(keys, 'dev-public.pem')
    writeFileSync(privateKeyPath, keyPair.privateKey.export({ type: 'pkcs8', format: 'pem' }), { mode: 0o600 })
    writeFileSync(publicKeyPath, keyPair.publicKey.export({ type: 'spki', format: 'pem' }))
    file = {
      version: 'ripple/local-project-analysis-host/v1', privateKeyPath, publicKeyPath,
      analyzerBuildPin: measureAnalyzerSourceBuild(),
      projects: [{ checkoutRoot: checkout, binding: {
        projectId, repository: 'example.test/ripple-fixture', gitHead: snapshot.gitHead!,
        rootTree: snapshot.rootTree!, sourceDigest: snapshot.sourceDigest,
      } }],
    }
    configPath = saveConfig('dev.json', file)
  }, 60_000)

  afterAll(() => {
    if (root) rmSync(root, { force: true, recursive: true })
  })

  function saveConfig(name: string, config: unknown) {
    const filePath = path.join(root, name)
    writeFileSync(filePath, JSON.stringify(config), { mode: 0o600 })
    return filePath
  }

  function resolve(configFile = configPath): LocalProjectAnalysisRegistration {
    const project = loadLocalProjectAnalysisHost(configFile)?.resolveProject(projectId)
    if (!project) throw new Error('Expected the development registration to load')
    return project
  }

  it('loads ephemeral files, verifies the receipt and runs the real pinned Analyzer', () => {
    const registration = resolve()
    const input = producerInput(registration)
    const producer = createGraphProducerEvidenceVerifier(registration.analyzerBuildPin)
    const result = producer.generate(input)
    expect(result.status).toBe('available-producer-evidence')
    if (result.status !== 'available-producer-evidence') return
    expect(result.evidence.source.head).toBe(registration.expected.gitHead)
    expect(result.evidence.build).toEqual(file.analyzerBuildPin)
    expect(JSON.parse(result.rawGraphBytes.toString()).nodes.length).toBeGreaterThan(0)
    expect(registration).not.toHaveProperty('privateKey')
  }, 90_000)

  it('does not load a missing, relative, malformed or incomplete server config', () => {
    const broken = path.join(root, 'broken.json')
    writeFileSync(broken, '{')
    const { analyzerBuildPin: _pin, ...withoutPin } = file
    for (const invalid of [undefined, 'dev.json', path.join(root, 'missing.json'),
      broken, saveConfig('no-pin.json', withoutPin),
      saveConfig('malformed-pin.json', { ...file, analyzerBuildPin: { ...file.analyzerBuildPin, runtime: null } }),
      saveConfig('duplicate.json', { ...file, projects: [...file.projects, ...file.projects] }),
    ]) {
      expect(loadLocalProjectAnalysisHost(invalid)).toBeUndefined()
    }
  })

  it('rejects wrong, missing and mismatched signing or verification keys', () => {
    const wrong = path.join(root, 'keys', 'wrong-public.pem')
    writeFileSync(wrong, other.publicKey.export({ type: 'spki', format: 'pem' }))
    for (const invalid of [
      { ...file, publicKeyPath: wrong },
      { ...file, publicKeyPath: file.privateKeyPath },
      { ...file, privateKeyPath: file.publicKeyPath },
      { ...file, privateKeyPath: path.join(root, 'keys', 'missing.pem') },
    ]) {
      expect(loadLocalProjectAnalysisHost(saveConfig('bad-key.json', invalid))).toBeUndefined()
    }
  })

  it('rejects host config or key files within service static roots', () => {
    expect(loadLocalProjectAnalysisHost(configPath, [root])).toBeUndefined()
    expect(loadLocalProjectAnalysisHost(configPath, [path.join(root, 'keys')])).toBeUndefined()
    expect(loadLocalProjectAnalysisHost(configPath, [checkout])?.resolveProject(projectId)).toBeDefined()
  })

  it('only selects exact project IDs and pins a copy of every authority setting', () => {
    const projects = file.projects.map(project => ({ ...project, binding: { ...project.binding } }))
    const analyzerBuildPin = structuredClone(file.analyzerBuildPin)
    const host = createLocalProjectAnalysisHost({ ...keyPair, projects, analyzerBuildPin })
    const before = host.resolveProject(projectId)!
    projects[0].checkoutRoot = root
    projects[0].binding.sourceDigest = '0'.repeat(64)
    projects.push({ ...projects[0], binding: { ...projects[0].binding, projectId: 'new' } })
    analyzerBuildPin.runtime.nodeVersion = 'v0.0.0'
    analyzerBuildPin.dependencies.typescript = '0.0.0'
    expect(host.resolveProject('new')).toBeUndefined()
    expect(host.resolveProject(checkout)).toBeUndefined()
    expect(Reflect.apply(host.resolveProject, host, [{ projectId, checkoutRoot: root }])).toBeUndefined()
    expect(Reflect.apply(host.resolveProject, host, [projectId, { publicKey: other.publicKey, analyzerBuildPin }])).toBe(before)
    expect(before.checkoutRoot).toBe(checkout)
    expect(before.expected).toEqual(file.projects[0].binding)
    expect(before.analyzerBuildPin).toEqual(file.analyzerBuildPin)
    expect(Object.isFrozen(before.analyzerBuildPin.runtime)).toBe(true)
    expect(Object.isFrozen(before.analyzerBuildPin.dependencies)).toBe(true)
    expect(before.issueReceipt().status).toBe('issued')
  })

  it('rejects a valid receipt from a caller-chosen key under the original public pin', () => {
    const registration = resolve()
    const attacker = createLocalProjectAnalysisHost({ ...other, projects: file.projects, analyzerBuildPin: file.analyzerBuildPin })
    const issued = attacker.resolveProject(projectId)!.issueReceipt()
    if (issued.status !== 'issued') throw new Error(issued.reason)
    expect(createHostRegistryVerifierV1(registration)(issued.receipt)).toEqual({ status: 'rejected', reason: 'key-mismatch' })
  })

  it('withholds receipts for worktree drift and inconsistent registered Git identity', () => {
    const registration = resolve()
    const filePath = path.join(checkout, 'App.tsx')
    writeFileSync(filePath, original + '// drift\n')
    try {
      expect(registration.issueReceipt()).toEqual({ status: 'unavailable', reason: 'snapshot-unavailable' })
    } finally {
      writeFileSync(filePath, original)
    }
    const entry = file.projects[0]
    const wrong = saveConfig('wrong-source.json', { ...file, projects: [
      { ...entry, binding: { ...entry.binding, rootTree: '0'.repeat(40) } },
    ] })
    expect(resolve(wrong).issueReceipt()).toEqual({ status: 'rejected', reason: 'snapshot-binding-mismatch' })
  })

  it('retains the configured build pin and lets the producer reject a different measured build', () => {
    const registration = resolve(saveConfig('wrong-build.json', {
      ...file, analyzerBuildPin: { ...file.analyzerBuildPin, buildSha256: '0'.repeat(64) },
    }))
    expect(createGraphProducerEvidenceVerifier(registration.analyzerBuildPin).generate(producerInput(registration)))
      .toEqual({ status: 'unavailable', reason: 'build-identity-mismatch' })
  }, 60_000)
})
