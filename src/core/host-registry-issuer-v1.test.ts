import { execFileSync } from 'node:child_process'
import { createHash, generateKeyPairSync, verify } from 'node:crypto'
import { mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import path from 'node:path'
import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import {
  createHostRegistryIssuerV1,
  createHostRegistryVerifierV1,
  type HostProjectBindingV1,
  type HostRegistryIssueResultV1,
  type HostRegistryReceiptV1,
} from './host-registry-issuer-v1'

const host = generateKeyPairSync('ed25519')
const caller = generateKeyPairSync('ed25519')
const roots: string[] = []

function createProject(projectId: string) {
  const checkoutRoot = realpathSync(mkdtempSync(path.join(tmpdir(), 'ripple-registry-')))
  roots.push(checkoutRoot)
  const git = (...args: string[]) => execFileSync('git', [
    '-C', checkoutRoot, '-c', 'user.email=registry@example.test', '-c', 'user.name=Registry test',
    '-c', 'commit.gpgsign=false', '-c', 'core.autocrlf=false', ...args,
  ], { encoding: 'utf8' }).trim()
  const file = 'App.tsx'
  const original = 'export const App = () => <div />\n'
  git('init', '--quiet', '--object-format=sha1')
  writeFileSync(path.join(checkoutRoot, file), original)
  git('add', '--', file)
  git('commit', '--quiet', '--no-verify', '-m', 'fixture')
  const fileSha256 = createHash('sha256').update(original).digest('hex')
  const sourceDigest = createHash('sha256').update(
    `${Buffer.byteLength(file)}:${file}:${Buffer.byteLength(original)}:${fileSha256}\n`,
  ).digest('hex')
  const binding = {
    projectId, repository: 'github.com/example/ripple-fixture',
    gitHead: git('rev-parse', 'HEAD'), rootTree: git('rev-parse', 'HEAD^{tree}'), sourceDigest,
  }
  return { checkoutRoot, binding, git, file, original }
}

function receiptFrom(result: HostRegistryIssueResultV1): HostRegistryReceiptV1 {
  expect(result.status).toBe('issued')
  if (result.status !== 'issued') throw new Error(`Fixture failed to issue: ${result.reason}`)
  return result.receipt
}

describe('Host Registry issuer v1', () => {
  let project: ReturnType<typeof createProject>
  let receipt: HostRegistryReceiptV1
  let verifyReceipt: ReturnType<typeof createHostRegistryVerifierV1>

  beforeAll(() => {
    project = createProject('registered-project')
    const issue = createHostRegistryIssuerV1({ projects: [project], privateKey: host.privateKey })
    receipt = receiptFrom(issue(project.binding.projectId))
    verifyReceipt = createHostRegistryVerifierV1({ expected: project.binding, publicKey: host.publicKey })
  }, 20_000)

  afterAll(() => {
    for (const root of roots) rmSync(root, { recursive: true, force: true })
  })

  it('issues from a real committed Git tree and independently verifies its signed bytes', () => {
    const { projectId, repository, gitHead, rootTree, sourceDigest } = project.binding
    const keyId = createHash('sha256').update(host.publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
    const payload = Buffer.from('ripple/host-registry/project-snapshot/v1\0' + JSON.stringify([
      'ripple-host-registry-receipt/v1', keyId, projectId, repository, gitHead, rootTree, sourceDigest,
    ]), 'utf8')
    expect(receipt.keyId).toBe(keyId)
    expect(verify(null, payload, host.publicKey, Buffer.from(receipt.signature, 'base64url'))).toBe(true)
    expect(verifyReceipt(JSON.parse(JSON.stringify(receipt)))).toEqual({ status: 'verified', binding: project.binding })
    expect(Object.keys(receipt).sort()).toEqual(['binding', 'keyId', 'signature', 'version'])
  })

  it('keeps an empty registry, an unknown project and a missing receipt unavailable', () => {
    const empty = createHostRegistryIssuerV1({ projects: [], privateKey: host.privateKey })
    const issue = createHostRegistryIssuerV1({ projects: [project], privateKey: host.privateKey })
    expect(empty(project.binding.projectId)).toEqual({ status: 'unavailable', reason: 'project-unregistered' })
    expect(issue('unknown')).toEqual({ status: 'unavailable', reason: 'project-unregistered' })
    expect(verifyReceipt(undefined)).toEqual({ status: 'unavailable', reason: 'receipt-missing' })
  })

  it('rejects a caller issuer with a self-consistent registry and the same genuine snapshot', () => {
    const issue = createHostRegistryIssuerV1({ projects: [project], privateKey: caller.privateKey })
    const forged = receiptFrom(issue(project.binding.projectId))
    expect(verifyReceipt(forged)).toEqual({ status: 'rejected', reason: 'key-mismatch' })
    expect(verifyReceipt({ ...forged, keyId: receipt.keyId })).toEqual({ status: 'rejected', reason: 'signature-invalid' })
    expect(verifyReceipt({ ...receipt, publicKey: caller.publicKey })).toEqual({ status: 'rejected', reason: 'invalid-receipt' })
  })

  const alterations: [keyof HostProjectBindingV1, string][] = [
    ['projectId', 'other-project'], ['repository', 'github.com/example/other'],
    ['gitHead', 'f'.repeat(40)], ['rootTree', 'e'.repeat(40)], ['sourceDigest', 'd'.repeat(64)],
  ]

  it.each(alterations)('rejects tampered and correctly signed out-of-context %s', (field, value) => {
    const other = { ...project.binding, [field]: value }
    expect(verifyReceipt({ ...receipt, binding: other })).toEqual({ status: 'rejected', reason: 'signature-invalid' })
    const verifyOther = createHostRegistryVerifierV1({ expected: other, publicKey: host.publicKey })
    expect(verifyOther(receipt)).toEqual({ status: 'rejected', reason: 'binding-mismatch' })
  })

  it.each(alterations.slice(2))('refuses to issue when captured %s differs from host registration', (field, value) => {
    const binding = { ...project.binding, [field]: value }
    const issue = createHostRegistryIssuerV1({ projects: [{ ...project, binding }], privateKey: host.privateKey })
    expect(issue(binding.projectId)).toEqual({ status: 'rejected', reason: 'snapshot-binding-mismatch' })
  })

  it('refuses issuance after writable checkout drift, including a new committed revision', () => {
    const drift = createProject('drift-project')
    const issue = createHostRegistryIssuerV1({ projects: [drift], privateKey: host.privateKey })
    receiptFrom(issue(drift.binding.projectId))
    writeFileSync(path.join(drift.checkoutRoot, drift.file), drift.original.replace('div', 'span'))
    expect(issue(drift.binding.projectId)).toEqual({ status: 'unavailable', reason: 'snapshot-unavailable' })
    drift.git('add', '--', drift.file)
    drift.git('commit', '--quiet', '--no-verify', '-m', 'drift')
    expect(issue(drift.binding.projectId)).toEqual({ status: 'rejected', reason: 'snapshot-binding-mismatch' })
  })

  it('rejects duplicate project registrations and protects copied host configuration', () => {
    const record = { ...project, binding: { ...project.binding } }
    expect(() => createHostRegistryIssuerV1({ projects: [project, record], privateKey: host.privateKey })).toThrow(/duplicate/)
    const projects = [record]
    const issue = createHostRegistryIssuerV1({ projects, privateKey: host.privateKey })
    const verifyPinned = createHostRegistryVerifierV1({ expected: record.binding, publicKey: host.publicKey })
    projects.push({ ...record, binding: { ...record.binding, projectId: 'another' } })
    record.binding.sourceDigest = caller.publicKey.export({ type: 'spki', format: 'der' }).toString('hex')
    expect(issue('another')).toEqual({ status: 'unavailable', reason: 'project-unregistered' })
    expect(verifyPinned(receiptFrom(issue(project.binding.projectId)))).toEqual({ status: 'verified', binding: project.binding })
  })

  it('fails closed for unknown versions, malformed signatures and invalid inputs', () => {
    const badPadding = receipt.signature.slice(0, -1) + 'B'
    const bad = [42, {}, { ...receipt, version: 'v2' }, { ...receipt, binding: null },
      { ...receipt, signature: receipt.signature + '=' }, { ...receipt, signature: badPadding }]
    for (const input of bad) {
      expect(verifyReceipt(input)).toEqual({ status: 'rejected', reason: 'invalid-receipt' })
    }
  })
})
