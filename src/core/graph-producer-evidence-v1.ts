import { execFileSync } from 'node:child_process'
import { createHash } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import { fileURLToPath } from 'node:url'
import { isFrozenSourceSnapshot } from './frozen-project-snapshot'
import type { FrozenSourceSnapshot } from './frozen-source-snapshot'
import { canonicalJson } from './graph-identity-v2'
import type { HostProjectRegistryRecord } from './graph-identity-v2-adapter'

const evidenceVersion = 'ripple/graph-producer-evidence/v1'
const buildVersion = 'ripple/analyzer-source-build/v1'
const producer = 'ripple/analyzeProject'
const buildRoot = fileURLToPath(new URL('../..', import.meta.url))
const sha256 = (bytes: string | Uint8Array) => createHash('sha256').update(bytes).digest('hex')
const domainHash = (domain: string, input: unknown) => sha256(domain + '\0' + canonicalJson(input))

// This source-build profile covers the Analyzer and Adapter runtime import closure.
// An omitted dependency cannot be resolved from the isolated build directory.
const buildFiles = [
  'package.json', 'package-lock.json', 'scripts/ts-extension-loader.mjs',
  ...['project.ts', 'css-token-source.ts', 'frozen-project-snapshot.ts', 'frozen-source-snapshot.ts',
    'graph-identity-v2.ts', 'graph-identity-v2-adapter.ts', 'page-overrides.ts',
    'project-config-resolver.mjs', 'project-data-routes.ts', 'relation-id-v1.ts'].map(file => 'src/core/' + file),
]
const packages = ['typescript', 'postcss', 'nanoid', 'picocolors', 'source-map-js']
const nodeFlags = ['--no-global-search-paths', '--experimental-transform-types', '--loader', './scripts/ts-extension-loader.mjs', '--input-type=module']
const runAnalyzer = `
import { createHash } from 'node:crypto'
import { readFileSync } from 'node:fs'
import ts from 'typescript'
import { captureFrozenSourceSnapshot } from './src/core/frozen-project-snapshot.ts'
import { analyzeProject } from './src/core/project.ts'
import { adaptSourceGraph } from './src/core/graph-identity-v2-adapter.ts'
const { root, binding, trackedSetSha256 } = JSON.parse(readFileSync(0, 'utf8'))
let snapshot
try { snapshot = captureFrozenSourceSnapshot(root) } catch { /* unavailable checkout */ }
if (!snapshot || snapshot.gitHead !== binding.head || snapshot.rootTree !== binding.rootTree ||
    snapshot.sourceDigest !== binding.sourceDigest || snapshot.trackedSetSha256 !== trackedSetSha256) {
  console.log(JSON.stringify({ status: 'snapshot-mismatch' }))
} else {
  const graph = analyzeProject(snapshot)
  const adapted = adaptSourceGraph({ graph, snapshot, registry: binding })
  if (adapted.status !== 'available-content-only') {
    console.log(JSON.stringify({ status: 'graph-digest-unavailable' }))
  } else {
    console.log(JSON.stringify({
      status: 'available',
      runtime: {
        nodeVersion: process.version,
        nodeExecutableSha256: createHash('sha256').update(readFileSync(process.execPath)).digest('hex'),
        icuVersion: process.versions.icu,
        platform: process.platform,
        arch: process.arch,
      },
      typescriptVersion: ts.version,
      rawGraphJson: JSON.stringify(graph),
      graphDigest: adapted.result.digest,
      canonicalBytesSha256: adapted.result.canonicalBytesSha256,
    }))
  }
}
`

export interface AnalyzerBuildIdentityV1 {
  version: typeof buildVersion
  producer: typeof producer
  buildSha256: string
  lockfileSha256: string
  runtime: {
    nodeVersion: string
    nodeExecutableSha256: string
    icuVersion: string
    platform: string
    arch: string
  }
  dependencies: Record<string, string>
}

export interface GraphProducerEvidenceV1 {
  version: typeof evidenceVersion
  build: AnalyzerBuildIdentityV1
  source: HostProjectRegistryRecord & { trackedSetSha256: string }
  rawGraphArtifactSha256: string
  graphDigest: string
  canonicalBytesSha256: string
  evidenceSha256: string
}

type FailureReason = 'build-identity-unavailable' | 'build-identity-mismatch' | 'project-binding-mismatch' |
  'snapshot-mismatch' | 'analysis-unavailable' | 'graph-digest-unavailable' | 'evidence-mismatch' | 'graph-artifact-mismatch'
type EvidenceResult =
  | { status: 'unavailable'; reason: FailureReason }
  | { status: 'available-producer-evidence'; evidence: GraphProducerEvidenceV1; rawGraphBytes: Buffer }
type EvidenceInput = {
  snapshot: FrozenSourceSnapshot
  binding?: Readonly<HostProjectRegistryRecord>
}

function collectBuild() {
  const files = new Map<string, Buffer>()
  function read(relative: string) {
    const absolute = path.join(buildRoot, relative)
    const stat = fs.lstatSync(absolute)
    if (stat.isSymbolicLink()) throw new Error('Build input contains a link')
    if (stat.isDirectory()) {
      for (const name of fs.readdirSync(absolute)) read(relative + '/' + name)
    } else if (stat.isFile()) {
      files.set(relative, fs.readFileSync(absolute))
    } else {
      throw new Error('Build input is not a regular file')
    }
  }
  for (const file of buildFiles) read(file)
  const lock = files.get('package-lock.json')!
  const locked = JSON.parse(lock.toString('utf8')).packages
  const dependencies: Record<string, string> = {}
  for (const name of packages) {
    const relative = 'node_modules/' + name
    read(relative)
    const manifest = JSON.parse(files.get(relative + '/package.json')!.toString('utf8'))
    if (manifest.name !== name || manifest.version !== locked[relative]?.version ||
        Object.keys(manifest.dependencies ?? {}).some(dependency => !packages.includes(dependency))) {
      throw new Error('Analyzer dependencies differ from the pinned build profile')
    }
    dependencies[name] = manifest.version
  }
  const icuVersion = process.versions.icu
  if (!icuVersion) throw new Error('Analyzer runtime must provide ICU')
  const runtime = {
    nodeVersion: process.version,
    nodeExecutableSha256: sha256(fs.readFileSync(process.execPath)),
    icuVersion,
    platform: process.platform,
    arch: process.arch,
  }
  const fileDigests = Object.fromEntries([...files].map(([file, bytes]) => [file, sha256(bytes)]))
  const build: AnalyzerBuildIdentityV1 = {
    version: buildVersion, producer, lockfileSha256: sha256(lock), runtime, dependencies,
    buildSha256: domainHash(buildVersion, { producer, fileDigests, runtime, dependencies, nodeFlags, runAnalyzer }),
  }
  return { build, files }
}

/** Measurement for independent pin provisioning. A measurement alone establishes no trust. */
export function measureAnalyzerSourceBuild(): AnalyzerBuildIdentityV1 {
  return collectBuild().build
}

function sameData(left: unknown, right: unknown): boolean {
  try { return canonicalJson(left) === canonicalJson(right) } catch { return false }
}

function sourceBinding({ snapshot, binding }: EvidenceInput): GraphProducerEvidenceV1['source'] | undefined {
  if (!isFrozenSourceSnapshot(snapshot) || !binding) return undefined
  const { projectId, repository, head, rootTree, sourceDigest } = binding
  if (typeof projectId !== 'string' || !projectId.trim() || typeof repository !== 'string' || !repository.trim() ||
      !snapshot.gitHead || !snapshot.rootTree || head !== snapshot.gitHead || rootTree !== snapshot.rootTree ||
      sourceDigest !== snapshot.sourceDigest) return undefined
  return { projectId, repository, head, rootTree, sourceDigest, trackedSetSha256: snapshot.trackedSetSha256 }
}

/** The expected build must be pinned by the verifier's trusted configuration.
 * Project binding is compatible with a verified E receipt, but is not an issuer proof here.
 */
export function createGraphProducerEvidenceVerifier(expectedBuild?: Readonly<AnalyzerBuildIdentityV1>) {
  let pin: string | undefined
  try { if (expectedBuild) pin = canonicalJson(expectedBuild) } catch { /* invalid pin */ }

  const generate = (input: EvidenceInput): EvidenceResult => {
    if (!pin) return { status: 'unavailable', reason: 'build-identity-unavailable' }
    let source: ReturnType<typeof sourceBinding>
    try { source = sourceBinding(input) } catch { /* invalid source input */ }
    if (!source) return { status: 'unavailable', reason: 'project-binding-mismatch' }

    let measured: ReturnType<typeof collectBuild>
    try { measured = collectBuild() } catch { return { status: 'unavailable', reason: 'build-identity-unavailable' } }
    if (pin !== canonicalJson(measured.build)) return { status: 'unavailable', reason: 'build-identity-mismatch' }

    let directory: string | undefined
    try {
      // Execute only the measured copies, in a fresh process with no shared module cache.
      directory = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-analyzer-build-'))
      for (const [relative, bytes] of measured.files) {
        const file = path.join(directory, relative)
        fs.mkdirSync(path.dirname(file), { recursive: true })
        fs.writeFileSync(file, bytes, { flag: 'wx' })
      }
      const env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(NODE_|GIT_)/i.test(key)))
      env.GIT_NO_REPLACE_OBJECTS = '1'
      const output = JSON.parse(execFileSync(process.execPath, [...nodeFlags, '--eval', runAnalyzer], {
        cwd: directory, env, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], input: JSON.stringify({
          root: input.snapshot.root, binding: source, trackedSetSha256: source.trackedSetSha256,
        }), timeout: 120_000, maxBuffer: 64 * 1024 * 1024,
      }))
      if (output.status === 'snapshot-mismatch' || output.status === 'graph-digest-unavailable') {
        return { status: 'unavailable', reason: output.status }
      }
      if (!sameData(output.runtime, measured.build.runtime) || output.typescriptVersion !== measured.build.dependencies.typescript) {
        return { status: 'unavailable', reason: 'build-identity-mismatch' }
      }
      if (output.status !== 'available' || typeof output.rawGraphJson !== 'string' ||
          !/^[0-9a-f]{64}$/.test(output.graphDigest) || !/^[0-9a-f]{64}$/.test(output.canonicalBytesSha256)) {
        return { status: 'unavailable', reason: 'analysis-unavailable' }
      }
      const rawGraphBytes = Buffer.from(output.rawGraphJson, 'utf8')
      const payload = {
        version: evidenceVersion, build: measured.build, source,
        rawGraphArtifactSha256: sha256(rawGraphBytes), graphDigest: output.graphDigest as string,
        canonicalBytesSha256: output.canonicalBytesSha256 as string,
      } as const
      return { status: 'available-producer-evidence', evidence: { ...payload, evidenceSha256: domainHash(evidenceVersion, payload) }, rawGraphBytes }
    } catch {
      return { status: 'unavailable', reason: 'analysis-unavailable' }
    } finally {
      if (directory) {
        try { fs.rmSync(directory, { recursive: true, force: true }) } catch { /* cleanup does not change evidence */ }
      }
    }
  }

  return {
    generate,
    verify(input: EvidenceInput, candidate: unknown, rawGraphBytes: Uint8Array): EvidenceResult {
      const result = generate(input)
      if (result.status === 'unavailable') return result
      if (!sameData(result.evidence, candidate)) return { status: 'unavailable', reason: 'evidence-mismatch' }
      if (!(rawGraphBytes instanceof Uint8Array) || !result.rawGraphBytes.equals(rawGraphBytes)) {
        return { status: 'unavailable', reason: 'graph-artifact-mismatch' }
      }
      return result
    },
  }
}
