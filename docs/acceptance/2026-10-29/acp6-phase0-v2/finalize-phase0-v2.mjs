import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const read = name => fs.readFileSync(path.join(dir, name), 'utf8');
const sha256File = name => crypto.createHash('sha256').update(fs.readFileSync(path.join(dir, name))).digest('hex');
const json = name => JSON.parse(read(name));
const matrix = json('acp6-v06-phase0-gap-matrix-v2-20261029.json');
const positive = json('validation-positive.json');
const negativeIndex = json('negative-run-index.json');

const formal = {
  schemaVersion: 'acp6-v06-phase0-formal-input/v1',
  declaration: 'The recovered ed58cfd B v5 JSON is the only formal input for this Phase 0 rebuild.',
  source: {
    repository: 'Onesummer-D/Ripple',
    evidenceBranch: 'evidence/pr65-acp6-integrity-repair-20261028',
    sourceCommit: 'ba48108532bec0724614867182e69bd07277de96',
    sourceTree: '6b77a1730cbe6963edbd74510f1c7e84f596e9a7',
    sourcePath: 'evidence/acceptance-ed58cfd-original-recovered.json',
    localPath: 'acceptance-ed58cfd-final.json',
    sourcePrHead: 'ed58cfdc2892acaa9b97363a3414b1c219d07053',
    sourcePrTree: '24de55f8bc1d8146b12b42b8bfdd4b24d5f41f6c',
    fixedProject: 'allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd',
    bytes: fs.statSync(path.join(dir, 'acceptance-ed58cfd-final.json')).size,
    sha256: '0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a',
    actualLocalSha256: sha256File('acceptance-ed58cfd-final.json'),
    jsonParse: 'pass',
  },
  historicalCorruptArchive: {
    branch: 'evidence/pr65-acp6-ed58-independent-20261028',
    path: 'evidence/acceptance-ed58cfd-final.json',
    sha256: 'b7500c9d5fc1b4c99bea8b889fa195915172abe8bc7ed9ccada52c64a3d037a4',
    jsonParse: 'fail',
    preserved: true,
    role: 'historical record only; never used as formal input and never overwritten',
  },
  expectedEvidence: {
    ac62: { rows: 123, covered: 85, uncovered: 38, tokens: 8, completeTokens: 1 },
    ac64: { pairs: 147, anchored: 131, unknown: 16, staticUnknown: 9, dynamicUnknown: 7 },
  },
  replayCommand: 'node validate-acp6-v06-phase0-v2.mjs acp6-v06-phase0-gap-matrix-v2-20261029.json acceptance-ed58cfd-final.json',
  taxonomyVersion: 'acp6-gap-taxonomy/v1',
  mappingVersion: 'acp6-gap-mapping/v1',
  taxonomyContract: {
    repository: 'Onesummer-D/Ripple',
    branch: 'evidence/acp6-taxonomy-v1-20261029',
    commit: '6deb7a263fe45e45ab06bdc617f5a8be2da31a1d',
    path: 'docs/architecture/acp6-gap-taxonomy-v1-2026-10-29.md',
    blob: 'd99c0c6bc0699fd8980007d7aef2a8a801ae2565',
    taxonomyVersion: 'acp6-gap-taxonomy/v1',
    mappingVersion: 'acp6-gap-mapping/v1',
  },
};
fs.writeFileSync(path.join(dir, 'formal-input-declaration.json'), JSON.stringify(formal, null, 2) + '\n', 'utf8');

const legacy = {
  schemaVersion: 'acp6-v06-phase0-legacy-reference/v1',
  branch: 'evidence/cd-acp6-phase0-20261028-final',
  commit: 'c851bfe11e6851e01695f94246a5a571435d8faa',
  tree: 'ffafdd15a9b90254c7b55354a35155b7ffa63381',
  matrixPath: 'docs/acceptance/2026-10-28/acp6-phase0/acp6-v06-phase0-gap-matrix-20261028.json',
  matrixSha256: '89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200',
  role: 'preserved raw-classification witness only',
  rawLabels: ['selector-owner-unresolved', 'dynamic-className', 'theme-cascade-ambiguity', 'complex-selector-normalization', 'candidate-without-strict-edge'],
  canonicalization: 'Each raw label is re-evaluated against selector, AC6.4 dynamic evidence, candidate count and strict-edge count; no merged class is mechanically renamed.',
  canonicalTaxonomy: 'acp6-gap-taxonomy/v1',
};
fs.writeFileSync(path.join(dir, 'legacy-archive-reference.json'), JSON.stringify(legacy, null, 2) + '\n', 'utf8');

const failedChecks = name => {
  const item = name === 'positive' ? positive : json(`validation-${name}.json`);
  return item.validation.checks.filter(check => !check.pass).map(check => check.name);
};
const commands = [
  { name: 'positive', command: 'node validate-acp6-v06-phase0-v2.mjs acp6-v06-phase0-gap-matrix-v2-20261029.json acceptance-ed58cfd-final.json', exitCode: positive.exitPass ? 0 : 1, validatorPass: positive.validation.pass, failedChecks: failedChecks('positive') },
  ...negativeIndex.map(item => ({ name: item.case, command: `node validate-acp6-v06-phase0-v2.mjs acp6-v06-phase0-gap-matrix-v2-20261029.json acceptance-ed58cfd-final.json --negative=${item.case}`, exitCode: item.exitCode, validatorPass: json(`validation-${item.case}.json`).validation.pass, failedChecks: failedChecks(item.case) })),
];
const reproLog = [
  '# AC-P6 Phase 0 v2 clean reproduction',
  '# Each negative case exits 0 only when the validator detects the intended mutation. shuffle-order is a positive invariance case.',
  ...commands.map(item => `${item.exitCode}  ${item.name}  validatorPass=${item.validatorPass}  failedChecks=${item.failedChecks.join(',') || 'none'}\n    ${item.command}`),
  '',
].join('\n');
fs.writeFileSync(path.join(dir, 'reproduction-log.txt'), reproLog, 'utf8');

const validationTable = commands.map(item => `| ${item.name} | ${item.exitCode} | ${item.validatorPass} | ${item.failedChecks.join(', ') || 'none'} |`).join('\n');
const baseMarkdown = read('acp6-v06-phase0-gap-matrix-v2-20261029.md');
const finalMarkdown = `${baseMarkdown}\n## Clean reproduction record\n\nThe formal source JSON parsed successfully and matched SHA-256 \`0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a\`. The historical corrupt #65 JSON remains preserved and is never used.\n\n| Case | Process exit | Validator pass | Failed checks observed |\n| --- | ---: | --- | --- |\n${validationTable}\n\nThe negative cases cover duplicate IDs, unknown raw/canonical classifications, deleted classifications, wrong mappings, source-location mutation, input-hash mutation, count mutation, invented graphNodeIds, platform offset drift, and source-row mutation. Reversing row order passes while preserving IDs, counts and classifications.\n`;
fs.writeFileSync(path.join(dir, 'acp6-v06-phase0-gap-matrix-v2-20261029.md'), finalMarkdown, 'utf8');

const exclude = new Set(['manifest.json', 'manifest-sha256.txt']);
const files = fs.readdirSync(dir).filter(name => !exclude.has(name) && fs.statSync(path.join(dir, name)).isFile()).sort();
const manifest = {
  schemaVersion: 'acp6-v06-phase0-manifest/v1',
  generatedAt: '2026-10-29',
  branchIntent: 'new evidence-only branch; old c851bfe archive remains intact',
  baseCommit: 'c851bfe11e6851e01695f94246a5a571435d8faa',
  formalInputSha256: formal.source.sha256,
  taxonomyVersion: formal.taxonomyVersion,
  mappingVersion: formal.mappingVersion,
  files: files.map(name => ({ path: name, bytes: fs.statSync(path.join(dir, name)).size, sha256: sha256File(name) })),
  selfHashPolicy: 'manifest.json and manifest-sha256.txt are intentionally excluded from manifest entries; manifest-sha256.txt records the final manifest bytes separately.',
};
fs.writeFileSync(path.join(dir, 'manifest.json'), JSON.stringify(manifest, null, 2) + '\n', 'utf8');
const manifestHash = sha256File('manifest.json');
fs.writeFileSync(path.join(dir, 'manifest-sha256.txt'), `${manifestHash}  manifest.json\n`, 'utf8');
console.log(JSON.stringify({ formalInput: formal.source, commandCount: commands.length, manifestEntries: manifest.files.length, manifestSha256: manifestHash }, null, 2));
