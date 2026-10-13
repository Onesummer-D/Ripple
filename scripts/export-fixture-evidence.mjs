import fs from 'node:fs'
import path from 'node:path'
import { fixtures } from '../src/cases/fixtures.ts'

for (const fixture of Object.values(fixtures)) {
  for (const evidence of fixture.evidence) {
    const destination = path.resolve('public', evidence.sourcePath)
    fs.mkdirSync(path.dirname(destination), { recursive: true })
    fs.writeFileSync(destination, JSON.stringify({ origin: 'fixture', evidence, graph: fixture.graph, slots: fixture.slots, note: '结构交互示例。该文件不提供真实预演、风险检测或第三方仓库证明。' }, null, 2) + '\n')
  }
}
