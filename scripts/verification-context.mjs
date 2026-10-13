import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'

export const acceptanceDate = process.env.RIPPLE_ACCEPTANCE_DATE ?? new Intl.DateTimeFormat('en-CA', { timeZone: 'Asia/Shanghai' }).format(new Date())
export const sourceDigest = (root) => {
  const hash = createHash('sha256')
  const visit = (relative) => {
    const absolute = path.join(root, relative)
    if (!fs.existsSync(absolute)) return
    if (fs.statSync(absolute).isDirectory()) {
      for (const name of fs.readdirSync(absolute).sort()) visit(path.join(relative, name))
    } else { hash.update(relative); hash.update(fs.readFileSync(absolute)) }
  }
  for (const entry of ['src', 'public', 'e2e', 'package.json', 'package-lock.json', 'vite.config.ts', 'vitest.config.ts', 'playwright.config.ts', 'tsconfig.app.json', 'tsconfig.node.json']) visit(entry)
  return hash.digest('hex')
}
