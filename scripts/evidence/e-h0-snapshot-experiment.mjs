import crypto from 'node:crypto'
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import { pathToFileURL } from 'node:url'
import { spawn, spawnSync, execFileSync } from 'node:child_process'

const workspace = process.env.GITHUB_WORKSPACE || process.cwd()
const sourceCommit = process.env.E_H0_SOURCE_COMMIT || 'da89402738b3f46aeea1dc9eedaa5231a22fd571'
const expectedTree = process.env.E_H0_EXPECTED_TREE || 'd4065b4cf07a487bb73a8efc8130ff566be59973'
const outputRoot = process.env.E_H0_OUTPUT_ROOT || path.join(os.tmpdir(), 'ripple-e-h0-snapshot')
const argv = process.argv.slice(2)

const argValue = (name, fallback = undefined) => {
  const exactIndex = argv.findIndex((item) => item === name)
  if (exactIndex >= 0) return argv[exactIndex + 1] ?? fallback
  const prefix = name + '='
  const item = argv.find((value) => value.startsWith(prefix))
  return item ? item.slice(prefix.length) : fallback
}

const mode = argValue('--mode', 'experiment')
const snapshotArg = argValue('--snapshot')
const outputArg = argValue('--output')

const sha256 = (value) => crypto.createHash('sha256').update(value).digest('hex')
const json = (value) => JSON.stringify(value, null, 2) + '\n'

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, json(value), 'utf8')
}

function writeText(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true })
  fs.writeFileSync(file, value.endsWith('\n') ? value : value + '\n', 'utf8')
}

function command(file, args, options = {}) {
  const result = spawnSync(file, args, {
    cwd: options.cwd || workspace,
    env: options.env || process.env,
    encoding: 'utf8',
    maxBuffer: 32 * 1024 * 1024,
  })
  return {
    file,
    args,
    exitCode: result.status === null ? 1 : result.status,
    signal: result.signal || null,
    stdout: result.stdout || '',
    stderr: result.stderr || '',
  }
}

function git(root, args) {
  const result = command('git', ['-C', root, ...args])
  if (result.exitCode !== 0) {
    throw new Error('git ' + args.join(' ') + ' failed: ' + result.stderr.trim())
  }
  return result.stdout.trimEnd()
}

function safeRelative(relative) {
  if (typeof relative !== 'string' || !relative || relative.includes('\0')) throw new Error('invalid-relative-path')
  if (relative.includes('\\') || path.posix.isAbsolute(relative)) throw new Error('non-posix-relative-path')
  const parts = relative.split('/')
  if (parts.some((part) => !part || part === '.' || part === '..')) throw new Error('path-escape')
}

function assertNoSymlinkComponents(root, relative) {
  safeRelative(relative)
  let current = root
  const parts = relative.split('/')
  for (const part of parts.slice(0, -1)) {
    current = path.join(current, part)
    const stat = fs.lstatSync(current)
    if (stat.isSymbolicLink()) throw new Error('parent-symlink')
    if (!stat.isDirectory()) throw new Error('parent-not-directory')
  }
}

function readStable(root, relative, options = {}) {
  const realRoot = fs.realpathSync(root)
  assertNoSymlinkComponents(realRoot, relative)
  const absolute = path.resolve(realRoot, relative)
  const relativeCheck = path.relative(realRoot, absolute)
  if (!relativeCheck || relativeCheck === '..' || relativeCheck.startsWith('..' + path.sep) || path.isAbsolute(relativeCheck)) {
    throw new Error('path-escape')
  }
  const beforePath = fs.lstatSync(absolute)
  if (beforePath.isSymbolicLink() || !beforePath.isFile()) throw new Error('not-regular-file')
  if (options.pauseMs) execFileSync('sleep', [String(options.pauseMs / 1000)])
  const flags = fs.constants.O_RDONLY | (fs.constants.O_NOFOLLOW || 0)
  const fd = fs.openSync(absolute, flags)
  try {
    const before = fs.fstatSync(fd)
    if (!before.isFile() || before.dev !== beforePath.dev || before.ino !== beforePath.ino) throw new Error('replaced-before-read')
    const bytes = fs.readFileSync(fd)
    const after = fs.fstatSync(fd)
    const afterPath = fs.lstatSync(absolute)
    if (
      afterPath.isSymbolicLink() ||
      !afterPath.isFile() ||
      afterPath.dev !== before.dev ||
      afterPath.ino !== before.ino ||
      after.size !== before.size ||
      after.mtimeMs !== before.mtimeMs ||
      after.ctimeMs !== before.ctimeMs
    ) throw new Error('changed-during-read')
    return Buffer.from(bytes)
  } finally {
    fs.closeSync(fd)
  }
}

function parseTracked(root) {
  const result = spawnSync('git', ['-C', root, 'ls-files', '-s', '-z'], { encoding: 'buffer', maxBuffer: 32 * 1024 * 1024 })
  if (result.status !== 0) throw new Error('git ls-files failed: ' + result.stderr.toString('utf8'))
  return result.stdout.toString('utf8').split('\0').filter(Boolean).map((entry) => {
    const tab = entry.indexOf('\t')
    const metadata = entry.slice(0, tab).split(' ')
    const relative = entry.slice(tab + 1)
    return { mode: metadata[0], blob: metadata[2], path: relative }
  }).sort((left, right) => left.path.localeCompare(right.path, 'en'))
}

function sourceDigest(records) {
  const hash = crypto.createHash('sha256')
  for (const record of records) {
    hash.update(String(Buffer.byteLength(record.path, 'utf8')))
    hash.update(':').update(record.path).update(':')
    hash.update(String(record.bytes)).update(':').update(record.sha256).update('\n')
  }
  return hash.digest('hex')
}

function captureManifest(root) {
  const realRoot = fs.realpathSync(root)
  const tracked = parseTracked(realRoot)
  const files = []
  for (const entry of tracked) {
    if (entry.mode !== '100644' && entry.mode !== '100755') throw new Error('unsupported-file-mode:' + entry.path)
    const bytes = readStable(realRoot, entry.path)
    files.push({
      path: entry.path,
      mode: entry.mode,
      gitBlobSha: entry.blob,
      bytes: bytes.byteLength,
      sha256: sha256(bytes),
    })
  }
  const paths = files.map((file) => file.path)
  return {
    root: realRoot,
    gitHead: git(realRoot, ['rev-parse', 'HEAD']),
    rootTree: git(realRoot, ['rev-parse', 'HEAD^{tree}']),
    trackedCount: files.length,
    trackedSetSha256: sha256(Buffer.from(paths.join('\0') + '\0', 'utf8')),
    sourceDigest: sourceDigest(files),
    files,
  }
}

function compareManifests(before, after) {
  const beforeFiles = new Map(before.files.map((file) => [file.path, file]))
  const afterFiles = new Map(after.files.map((file) => [file.path, file]))
  const changed = []
  const allPaths = [...new Set([...beforeFiles.keys(), ...afterFiles.keys()])].sort()
  for (const file of allPaths) {
    const left = beforeFiles.get(file)
    const right = afterFiles.get(file)
    if (!left || !right || left.sha256 !== right.sha256 || left.bytes !== right.bytes || left.mode !== right.mode) {
      changed.push({ path: file, before: left || null, after: right || null })
    }
  }
  return {
    same: before.gitHead === after.gitHead &&
      before.rootTree === after.rootTree &&
      before.trackedSetSha256 === after.trackedSetSha256 &&
      before.sourceDigest === after.sourceDigest &&
      changed.length === 0,
    changed,
  }
}

function attempt(label, action) {
  try {
    action()
    return { id: label, observed: 'accepted', exitCode: 0, expected: 'rejected' }
  } catch (error) {
    return { id: label, observed: 'rejected', exitCode: 1, error: String(error?.code || error?.message || error), expected: 'rejected' }
  }
}

function prepareToolRoot(root) {
  const toolRoot = path.join(outputRoot, 'analyzer-tool')
  fs.rmSync(toolRoot, { recursive: true, force: true })
  fs.mkdirSync(toolRoot, { recursive: true })
  fs.cpSync(path.join(root, 'src'), path.join(toolRoot, 'src'), { recursive: true })
  fs.cpSync(path.join(root, 'scripts', 'ts-extension-loader.mjs'), path.join(toolRoot, 'scripts', 'ts-extension-loader.mjs'))
  fs.symlinkSync(path.join(root, 'node_modules'), path.join(toolRoot, 'node_modules'), 'dir')
  return toolRoot
}

function runAnalyzer(root, toolRoot, traceFile, resultFile) {
  const commandArgs = [
    '-f', '-e', 'trace=file', '-o', traceFile,
    'node', '--experimental-transform-types',
    '--loader', path.join(workspace, 'scripts', 'ts-extension-loader.mjs'),
    path.join(workspace, 'scripts', 'evidence', 'e-h0-snapshot-experiment.mjs'),
    '--mode', 'analyze',
    '--snapshot', root,
    '--output', resultFile,
  ]
  const result = command('strace', commandArgs, {
    cwd: workspace,
    env: { ...process.env, E_H0_TOOL_ROOT: toolRoot },
  })
  writeText(path.join(outputRoot, 'analyzer.stdout.log'), result.stdout)
  writeText(path.join(outputRoot, 'analyzer.stderr.log'), result.stderr)
  return result
}

function traceAudit(traceFile, snapshotRoot, toolRoot, trackedFiles) {
  if (!fs.existsSync(traceFile)) return { available: false, reason: 'trace-file-missing', snapshotReads: [], workspaceTrackedReads: [] }
  const lines = fs.readFileSync(traceFile, 'utf8').split(/\r?\n/)
  const snapshotPrefix = snapshotRoot.endsWith('/') ? snapshotRoot : snapshotRoot + '/'
  const workspacePrefix = workspace.endsWith('/') ? workspace : workspace + '/'
  const toolPrefix = toolRoot.endsWith('/') ? toolRoot : toolRoot + '/'
  const workspaceToolFiles = new Set(['package.json', 'package-lock.json', 'scripts/ts-extension-loader.mjs'])
  const snapshotReads = lines.filter((line) => line.includes(snapshotPrefix))
  const workspaceTrackedReads = []
  for (const relative of trackedFiles) {
    if (workspaceToolFiles.has(relative)) continue
    const marker = workspacePrefix + relative
    for (const line of lines) {
      if (line.includes(marker) && !line.includes(toolPrefix)) workspaceTrackedReads.push({ path: relative, line })
    }
  }
  return {
    available: lines.length > 1,
    lineCount: lines.length,
    snapshotReads: snapshotReads.slice(0, 200),
    snapshotReadCount: snapshotReads.length,
    workspaceTrackedReads: workspaceTrackedReads.slice(0, 200),
    workspaceTrackedReadCount: workspaceTrackedReads.length,
    sourceReadsBound: lines.length > 1 && workspaceTrackedReads.length === 0 && snapshotReads.length > 0,
  }
}

function createNegativeFixture() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-e-h0-negative-'))
  const outside = fs.mkdtempSync(path.join(os.tmpdir(), 'ripple-e-h0-outside-'))
  fs.mkdirSync(path.join(root, 'dir'))
  fs.writeFileSync(path.join(root, 'dir', 'value.txt'), 'old\n')
  fs.writeFileSync(path.join(outside, 'secret.txt'), 'outside\n')
  fs.symlinkSync(outside, path.join(root, 'link'), 'dir')
  return { root, outside }
}

async function runNegativeCases(mountRoot, manifest) {
  const cases = []
  const sample = manifest.files.find((file) => file.path === 'README.md') || manifest.files[0]
  if (mountRoot) {
    const target = path.join(mountRoot, sample.path)
    cases.push(attempt('internal-write', () => fs.writeFileSync(target, 'internal-write\n')))
    const external = command(process.execPath, ['-e', "require('node:fs').writeFileSync(process.argv[1], 'external-write\\n')", target])
    cases.push({ id: 'external-write', observed: external.exitCode === 0 ? 'accepted' : 'rejected', exitCode: external.exitCode, stderr: external.stderr.trim(), expected: 'rejected' })
    const replacement = path.join(outputRoot, 'replacement.tmp')
    fs.writeFileSync(replacement, 'replacement\n')
    cases.push(attempt('file-replacement', () => fs.renameSync(replacement, target)))
    cases.push(attempt('symlink-create', () => fs.symlinkSync('/tmp/outside', path.join(mountRoot, 'e-h0-symlink'))))
    cases.push(attempt('mount-mutate-then-restore', () => {
      fs.writeFileSync(target, 'temporary-change\n')
      fs.writeFileSync(target, 'original\n')
    }))
  } else {
    for (const id of ['internal-write', 'external-write', 'file-replacement', 'symlink-create']) cases.push({ id, observed: 'not-executable', expected: 'rejected' })
  }

  const fixture = createNegativeFixture()
  try {
    cases.push(attempt('parent-path-escape', () => readStable(fixture.root, 'link/secret.txt')))
    cases.push(attempt('missing-tracked-file', () => readStable(fixture.root, 'missing-tracked-file.txt')))
    const replaceTarget = path.join(fixture.root, 'dir', 'value.txt')
    const replacer = spawn('sh', ['-c', 'sleep 0.05; rm -f "$1"; printf replaced > "$1"', 'sh', replaceTarget])
    cases.push(attempt('toctou-file-replace', () => readStable(fixture.root, 'dir/value.txt', { pauseMs: 120 })))
    await new Promise((resolve) => replacer.on('close', resolve))

    const restoreTarget = path.join(fixture.root, 'dir', 'restore.txt')
    fs.writeFileSync(restoreTarget, 'original\n')
    const before = sha256(fs.readFileSync(restoreTarget))
    fs.writeFileSync(restoreTarget, 'temporary-change\n')
    fs.writeFileSync(restoreTarget, 'original\n')
    const after = sha256(fs.readFileSync(restoreTarget))
    cases.push({
      id: 'mutate-then-restore',
      observed: before === after ? 'digest-equal-after-restore' : 'digest-different',
      expected: 'control-only-not-detectable-by-digest-alone',
      before,
      after,
    })
  } finally {
    fs.rmSync(fixture.root, { recursive: true, force: true })
    fs.rmSync(fixture.outside, { recursive: true, force: true })
  }
  return cases
}

function sudo(args) {
  return command('sudo', ['-n', ...args])
}

function prepareReadOnlySnapshot(snapshotRoot, manifest) {
  const state = { mounted: false, mountRoot: path.join(outputRoot, 'snapshot-mount'), mountReadOnly: false, immutableFlags: false, errors: [] }
  fs.rmSync(state.mountRoot, { recursive: true, force: true })
  fs.mkdirSync(state.mountRoot, { recursive: true })
  const owner = sudo(['chown', '-R', 'root:root', snapshotRoot])
  if (owner.exitCode !== 0) state.errors.push({ step: 'chown', result: owner })
  const chmod = sudo(['chmod', '-R', 'a-w', snapshotRoot])
  if (chmod.exitCode !== 0) state.errors.push({ step: 'chmod', result: chmod })
  const immutable = sudo(['chattr', '-R', '+i', snapshotRoot])
  state.immutableFlags = immutable.exitCode === 0
  if (!state.immutableFlags) state.errors.push({ step: 'chattr-plus-i', result: immutable })
  const mount = sudo(['mount', '--bind', snapshotRoot, state.mountRoot])
  if (mount.exitCode !== 0) {
    state.errors.push({ step: 'mount-bind', result: mount })
    return state
  }
  state.mounted = true
  const remount = sudo(['mount', '-o', 'remount,bind,ro', state.mountRoot])
  if (remount.exitCode !== 0) state.errors.push({ step: 'mount-remount-ro', result: remount })
  const findmnt = command('findmnt', ['-no', 'OPTIONS', state.mountRoot])
  state.mountOptions = findmnt.stdout.trim()
  state.mountReadOnly = findmnt.exitCode === 0 && state.mountOptions.split(',').includes('ro')
  if (!state.mountReadOnly) state.errors.push({ step: 'findmnt-ro', result: findmnt })
  state.samplePath = manifest.files[0]?.path
  return state
}

function cleanupSnapshot(snapshotRoot, state) {
  if (!snapshotRoot) return
  if (state?.mounted) sudo(['umount', '-l', state.mountRoot])
  sudo(['chattr', '-R', '-i', snapshotRoot])
  sudo(['chmod', '-R', 'u+w', snapshotRoot])
  const uid = command('id', ['-u']).stdout.trim()
  const gid = command('id', ['-g']).stdout.trim()
  if (uid && gid) sudo(['chown', '-R', uid + ':' + gid, snapshotRoot])
  sudo(['rm', '-rf', snapshotRoot])
  if (state?.mountRoot) sudo(['rm', '-rf', state.mountRoot])
  try { fs.rmSync(state?.mountRoot || '', { recursive: true, force: true }) } catch {}
  try { fs.rmSync(snapshotRoot, { recursive: true, force: true }) } catch {}
}

async function analyzeMode() {
  const toolRoot = process.env.E_H0_TOOL_ROOT
  if (!toolRoot || !snapshotArg || !outputArg) throw new Error('analyze-mode-arguments-missing')
  try {
    const module = await import(pathToFileURL(path.join(toolRoot, 'src', 'core', 'project.ts')).href)
    const graph = module.analyzeProject(snapshotArg, true)
    writeJson(outputArg, {
      ok: true,
      graphId: graph.id,
      revision: graph.revision,
      nodeCount: graph.nodes.length,
      edgeCount: graph.edges.length,
      unresolvedCount: graph.unresolved.length,
    })
    process.exitCode = 0
  } catch (error) {
    writeJson(outputArg, { ok: false, error: String(error?.stack || error) })
    process.exitCode = 1
  }
}

async function experimentMode() {
  fs.rmSync(outputRoot, { recursive: true, force: true })
  fs.mkdirSync(outputRoot, { recursive: true })
  const experiment = {
    experimentVersion: 'e-h0-snapshot-experiment/v1',
    authorizationSha256: process.env.E_H0_AUTH_SHA256 || '04479850c469664c1f48b375613d47899230ef088a1e8a1e1128c567fe20c3bf',
    workflowCommit: null,
    workflowTree: null,
    analyzedSourceCommit: sourceCommit,
    expectedRootTree: expectedTree,
    toolchain: {
      node: process.version,
      npm: command('npm', ['--version']).stdout.trim(),
      git: command('git', ['--version']).stdout.trim(),
      typescriptPackage: null,
      platform: process.platform,
      kernel: command('uname', ['-a']),
    },
    snapshot: null,
    analyzer: null,
    negativeCases: [],
    status: 'NOT_PROVEN',
    hostProof: 'unavailable',
    authorizationEligible: false,
  }
  const workspaceManifest = captureManifest(workspace)
  experiment.workflowCommit = workspaceManifest.gitHead
  experiment.workflowTree = workspaceManifest.rootTree
  let snapshotRoot = null
  let readonly = null
  try {
    try {
      const packageJson = JSON.parse(fs.readFileSync(path.join(workspace, 'package.json'), 'utf8'))
      const lock = JSON.parse(fs.readFileSync(path.join(workspace, 'package-lock.json'), 'utf8'))
      experiment.toolchain.typescriptPackage = lock?.packages?.['node_modules/typescript']?.version || packageJson?.devDependencies?.typescript || null
    } catch (error) {
      experiment.toolchain.typescriptPackage = 'unreadable:' + String(error)
    }

    snapshotRoot = path.join(outputRoot, 'snapshot')
    const clone = command('git', ['clone', '--local', '--no-hardlinks', workspace, snapshotRoot])
    writeJson(path.join(outputRoot, 'clone-result.json'), clone)
    if (clone.exitCode !== 0) throw new Error('snapshot-clone-failed')
    const checkout = command('git', ['-C', snapshotRoot, 'checkout', '--detach', sourceCommit])
    writeJson(path.join(outputRoot, 'checkout-result.json'), checkout)
    if (checkout.exitCode !== 0) throw new Error('baseline-checkout-failed')
    const before = captureManifest(snapshotRoot)
    writeJson(path.join(outputRoot, 'snapshot-manifest-before.json'), before)
    experiment.snapshot = { before, strategy: 'local-clone-plus-chattr-plus-read-only-bind', root: snapshotRoot }
    if (before.gitHead !== sourceCommit || before.rootTree !== expectedTree) throw new Error('baseline-identity-mismatch')

    const toolRoot = prepareToolRoot(workspace)
    readonly = prepareReadOnlySnapshot(snapshotRoot, before)
    experiment.snapshot.readonly = readonly
    const mountRoot = readonly.mounted && readonly.mountReadOnly ? readonly.mountRoot : null
    experiment.negativeCases = await runNegativeCases(mountRoot, before)

    const workspaceTarget = path.join(workspace, before.files.find((file) => file.path === 'README.md')?.path || before.files[0].path)
    const originalWorkspaceBytes = fs.readFileSync(workspaceTarget)
    fs.writeFileSync(workspaceTarget, Buffer.concat([originalWorkspaceBytes, Buffer.from('\nexternal-write-probe\n')]))
    try {
      const during = captureManifest(snapshotRoot)
      const beforeFirstFile = before.files.find((file) => file.path === before.files[0].path)
      const duringFirstFile = during.files.find((file) => file.path === before.files[0].path)
      experiment.snapshot.externalWorkspaceMutation = {
        snapshotDigestUnchanged: during.sourceDigest === before.sourceDigest,
        snapshotFileUnchanged: duringFirstFile?.sha256 === beforeFirstFile?.sha256,
      }
    } finally {
      fs.writeFileSync(workspaceTarget, originalWorkspaceBytes)
    }

    if (mountRoot) {
      const traceFile = path.join(outputRoot, 'analyzer.trace.log')
      const resultFile = path.join(outputRoot, 'analyzer-result.json')
      const analyzerResult = runAnalyzer(mountRoot, toolRoot, traceFile, resultFile)
      const trace = traceAudit(traceFile, mountRoot, toolRoot, before.files.map((file) => file.path))
      experiment.analyzer = {
        command: 'strace -f -e trace=file node --experimental-transform-types --loader scripts/ts-extension-loader.mjs ... --mode analyze',
        exitCode: analyzerResult.exitCode,
        stdout: analyzerResult.stdout,
        stderr: analyzerResult.stderr,
        result: fs.existsSync(resultFile) ? JSON.parse(fs.readFileSync(resultFile, 'utf8')) : null,
        trace,
      }
    } else {
      experiment.analyzer = { status: 'not-executable', reason: 'read-only-bind-or-immutable-snapshot-not-established' }
    }

    const after = captureManifest(snapshotRoot)
    experiment.snapshot.after = after
    experiment.snapshot.byteBinding = compareManifests(before, after)
    const negativeFailClosed = experiment.negativeCases.filter((item) => item.expected === 'rejected').every((item) => item.observed === 'rejected')
    const restoreIsExplicitlyUnproven = experiment.negativeCases.some((item) => item.id === 'mount-mutate-then-restore' && item.observed !== 'rejected')
    const analyzerBound = experiment.analyzer?.exitCode === 0 && experiment.analyzer?.trace?.sourceReadsBound === true
    experiment.status = readonly.immutableFlags && readonly.mountReadOnly && experiment.snapshot.byteBinding.same && analyzerBound && negativeFailClosed && !restoreIsExplicitlyUnproven
      ? 'FEASIBLE'
      : 'NOT_PROVEN'
    experiment.decisionReason = restoreIsExplicitlyUnproven
      ? 'ordinary digest can be equal after mutate-restore; full immutable snapshot proof remains required'
      : 'one or more immutable snapshot, analyzer-byte-binding or negative-case requirements were not proven'
    writeJson(path.join(outputRoot, 'e-h0-snapshot-experiment-manifest.json'), experiment)
    writeText(path.join(outputRoot, 'e-h0-snapshot-experiment-summary.md'), [
      '# E-H0 Snapshot Experiment',
      '',
      '- Option A: ' + experiment.status,
      '- Host Registry proof: unavailable',
      '- Authorization eligible: false',
      '- Workflow commit: ' + experiment.workflowCommit,
      '- Analyzed source commit: ' + experiment.analyzedSourceCommit,
      '- Analyzed source tree: ' + (experiment.snapshot?.before?.rootTree || 'unknown'),
      '- Snapshot sourceDigest: ' + (experiment.snapshot?.before?.sourceDigest || 'unknown'),
      '',
      experiment.decisionReason || '',
      '',
      'This artifact is evidence-only. It does not unlock E-H1, Runtime Identity, VerificationRun or authorization gates.',
    ].join('\n'))
  } catch (error) {
    experiment.status = 'NOT_PROVEN'
    experiment.fatalError = String(error?.stack || error).replaceAll(String.fromCharCode(96), '')
    writeJson(path.join(outputRoot, 'e-h0-snapshot-experiment-manifest.json'), experiment)
    writeText(path.join(outputRoot, 'e-h0-snapshot-experiment-summary.md'), '# E-H0 Snapshot Experiment\n\n- Option A: NOT_PROVEN\n- Fatal error: ' + experiment.fatalError)
  } finally {
    if (snapshotRoot) cleanupSnapshot(snapshotRoot, readonly)
    fs.rmSync(path.join(outputRoot, 'analyzer-tool'), { recursive: true, force: true })
  }
  console.log(JSON.stringify({
    optionA: experiment.status,
    workflowCommit: experiment.workflowCommit,
    analyzedSourceCommit: experiment.analyzedSourceCommit,
    analyzedSourceTree: experiment.snapshot?.before?.rootTree || null,
    trackedCount: experiment.snapshot?.before?.trackedCount || null,
    trackedSetSha256: experiment.snapshot?.before?.trackedSetSha256 || null,
    sourceDigest: experiment.snapshot?.before?.sourceDigest || null,
    snapshotByteBinding: experiment.snapshot?.byteBinding || null,
    readonly: experiment.snapshot?.readonly || null,
    analyzer: experiment.analyzer ? {
      exitCode: experiment.analyzer.exitCode ?? null,
      stdout: experiment.analyzer.stdout || '',
      stderr: experiment.analyzer.stderr || '',
      result: experiment.analyzer.result || null,
      trace: experiment.analyzer.trace || null,
    } : null,
    negativeCases: experiment.negativeCases,
    hostProof: experiment.hostProof,
    authorizationEligible: experiment.authorizationEligible,
  }))
}

if (mode === 'analyze') await analyzeMode()
else await experimentMode()

