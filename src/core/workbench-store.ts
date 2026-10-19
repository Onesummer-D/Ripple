import { randomUUID } from 'node:crypto'
import * as fs from 'node:fs'
import * as os from 'node:os'
import * as path from 'node:path'
import type { EditSession } from './model'
import type { CandidateRecord } from './candidate'

export type CandidateLifecycle = 'active' | 'discarded' | 'stale' | 'applied' | 'rolled-back'
export interface StoredCandidate {
  schemaVersion: 1
  lifecycle: CandidateLifecycle
  updatedAt: string
  record: CandidateRecord
  session: EditSession
}

const idPattern = /^candidate-[a-zA-Z0-9-]+$/
const sessionPattern = /^session-[a-zA-Z0-9-]+$/
export const workbenchStateRoot = () => path.resolve(process.env.RIPPLE_WORKBENCH_STATE_DIR ?? path.join(os.homedir(), '.ripple', 'workbench'))
const sessionDirectory = (sessionId: string) => {
  if (!sessionPattern.test(sessionId)) throw new Error('Invalid saved workbench session identity')
  return path.join(workbenchStateRoot(), sessionId)
}
const regularFile = (file: string) => {
  const stat = fs.lstatSync(file)
  if (stat.isSymbolicLink() || !stat.isFile()) throw new Error('Saved workbench record is not a regular file')
}

export function writeStoredCandidate(value: StoredCandidate): void {
  if (!idPattern.test(value.record.id) || value.session.candidate?.id !== value.record.id || value.session.id !== `session-${value.record.id.slice('candidate-'.length)}`) {
    throw new Error('Candidate and session identities do not match')
  }
  const root = workbenchStateRoot()
  fs.mkdirSync(root, { recursive: true, mode: 0o700 })
  const rootStat = fs.lstatSync(root)
  if (rootStat.isSymbolicLink() || !rootStat.isDirectory()) throw new Error('Workbench state root is not a normal directory')
  const directory = sessionDirectory(value.session.id)
  fs.mkdirSync(directory, { recursive: true })
  const directoryStat = fs.lstatSync(directory)
  if (directoryStat.isSymbolicLink() || !directoryStat.isDirectory()) throw new Error('Saved workbench directory is not a normal directory')
  const destination = path.join(directory, 'session.json')
  const temporary = path.join(directory, `.session-${randomUUID()}.tmp`)
  fs.writeFileSync(temporary, JSON.stringify(value), { encoding: 'utf8', flag: 'wx', mode: 0o600 })
  try { fs.renameSync(temporary, destination) }
  finally { if (fs.existsSync(temporary)) fs.unlinkSync(temporary) }
}

function readStoredFile(file: string): StoredCandidate {
  regularFile(file)
  const value = JSON.parse(fs.readFileSync(file, 'utf8')) as StoredCandidate
  if (value.schemaVersion !== 1 || !['active', 'discarded', 'stale', 'applied', 'rolled-back'].includes(value.lifecycle) ||
    !value.record || !idPattern.test(value.record.id) || value.session?.candidate?.id !== value.record.id ||
    value.session.id !== `session-${value.record.id.slice('candidate-'.length)}`) throw new Error('Saved workbench record is invalid')
  return value
}

export function listStoredCandidates(projectId?: string): StoredCandidate[] {
  const root = workbenchStateRoot()
  if (!fs.existsSync(root)) return []
  const stat = fs.lstatSync(root)
  if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error('Workbench state root is not a normal directory')
  return fs.readdirSync(root, { withFileTypes: true })
    .filter(entry => entry.isDirectory() && sessionPattern.test(entry.name))
    .flatMap(entry => {
      const file = path.join(root, entry.name, 'session.json')
      if (!fs.existsSync(file)) return []
      const stored = readStoredFile(file)
      return !projectId || stored.session.projectRevision.projectId === projectId ? [stored] : []
    })
    .sort((left, right) => left.updatedAt.localeCompare(right.updatedAt))
}

export function readStoredCandidate(candidateId: string): StoredCandidate | undefined {
  if (!idPattern.test(candidateId)) throw new Error('Invalid candidate identity')
  return listStoredCandidates().find(item => item.record.id === candidateId)
}
