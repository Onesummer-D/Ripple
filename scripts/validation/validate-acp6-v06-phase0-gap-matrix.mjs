import fs from 'node:fs';
import crypto from 'node:crypto';

const matrixPath=process.argv[2]||'./acp6-v06-phase0-gap-matrix-20261028.json';
const sourcePath=process.argv[3]||null;
const matrix=JSON.parse(fs.readFileSync(matrixPath,'utf8'));
const resultPath=matrixPath.replace(/\.json$/,'-validation.json');
const allowed=new Set(matrix.classification.allowedGapClasses);
const sha256=b=>crypto.createHash('sha256').update(b).digest('hex');
const clone=x=>JSON.parse(JSON.stringify(x));
const sourceBytes=sourcePath&&fs.existsSync(sourcePath)?fs.readFileSync(sourcePath):null;

function validateCore(m){
  const checks=[];
  const check=(name,pass,details)=>checks.push({name,pass:Boolean(pass),details});
  const rows=m.rows||[];
  const uncovered=rows.filter(r=>r.coverageStatus==='uncovered');
  const covered=rows.filter(r=>r.coverageStatus==='covered');
  const ids=rows.map(r=>r.rowId);
  const uniqueIds=new Set(ids);
  check('schema-version',m.schemaVersion==='acp6-v06-phase0-gap-matrix/v2',{actual:m.schemaVersion});
  check('taxonomy-version',m.classification?.taxonomyVersion==='acp6-gap-taxonomy/v1',{actual:m.classification?.taxonomyVersion});
  check('stable-id-unique',uniqueIds.size===ids.length,{rows:ids.length,uniqueIds:uniqueIds.size});
  check('stable-id-reproducible',rows.every(r=>{const h=sha256(`acp6-v06-phase0-row|${r.token}|${r.sourceRef.file}|${r.sourceRef.byteOffset}|${r.sourceRef.selector}`);return r.rowId===`acp6-gap-${h.slice(0,16)}`}),{});
  check('all-source-locations-present',rows.every(r=>r.sourceRef&&typeof r.sourceRef.file==='string'&&Number.isInteger(r.sourceRef.offset)&&Number.isInteger(r.sourceRef.byteOffset)&&typeof r.sourceRef.selector==='string'),{});
  check('classification-legal',uncovered.every(r=>allowed.has(r.gapClass)&&Array.isArray(r.gapClasses)&&r.gapClasses.length>0&&r.gapClasses.every(c=>allowed.has(c))&&r.gapClasses.includes(r.gapClass)),{allowed:[...allowed]});
  check('covered-have-no-gap',covered.every(r=>r.gapClass===null&&Array.isArray(r.gapClasses)&&r.gapClasses.length===0),{});
  check('source-use-graph-node-ids-explicit-missing',rows.every(r=>r.sourceUseGraphNodeIds&&r.sourceUseGraphNodeIds.status==='missing'&&r.sourceUseGraphNodeIds.value===null),{});
  check('row-count',rows.length===123,{actual:rows.length,expected:123});
  check('covered-count',covered.length===85,{actual:covered.length,expected:85});
  check('uncovered-count',uncovered.length===38,{actual:uncovered.length,expected:38});
  check('matrix-stats-match',m.stats?.sourceUseRows===rows.length&&m.stats?.coveredRows===covered.length&&m.stats?.uncoveredRows===uncovered.length,{stats:m.stats,computed:{sourceUseRows:rows.length,coveredRows:covered.length,uncoveredRows:uncovered.length}});
  check('token-count',m.stats?.tokenCount===8,{actual:m.stats?.tokenCount,expected:8});
  check('unknown-pair-count',m.stats?.ac64UnknownPairs===16,{actual:m.stats?.ac64UnknownPairs,expected:16});
  check('uncovered-id-index',new Set(m.uncoveredRowIds||[]).size===38&&(m.uncoveredRowIds||[]).length===38&&(m.uncoveredRowIds||[]).every(id=>uncovered.some(r=>r.rowId===id)),{});
  check('covered-id-index',new Set(m.coveredRowIds||[]).size===85&&(m.coveredRowIds||[]).length===85&&(m.coveredRowIds||[]).every(id=>covered.some(r=>r.rowId===id)),{});
  const counts={};for(const r of uncovered) counts[r.gapClass]=(counts[r.gapClass]||0)+1;
  check('classification-counts',allowed.size===5&&[...allowed].every(k=>(m.stats?.gapClassCounts?.[k]||0)===(counts[k]||0)),{actual:m.stats?.gapClassCounts,computed:counts});
  const actualSourceSha=sourceBytes?sha256(sourceBytes):null;
  check('source-input-present',Boolean(sourceBytes),{sourcePath});
  check('source-evidence-sha256',Boolean(sourceBytes)&&actualSourceSha===m.source.acceptanceJsonSha256,{actual:actualSourceSha,recorded:m.source.acceptanceJsonSha256});
  check('source-not-overwritten',m.source.overwritten===false,{});
  check('source-comparison-recorded',m.sourceComparison?.remoteB?.sha256==='b7500c9d5fc1b4c99bea8b889fa195915172abe8bc7ed9ccada52c64a3d037a4'&&m.sourceComparison.remoteB.jsonParse==='fail'&&m.sourceComparison.remoteB.independentlyExtractedSections.consumerGroups===123&&m.sourceComparison.remoteB.independentlyExtractedSections.uncoveredConsumerPairs===16&&m.sourceComparison.remoteB.ac62StrictCoverage.status==='unavailable-from-malformed-source'&&m.sourceComparison.localDerivedInput?.sha256===m.source.acceptanceJsonSha256&&m.sourceComparison.localDerivedInput.jsonParse==='pass',{remote:m.sourceComparison?.remoteB,local:m.sourceComparison?.localDerivedInput});
  check('phase0-base',m.execution?.baseCommit==='5b75fe699afce98638e6fd6ad110911d83389dc8'&&m.execution.remoteVerified===true,{actual:m.execution});
  const pass=checks.every(c=>c.pass);
  return {pass,checks,summary:{rows:rows.length,covered:covered.length,uncovered:uncovered.length,tokens:m.stats?.tokenCount,unknownPairs:m.stats?.ac64UnknownPairs,gapClassCounts:m.stats?.gapClassCounts}};
}

const positive=validateCore(matrix);
const shuffle=clone(matrix);shuffle.rows.reverse();
const shuffled=validateCore(shuffle);
const stableSet=a=>new Set(a.rows.map(r=>r.rowId));
const shuffleInvariant=shuffled.pass&&JSON.stringify([...stableSet(matrix)].sort())===JSON.stringify([...stableSet(shuffle)].sort())&&JSON.stringify(shuffled.summary)===JSON.stringify(positive.summary);
const negatives=[];
function negative(name,mutate){const m=clone(matrix);mutate(m);const v=validateCore(m);negatives.push({name,pass:!v.pass,expectedFailure:!v.pass,failedChecks:v.checks.filter(c=>!c.pass).map(c=>c.name)});}
negative('duplicate-id',m=>{m.rows[1].rowId=m.rows[0].rowId;});
negative('deleted-classification',m=>{const r=m.rows.find(x=>x.coverageStatus==='uncovered');r.gapClass=null;r.gapClasses=[];});
negative('tampered-source-location',m=>{const r=m.rows.find(x=>x.coverageStatus==='uncovered');r.sourceRef.byteOffset+=1;});
negative('tampered-input-hash',m=>{m.source.acceptanceJsonSha256='0'.repeat(64);});
negative('tampered-coverage-statistics',m=>{m.stats.coveredRows=84;m.stats.uncoveredRows=39;});
negative('graph-node-missing-bypassed',m=>{const r=m.rows.find(x=>x.coverageStatus==='uncovered');r.sourceUseGraphNodeIds={status:'present',value:['invented-node']};});
const pass=positive.pass&&shuffleInvariant&&negatives.every(x=>x.pass);
const result={schemaVersion:'acp6-v06-phase0-validation/v2',generatedAt:'2026-10-28',matrixPath,sourcePath,matrixSha256:sha256(fs.readFileSync(matrixPath)),pass,positive,shuffleInvariant,negativeTests:negatives};
fs.writeFileSync(resultPath,JSON.stringify(result,null,2)+'\n','utf8');
console.log(JSON.stringify({resultPath,pass,positive:positive.pass,shuffleInvariant,negativeTests:negatives,summary:positive.summary,sourcePath},null,2));
const selectedNegative=process.argv.find(a=>a.startsWith('--negative='))?.slice('--negative='.length);
if(selectedNegative){const selected=negatives.find(x=>x.name===selectedNegative);console.log(JSON.stringify({negativeCase:selectedNegative,record:selected||null,exitMeaning:'0 means the validator correctly rejected the mutation; 1 means it failed to reject or the case is unknown'},null,2));process.exitCode=selected?.pass?0:1;}
if(!pass) process.exitCode=1;

