import fs from 'node:fs'
import path from 'node:path'
import { spawn } from 'node:child_process'
import { acceptanceDate, sourceDigest } from './verification-context.mjs'

const root = process.cwd()
const evidence = path.resolve(root, '../../docs/acceptance', acceptanceDate, 'evidence')
fs.mkdirSync(evidence, { recursive: true })
const digest = sourceDigest(root)
const commands = [
  { name: 'typecheck', args: ['run', 'typecheck'] },
  { name: 'build', args: ['run', 'build'] },
  { name: 'test', args: ['test', '--', '--run', '--reporter=json', `--outputFile=${path.join(evidence, 'vitest-results.json')}`] },
  { name: 'browser', args: ['run', 'test:browser'] },
]
const results = []
for (const command of commands) {
  console.log(`Verifying ${command.name}…`)
  const result = await new Promise((resolve) => {
    const child = spawn(process.execPath, [process.env.npm_execpath, ...command.args], { cwd: root, env: process.env })
    let output = ''
    child.stdout.on('data', (chunk) => { output += chunk })
    child.stderr.on('data', (chunk) => { output += chunk })
    child.on('error', (error) => { output += error.message })
    child.on('close', (exitCode) => resolve({ name: command.name, args: command.args, exitCode, output }))
  })
  fs.writeFileSync(path.join(evidence, `verify-${command.name}.txt`), result.output)
  results.push({ name: result.name, args: result.args, exitCode: result.exitCode })
  console.log(`${command.name}: ${result.exitCode === 0 ? 'PASS' : 'FAIL'}`)
  if (result.exitCode !== 0) break
}
const passed = results.length === commands.length && results.every((result) => result.exitCode === 0) && digest === sourceDigest(root)
fs.writeFileSync(path.join(evidence, 'formal-verification.json'), JSON.stringify({ acceptanceDate, generatedAt: new Date().toISOString(), sourceDigest: digest, passed, results }, null, 2) + '\n')
if (!passed) process.exitCode = 1
