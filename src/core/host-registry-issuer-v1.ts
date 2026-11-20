import { createHash, createPublicKey, sign, verify, type KeyObject } from 'node:crypto'
import { realpathSync } from 'node:fs'
import path from 'node:path'
import { captureFrozenSourceSnapshot } from './frozen-project-snapshot'

const version = 'ripple-host-registry-receipt/v1'
const domain = 'ripple/host-registry/project-snapshot/v1\0'
const bindingFields = ['projectId', 'repository', 'gitHead', 'rootTree', 'sourceDigest'] as const
const sha256 = /^[0-9a-f]{64}$/u
const gitOid = /^(?:[0-9a-f]{40}|[0-9a-f]{64})$/u

export type HostProjectBindingV1 = Readonly<Record<(typeof bindingFields)[number], string>>

export interface HostRegistryProjectV1 {
  /** Local checkout selected by trusted host configuration. */
  readonly checkoutRoot: string
  readonly binding: HostProjectBindingV1
}

export interface HostRegistryReceiptV1 {
  readonly version: typeof version
  readonly keyId: string
  readonly binding: HostProjectBindingV1
  readonly signature: string
}

export type HostRegistryIssueResultV1 =
  | { readonly status: 'issued'; readonly receipt: HostRegistryReceiptV1 }
  | { readonly status: 'unavailable'; readonly reason: 'project-unregistered' | 'snapshot-unavailable' | 'signing-unavailable' }
  | { readonly status: 'rejected'; readonly reason: 'snapshot-binding-mismatch' }

export type HostRegistryVerificationResultV1 =
  | { readonly status: 'verified'; readonly binding: HostProjectBindingV1 }
  | { readonly status: 'unavailable'; readonly reason: 'receipt-missing' }
  | { readonly status: 'rejected'; readonly reason: 'invalid-receipt' | 'key-mismatch' | 'signature-invalid' | 'binding-mismatch' }

function exactFields(value: unknown, fields: readonly string[]): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false
  const keys = Reflect.ownKeys(value)
  return keys.length === fields.length && fields.every(field => Object.hasOwn(value, field))
}

function readBinding(value: unknown): HostProjectBindingV1 | undefined {
  if (!exactFields(value, bindingFields)) return undefined
  const { projectId, repository, gitHead, rootTree, sourceDigest } = value
  const validId = (id: unknown): id is string =>
    typeof id === 'string' && id.length > 0 && id.trim() === id && !/[\u0000-\u001f\u007f]/u.test(id)
  if (!validId(projectId) || !validId(repository) || typeof gitHead !== 'string' ||
      (gitHead.length !== 40 && gitHead.length !== 64) || !gitOid.test(gitHead) ||
      typeof rootTree !== 'string' || !gitOid.test(rootTree) || rootTree.length !== gitHead.length ||
      typeof sourceDigest !== 'string' || sourceDigest.length !== 64 || !sha256.test(sourceDigest)) return undefined
  return Object.freeze({ projectId, repository, gitHead, rootTree, sourceDigest })
}

function keyIdFor(publicKey: KeyObject): string {
  return createHash('sha256').update(publicKey.export({ type: 'spki', format: 'der' })).digest('hex')
}

function signedBytes(keyId: string, binding: HostProjectBindingV1): Buffer {
  return Buffer.from(domain + JSON.stringify([version, keyId, ...bindingFields.map(field => binding[field])]), 'utf8')
}

/**
 * Trusted host composition builds this closure with its internal registrations and private key.
 * The issuing operation accepts only a lookup key and captures the registered checkout itself.
 */
export function createHostRegistryIssuerV1(config: {
  readonly projects: readonly HostRegistryProjectV1[]
  readonly privateKey: KeyObject
}): (projectId: string) => HostRegistryIssueResultV1 {
  const { privateKey } = config
  if (privateKey.type !== 'private' || privateKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Host Registry issuer requires an Ed25519 private key')
  }
  const keyId = keyIdFor(createPublicKey(privateKey))
  const projects = new Map<string, HostRegistryProjectV1>()
  for (const record of config.projects) {
    const binding = readBinding(record.binding)
    if (!binding || !path.isAbsolute(record.checkoutRoot) || projects.has(binding.projectId)) {
      throw new TypeError('Invalid or duplicate Host Registry registration')
    }
    projects.set(binding.projectId, { binding, checkoutRoot: path.resolve(record.checkoutRoot) })
  }

  return projectId => {
    const project = projects.get(projectId)
    if (!project) return { status: 'unavailable', reason: 'project-unregistered' }
    try {
      const checkoutRoot = realpathSync(project.checkoutRoot)
      const snapshot = captureFrozenSourceSnapshot(checkoutRoot)
      if (snapshot.root !== checkoutRoot || snapshot.gitHead !== project.binding.gitHead ||
          snapshot.rootTree !== project.binding.rootTree || snapshot.sourceDigest !== project.binding.sourceDigest) {
        return { status: 'rejected', reason: 'snapshot-binding-mismatch' }
      }
    } catch {
      return { status: 'unavailable', reason: 'snapshot-unavailable' }
    }

    try {
      const signature = sign(null, signedBytes(keyId, project.binding), privateKey).toString('base64url')
      return { status: 'issued', receipt: Object.freeze({ version, keyId, binding: project.binding, signature }) }
    } catch {
      return { status: 'unavailable', reason: 'signing-unavailable' }
    }
  }
}

/** Pin this verifier from trusted host context before passing it untrusted receipt data. */
export function createHostRegistryVerifierV1(config: {
  readonly expected: HostProjectBindingV1
  readonly publicKey: KeyObject
}): (receipt: unknown) => HostRegistryVerificationResultV1 {
  const { publicKey } = config
  const expected = readBinding(config.expected)
  if (!expected || publicKey.type !== 'public' || publicKey.asymmetricKeyType !== 'ed25519') {
    throw new TypeError('Host Registry verifier requires a valid binding and Ed25519 public key')
  }
  const keyId = keyIdFor(publicKey)

  return receipt => {
    if (receipt == null) return { status: 'unavailable', reason: 'receipt-missing' }
    try {
      if (!exactFields(receipt, ['version', 'keyId', 'binding', 'signature'])) {
        return { status: 'rejected', reason: 'invalid-receipt' }
      }
      const { version: receiptVersion, keyId: receiptKeyId, binding: rawBinding, signature } = receipt
      const binding = readBinding(rawBinding)
      if (receiptVersion !== version || !binding || typeof receiptKeyId !== 'string' || receiptKeyId.length !== 64 ||
          !sha256.test(receiptKeyId) ||
          typeof signature !== 'string' || !/^[A-Za-z0-9_-]{86}$/.test(signature)) {
        return { status: 'rejected', reason: 'invalid-receipt' }
      }
      const bytes = Buffer.from(signature, 'base64url')
      if (bytes.length !== 64 || bytes.toString('base64url') !== signature) {
        return { status: 'rejected', reason: 'invalid-receipt' }
      }
      if (receiptKeyId !== keyId) return { status: 'rejected', reason: 'key-mismatch' }
      if (!verify(null, signedBytes(keyId, binding), publicKey, bytes)) {
        return { status: 'rejected', reason: 'signature-invalid' }
      }
      if (!bindingFields.every(field => binding[field] === expected[field])) {
        return { status: 'rejected', reason: 'binding-mismatch' }
      }
      return { status: 'verified', binding }
    } catch {
      return { status: 'rejected', reason: 'invalid-receipt' }
    }
  }
}
