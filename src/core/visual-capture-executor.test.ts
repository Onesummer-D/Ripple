// The production capture executor is intentionally plain ESM because it runs
// inside the verification container without a TypeScript transform. This
// contract test exercises that module with lightweight browser stubs.
// @ts-nocheck
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { afterEach, describe, expect, it } from 'vitest'
import { captureVisualSide, visualViewportDir, writeRuntimeIdentityArtifact, writeVisualSideArtifacts } from './visual-capture-executor.mjs'

const LIMIT = 16 * 1024 * 1024
const protocol = 'ripple-runtime-identity/v1'
const page = { pathname: '/', search: '', hash: '' }
const snapshot = (records = []) => ({ protocol, page, records })
const captured = (value, collection = 'collected', error = null) => ({
  runtimeIdentitySnapshot: value,
  runtimeIdentityCollection: collection,
  runtimeIdentityError: error,
})
const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-a1-'))
const sha256 = bytes => createHash('sha256').update(bytes).digest('hex')

afterEach(() => {
  delete globalThis.__rippleCollectorCount
  delete globalThis.window
  delete globalThis.document
  delete globalThis.location
  delete globalThis.getComputedStyle
})

describe('A① runtime identity archive contract', () => {
  it('derives fixed collision-resistant directories from trusted viewport names', () => {
    const a = visualViewportDir('mobile/tablet')
    const b = visualViewportDir('mobile-tablet')
    const longA = visualViewportDir('a'.repeat(40) + '-one')
    const longB = visualViewportDir('a'.repeat(40) + '-two')
    expect(a).not.toBe(b)
    expect(longA).not.toBe(longB)
    expect(a).toMatch(/^[a-z0-9-]{1,32}$/)
    expect(longA).toMatch(/^[a-z0-9-]{1,32}$/)
  })

  it('distinguishes missing collector source, source serialization failure, and collector throw', async () => {
    const root = tempRoot()
    globalThis.window = { scrollX: 0, scrollY: 0, innerWidth: 100, innerHeight: 100, devicePixelRatio: 1 }
    globalThis.document = { querySelectorAll: () => [], body: {}, documentElement: { scrollWidth: 100, scrollHeight: 100 } }
    globalThis.location = { pathname: '/', search: '', hash: '', href: 'http://capture.test/' }
    globalThis.getComputedStyle = () => ({ position: 'static', overflowX: 'visible', overflowY: 'visible', display: 'block', visibility: 'visible', opacity: '1', transform: 'none', filter: 'none', perspective: 'none', backdropFilter: 'none', contain: '', containerType: '', contentVisibility: 'visible', willChange: 'auto' })
    const pageStub = {
      evaluate: async (fn, arg) => typeof arg === 'object' && arg?.side ? fn(arg) : true,
      screenshot: async () => new Uint8Array([1, 2, 3]),
      viewportSize: () => ({ width: 100, height: 100 }),
    }
    const missing = await captureVisualSide(pageStub, { side: 'baseline', route: '/', collectorSource: undefined, screenshot: 'none' })
    expect(writeRuntimeIdentityArtifact(root, 'desktop', 'baseline', missing)).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', detail: 'collector source missing' })

    const unserialisable = await captureVisualSide(pageStub, { side: 'baseline', route: '/', collectorSource: 'not valid javascript (', screenshot: 'none' })
    expect(writeRuntimeIdentityArtifact(root, 'desktop-serialize', 'baseline', unserialisable)).toMatchObject({ archive: 'failed', reason: 'collector-error', detail: 'collector source failed to serialize' })

    const throwing = captured(null, 'failed', 'collector threw token=private-value\nwith a long detail')
    const failed = writeRuntimeIdentityArtifact(root, 'desktop-throw', 'baseline', throwing)
    expect(failed).toMatchObject({ archive: 'failed', reason: 'collector-error' })
    expect(failed.detail).toBe('collector threw token=<redacted> with a long detail')
    expect(failed.detail.length).toBeLessThanOrEqual(300)
  })

  it('accepts a legal empty snapshot, rejects invalid schema, and reports serialization errors', () => {
    const root = tempRoot()
    const empty = writeRuntimeIdentityArtifact(root, 'desktop', 'baseline', captured(snapshot([])))
    expect(empty.archive).toBe('stored')
    const bytes = fs.readFileSync(path.join(root, 'identity', 'desktop', 'baseline-identity.json'))
    expect(empty.snapshotSha256).toBe(sha256(bytes))
    expect(JSON.parse(bytes)).toEqual(snapshot([]))

    expect(writeRuntimeIdentityArtifact(root, 'invalid-schema', 'baseline', captured({ records: [] }))).toMatchObject({
      archive: 'failed', reason: 'snapshot-unavailable', detail: 'runtime identity snapshot schema is invalid',
    })
    const circular = snapshot([])
    circular.records.push(circular)
    expect(writeRuntimeIdentityArtifact(root, 'circular', 'baseline', captured(circular))).toMatchObject({
      archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity snapshot contains a circular reference.',
    })

    const v2 = writeRuntimeIdentityArtifact(root, 'desktop-v2', 'candidate', captured({ ...snapshot([]), protocol: 'ripple-runtime-identity/v2' }))
    expect(v2.archive).toBe('stored')
    expect(JSON.parse(fs.readFileSync(path.join(root, 'identity', 'desktop-v2', 'candidate-identity.json'), 'utf8')).protocol).toBe('ripple-runtime-identity/v2')
  })

  it('stores snapshots at or below the 16MB limit and refuses oversized snapshots without truncating', () => {
    const root = tempRoot()
    const emptyValueBytes = Buffer.byteLength('{"page":{"hash":"","pathname":"/","search":""},"protocol":"ripple-runtime-identity/v1","records":[{"value":""}]}\n', 'utf8')
    const exact = snapshot([{ value: 'x'.repeat(LIMIT - emptyValueBytes) }])
    const stored = writeRuntimeIdentityArtifact(root, 'under-limit', 'baseline', captured(exact))
    expect(stored.archive).toBe('stored')
    expect(fs.statSync(path.join(root, 'identity', 'under-limit', 'baseline-identity.json')).size).toBe(LIMIT)

    const over = snapshot([{ value: 'x'.repeat(LIMIT - emptyValueBytes + 1) }])
    const refused = writeRuntimeIdentityArtifact(root, 'over-limit', 'baseline', captured(over))
    expect(refused).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
    expect(refused.detail).toContain('exceeds 16777216 bytes')
    expect(fs.existsSync(path.join(root, 'identity', 'over-limit', 'baseline-identity.json'))).toBe(false)
  })

  it('rejects path escape and non-regular destinations, and keeps errors bounded', () => {
    const root = tempRoot()
    const escaped = writeRuntimeIdentityArtifact(root, '../escape', 'baseline', captured(snapshot([])))
    expect(escaped).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity artifact directory is invalid.' })
    fs.mkdirSync(path.join(root, 'identity', 'desktop'), { recursive: true })
    fs.mkdirSync(path.join(root, 'identity', 'desktop', 'baseline-identity.json'))
    expect(writeRuntimeIdentityArtifact(root, 'desktop', 'baseline', captured(snapshot([])))).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity artifact path is not a regular file.' })
  })

  it.skipIf(process.platform === 'win32')('rejects symlink destinations and scrubs exclusive-write failures', () => {
    const root = tempRoot()
    const outside = path.join(root, 'outside.json')
    fs.writeFileSync(outside, 'leave-this-file-alone')
    fs.mkdirSync(path.join(root, 'identity', 'desktop'), { recursive: true })
    fs.symlinkSync(outside, path.join(root, 'identity', 'desktop', 'baseline-identity.json'), 'file')
    const symlink = writeRuntimeIdentityArtifact(root, 'desktop', 'baseline', captured(snapshot([])))
    expect(symlink).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity artifact path is not a regular file.' })
    expect(fs.readFileSync(outside, 'utf8')).toBe('leave-this-file-alone')

    const rootLinkParent = tempRoot()
    const outsideRoot = path.join(rootLinkParent, 'outside-root')
    const linkedRoot = path.join(rootLinkParent, 'linked-root')
    fs.mkdirSync(outsideRoot)
    fs.symlinkSync(outsideRoot, linkedRoot, 'dir')
    expect(writeRuntimeIdentityArtifact(linkedRoot, 'desktop', 'baseline', captured(snapshot([])))).toMatchObject({
      archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity artifact root must be a regular directory.',
    })
    expect(fs.readdirSync(outsideRoot)).toEqual([])

    const directoryRoot = tempRoot()
    const outsideDirectory = path.join(directoryRoot, 'outside-directory')
    fs.mkdirSync(outsideDirectory)
    fs.symlinkSync(outsideDirectory, path.join(directoryRoot, 'identity'), 'dir')
    expect(writeRuntimeIdentityArtifact(directoryRoot, 'desktop', 'baseline', captured(snapshot([])))).toMatchObject({
      archive: 'failed', reason: 'snapshot-unavailable', detail: 'Runtime identity artifact directory must be a regular directory.',
    })
    expect(fs.readdirSync(outsideDirectory)).toEqual([])

    const collisionRoot = tempRoot()
    const stored = writeRuntimeIdentityArtifact(collisionRoot, 'desktop', 'baseline', captured(snapshot([{ id: 'first' }])))
    expect(stored.archive).toBe('stored')
    const artifactPath = path.join(collisionRoot, stored.artifact.snapshot.path)
    const originalBytes = fs.readFileSync(artifactPath)
    const collision = writeRuntimeIdentityArtifact(collisionRoot, 'desktop', 'baseline', captured(snapshot([{ id: 'second' }])))
    expect(collision).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable' })
    expect(collision.detail).toContain('<path>')
    expect(collision.detail).not.toContain(collisionRoot)
    expect(fs.readFileSync(artifactPath)).toEqual(originalBytes)
  })

  it('retains one side when the other side fails', () => {
    const baselineRoot = tempRoot()
    const baseline = writeRuntimeIdentityArtifact(baselineRoot, 'desktop', 'baseline', captured(snapshot([{ id: 'b' }])))
    const candidate = writeRuntimeIdentityArtifact(baselineRoot, 'desktop', 'candidate', captured(null, 'unavailable', 'collector source missing'))
    expect(baseline.archive).toBe('stored')
    expect(candidate).toMatchObject({ archive: 'failed', reason: 'snapshot-unavailable', detail: 'collector source missing' })
    expect(fs.existsSync(path.join(baselineRoot, 'identity', 'desktop', 'baseline-identity.json'))).toBe(true)
    expect(fs.existsSync(path.join(baselineRoot, 'identity', 'desktop', 'candidate-identity.json'))).toBe(false)

    const candidateRoot = tempRoot()
    const candidateOnly = writeRuntimeIdentityArtifact(candidateRoot, 'desktop', 'candidate', captured(snapshot([{ id: 'c' }])))
    const baselineFailure = writeRuntimeIdentityArtifact(candidateRoot, 'desktop', 'baseline', captured(null, 'failed', 'collector exploded'))
    expect(candidateOnly.archive).toBe('stored')
    expect(baselineFailure).toMatchObject({ archive: 'failed', reason: 'collector-error', detail: 'collector exploded' })
    expect(fs.existsSync(path.join(candidateRoot, 'identity', 'desktop', 'candidate-identity.json'))).toBe(true)
  })
})

describe('A① same-evaluate capture invariant', () => {
  it('calls the collector once in the geometry evaluate and preserves identity geometry fields', async () => {
    const attrs = new Map([
      ['data-ripple-source', 'jsx:src/App.tsx#1'],
      ['data-ripple-instance', 'app'],
    ])
    const node = {
      parentElement: null,
      getAttribute: name => attrs.get(name) ?? null,
      setAttribute: (name, value) => attrs.set(name, value),
      removeAttribute: name => attrs.delete(name),
      getBoundingClientRect: () => ({ x: 0, y: 0, width: 10, height: 10 }),
      checkVisibility: () => true,
    }
    globalThis.window = { scrollX: 0, scrollY: 0, innerWidth: 100, innerHeight: 100, devicePixelRatio: 1 }
    globalThis.document = {
      querySelectorAll: selector => selector === '[data-ripple-source]' ? [node] : [],
      body: {},
      documentElement: { scrollWidth: 100, scrollHeight: 100 },
    }
    globalThis.location = { pathname: '/', search: '', hash: '', href: 'http://capture.test/' }
    globalThis.getComputedStyle = () => ({
      position: 'static', overflowX: 'visible', overflowY: 'visible', display: 'block', visibility: 'visible',
      opacity: '1', transform: 'none', filter: 'none', perspective: 'none', backdropFilter: 'none', contain: '',
      containerType: '', contentVisibility: 'visible', willChange: 'auto',
    })
    globalThis.__rippleCollectorCount = 0
    const collectorSource = `(options) => { globalThis.__rippleCollectorCount += 1; return { protocol: '${protocol}', page: { pathname: location.pathname, search: location.search, hash: location.hash }, records: [] }; }`
    const evaluateCalls = []
    const pageStub = {
      evaluate: async (fn, arg) => {
        evaluateCalls.push({ fn, arg })
        if (arg && typeof arg === 'object' && arg.side) return fn(arg)
        if (typeof arg === 'boolean') return true
        return fn()
      },
      screenshot: async () => new Uint8Array([1, 2, 3]),
      viewportSize: () => ({ width: 100, height: 100 }),
    }
    const result = await captureVisualSide(pageStub, {
      side: 'baseline', route: '/', collectorSource, screenshot: 'none', awaitFonts: false,
    })
    expect(globalThis.__rippleCollectorCount).toBe(1)
    expect(evaluateCalls.filter(call => call.arg && typeof call.arg === 'object' && call.arg.side)).toHaveLength(1)
    expect(result.geometry).toHaveProperty('elements.0.identityReasons')
    expect(result.geometry).toHaveProperty('sourceFileVersions')
    expect(result.geometry).toMatchObject({
      pageContext: { pathname: '/', search: '', hash: '' },
      runtimeIdentitySnapshot: snapshot([]),
    })

    const root = tempRoot()
    const side = writeVisualSideArtifacts(root, 'desktop', 'baseline', { ...result, screenshot: null })
    const geometry = JSON.parse(fs.readFileSync(path.join(root, side.geometry.path), 'utf8'))
    expect(geometry.runtimeIdentitySnapshot).toBeUndefined()
    expect(geometry.runtimeIdentityCollection).toBeUndefined()
    expect(geometry.pageContext).toEqual({ pathname: '/', search: '', hash: '' })
    expect(fs.existsSync(path.join(root, side.runtimeIdentity.artifact.snapshot.path))).toBe(true)
  })
})
