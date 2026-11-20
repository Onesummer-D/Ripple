import { createHash } from 'node:crypto'
import { execFileSync } from 'node:child_process'
import * as fs from 'node:fs'
import * as path from 'node:path'
import ts from 'typescript'
import { createFrozenSourceSnapshot, createFrozenTypeScriptSystem, type FrozenSourceSnapshot, type FrozenSourceFileInput } from './frozen-source-snapshot'

const captured = new WeakSet<FrozenSourceSnapshot>()
const refs = new WeakMap<FrozenSourceSnapshot, string>()
const git = (root: string, args: string[]) => execFileSync('git', ['-C', root, ...args], { encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })

export class FrozenProjectSnapshotError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = 'FrozenProjectSnapshotError' }
}

function assertRepoPath(file: string): void {
  if (!file || file.startsWith('/') || /^[A-Za-z]:/.test(file) || file.includes('\\') || file.includes('\0') ||
      file.split('/').some(part => !part || part === '.' || part === '..')) {
    throw new FrozenProjectSnapshotError('snapshot-path-invalid', file)
  }
}

function objectTable(output: string, source: 'index' | 'tree', oidLength: number): Map<string, { mode: string; oid: string }> {
  const result = new Map<string, { mode: string; oid: string }>()
  for (const record of output.split('\0').filter(Boolean)) {
    const separator = record.indexOf('\t')
    if (separator < 0) throw new FrozenProjectSnapshotError('snapshot-object-table-invalid', `Malformed ${source} record`)
    const fields = record.slice(0, separator).split(' ')
    const file = record.slice(separator + 1)
    assertRepoPath(file)
    const [mode, typeOrOid, oidOrStage] = fields
    const modeAllowed = mode === '100644' || mode === '100755'
    const oid = source === 'index' ? typeOrOid : oidOrStage
    if (!modeAllowed || (source === 'tree' && typeOrOid !== 'blob') ||
        !(source === 'index' ? oidOrStage === '0' : true) || !new RegExp(`^[0-9a-f]{${oidLength}}$`).test(oid ?? '')) {
      throw new FrozenProjectSnapshotError('snapshot-file-invalid', `${source} contains symlink, submodule, unmerged or unsupported entry`)
    }
    if (result.has(file)) throw new FrozenProjectSnapshotError('snapshot-object-table-invalid', `Duplicate ${source} path: ${file}`)
    result.set(file, { mode, oid })
  }
  return result
}

function sameTable(left: Map<string, { mode: string; oid: string }>, right: Map<string, { mode: string; oid: string }>): boolean {
  return left.size === right.size && [...left].every(([file, value]) => {
    const other = right.get(file)
    return other?.mode === value.mode && other.oid === value.oid
  })
}

/** Build the E-owned immutable container from exact HEAD tree blobs, never from live file reads. */
export function captureFrozenSourceSnapshot(inputRoot: string, requireClean = true): FrozenSourceSnapshot {
  let root: string
  try {
    root = fs.realpathSync(git(fs.realpathSync(inputRoot), ['rev-parse', '--show-toplevel']).trim())
  } catch { throw new FrozenProjectSnapshotError('snapshot-git-root-invalid', 'Input is not a readable Git worktree') }
  const head = git(root, ['rev-parse', 'HEAD']).trim()
  const ref = git(root, ['branch', '--show-current']).trim() || head
  const rootTree = git(root, ['rev-parse', 'HEAD^{tree}']).trim()
  const objectFormat = git(root, ['rev-parse', '--show-object-format']).trim()
  if (objectFormat !== 'sha1' && objectFormat !== 'sha256') throw new FrozenProjectSnapshotError('snapshot-object-format-invalid', objectFormat)
  if (requireClean && git(root, ['status', '--porcelain', '--untracked-files=normal']).trim()) {
    throw new FrozenProjectSnapshotError('snapshot-dirty', 'Source checkout is not clean')
  }
  const oidLength = objectFormat === 'sha1' ? 40 : 64
  const indexOutput = git(root, ['ls-files', '-s', '-z'])
  const treeOutput = git(root, ['ls-tree', '-r', '-z', '--full-tree', 'HEAD'])
  const index = objectTable(indexOutput, 'index', oidLength)
  const tree = objectTable(treeOutput, 'tree', oidLength)
  if (!sameTable(index, tree)) throw new FrozenProjectSnapshotError('snapshot-index-mismatch', 'Index file set differs from committed HEAD tree')

  const files: FrozenSourceFileInput[] = []
  for (const [file, entry] of tree) {
    const bytes = execFileSync('git', ['-C', root, 'cat-file', 'blob', entry.oid], { encoding: null, maxBuffer: 512 * 1024 * 1024 })
    const blobBytes = Buffer.concat([Buffer.from(`blob ${bytes.byteLength}\0`, 'ascii'), bytes])
    if (createHash(objectFormat).update(blobBytes).digest('hex') !== entry.oid) {
      throw new FrozenProjectSnapshotError('snapshot-object-invalid', `Blob hash mismatch: ${file}`)
    }
    files.push({ path: file, bytes })
  }
  if (git(root, ['rev-parse', 'HEAD']).trim() !== head || git(root, ['rev-parse', 'HEAD^{tree}']).trim() !== rootTree ||
      git(root, ['ls-files', '-s', '-z']) !== indexOutput ||
      (requireClean && git(root, ['status', '--porcelain', '--untracked-files=normal']).trim())) {
    throw new FrozenProjectSnapshotError('snapshot-changed', 'HEAD, index or worktree changed while capturing tree blobs')
  }
  const snapshot = createFrozenSourceSnapshot(root, files, { gitHead: head, rootTree })
  captured.add(snapshot)
  refs.set(snapshot, ref)
  return snapshot
}

export function isFrozenSourceSnapshot(value: unknown): value is FrozenSourceSnapshot {
  return typeof value === 'object' && value !== null && captured.has(value as FrozenSourceSnapshot)
}

export function frozenSourceRef(snapshot: FrozenSourceSnapshot): string {
  if (!isFrozenSourceSnapshot(snapshot)) throw new FrozenProjectSnapshotError('snapshot-unavailable', 'Unknown snapshot')
  return refs.get(snapshot) ?? snapshot.gitHead ?? ''
}

export function readFrozenBytes(snapshot: FrozenSourceSnapshot, relative: string): Buffer | undefined {
  if (!isFrozenSourceSnapshot(snapshot)) throw new FrozenProjectSnapshotError('snapshot-unavailable', 'Snapshot was not captured from a committed Git tree')
  assertRepoPath(relative)
  const bytes = snapshot.readFile(path.join(snapshot.root, ...relative.split('/')))
  return bytes ? Buffer.from(bytes) : undefined
}

export function decodeFrozenUtf8(bytes: Uint8Array): string {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(bytes) }
  catch { throw new FrozenProjectSnapshotError('source-utf8-invalid', 'Invalid UTF-8 source bytes') }
}

export function frozenSourceSystem(snapshot: FrozenSourceSnapshot): ts.System {
  if (!isFrozenSourceSnapshot(snapshot)) throw new FrozenProjectSnapshotError('snapshot-unavailable', 'Unknown snapshot')
  return createFrozenTypeScriptSystem(snapshot, ts, [path.dirname(ts.getDefaultLibFilePath({}))])
}
