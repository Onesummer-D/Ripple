import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { BrowserVerificationContract } from './model'
import { RUNTIME_IDENTITY_PROTOCOL, RUNTIME_IDENTITY_PROTOCOL_V2, type RuntimeIdentitySnapshot } from './runtime-identity'
import {
  planRuntimeIdentityCaptures,
  readRuntimeIdentityArchives,
  RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES,
  type RuntimeIdentityCapturePlan,
  type RuntimeIdentityArchiveReadEntry,
} from './runtime-identity-archive'

const roots: string[] = []
const extraPaths: string[] = []
const runId = 'verification-test-run'
const contract: BrowserVerificationContract = {
  pages: [{ pageRef: 'page:home', path: '/', markerText: 'Home title' }],
  interactions: [],
}
const viewport = { name: 'desktop', width: 1280, height: 800 }
const plans = planRuntimeIdentityCaptures({ runId, viewports: [viewport], verificationContract: contract })
const baselinePlan = plans.find(plan => plan.side === 'baseline')!
const candidatePlan = plans.find(plan => plan.side === 'candidate')!

function createRunRoot(): string {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-identity-host-'))
  roots.push(root)
  return root
}

function snapshot(records: RuntimeIdentitySnapshot['records'] = [
  {
    sourceRef: 'jsx:src/App.tsx#1',
    sourceFile: 'src/App.tsx',
    runtimeInstanceId: '/:jsx:src/App.tsx#1',
    declaredCertainty: 'stable-react-instance',
    certainty: 'stable-react-instance',
    sourceVersion: 'a'.repeat(64),
    domNode: 1,
    sameSourceCount: 1,
    reasons: [],
  },
]): RuntimeIdentitySnapshot {
  return { protocol: RUNTIME_IDENTITY_PROTOCOL, page: { pathname: '/', search: '', hash: '' }, records }
}

function digest(bytes: Uint8Array): string {
  return createHash('sha256').update(bytes).digest('hex')
}

function canonicalJson(value: unknown): string {
  if (value === null) return 'null'
  if (typeof value === 'string' || typeof value === 'boolean' || typeof value === 'number') return JSON.stringify(value) ?? 'null'
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`
  if (typeof value === 'object') {
    const record = value as Record<string, unknown>
    return `{${Object.keys(record).sort().map(key => `${JSON.stringify(key)}:${canonicalJson(record[key])}`).join(',')}}`
  }
  throw new Error('test fixture is not JSON data')
}

function artifactFile(root: string, plan: RuntimeIdentityCapturePlan): string {
  const filePath = path.join(root, ...plan.artifactPath.split('/'))
  fs.mkdirSync(path.dirname(filePath), { recursive: true })
  return filePath
}

function storedEntry(root: string, plan: RuntimeIdentityCapturePlan, bytes = Buffer.from(`${canonicalJson(snapshot())}\n`, 'utf8')) {
  const hash = digest(bytes)
  fs.writeFileSync(artifactFile(root, plan), bytes)
  return {
    schema: 'ripple-runtime-identity-capture/v1',
    checkId: plan.checkId,
    route: plan.route,
    viewport: plan.viewport,
    state: plan.state,
    side: plan.side,
    archive: 'stored',
    snapshotSha256: hash,
    artifact: { snapshot: { path: plan.artifactPath, sha256: hash } },
  }
}

function failedEntry(plan: RuntimeIdentityCapturePlan, reason: string, detail?: string) {
  return {
    schema: 'ripple-runtime-identity-capture/v1',
    checkId: plan.checkId,
    route: plan.route,
    viewport: plan.viewport,
    state: plan.state,
    side: plan.side,
    archive: 'failed',
    reason,
    ...(detail ? { detail } : {}),
  }
}

function read(root: string, manifestEntries: unknown = [storedEntry(root, baselinePlan), storedEntry(root, candidatePlan)]) {
  return readRuntimeIdentityArchives({ runRoot: root, plannedCaptures: plans, manifestEntries })
}

function failures(entries: RuntimeIdentityArchiveReadEntry[]) {
  return entries.filter((entry): entry is Extract<RuntimeIdentityArchiveReadEntry, { archive: 'failed' }> => entry.archive === 'failed')
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
  for (const file of extraPaths.splice(0)) fs.rmSync(file, { force: true })
})

describe('host runtime identity archive verification', () => {
  it('derives fixed baseline/candidate paths from the trusted run plan', () => {
    expect(plans).toHaveLength(2)
    expect(plans.map(plan => plan.side)).toEqual(['baseline', 'candidate'])
    expect(plans.map(plan => plan.artifactPath)).toEqual([
      expect.stringMatching(/^identity\/desktop-[a-f0-9]{8}\/baseline-identity\.json$/),
      expect.stringMatching(/^identity\/desktop-[a-f0-9]{8}\/candidate-identity\.json$/),
    ])
    expect(planRuntimeIdentityCaptures({ runId, viewports: [viewport], verificationContract: { pages: [], interactions: [] } })).toEqual([])
  })

  it('rejects trusted viewport plans that collide on fixed artifact paths', () => {
    expect(() => planRuntimeIdentityCaptures({
      runId,
      viewports: [viewport, { ...viewport, width: 900, height: 600 }],
      verificationContract: contract,
    })).toThrow('colliding artifact paths')
  })

  it('reads both sides and returns the SHA-256 of their actual bytes', () => {
    const root = createRunRoot()
    const result = read(root)
    expect(result.diagnostics).toEqual([])
    expect(result.entries).toHaveLength(2)
    expect(result.entries.every(entry => entry.archive === 'stored')).toBe(true)
    for (const entry of result.entries) {
      if (entry.archive !== 'stored') continue
      const actual = fs.readFileSync(path.join(root, ...entry.artifact.snapshot.path.split('/')))
      expect(entry.snapshotSha256).toBe(digest(actual))
      expect(entry.artifact.snapshot.sha256).toBe(digest(actual))
      expect(entry.snapshot.protocol).toBe(RUNTIME_IDENTITY_PROTOCOL)
    }
  })

  it('accepts a v2 snapshot as an archived protocol while leaving namespace proof to the host assessor', () => {
    const root = createRunRoot()
    const v2 = { ...snapshot(), protocol: RUNTIME_IDENTITY_PROTOCOL_V2 }
    const bytes = Buffer.from(`${canonicalJson(v2)}\n`, 'utf8')
    const result = read(root, [storedEntry(root, baselinePlan, bytes), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'stored', snapshot: { protocol: RUNTIME_IDENTITY_PROTOCOL_V2 } })
  })

  it('accepts a legal empty records list', () => {
    const root = createRunRoot()
    const bytes = Buffer.from(`${canonicalJson(snapshot([]))}\n`)
    const result = read(root, [storedEntry(root, baselinePlan, bytes), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'stored', side: 'baseline', snapshot: { records: [] } })
    expect(failures(result.entries)).toEqual([])
  })

  it('preserves a collector failure on one side while accepting the independent other side', () => {
    const root = createRunRoot()
    const result = read(root, [
      failedEntry(baselinePlan, 'collector-error', 'collector failed token=secret-value at C:\\private\\file.ts'),
      storedEntry(root, candidatePlan),
    ])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'collector-error', side: 'baseline' })
    if (result.entries[0].archive === 'failed') {
      expect(result.entries[0].detail).toContain('token=<redacted>')
      expect(result.entries[0].detail).toContain('<path>')
      expect(result.entries[0].detail!.length).toBeLessThanOrEqual(240)
      expect(result.entries[0].detail).not.toContain('secret-value')
    }
    expect(result.entries[1]).toMatchObject({ archive: 'stored', side: 'candidate' })
  })

  it('preserves A① missing-collectorSource as snapshot-unavailable', () => {
    const root = createRunRoot()
    const result = read(root, [
      failedEntry(baselinePlan, 'snapshot-unavailable', 'collector source missing'),
      storedEntry(root, candidatePlan),
    ])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', side: 'baseline', detail: 'collector source missing' })
    expect(result.entries[1].archive).toBe('stored')
  })

  it('uses only v1.2 archive failure reasons and fails unknown container reasons closed', () => {
    const root = createRunRoot()
    const result = read(root, [failedEntry(baselinePlan, 'container-invented-state'), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
    expect(result.entries[1].archive).toBe('stored')
  })

  it('does not accept container-declared version-unverifiable as an archive failure state', () => {
    const root = createRunRoot()
    const result = read(root, [failedEntry(baselinePlan, 'version-unverifiable'), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
    expect('snapshot' in result.entries[0]).toBe(false)
    expect(result.entries[1].archive).toBe('stored')
  })

  it('records a missing manifest side as side-missing', () => {
    const root = createRunRoot()
    const result = read(root, [storedEntry(root, candidatePlan)])
    expect(failures(result.entries)).toMatchObject([{ checkId: baselinePlan.checkId, side: 'baseline', reason: 'side-missing' }])
  })

  it('records a missing side artifact as side-missing', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    fs.unlinkSync(artifactFile(root, baselinePlan))
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'side-missing' })
  })

  it('rejects a manifest path escape without following the declared path', () => {
    const root = createRunRoot()
    const outside = path.join(root, '..', 'identity-host-outside.json')
    extraPaths.push(outside)
    fs.writeFileSync(outside, `${canonicalJson(snapshot())}\n`)
    const baseline = storedEntry(root, baselinePlan)
    baseline.artifact.snapshot.path = '../identity-host-outside.json'
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
    expect(result.entries[1].archive).toBe('stored')
  })

  it('rejects a tampered snapshot by comparing the host hash with both declarations', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    fs.appendFileSync(artifactFile(root, baselinePlan), ' ')
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'artifact-hash-mismatch', declaredSnapshotSha256: baseline.snapshotSha256 })
    expect('snapshot' in result.entries[0]).toBe(false)
    expect(result.entries[1].archive).toBe('stored')
  })

  it('rejects disagreement between inline and artifact hash claims', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    baseline.snapshotSha256 = 'b'.repeat(64)
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'artifact-hash-mismatch' })
  })

  it('rejects invalid JSON even when both hash declarations match the bytes', () => {
    const root = createRunRoot()
    const result = read(root, [storedEntry(root, baselinePlan, Buffer.from('{broken')), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', declaredSnapshotSha256: expect.any(String) })
  })

  it('rejects valid JSON that does not preserve A① deterministic serialization', () => {
    const root = createRunRoot()
    const nonCanonical = Buffer.from(`${JSON.stringify(snapshot())}\n`, 'utf8')
    const result = read(root, [storedEntry(root, baselinePlan, nonCanonical), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
  })

  it('rejects invalid snapshot protocol and record schemas', () => {
    const root = createRunRoot()
    const badProtocol = Buffer.from(`${canonicalJson({ ...snapshot(), protocol: 'other/v1' })}\n`)
    const result = read(root, [storedEntry(root, baselinePlan, badProtocol), storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })

    const badRecord = Buffer.from(`${canonicalJson(snapshot([{ ...snapshot().records[0], reasons: ['unknown-reason'] as never }]))}\n`)
    const secondRoot = createRunRoot()
    const second = read(secondRoot, [storedEntry(secondRoot, baselinePlan, badRecord), storedEntry(secondRoot, candidatePlan)])
    expect(second.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
  })

  it('rejects duplicate planned side entries without losing the other side', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    const result = read(root, [baseline, { ...baseline }, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', side: 'baseline', reason: 'snapshot-unavailable' })
    expect(result.entries[1].archive).toBe('stored')
  })

  it('rejects unplanned entries and reports them without admitting them as run points', () => {
    const root = createRunRoot()
    const extra = { ...storedEntry(root, candidatePlan), checkId: 'unplanned-check' }
    const result = read(root, [storedEntry(root, baselinePlan), storedEntry(root, candidatePlan), extra])
    expect(result.entries).toHaveLength(2)
    expect(result.diagnostics).toEqual(['1 unplanned runtime identity capture entry was rejected.'])
    expect(result.entries.every(entry => entry.checkId !== 'unplanned-check')).toBe(true)
  })

  it('maps a same-side run-point tuple mismatch to snapshot-unavailable', () => {
    const root = createRunRoot()
    const baseline = { ...storedEntry(root, baselinePlan), route: '/different' }
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', route: baselinePlan.route })
    expect(result.entries[1].archive).toBe('stored')
  })

  it('rejects a non-regular file at the fixed artifact path', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    const file = artifactFile(root, baselinePlan)
    fs.unlinkSync(file)
    fs.mkdirSync(file)
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked artifact file', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    const file = artifactFile(root, baselinePlan)
    const outside = path.join(root, 'outside.json')
    fs.writeFileSync(outside, `${canonicalJson(snapshot())}\n`)
    fs.unlinkSync(file)
    fs.symlinkSync(outside, file)
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked artifact directory', () => {
    const root = createRunRoot()
    const baseline = storedEntry(root, baselinePlan)
    const identityDir = path.join(root, 'identity')
    const outside = path.join(root, 'outside')
    fs.renameSync(identityDir, outside)
    fs.symlinkSync(outside, identityDir, 'dir')
    const result = read(root, [baseline, storedEntry(root, candidatePlan)])
    expect(result.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
  })

  it.skipIf(process.platform === 'win32')('rejects a symlinked trusted run root', () => {
    const root = createRunRoot()
    const link = `${root}-link`
    extraPaths.push(link)
    fs.symlinkSync(root, link, 'dir')
    const result = readRuntimeIdentityArchives({ runRoot: link, plannedCaptures: plans, manifestEntries: [] })
    expect(failures(result.entries).map(entry => entry.reason)).toEqual(['snapshot-unavailable', 'snapshot-unavailable'])
  })

  it.skipIf(process.platform === 'win32')('rejects a trusted run root reached through a symlinked parent', () => {
    const root = createRunRoot()
    const parent = path.dirname(root)
    const link = `${root}-parent-link`
    extraPaths.push(link)
    fs.symlinkSync(parent, link, 'dir')
    const linkedRoot = path.join(link, path.basename(root))
    const result = readRuntimeIdentityArchives({ runRoot: linkedRoot, plannedCaptures: plans, manifestEntries: [] })
    expect(failures(result.entries).map(entry => entry.reason)).toEqual(['snapshot-unavailable', 'snapshot-unavailable'])
    expect(result.diagnostics[0]).toContain('symbolic link')
  })

  it('accepts the exact 16 MiB boundary and rejects one byte over without truncation', () => {
    const root = createRunRoot()
    const originalRecord = snapshot().records[0]
    const emptyLabelSnapshot = snapshot([{ ...originalRecord, label: '' }])
    const emptyLabelBytes = Buffer.from(`${canonicalJson(emptyLabelSnapshot)}\n`, 'utf8')
    const boundaryRecord = { ...originalRecord, label: 'x'.repeat(RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES - emptyLabelBytes.length) }
    const boundary = Buffer.from(`${canonicalJson(snapshot([boundaryRecord]))}\n`, 'utf8')
    expect(boundary.length).toBe(RUNTIME_IDENTITY_SNAPSHOT_LIMIT_BYTES)
    const exact = read(root, [storedEntry(root, baselinePlan, boundary), storedEntry(root, candidatePlan)])
    expect(exact.entries[0].archive).toBe('stored')

    const secondRoot = createRunRoot()
    const oversized = Buffer.concat([boundary, Buffer.from(' ')])
    const over = read(secondRoot, [storedEntry(secondRoot, baselinePlan, oversized), storedEntry(secondRoot, candidatePlan)])
    expect(over.entries[0]).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', declaredSnapshotSha256: digest(oversized) })
    expect(over.entries[1].archive).toBe('stored')
  })

  it('records every planned side as failed when the trusted run root is missing or unsafe', () => {
    const missingRoot = createRunRoot()
    fs.rmSync(missingRoot, { recursive: true, force: true })
    const missing = readRuntimeIdentityArchives({ runRoot: missingRoot, plannedCaptures: plans, manifestEntries: [] })
    expect(failures(missing.entries).map(entry => entry.reason)).toEqual(['side-missing', 'side-missing'])
  })
})
