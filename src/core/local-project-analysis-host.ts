import { createPrivateKey, createPublicKey, type KeyObject } from 'node:crypto'
import { readFileSync, realpathSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { AnalyzerBuildIdentityV1 } from './graph-producer-evidence-v1'
import {
  createHostRegistryIssuerV1,
  type HostProjectBindingV1,
  type HostRegistryIssueResultV1,
  type HostRegistryProjectV1,
} from './host-registry-issuer-v1'

export interface LocalProjectAnalysisRegistration {
  readonly checkoutRoot: string
  readonly expected: HostProjectBindingV1
  readonly publicKey: KeyObject
  readonly analyzerBuildPin: Readonly<AnalyzerBuildIdentityV1>
  readonly issueReceipt: () => HostRegistryIssueResultV1
}

export interface LocalProjectAnalysisHost {
  resolveProject(projectId: string): LocalProjectAnalysisRegistration | undefined
}

export interface LocalProjectAnalysisHostConfig {
  readonly projects: readonly HostRegistryProjectV1[]
  readonly privateKey: KeyObject
  readonly publicKey: KeyObject
  readonly analyzerBuildPin: Readonly<AnalyzerBuildIdentityV1>
}

/** Server-owned JSON. Reference key files explicitly and keep them outside served directories. */
export interface LocalProjectAnalysisHostFileV1 {
  readonly version: 'ripple/local-project-analysis-host/v1'
  readonly projects: readonly HostRegistryProjectV1[]
  readonly privateKeyPath: string
  readonly publicKeyPath: string
  readonly analyzerBuildPin: Readonly<AnalyzerBuildIdentityV1>
}

function hasFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && Reflect.ownKeys(value).length === fields.length &&
    fields.every(field => Object.hasOwn(value, field))
}

const nonBlank = (value: unknown): value is string => typeof value === 'string' && value.length > 0 && value === value.trim()
const sha256 = (value: unknown): value is string => typeof value === 'string' && value.length === 64 && /^[a-f0-9]+$/u.test(value)
const packageRoot = fileURLToPath(new URL('../..', import.meta.url))

function freezeAnalyzerPin(value: unknown): Readonly<AnalyzerBuildIdentityV1> {
  if (!hasFields(value, ['version', 'producer', 'buildSha256', 'lockfileSha256', 'runtime', 'dependencies'])) {
    throw new TypeError('Invalid Analyzer Build pin')
  }
  const { version, producer, buildSha256, lockfileSha256, runtime, dependencies } = value
  if (version !== 'ripple/analyzer-source-build/v1' || producer !== 'ripple/analyzeProject' ||
      !sha256(buildSha256) || !sha256(lockfileSha256) ||
      !hasFields(runtime, ['nodeVersion', 'nodeExecutableSha256', 'icuVersion', 'platform', 'arch']) ||
      typeof dependencies !== 'object' || dependencies === null || Array.isArray(dependencies)) {
    throw new TypeError('Invalid Analyzer Build pin')
  }
  const { nodeVersion, nodeExecutableSha256, icuVersion, platform, arch } = runtime
  const dependencyEntries = Object.entries(dependencies)
  if (!nonBlank(nodeVersion) || !sha256(nodeExecutableSha256) || !nonBlank(icuVersion) ||
      !nonBlank(platform) || !nonBlank(arch) ||
      !dependencyEntries.some(([name]) => name === 'typescript') ||
      !dependencyEntries.every(([name, release]) => nonBlank(name) && nonBlank(release))) {
    throw new TypeError('Invalid Analyzer Build pin')
  }
  return Object.freeze({
    version, producer, buildSha256, lockfileSha256,
    runtime: Object.freeze({ nodeVersion, nodeExecutableSha256, icuVersion, platform, arch }),
    dependencies: Object.freeze(Object.fromEntries(dependencyEntries) as Record<string, string>),
  })
}

function parseProject(value: unknown): HostRegistryProjectV1 {
  if (!hasFields(value, ['checkoutRoot', 'binding']) || typeof value.checkoutRoot !== 'string' ||
      !hasFields(value.binding, ['projectId', 'repository', 'gitHead', 'rootTree', 'sourceDigest'])) {
    throw new TypeError('Invalid local analysis project registration')
  }
  const { projectId, repository, gitHead, rootTree, sourceDigest } = value.binding
  if (typeof projectId !== 'string' || typeof repository !== 'string' || typeof gitHead !== 'string' ||
      typeof rootTree !== 'string' || typeof sourceDigest !== 'string') {
    throw new TypeError('Invalid local analysis project binding')
  }
  return { checkoutRoot: value.checkoutRoot, binding: { projectId, repository, gitHead, rootTree, sourceDigest } }
}

/** Compose once from trusted service configuration. Request code can only select a known ID. */
export function createLocalProjectAnalysisHost(config: LocalProjectAnalysisHostConfig): LocalProjectAnalysisHost {
  const { projects, privateKey, publicKey } = config
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519' ||
      publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Local Project Analysis requires Ed25519 keys')
  }
  const pinnedSpki = publicKey.export({ type: 'spki', format: 'der' })
  if (!pinnedSpki.equals(createPublicKey(privateKey).export({ type: 'spki', format: 'der' }))) {
    throw new TypeError('Signing key does not match the independently pinned public key')
  }
  const analyzerBuildPin = freezeAnalyzerPin(config.analyzerBuildPin)
  const records = projects.map(({ checkoutRoot, binding }) => {
    if (!path.isAbsolute(checkoutRoot)) throw new TypeError('Project checkout root must be absolute')
    return { checkoutRoot: realpathSync(checkoutRoot), binding: Object.freeze({ ...binding }) }
  })
  const issue = createHostRegistryIssuerV1({ projects: records, privateKey })
  const registrations = new Map(records.map(({ checkoutRoot, binding: expected }) => [
    expected.projectId,
    Object.freeze({
      checkoutRoot, expected, analyzerBuildPin,
      // Recreate a public object for each consumer so a mutable object cannot change future resolutions.
      get publicKey() { return createPublicKey({ key: pinnedSpki, type: 'spki', format: 'der' }) },
      issueReceipt(): HostRegistryIssueResultV1 {
        try {
          if (realpathSync(checkoutRoot) !== checkoutRoot) {
            return { status: 'rejected', reason: 'snapshot-binding-mismatch' }
          }
          return issue(expected.projectId)
        } catch {
          return { status: 'unavailable', reason: 'snapshot-unavailable' }
        }
      },
    }),
  ]))
  return Object.freeze({
    resolveProject(projectId: string) { return registrations.get(projectId) },
  })
}

/**
 * The bootstrap supplies the file path from server settings. Missing or invalid
 * configuration leaves the route without a host. It never derives a key or pin
 * from an incoming receipt or measures the running build to create its own pin.
 */
export function loadLocalProjectAnalysisHost(
  configFile?: string,
  additionalServedRoots: readonly string[] = [],
): LocalProjectAnalysisHost | undefined {
  if (!configFile || !path.isAbsolute(configFile)) return undefined
  try {
    const servedRoots = [packageRoot, ...additionalServedRoots].map(root => realpathSync(root))
    const readHostFile = (file: string) => {
      const absolute = realpathSync(file)
      if (servedRoots.some(root => {
        const relative = path.relative(root, absolute)
        return relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative)
      })) throw new Error('Host input is inside a served directory')
      return readFileSync(absolute, 'utf8')
    }
    const config: unknown = JSON.parse(readHostFile(configFile))
    if (!hasFields(config, ['version', 'projects', 'privateKeyPath', 'publicKeyPath', 'analyzerBuildPin']) ||
        config.version !== 'ripple/local-project-analysis-host/v1' || !Array.isArray(config.projects) ||
        typeof config.privateKeyPath !== 'string' || !path.isAbsolute(config.privateKeyPath) ||
        typeof config.publicKeyPath !== 'string' || !path.isAbsolute(config.publicKeyPath)) return undefined
    // The public key file must contain a public key. createPublicKey alone also
    // accepts private PEM and would silently derive a replacement pin.
    const publicPem = readHostFile(config.publicKeyPath).trim()
    if (!/^-----BEGIN PUBLIC KEY-----\r?\n[A-Za-z0-9+/=\r\n]+\r?\n-----END PUBLIC KEY-----$/u.test(publicPem)) return undefined
    return createLocalProjectAnalysisHost({
      projects: config.projects.map(parseProject),
      privateKey: createPrivateKey(readHostFile(config.privateKeyPath)),
      publicKey: createPublicKey(publicPem),
      analyzerBuildPin: freezeAnalyzerPin(config.analyzerBuildPin),
    })
  } catch {
    return undefined
  }
}
