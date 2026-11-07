import fs from 'node:fs'
import crypto from 'node:crypto'
import { canonicalGraph, GRAPH_DOMAIN } from './canonical-observation-digest.mjs'
const root = new URL('.', import.meta.url)
const fixturePath = new URL('g0.json', root)
const fixtureBytes = fs.readFileSync(fixturePath)
const graph = JSON.parse(fixtureBytes.toString('utf8'))
const result = canonicalGraph(graph)
const canonicalBytes = Buffer.from(result.canonicalJson, 'utf8')
const output = {
  status: 'passed',
  exitCode: 0,
  input: { path: 'g0.json', bytes: fixtureBytes.length, sha256: crypto.createHash('sha256').update(fixtureBytes).digest('hex') },
  output: { canonicalJson: result.canonicalJson, canonicalBytesBase64: canonicalBytes.toString('base64'), canonicalBytes: canonicalBytes.length, canonicalBytesSha256: crypto.createHash('sha256').update(canonicalBytes).digest('hex') },
  domain: GRAPH_DOMAIN,
  domainBytesUtf8Hex: Buffer.from(GRAPH_DOMAIN, 'utf8').toString('hex'),
  graphDigest: result.digest,
  serializerSha256: crypto.createHash('sha256').update(fs.readFileSync(new URL('canonical-observation-digest.mjs', root))).digest('hex')
}
fs.writeFileSync(new URL('node-output.json', root), JSON.stringify(output, null, 2) + '\n')
console.log(JSON.stringify(output, null, 2))
