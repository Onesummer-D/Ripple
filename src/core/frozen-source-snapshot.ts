import { createHash } from 'node:crypto'
import path from 'node:path'
import type ts from 'typescript'

export interface FrozenSourceFileInput {
  readonly path: string
  readonly bytes: Uint8Array
}

/** Content container only. Its caller and metadata do not establish host trust. */
export interface FrozenSourceSnapshot {
  readonly root: string
  readonly gitHead?: string
  readonly rootTree?: string
  readonly trackedFiles: readonly string[]
  readonly trackedSetSha256: string
  readonly sourceDigest: string
  readonly fileHashes: ReadonlyMap<string, string>
  readFile(file: string): Uint8Array | undefined
  fileExists(file: string): boolean
  directoryExists(directory: string): boolean
  getDirectories(directory: string): string[]
  filesIn(directory: string): string[]
  owns(file: string): boolean
}

export interface FrozenSourceSnapshotIdentity {
  /** Descriptive provenance supplied by the caller; never a host trust assertion. */
  readonly gitHead?: string
  readonly rootTree?: string
}

const hash = (bytes: Uint8Array | string) => createHash('sha256').update(bytes).digest('hex')

function relativeFile(root: string, file: string): string | undefined {
  const absolute = path.resolve(root, file)
  const relative = path.relative(root, absolute)
  if (relative === '..' || relative.startsWith('..' + path.sep) || path.isAbsolute(relative)) return undefined
  return relative.replaceAll('\\', '/')
}

function validTrackedPath(file: string): boolean {
  return Boolean(file) && !file.includes('\\') && !file.includes('\0') &&
    !path.posix.isAbsolute(file) && !path.win32.isAbsolute(file) &&
    file.split('/').every(part => Boolean(part) && part !== '.' && part !== '..')
}

export function createFrozenSourceSnapshot(
  rootInput: string,
  inputs: readonly FrozenSourceFileInput[],
  identity: FrozenSourceSnapshotIdentity = {},
): FrozenSourceSnapshot {
  const root = path.resolve(rootInput)
  if (!path.isAbsolute(rootInput) || !inputs.length) throw new Error('frozen-snapshot-invalid-root-or-empty-set')
  const files = new Map<string, Buffer>()
  for (const input of inputs) {
    if (!validTrackedPath(input.path) || files.has(input.path) || !ArrayBuffer.isView(input.bytes) || input.bytes.BYTES_PER_ELEMENT !== 1) {
      throw new Error('frozen-snapshot-invalid-or-duplicate-file')
    }
    files.set(input.path, Buffer.from(input.bytes))
  }
  const trackedFiles = [...files.keys()].sort((a, b) => a.localeCompare(b, 'en'))
  const fileHashes = new Map(trackedFiles.map(file => [file, hash(files.get(file)!)]))
  const digest = createHash('sha256')
  const directories = new Set<string>([''])
  for (const file of trackedFiles) {
    const bytes = files.get(file)!
    digest.update(String(Buffer.byteLength(file, 'utf8'))).update(':').update(file).update(':')
      .update(String(bytes.byteLength)).update(':').update(fileHashes.get(file)!).update('\n')
    const parts = file.split('/')
    for (let count = 1; count < parts.length; count++) directories.add(parts.slice(0, count).join('/'))
  }
  const sourceDigest = digest.digest('hex')
  const trackedSetSha256 = hash(Buffer.from(trackedFiles.join('\0') + '\0', 'utf8'))
  const snapshot: FrozenSourceSnapshot = {
    root,
    ...(identity.gitHead ? { gitHead: identity.gitHead } : {}),
    ...(identity.rootTree ? { rootTree: identity.rootTree } : {}),
    trackedFiles: Object.freeze(trackedFiles),
    trackedSetSha256,
    sourceDigest,
    get fileHashes() { return new Map(fileHashes) },
    owns(file) { return relativeFile(root, file) !== undefined },
    readFile(file) {
      const relative = relativeFile(root, file)
      const bytes = relative === undefined ? undefined : files.get(relative)
      return bytes ? Buffer.from(bytes) : undefined
    },
    fileExists(file) {
      const relative = relativeFile(root, file)
      return relative !== undefined && files.has(relative)
    },
    directoryExists(directory) {
      const relative = relativeFile(root, directory)
      return relative !== undefined && directories.has(relative)
    },
    getDirectories(directory) {
      const relative = relativeFile(root, directory)
      if (relative === undefined || !directories.has(relative)) return []
      const prefix = relative ? relative + '/' : ''
      return [...directories].filter(item => item.startsWith(prefix) && item !== relative &&
        !item.slice(prefix.length).includes('/')).map(item => path.join(root, item))
    },
    filesIn(directory) {
      const relative = relativeFile(root, directory)
      if (relative === undefined || !directories.has(relative)) return []
      const prefix = relative ? relative + '/' : ''
      return trackedFiles.filter(item => item.startsWith(prefix)).map(item => path.join(root, item))
    },
  }
  return Object.freeze(snapshot)
}

/** Project reads come only from frozen bytes. External toolchain reads need an explicit root. */
export function createFrozenTypeScriptHost(
  snapshot: FrozenSourceSnapshot,
  typescript: typeof ts,
  options: ts.CompilerOptions,
  externalRoots: readonly string[] = [],
): ts.CompilerHost {
  const base = typescript.createCompilerHost(options)
  const allowed = externalRoots.map(root => path.resolve(root))
  const external = (file: string) => allowed.some(root => {
    const relative = path.relative(root, path.resolve(file))
    return relative === '' || (relative !== '..' && !relative.startsWith('..' + path.sep) && !path.isAbsolute(relative))
  })
  const readFile = (file: string): string | undefined => {
    if (snapshot.owns(file)) {
      const bytes = snapshot.readFile(file)
      return bytes ? Buffer.from(bytes).toString('utf8') : undefined
    }
    return external(file) ? base.readFile(file) : undefined
  }
  const fileExists = (file: string) => snapshot.owns(file) ? snapshot.fileExists(file) : external(file) && base.fileExists(file)
  const directoryExists = (directory: string) => snapshot.owns(directory)
    ? snapshot.directoryExists(directory)
    : external(directory) && (base.directoryExists?.(directory) ?? false)
  const getDirectories = (directory: string) => snapshot.owns(directory)
    ? snapshot.getDirectories(directory)
    : external(directory) ? base.getDirectories?.(directory) ?? [] : []
  return {
    ...base,
    getCurrentDirectory: () => snapshot.root,
    readFile,
    fileExists,
    directoryExists,
    getDirectories,
    realpath: file => snapshot.owns(file) ? path.resolve(file) : external(file) ? base.realpath?.(file) ?? path.resolve(file) : path.resolve(file),
    writeFile: () => { throw new Error('frozen-snapshot-write-denied') },
    getSourceFile(file, languageVersion, onError) {
      const text = readFile(file)
      if (text === undefined) { onError?.(`Frozen source is unavailable: ${file}`); return undefined }
      const kind = /\.tsx$/i.test(file) ? typescript.ScriptKind.TSX
        : /\.jsx$/i.test(file) ? typescript.ScriptKind.JSX
          : /\.js$/i.test(file) ? typescript.ScriptKind.JS : typescript.ScriptKind.TS
      return typescript.createSourceFile(file, text, languageVersion, true, kind)
    },
  }
}

/** Use at every config and module-resolution call site; never mutate `ts.sys`. */
export function createFrozenTypeScriptSystem(
  snapshot: FrozenSourceSnapshot,
  typescript: typeof ts,
  externalRoots: readonly string[] = [],
): ts.System {
  const host = createFrozenTypeScriptHost(snapshot, typescript, {}, externalRoots)
  type Matcher = (
    root: string, extensions: readonly string[] | undefined, excludes: readonly string[] | undefined,
    includes: readonly string[] | undefined, caseSensitive: boolean, currentDirectory: string,
    depth: number | undefined, entries: (directory: string) => { files: string[], directories: string[] },
    realpath: (file: string) => string,
  ) => string[]
  const matchFiles = (typescript as typeof ts & { matchFiles?: Matcher }).matchFiles
  return {
    ...typescript.sys,
    getCurrentDirectory: () => snapshot.root,
    readFile: host.readFile,
    fileExists: host.fileExists,
    directoryExists: host.directoryExists ?? (() => false),
    getDirectories: host.getDirectories ?? (() => []),
    realpath: host.realpath ?? (file => path.resolve(file)),
    readDirectory(directory, extensions, excludes, includes, depth) {
      if (!snapshot.owns(directory)) return []
      if (!matchFiles) throw new Error('frozen-snapshot-typescript-matcher-unavailable')
      return matchFiles(directory, extensions, excludes, includes, typescript.sys.useCaseSensitiveFileNames,
        snapshot.root, depth, entry => {
          const files = snapshot.filesIn(entry).filter(file => path.dirname(file) === path.resolve(entry)).map(file => path.basename(file))
          const directories = snapshot.getDirectories(entry).map(file => path.basename(file))
          return { files, directories }
        }, file => path.resolve(file))
    },
    writeFile: () => { throw new Error('frozen-snapshot-write-denied') },
    createDirectory: () => { throw new Error('frozen-snapshot-write-denied') },
    deleteFile: () => { throw new Error('frozen-snapshot-write-denied') },
  }
}
