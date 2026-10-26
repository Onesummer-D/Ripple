import { afterEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import type { RuntimeIdentityArchiveReadEntry } from './runtime-identity-archive'
import { assessRuntimeIdentityArchives, runtimeIdentityAssessmentSha256, runtimeIdentityNamespaceProven, runtimeIdentityRecordKey } from './runtime-identity-assessment'
import { RUNTIME_IDENTITY_PROTOCOL, RUNTIME_IDENTITY_PROTOCOL_V2, type RuntimeIdentityRecord, type RuntimeIdentitySnapshot } from './runtime-identity'
import type { SourceGraph } from './model'
import { digestTrackedTree, servedSourceDigest } from './project'

const roots: string[] = []
const page = { pathname: '/', search: '', hash: '' }
const baseBytes = 'export const label = "baseline"\n'
const candidateBytes = 'export const label = "candidate"\n'
const hashText = (value: string) => createHash('sha256').update(value, 'utf8').digest('hex')

function rootWithSource(content: string): string {
  const parent = path.join(process.cwd(), 'node_modules', '.tmp')
  fs.mkdirSync(parent, { recursive: true })
  const root = fs.mkdtempSync(path.join(parent, 'ripple-runtime-identity-assess-'))
  roots.push(root)
  fs.mkdirSync(path.join(root, 'src'))
  fs.writeFileSync(path.join(root, 'src', 'App.tsx'), content)
  execFileSync('git', ['init', '--quiet', root])
  execFileSync('git', ['-c', 'core.autocrlf=false', '-C', root, 'add', 'src/App.tsx'])
  execFileSync('git', ['-c', 'core.autocrlf=false', '-c', 'user.name=Ripple Test', '-c', 'user.email=ripple-test@example.invalid', '-C', root, 'commit', '--quiet', '-m', 'assessment fixture'])
  return root
}

function graph(sourceDigest: string): SourceGraph {
  return {
    id: `graph-${sourceDigest}`,
    revision: { projectId: 'project-1', sourceDigest, runtimeFingerprint: 'runtime-1' },
    nodes: [{ id: 'jsx:src/App.tsx#1', kind: 'jsx-element', label: 'heading' }],
    edges: [],
    unresolved: [],
  }
}

function record(overrides: Partial<RuntimeIdentityRecord> = {}): RuntimeIdentityRecord {
  return {
    sourceRef: 'jsx:src/App.tsx#1',
    sourceFile: 'src/App.tsx',
    runtimeInstanceId: '/:jsx:src/App.tsx#1',
    declaredCertainty: 'stable-react-instance',
    certainty: 'stable-react-instance',
    sourceVersion: hashText(baseBytes),
    domNode: 1,
    sameSourceCount: 1,
    reasons: [],
    ...overrides,
  }
}

function snapshot(records: RuntimeIdentityRecord[] = [record()], snapshotPage = page): RuntimeIdentitySnapshot {
  return { protocol: RUNTIME_IDENTITY_PROTOCOL, page: snapshotPage, records }
}

function stored(side: 'baseline' | 'candidate', value = snapshot(), sourceVersion = hashText(baseBytes)): RuntimeIdentityArchiveReadEntry {
  return {
    checkId: 'verification-1-desktop', route: '/', viewport: { width: 1280, height: 800 }, state: 'rendered', side,
    archive: 'stored', snapshot: { ...value, records: value.records.map(item => ({ ...item, sourceVersion: item.sourceVersion ?? sourceVersion })) },
    snapshotSha256: 'a'.repeat(64), artifact: { snapshot: { path: `identity/desktop/${side}.json`, sha256: 'a'.repeat(64) } },
  }
}

function fixture(options: { baseline?: RuntimeIdentityArchiveReadEntry; candidate?: RuntimeIdentityArchiveReadEntry; baselineBound?: string; candidateBound?: string; paths?: Array<{ pageRef: string; path: string; markerText: string }>; route?: string; omitContract?: boolean; } = {}) {
  const baselineRoot = rootWithSource(baseBytes)
  const candidateRoot = rootWithSource(candidateBytes)
  const baselineTreeDigest = digestTrackedTree(baselineRoot)
  const candidateTreeDigest = digestTrackedTree(candidateRoot)
  const baselineBound = options.baselineBound ?? baselineTreeDigest
  const candidateBound = options.candidateBound ?? candidateTreeDigest
  const planned = [
    options.baseline ?? stored('baseline'),
    options.candidate ?? stored('candidate', snapshot([record({ sourceVersion: hashText(candidateBytes) })]), hashText(candidateBytes)),
  ].map(entry => options.route ? { ...entry, route: options.route } : entry)
  const result = assessRuntimeIdentityArchives({
    archiveEntries: planned,
    verificationContract: options.omitContract ? undefined : { pages: options.paths ?? [{ pageRef: 'page:home', path: '/', markerText: 'Home' }], interactions: [] },
    sides: {
      baseline: { root: baselineRoot, graph: graph(baselineBound), boundDigest: baselineBound },
      candidate: { root: candidateRoot, graph: graph(candidateBound), boundDigest: candidateBound },
    },
  })
  return { result, baselineRoot, candidateRoot, baselineTreeDigest, candidateTreeDigest }
}

afterEach(() => {
  for (const root of roots.splice(0)) fs.rmSync(root, { recursive: true, force: true })
})

describe('host runtime identity assessment', () => {
  it('assesses each side against its own source tree, binds the side revision, and hashes each assessment', () => {
    const { result, baselineTreeDigest, candidateTreeDigest } = fixture()
    const baseline = result[0]
    const candidate = result[1]
    if (!('assessments' in baseline) || !('assessments' in candidate)) throw new Error('Expected two assessed identity entries')
    expect(result).toHaveLength(2)
    expect(result.map(item => item.side)).toEqual(['baseline', 'candidate'])
    expect(baseline).toMatchObject({
      archive: 'stored', assessmentStatus: 'complete',
      boundDigest: baselineTreeDigest, sourceDigests: { 'src/App.tsx': hashText(baseBytes) },
      assessments: [{ recordKey: JSON.stringify(['jsx:src/App.tsx#1', '/:jsx:src/App.tsx#1', 0]), assessment: { instanceIdentityProven: true, reasons: [] }, assessmentSha256: expect.stringMatching(/^[a-f0-9]{64}$/) }],
    })
    if ('assessments' in baseline) {
      const assessed = baseline.assessments[0]
      expect(assessed.assessmentSha256).toBe(runtimeIdentityAssessmentSha256(
        { checkId: baseline.checkId, route: baseline.route, viewport: baseline.viewport, state: baseline.state, side: baseline.side },
        baseline.snapshotSha256,
        assessed.recordKey,
        assessed.assessment,
      ))
    }
    expect(candidate).toMatchObject({
      archive: 'stored', assessmentStatus: 'complete',
      boundDigest: candidateTreeDigest, sourceDigests: { 'src/App.tsx': hashText(candidateBytes) },
      assessments: [{ assessment: { instanceIdentityProven: true, reasons: [] } }],
    })
  })

  it('uses the shared servedSourceDigest recipe and rejects path traversal or symlinks', () => {
    const root = rootWithSource(baseBytes)
    expect(servedSourceDigest(root, 'src/App.tsx')).toBe(hashText(baseBytes))
    expect(() => servedSourceDigest(root, '../outside.tsx')).toThrow(/路径/)
    if (process.platform !== 'win32') {
      const link = path.join(root, 'src', 'linked.tsx')
      fs.symlinkSync(path.join(root, 'src', 'App.tsx'), link)
      expect(() => servedSourceDigest(root, 'src/linked.tsx')).toThrow(/普通文件/)
    }
  })

  it('keeps page pathname, search, and hash as an exact expected-page check', () => {
    const baseline = stored('baseline', snapshot([record()], { pathname: '/', search: '?old=1', hash: '#old' }))
    const { result } = fixture({ baseline })
    expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['page-context-mismatch', 'route-namespace-stale']) } }] })
  })

  it('does not prove v1 pathname-only namespaces on query or hash routes', () => {
    for (const route of ['/products?tab=spec', '/#/products']) {
      const parsed = new URL(route, 'http://ripple.local')
      const oldId = `${parsed.pathname}:jsx:src/App.tsx#1`
      const baseline = stored('baseline', snapshot([record({ runtimeInstanceId: oldId })], {
        pathname: parsed.pathname, search: parsed.search, hash: parsed.hash,
      }))
      const { result } = fixture({ baseline, route, paths: [{ pageRef: 'page:test', path: route, markerText: 'Test' }] })
      expect(result[0]).toMatchObject({
        archive: 'stored',
        assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['route-namespace-stale']) } }],
      })
    }
  })

  it('preserves collector route-namespace-stale after a v1 route returns to an empty namespace', () => {
    const route = '/products'
    const staleRecord = record({
      runtimeInstanceId: '/products:jsx:src/App.tsx#1',
      reasons: ['route-namespace-stale'],
    })
    const baseline = stored('baseline', snapshot([staleRecord], { pathname: route, search: '', hash: '' }))
    const { result } = fixture({ baseline, route, paths: [{ pageRef: 'page:products', path: route, markerText: 'Products' }] })

    expect(result[0]).toMatchObject({
      archive: 'stored',
      assessments: [{ assessment: { instanceIdentityProven: false, reasons: ['route-namespace-stale'] } }],
    })
  })

  it('proves only a canonical v2 namespace bound to the complete page tuple', () => {
    const route = '/products?tab=spec#reviews'
    const parsed = new URL(route, 'http://ripple.local')
    const pageAtRender = { pathname: parsed.pathname, search: parsed.search, hash: parsed.hash }
    const namespace = `ripple-page-v2:${encodeURIComponent(JSON.stringify([pageAtRender.pathname, pageAtRender.search, pageAtRender.hash]))}:jsx:src/App.tsx#1`
    const value: RuntimeIdentitySnapshot = {
      protocol: RUNTIME_IDENTITY_PROTOCOL_V2,
      page: pageAtRender,
      records: [record({ runtimeInstanceId: namespace })],
    }
    expect(runtimeIdentityNamespaceProven(value, value.records[0])).toBe(true)
    const { result } = fixture({
      baseline: stored('baseline', value), route,
      paths: [{ pageRef: 'page:test', path: route, markerText: 'Test' }],
    })
    expect(result[0]).toMatchObject({ archive: 'stored', assessments: [{ assessment: { instanceIdentityProven: true, reasons: [] } }] })
  })

  it('marks malformed, non-canonical, or stale v2 namespaces route-namespace-stale', () => {
    const pageAtRender = { pathname: '/products', search: '?tab=spec', hash: '#reviews' }
    const goodTuple = encodeURIComponent(JSON.stringify([pageAtRender.pathname, pageAtRender.search, pageAtRender.hash]))
    const malformedIds = [
      `ripple-page-v2:${goodTuple.replace('%2F', '%2f')}:jsx:src/App.tsx#1`,
      `ripple-page-v2:${encodeURIComponent(JSON.stringify(['/products', '?tab=old', '#reviews']))}:jsx:src/App.tsx#1`,
      '/products:jsx:src/App.tsx#1',
      'ripple-page-v2:not-json:jsx:src/App.tsx#1',
    ]
    for (const runtimeInstanceId of malformedIds) {
      const value: RuntimeIdentitySnapshot = { protocol: RUNTIME_IDENTITY_PROTOCOL_V2, page: pageAtRender, records: [record({ runtimeInstanceId })] }
      expect(runtimeIdentityNamespaceProven(value, value.records[0])).toBe(false)
      const { result } = fixture({
        baseline: stored('baseline', value), route: '/products?tab=spec#reviews',
        paths: [{ pageRef: 'page:test', path: '/products?tab=spec#reviews', markerText: 'Test' }],
      })
      expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['route-namespace-stale']) } }] })
    }
  })

  it('rejects a namespace suffix that is not anchored to the record sourceRef', () => {
    const pageAtRender = { pathname: '/', search: '', hash: '' }
    const runtimeInstanceId = `ripple-page-v2:${encodeURIComponent(JSON.stringify(['/','', '']))}:jsx:src/App.tsx#1`
    const mismatched = record({ sourceRef: 'jsx:src/Other.tsx#9', runtimeInstanceId })
    const value: RuntimeIdentitySnapshot = { protocol: RUNTIME_IDENTITY_PROTOCOL_V2, page: pageAtRender, records: [mismatched] }
    expect(runtimeIdentityNamespaceProven(value, mismatched)).toBe(false)
    const { result } = fixture({ baseline: stored('baseline', value) })
    expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['route-namespace-stale']) } }] })
  })

  it('requires a unique sourceRef anchor at the current JSX leaf for v1 and v2 namespaces', () => {
    const ancestorRef = 'jsx:src/Parent.tsx#1'
    const leafRef = 'jsx:src/App.tsx#1'
    const otherLeafRef = 'jsx:src/Other.tsx#9'
    const nestedLeafTail = `${ancestorRef}:${leafRef}`
    const pageAtRender = { pathname: '/', search: '', hash: '' }
    const cases = [
      { sourceRef: leafRef, tail: leafRef, proven: true },
      // Historical direct-source key suffixes remain supported only with an
      // explicit delimiter after the exact sourceRef.
      { sourceRef: leafRef, tail: `${leafRef}:key:active`, proven: true },
      { sourceRef: leafRef, tail: `${leafRef}:key%3Aactive/a%2Fb`, proven: true },
      { sourceRef: leafRef, tail: `${leafRef}key:active`, proven: false },
      { sourceRef: leafRef, tail: `${leafRef}::key`, proven: false },
      { sourceRef: leafRef, tail: `${leafRef}:key:${leafRef}`, proven: false },
      { sourceRef: leafRef, tail: nestedLeafTail, proven: true },
      { sourceRef: leafRef, tail: `${nestedLeafTail}:key:active`, proven: true },
      { sourceRef: leafRef, tail: `${nestedLeafTail}:key%3Aactive/a%2Fb`, proven: true },
      // The record claims the ancestor, while the identity suffix continues
      // through the actual child. A lastIndexOf-only check accepts the parent
      // because the remaining child suffix begins with a colon.
      { sourceRef: ancestorRef, tail: nestedLeafTail, proven: false },
      { sourceRef: leafRef, tail: `${ancestorRef}:${otherLeafRef}`, proven: false },
      { sourceRef: leafRef, tail: `${nestedLeafTail}:${leafRef}`, proven: false },
    ]

    for (const protocol of [RUNTIME_IDENTITY_PROTOCOL, RUNTIME_IDENTITY_PROTOCOL_V2] as const) {
      const prefix = protocol === RUNTIME_IDENTITY_PROTOCOL
        ? '/:'
        : `ripple-page-v2:${encodeURIComponent(JSON.stringify(['/','', '']))}:`
      for (const item of cases) {
        const current = record({ sourceRef: item.sourceRef, runtimeInstanceId: `${prefix}${item.tail}` })
        const value: RuntimeIdentitySnapshot = { protocol, page: pageAtRender, records: [current] }
        expect(runtimeIdentityNamespaceProven(value, current), `${protocol}: ${item.sourceRef} -> ${item.tail}`).toBe(item.proven)
      }

      const forged = record({ sourceRef: ancestorRef, runtimeInstanceId: `${prefix}${nestedLeafTail}` })
      const forgedSnapshot: RuntimeIdentitySnapshot = { protocol, page: pageAtRender, records: [forged] }
      const { result } = fixture({ baseline: stored('baseline', forgedSnapshot) })
      expect(result[0]).toMatchObject({
        archive: 'stored',
        assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['route-namespace-stale']) } }],
      })
    }
  })

  it('keeps invalid and duplicate trusted contract paths unverified', () => {
    const cases = [
      { route: '//other.example/path', paths: [{ pageRef: 'page:bad', path: '//other.example/path', markerText: 'Bad' }] },
      { route: '/', paths: [
        { pageRef: 'page:a', path: '/', markerText: 'A' },
        { pageRef: 'page:b', path: '/./', markerText: 'B' },
      ] },
    ]
    for (const item of cases) {
      const { result } = fixture({ route: item.route, paths: item.paths })
      expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['page-context-unverified']) } }] })
    }
  })

  it('uses a canonical record key and hashes the capture tuple, key, and assessment together', () => {
    const current = record()
    const key = runtimeIdentityRecordKey(current, 0)
    expect(key).toBe(JSON.stringify([current.sourceRef, current.runtimeInstanceId, 0]))
    expect(runtimeIdentityRecordKey(current, 1)).not.toBe(key)
    expect(() => runtimeIdentityRecordKey(current, -1)).toThrow(/non-negative/)

    const capture = { checkId: 'check-1', route: '/', viewport: { width: 1280, height: 800 }, state: 'rendered', side: 'baseline' as const }
    const assessment = { sourceRef: current.sourceRef, instanceIdentityProven: false, reasons: ['identity-not-stable'] }
    const snapshotDigest = 'a'.repeat(64)
    const digest = runtimeIdentityAssessmentSha256(capture, snapshotDigest, key, assessment)
    expect(digest).toMatch(/^[a-f0-9]{64}$/)
    expect(runtimeIdentityAssessmentSha256({ ...capture, side: 'candidate' }, snapshotDigest, key, assessment)).not.toBe(digest)
    expect(runtimeIdentityAssessmentSha256(capture, snapshotDigest, runtimeIdentityRecordKey(current, 1), assessment)).not.toBe(digest)
    expect(runtimeIdentityAssessmentSha256(capture, 'b'.repeat(64), key, assessment)).not.toBe(digest)
  })

  it('derives the full page tuple from trusted contract paths and fails closed on missing or ambiguous mappings', () => {
    const exactCases = [
      { route: '/products', page: { pathname: '/products', search: '', hash: '' } },
      { route: '/products?tab=spec', page: { pathname: '/products', search: '?tab=spec', hash: '' } },
      { route: '/#/products', page: { pathname: '/', search: '', hash: '#/products' } },
      { route: '/products?tab=spec#reviews', page: { pathname: '/products', search: '?tab=spec', hash: '#reviews' } },
    ]
    for (const item of exactCases) {
      const fullTupleRequired = item.page.search !== '' || item.page.hash !== ''
      const runtimeInstanceId = fullTupleRequired
        ? `ripple-page-v2:${encodeURIComponent(JSON.stringify([item.page.pathname, item.page.search, item.page.hash]))}:jsx:src/App.tsx#1`
        : `${item.page.pathname}:jsx:src/App.tsx#1`
      const value: RuntimeIdentitySnapshot = {
        protocol: fullTupleRequired ? RUNTIME_IDENTITY_PROTOCOL_V2 : RUNTIME_IDENTITY_PROTOCOL,
        page: item.page,
        records: [record({ runtimeInstanceId })],
      }
      const baseline = stored('baseline', value)
      const { result } = fixture({ baseline, route: item.route, paths: [{ pageRef: 'page:test', path: item.route, markerText: 'Test' }] })
      expect(result[0]).toMatchObject({ archive: 'stored', assessmentStatus: 'complete', assessments: [{ assessment: { instanceIdentityProven: true } }] })
    }

    const ambiguousCases: Array<{ omitContract?: boolean; route?: string; paths?: Array<{ pageRef: string; path: string; markerText: string }> }> = [
      { omitContract: true },
      { paths: [] },
      { paths: [{ pageRef: 'page:a', path: '/', markerText: 'A' }, { pageRef: 'page:b', path: '/', markerText: 'B' }] },
      { route: '/products', paths: [{ pageRef: 'page:a', path: '/products', markerText: 'A' }, { pageRef: 'page:b', path: '/products#', markerText: 'B' }] },
    ]
    for (const options of ambiguousCases) {
      const { result } = fixture(options)
      expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['page-context-unverified']) } }] })
    }
  })

  it('downgrades a source version copied from the other side', () => {
    const baseline = stored('baseline', snapshot([record({ sourceVersion: hashText(candidateBytes) })]))
    const { result } = fixture({ baseline })
    expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: ['source-version-mismatch'] } }] })
  })

  it('fails closed when the contract has no unique route mapping', () => {
    const { result } = fixture({ paths: [] })
    expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: ['page-context-unverified'] } }] })
  })

  it('assigns unique tuple keys to duplicate records and downgrades every colliding runtime id', () => {
    const duplicate = record({ domNode: 2 })
    const baseline = stored('baseline', snapshot([record(), duplicate]))
    const { result } = fixture({ baseline })
    expect(result[0]).toMatchObject({ assessments: [
      { recordKey: JSON.stringify(['jsx:src/App.tsx#1', '/:jsx:src/App.tsx#1', 0]), assessment: { instanceIdentityProven: false, reasons: ['duplicate-runtime-instance'] } },
      { recordKey: JSON.stringify(['jsx:src/App.tsx#1', '/:jsx:src/App.tsx#1', 1]), assessment: { instanceIdentityProven: false, reasons: ['duplicate-runtime-instance'] } },
    ] })
    const assessments = (result[0] as { assessments: Array<{ recordKey: string; assessment: { instanceIdentityProven: boolean } }> }).assessments
    expect(new Set(assessments.map(item => item.recordKey)).size).toBe(assessments.length)
    expect(assessments.every(item => item.assessment.instanceIdentityProven === false)).toBe(true)
  })

  it('records an empty runtime instance id as unavailable while retaining the source record assessment', () => {
    const baseline = stored('baseline', snapshot([record({ runtimeInstanceId: '' })]))
    const { result } = fixture({ baseline })
    expect(result[0]).toMatchObject({ assessments: [{ assessment: { instanceIdentityProven: false, reasons: expect.arrayContaining(['instance-unavailable']) } }] })
  })

  it('retains only host-verified Snapshot evidence when side version binding fails', () => {
    const { result } = fixture({ baselineBound: 'd'.repeat(64) })
    expect(result[0]).toMatchObject({
      archive: 'stored', assessmentStatus: 'version-unverifiable', reason: 'version-unverifiable', side: 'baseline',
      snapshot: { protocol: RUNTIME_IDENTITY_PROTOCOL, records: [expect.any(Object)] },
      snapshotSha256: 'a'.repeat(64), artifacts: { snapshot: { path: 'identity/desktop/baseline.json', sha256: 'a'.repeat(64) } },
      expectedBoundDigest: 'd'.repeat(64), observedSourceDigests: { 'src/App.tsx': hashText(baseBytes) },
      assessments: [{ assessment: { instanceIdentityProven: false, locatable: false, reasons: expect.arrayContaining(['source-version-unavailable']) } }],
    })
    expect('boundDigest' in result[0]).toBe(false)
    expect('sourceDigests' in result[0]).toBe(false)
    expect('snapshot' in result[1] && result[1].assessmentStatus === 'complete').toBe(true)
    expect('assessments' in result[1]).toBe(true)
  })

  it('returns version-unverifiable if the source root changes after the trusted graph was built', () => {
    const baselineRoot = rootWithSource(baseBytes)
    const candidateRoot = rootWithSource(candidateBytes)
    const baselineDigest = digestTrackedTree(baselineRoot)
    const candidateDigest = digestTrackedTree(candidateRoot)
    const baselineEntry = stored('baseline')
    fs.writeFileSync(path.join(baselineRoot, 'src', 'App.tsx'), `${baseBytes}// drift\n`)
    const result = assessRuntimeIdentityArchives({
      archiveEntries: [baselineEntry, stored('candidate', snapshot([record({ sourceVersion: hashText(candidateBytes) })]))],
      verificationContract: { pages: [{ pageRef: 'page:home', path: '/', markerText: 'Home' }], interactions: [] },
      sides: {
        baseline: { root: baselineRoot, graph: graph(baselineDigest), boundDigest: baselineDigest },
        candidate: { root: candidateRoot, graph: graph(candidateDigest), boundDigest: candidateDigest },
      },
    })
    expect(result[0]).toMatchObject({ archive: 'stored', assessmentStatus: 'version-unverifiable', reason: 'version-unverifiable', snapshot: { records: [expect.any(Object)] } })
    if ('assessments' in result[0]) expect(result[0].assessments.every(item => item.assessment.instanceIdentityProven === false)).toBe(true)
  })

  it('preserves A① capture failures as keyed host failure entries', () => {
    const failure: RuntimeIdentityArchiveReadEntry = {
      checkId: 'verification-1-desktop', route: '/', viewport: { width: 1280, height: 800 }, state: 'rendered', side: 'baseline',
      archive: 'failed', reason: 'collector-error', detail: 'Collector failed.',
    }
    const { result } = fixture({ baseline: failure })
    expect(result[0]).toEqual(failure)
  })

  it('retains a valid empty snapshot as a stored identity entry with an empty assessment list', () => {
    const empty = stored('baseline', snapshot([]))
    const { result } = fixture({ baseline: empty })
    expect('assessments' in result[0]).toBe(true)
    expect(result[0]).toMatchObject({ snapshot: { records: [] }, assessments: [] })
  })
})
