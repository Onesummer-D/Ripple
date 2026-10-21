// Acceptance-only golden verification. Run AFTER regeneration with a saved
// directory snapshot. Never alters committed golden fixtures.
import fs from 'node:fs'
import path from 'node:path'
import { createHash } from 'node:crypto'
import { PNG } from 'pngjs'

const [before, after] = process.argv.slice(2)
if (!before || !after) throw new Error('Usage: check-visual-fixture-regeneration.mjs <before-dir> <after-dir>')
const hash = data => createHash('sha256').update(data).digest('hex')
function files(root) {
  const names = []
  function walk(dir, prefix='') {
    for (const ent of fs.readdirSync(dir,{withFileTypes:true})) {
      if (!ent.isFile() && !ent.isDirectory()) throw new Error('Non-regular fixture: '+ent.name)
      const n=prefix ? prefix+'/'+ent.name : ent.name
      if (ent.isDirectory()) walk(path.join(dir,ent.name),n)
      else names.push(n)
    }
  }
  walk(root); return names.sort()
}
const prior=JSON.parse(fs.readFileSync(path.join(before,'manifest.json'),'utf8'))
const generated=JSON.parse(fs.readFileSync(path.join(after,'manifest.json'),'utf8'))
const getRegistered=m=>m.cases.flatMap(c=>Object.entries(c.files).map(([f,sha])=>({name:c.name+'/'+f,sha})))
const registered=getRegistered(prior), currentRegistered=getRegistered(generated)
const oldFiles=files(before), newFiles=files(after)
const allPaths=[...new Set([...oldFiles,...newFiles])].sort()
const differences=[]
for(const name of allPaths) {
  const a=path.join(before,name), b=path.join(after,name)
  if(!fs.existsSync(a) || !fs.existsSync(b)) {
    differences.push({path:name,status:!fs.existsSync(a)?'new':'missing'})
    continue
  }
  const aa=fs.readFileSync(a), bb=fs.readFileSync(b)
  if(aa.equals(bb))continue
  const item={path:name,status:'byte-mismatch',beforeSha256:hash(aa),afterSha256:hash(bb)}
  if(name.endsWith('.png')) {
    try{
      const pa=PNG.sync.read(aa), pb=PNG.sync.read(bb)
      item.pixelEquivalent=pa.width===pb.width && pa.height===pb.height && pa.data.equals(pb.data)
      item.beforePixelSha256=hash(pa.data)
      item.afterPixelSha256=hash(pb.data)
    }catch(e){item.pixelEquivalent='undecodable';item.decoderError=String(e?.message??e).slice(0,160)}
  }
  differences.push(item)
}
const recordedIssues=[]
for(const [where,m,root] of [['before',prior,before],['after',generated,after]]) {
  for(const {name,sha} of getRegistered(m)) {
    const f=path.join(root,name)
    if(!fs.existsSync(f)||hash(fs.readFileSync(f))!==sha)recordedIssues.push({where,path:name,status:'manifest-sha256-mismatch'})
  }
}
const summary={kind:'agent-e-fixture-regeneration',provenance:'synthetic fixtures; not browser acceptance',
  registeredBefore:registered.length,registeredAfter:currentRegistered.length,
  filesBefore:oldFiles.length,filesAfter:newFiles.length,byteIdentical:differences.length===0,
  differences,recordedIssues}
console.log(JSON.stringify(summary,null,2))
if(differences.length || recordedIssues.length || registered.length!==52 || currentRegistered.length!==52)process.exitCode=1
