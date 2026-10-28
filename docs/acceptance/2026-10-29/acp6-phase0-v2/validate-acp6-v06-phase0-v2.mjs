import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';

const [matrixPath, sourcePath, ...args] = process.argv.slice(2);
if (!matrixPath || !sourcePath) {
  console.error('usage: node validate-acp6-v06-phase0-v2.mjs <matrix.json> <source.json> [--raw=raw-matrix.json] [--negative=name]');
  process.exit(2);
}
const negativeName = args.find(value => value.startsWith('--negative='))?.slice('--negative='.length) ?? null;
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const rawArgument = args.find(value => value.startsWith('--raw='))?.slice('--raw='.length);
const rawPath = path.resolve(path.dirname(matrixPath), rawArgument ?? matrix.source?.rawClassificationSource?.localPath ?? 'raw-classification-source-c851bfe.json');
let rawClassificationBytes;
let rawClassification;
try {
  rawClassificationBytes = fs.readFileSync(rawPath);
  rawClassification = JSON.parse(rawClassificationBytes.toString('utf8'));
} catch (error) {
  console.error(`raw classification source unavailable: ${rawPath}`);
  process.exit(2);
}
const clone = value => JSON.parse(JSON.stringify(value));
const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};
const taxonomyVersion = 'acp6-gap-taxonomy/v1';
const mappingVersion = 'acp6-gap-mapping/v1';
const canonicalClasses = ['global-or-theme-selector', 'no-static-element-anchor', 'dynamic-or-ambiguous-class', 'candidate-without-source-edge', 'pseudo-element-or-generated-content'];
const rawClasses = ['selector-owner-unresolved', 'dynamic-className', 'theme-cascade-ambiguity', 'complex-selector-normalization', 'candidate-without-strict-edge'];

function sourceRows(input) {
  const item = input.acceptance.items.find(value => value.id === 'AC6.2');
  const rows = [];
  for (const set of item.detail.declarationSetCoverage) for (const use of set.sourceUseCoverage) rows.push({
    token: set.token,
    sourceRef: { file: use.file, offset: use.offset, byteOffset: use.byteOffset, selector: use.selector },
    originalEvidence: { candidateConsumers: use.candidateConsumers, linkedStrictEdges: use.linkedStrictEdges, covered: use.covered },
    declarationRefs: set.links.map(link => ({ file: link.file, byteOffset: link.byteOffset, selectorScope: link.selectorScope, graphNodeIds: [...(link.graphNodeIds ?? [])] })),
    coverageStatus: use.covered ? 'covered' : 'uncovered',
  });
  return rows;
}
const key = row => [row.token, row.sourceRef.file, row.sourceRef.byteOffset, row.sourceRef.selector].join('|');
const stableId = row => `acp6-gap-${sha256(`acp6-v06-phase0-row|${row.token}|${row.sourceRef.file}|${row.sourceRef.byteOffset}|${row.sourceRef.selector}`).slice(0, 16)}`;
const pseudo = selector => /::(?:before|after|first-letter|first-line|selection|marker|placeholder|backdrop|file-selector-button)/i.test(selector);
const globalOrTheme = selector => /^(?:body|html|:root)(?:$|[\s>+~.#:[,])/i.test(selector.trim()) || /^\*(?:$|[\s>+~.#:[,])/i.test(selector.trim()) || /\[data-theme(?:\s*=|\])/i.test(selector);
const expectedRows = sourceRows(source);
const rawClassificationRows = rawClassification.rows ?? [];
const rawClassificationById = new Map(rawClassificationRows.map(row => [row.rowId, row]));
const ac64 = source.acceptance.items.find(value => value.id === 'AC6.4').detail;
const dynamicKeys = new Set();
for (const pair of ac64.uncoveredConsumerPairs) if (pair.dynamic) for (const use of pair.sourceUses) dynamicKeys.add([pair.token, use.file, use.byteOffset, use.selector].join('|'));

function expectedMapping(row) {
  const raw = row.rawGapClass;
  const raws = row.rawGapClasses;
  if (!rawClasses.includes(raw) || !Array.isArray(raws) || raws.length === 0 || raws.some(value => !rawClasses.includes(value))) return null;
  const isDynamic = raw === 'dynamic-className' || raws.includes('dynamic-className');
  const isCandidate = raw === 'candidate-without-strict-edge' || raws.includes('candidate-without-strict-edge');
  const isTheme = raw === 'theme-cascade-ambiguity' || raws.includes('theme-cascade-ambiguity');
  const isComplex = raw === 'complex-selector-normalization' || raws.includes('complex-selector-normalization');
  const isPseudo = pseudo(row.sourceRef.selector);
  const isGlobal = globalOrTheme(row.sourceRef.selector);
  if (isDynamic && (!dynamicKeys.has(key(row)) || row.originalEvidence.candidateConsumers < 1)) return null;
  if (isCandidate && (row.originalEvidence.candidateConsumers < 1 || row.originalEvidence.linkedStrictEdges !== 0)) return null;
  if (isTheme && !isGlobal) return null;
  const common = { taxonomyVersion, mappingVersion, rawGapClass: raw, rawGapClasses: raws };
  if (isPseudo) {
    const gapClasses = ['pseudo-element-or-generated-content'];
    if (isDynamic) gapClasses.push('dynamic-or-ambiguous-class');
    if (isCandidate) gapClasses.push('candidate-without-source-edge');
    if (raws.includes('selector-owner-unresolved')) gapClasses.push('no-static-element-anchor');
    return { ...common, gapClass: gapClasses[0], gapClasses, mappingRuleId: isDynamic ? 'MAP-DYN-PSEUDO-001' : 'MAP-SOU-PSEUDO-001', secondaryReasons: ['pseudo-element-or-generated-content', ...(isDynamic ? ['dynamic-className-unresolved'] : []), ...(isCandidate ? ['candidate-without-source-edge'] : []), ...(raws.includes('selector-owner-unresolved') ? ['no-unique-owner'] : [])] };
  }
  if (isGlobal || isTheme) {
    const gapClasses = ['global-or-theme-selector'];
    if (raws.includes('selector-owner-unresolved')) gapClasses.push('no-static-element-anchor');
    return { ...common, gapClass: gapClasses[0], gapClasses, mappingRuleId: isTheme ? 'MAP-THEME-001' : 'MAP-SOU-GLOBAL-001', secondaryReasons: ['global-selector-unresolved', ...(isTheme ? ['theme-cascade-unresolved'] : []), ...(raws.includes('selector-owner-unresolved') ? ['no-unique-owner'] : [])] };
  }
  if (isDynamic) {
    const gapClasses = ['dynamic-or-ambiguous-class'];
    if (isCandidate) gapClasses.push('candidate-without-source-edge');
    return { ...common, gapClass: gapClasses[0], gapClasses, mappingRuleId: 'MAP-DYN-001', secondaryReasons: ['dynamic-className-unresolved', ...(isCandidate ? ['candidate-without-source-edge'] : [])] };
  }
  if (isCandidate) return { ...common, gapClass: 'candidate-without-source-edge', gapClasses: ['candidate-without-source-edge'], mappingRuleId: 'MAP-CAND-001', secondaryReasons: ['candidate-without-source-edge'] };
  if (isComplex) return { ...common, gapClass: 'no-static-element-anchor', gapClasses: ['no-static-element-anchor'], mappingRuleId: 'MAP-COMPLEX-001', secondaryReasons: ['selector-normalization-unresolved'] };
  return { ...common, gapClass: 'no-static-element-anchor', gapClasses: ['no-static-element-anchor'], mappingRuleId: 'MAP-SOU-OWNER-001', secondaryReasons: ['no-unique-owner'] };
}

const pairIdFor = pair => `acp6-unknown-pair-${sha256(canonical(pair)).slice(0, 16)}`;
const pairContentFromMatrix = pair => { const { pairId: _pairId, pairContentSha256: _pairHash, ...content } = pair; return content; };
const expectedPairs = ac64.uncoveredConsumerPairs.map(pair => ({ pairId: pairIdFor(pair), content: clone(pair) }));
const expectedPairMap = new Map(expectedPairs.map(pair => [pair.pairId, pair]));
const expectedPairSetSha256 = sha256(canonical(expectedPairs.map(pair => pair.content).sort((left, right) => canonical(left).localeCompare(canonical(right)))));

function makeIndependentDrift(input) {
  input.offsetEvidence.crossPlatformStatus = 'independent-drift-explained';
  input.offsetEvidence.proofLevel = 'proven';
  const windows = input.offsetEvidence.platformInputs.find(item => item.platform === 'windows');
  windows.runnerId = 'windows-independent-20261029';
  windows.inputArtifactSha256 = '1'.repeat(64);
  windows.sourcePath = 'windows-artifact/acceptance.json';
  windows.evidenceLevel = 'independent-run-artifact';
  windows.observedIndependently = true;
  input.offsetEvidence.driftRows = input.offsetEvidence.platformChecks.map(item => ({ rowId: item.rowId, offsetDelta: 1, byteOffsetDelta: 2 }));
  for (const item of input.offsetEvidence.platformChecks) {
    item.linux.offset = item.sourceRef.offset + 1;
    item.linux.byteOffset = item.sourceRef.byteOffset + 2;
    item.linux.offsetsExtracted = true;
    item.windows.offsetsExtracted = true;
    item.comparison = { status: 'independent-drift-explained', offsetDelta: 1, byteOffsetDelta: 2 };
  }
}

function applyMutation(input, name) {
  if (!name) return input;
  if (name === 'duplicate-id') input.rows[1].rowId = input.rows[0].rowId;
  else if (name === 'unknown-raw-class') input.rows.find(row => row.coverageStatus === 'uncovered').rawGapClass = 'unknown-raw-class';
  else if (name === 'unknown-canonical-class') input.rows.find(row => row.coverageStatus === 'uncovered').gapClass = 'unknown-canonical-class';
  else if (name === 'deleted-classification') { const row = input.rows.find(value => value.coverageStatus === 'uncovered'); for (const field of ['rawGapClass', 'rawGapClasses', 'gapClass', 'gapClasses', 'mappingRuleId', 'taxonomyVersion', 'mappingVersion', 'secondaryReasons']) delete row[field]; }
  else if (name === 'missing-row-mapping-version') delete input.rows.find(row => row.coverageStatus === 'uncovered').mappingVersion;
  else if (name === 'wrong-row-mapping-version') input.rows.find(row => row.coverageStatus === 'uncovered').mappingVersion = 'acp6-gap-mapping/v0';
  else if (name === 'wrong-mapping-rule') input.rows.find(row => row.coverageStatus === 'uncovered').mappingRuleId = 'MAP-CAND-001';
  else if (name === 'tampered-source-location') input.rows.find(row => row.coverageStatus === 'uncovered').sourceRef.byteOffset += 1;
  else if (name === 'tampered-input-hash') input.source.acceptanceJsonSha256 = '0'.repeat(64);
  else if (name === 'tampered-counts') input.stats.coveredRows = 84;
  else if (name === 'graph-node-present') input.rows.find(row => row.coverageStatus === 'uncovered').sourceUseGraphNodeIds = { status: 'present', value: ['invented-node'] };
  else if (name === 'source-row-mutation') input.rows.find(row => row.coverageStatus === 'uncovered').originalEvidence.candidateConsumers += 1;
  else if (name === 'ac64-pair-file') input.ac64Evidence.pairs[0].file = 'tampered.jsx';
  else if (name === 'ac64-pair-byte-offset') input.ac64Evidence.pairs[0].sourceUses[0].byteOffset += 1;
  else if (name === 'ac64-pair-token') input.ac64Evidence.pairs[0].token = '--tampered';
  else if (name === 'ac64-pair-component') input.ac64Evidence.pairs[0].component = 'Tampered';
  else if (name === 'ac64-pair-source-ref') input.ac64Evidence.pairs[0].sourceUses[0].file = 'tampered.css';
  else if (name === 'ac64-pair-edge-count') input.ac64Evidence.pairs[0].edgeCount = 1;
  else if (name === 'ac64-pair-certainty') input.ac64Evidence.pairs[0].certainty = 'source-proven';
  else if (name === 'ac64-pair-id') input.ac64Evidence.pairs[0].pairId = 'acp6-unknown-pair-tampered';
  else if (name === 'ac64-pair-content-hash') input.ac64Evidence.pairs[0].pairContentSha256 = '0'.repeat(64);
  else if (name === 'ac64-pair-set-hash') input.ac64PairSetSha256 = '0'.repeat(64);
  else if (name === 'ac64-unknown-pair-ids') input.ac64Evidence.unknownPairIds = input.ac64Evidence.unknownPairIds.slice(1);
  else if (name === 'covered-row-id-mutation') input.coveredRowIds[0] = 'acp6-gap-tampered';
  else if (name === 'uncovered-row-id-mutation') input.uncoveredRowIds[0] = 'acp6-gap-tampered';
  else if (name === 'raw-classification-label-swap') { const row = input.rows.find(value => value.coverageStatus === 'uncovered'); row.rawGapClass = 'dynamic-className'; row.rawGapClasses = ['dynamic-className']; }
  else if (name === 'raw-classification-source-hash') input.source.rawClassificationSource.sha256 = '0'.repeat(64);
  else if (name === 'copied-platform-evidence') { input.offsetEvidence.crossPlatformStatus = 'independent-equal'; input.offsetEvidence.proofLevel = 'proven'; for (const item of input.offsetEvidence.platformChecks) { item.linux.offset = item.sourceRef.offset; item.linux.byteOffset = item.sourceRef.byteOffset; item.linux.offsetsExtracted = true; item.linux.observedIndependently = false; item.comparison = { status: 'independent-equal', offsetDelta: 0, byteOffsetDelta: 0 }; } }
  else if (name === 'offset-platform-mismatch') { input.offsetEvidence.crossPlatformStatus = 'independent-equal'; input.offsetEvidence.proofLevel = 'proven'; input.offsetEvidence.platformChecks[0].linux.offset = input.offsetEvidence.platformChecks[0].sourceRef.offset + 1; input.offsetEvidence.platformChecks[0].linux.byteOffset = input.offsetEvidence.platformChecks[0].sourceRef.byteOffset + 1; input.offsetEvidence.platformChecks[0].comparison = { status: 'independent-equal', offsetDelta: 1, byteOffsetDelta: 1 }; }
  else if (name === 'drift-status-null-linux') { input.offsetEvidence.crossPlatformStatus = 'independent-drift-explained'; input.offsetEvidence.proofLevel = 'proven'; for (const item of input.offsetEvidence.platformChecks) item.comparison = { status: 'independent-drift-explained', offsetDelta: 0, byteOffsetDelta: 0 }; }
  else if (name === 'drift-status-unobserved') { input.offsetEvidence.crossPlatformStatus = 'independent-drift-explained'; input.offsetEvidence.proofLevel = 'proven'; input.offsetEvidence.platformInputs[1].observedIndependently = false; }
  else if (name === 'drift-fake-delta') { makeIndependentDrift(input); input.offsetEvidence.platformChecks[0].comparison.offsetDelta = 999; }
  else if (name === 'drift-missing-row') { makeIndependentDrift(input); input.offsetEvidence.driftRows = input.offsetEvidence.driftRows.slice(1); }
  else if (name === 'offset-reconciliation-promoted') input.offsetEvidence.externalReconciliationObservation.promotesProof = true;
  else if (name === 'shuffle-order') input.rows.reverse();
  else throw new Error(`unknown mutation: ${name}`);
  return input;
}

function validate(input) {
  const checks = [];
  const check = (name, pass, details = {}) => checks.push({ name, pass: Boolean(pass), details });
  const rows = input.rows ?? [];
  const covered = rows.filter(row => row.coverageStatus === 'covered');
  const uncovered = rows.filter(row => row.coverageStatus === 'uncovered');
  const ids = rows.map(row => row.rowId);
  const expectedCoveredIds = expectedRows.filter(row => row.coverageStatus === 'covered').map(stableId).sort();
  const expectedUncoveredIds = expectedRows.filter(row => row.coverageStatus === 'uncovered').map(stableId).sort();
  check('schema-version', input.schemaVersion === 'acp6-v06-phase0-gap-matrix/v4', { actual: input.schemaVersion });
  check('mapping-version', input.generationRuleVersion === mappingVersion && input.classification?.mappingVersion === mappingVersion, {});
  check('taxonomy-version', input.classification?.taxonomyVersion === taxonomyVersion && uncovered.every(row => row.taxonomyVersion === taxonomyVersion), {});
  check('canonical-class-vocabulary', canonical(input.classification?.allowedGapClasses) === canonical(canonicalClasses), { actual: input.classification?.allowedGapClasses });
  check('stable-id-unique', new Set(ids).size === ids.length, { rows: ids.length, unique: new Set(ids).size });
  check('stable-id-reproducible', rows.every(row => row.rowId === stableId(row)), {});
  check('source-location-shape', rows.every(row => row.sourceRef && typeof row.sourceRef.file === 'string' && Number.isInteger(row.sourceRef.offset) && Number.isInteger(row.sourceRef.byteOffset) && typeof row.sourceRef.selector === 'string'), {});
  check('covered-rows-have-no-gap-fields', covered.every(row => !('rawGapClass' in row) && !('rawGapClasses' in row) && !('gapClass' in row) && !('gapClasses' in row) && !('mappingRuleId' in row) && !('taxonomyVersion' in row) && !('mappingVersion' in row) && !('secondaryReasons' in row)), {});
  check('uncovered-classifications-legal', uncovered.every(row => { const mapped = expectedMapping(row); return mapped && canonical(mapped) === canonical({ rawGapClass: row.rawGapClass, rawGapClasses: row.rawGapClasses, gapClass: row.gapClass, gapClasses: row.gapClasses, mappingRuleId: row.mappingRuleId, taxonomyVersion: row.taxonomyVersion, mappingVersion: row.mappingVersion, secondaryReasons: row.secondaryReasons }); }), {});
  check('source-use-graph-node-ids-explicit-missing', rows.every(row => row.sourceUseGraphNodeIds?.status === 'missing' && row.sourceUseGraphNodeIds.value === null), {});
  check('source-hash', sha256(sourceBytes) === input.source?.acceptanceJsonSha256 && input.source?.acceptanceJsonSha256 === '0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a', { actual: sha256(sourceBytes), recorded: input.source?.acceptanceJsonSha256 });
  check('source-json-parse', input.source?.jsonParse === 'pass', {});
  check('source-not-overwritten', input.source?.overwritten === false, {});
  check('archive-base-identity', input.source?.archivePrBase === 'd1d26185710c8e4d80182356f760109123bdc989' && input.source?.rawClassificationSource?.commit === 'c851bfe11e6851e01695f94246a5a571435d8faa' && input.source?.rawClassificationSource?.sha256 === '89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200', {});
  const rawClassificationHash = sha256(rawClassificationBytes);
  check('raw-classification-source-hash', rawClassificationHash === input.source?.rawClassificationSource?.sha256 && rawClassificationHash === '89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200' && rawClassificationRows.length === 123, { actual: rawClassificationHash, recorded: input.source?.rawClassificationSource?.sha256 });
  check('row-counts', rows.length === 123 && covered.length === 85 && uncovered.length === 38 && input.stats?.sourceUseRows === 123 && input.stats?.coveredRows === 85 && input.stats?.uncoveredRows === 38, { actual: { rows: rows.length, covered: covered.length, uncovered: uncovered.length } });
  check('token-counts', input.stats?.tokenCount === 8 && input.stats?.uncoveredTokenCount === 7 && input.stats?.coveredTokenCount === 1, {});
  const expectedById = new Map(expectedRows.map(row => [stableId(row), row]));
  const sourceCompare = rows.length === expectedRows.length && rows.every(row => { const expected = expectedById.get(row.rowId); return expected && canonical({ token: row.token, sourceRef: row.sourceRef, originalEvidence: row.originalEvidence, declarationRefs: row.declarationRefs, coverageStatus: row.coverageStatus }) === canonical(expected); });
  check('source-use-full-row-comparison', sourceCompare && input.sourceComparison?.matchedRows === 123 && Array.isArray(input.sourceComparison?.sourceRowDiffs) && input.sourceComparison.sourceRowDiffs.length === 0, {});
  const rawClassificationCompare = uncovered.length === 38 && uncovered.every(row => {
    const expected = rawClassificationById.get(row.rowId);
    return expected && canonical({ rawGapClass: row.rawGapClass, rawGapClasses: row.rawGapClasses }) === canonical({ rawGapClass: expected.gapClass, rawGapClasses: expected.gapClasses });
  });
  check('raw-classification-row-comparison', rawClassificationCompare, { rawRows: rawClassificationRows.length, uncovered: uncovered.length });
  const gapCounts = {}; for (const row of uncovered) gapCounts[row.gapClass] = (gapCounts[row.gapClass] ?? 0) + 1;
  const rawCounts = {}; for (const row of uncovered) rawCounts[row.rawGapClass] = (rawCounts[row.rawGapClass] ?? 0) + 1;
  check('canonical-counts', canonical(input.stats?.gapClassCounts) === canonical({ 'global-or-theme-selector': 3, 'no-static-element-anchor': 21, 'dynamic-or-ambiguous-class': 8, 'candidate-without-source-edge': 4, 'pseudo-element-or-generated-content': 2 }) && canonical(gapCounts) === canonical(input.stats.gapClassCounts), { actual: gapCounts });
  check('raw-counts', canonical(rawCounts) === canonical(input.stats.rawGapClassCounts) && rawCounts['selector-owner-unresolved'] === 24 && rawCounts['dynamic-className'] === 9 && rawCounts['candidate-without-strict-edge'] === 4 && rawCounts['theme-cascade-ambiguity'] === 1 && (rawCounts['complex-selector-normalization'] ?? 0) === 0, { actual: rawCounts });
  check('row-indexes-exact', canonical([...new Set(input.coveredRowIds ?? [])].sort()) === canonical(expectedCoveredIds) && canonical([...new Set(input.uncoveredRowIds ?? [])].sort()) === canonical(expectedUncoveredIds) && new Set([...(input.coveredRowIds ?? []), ...(input.uncoveredRowIds ?? [])]).size === 123, {});
  const pairCounts = { expected: ac64.expectedStaticAndDynamicConsumerPairs, anchored: ac64.anchoredConsumerPairs.filter(pair => pair.anchored).length, unknown: ac64.uncoveredConsumerPairs.length, static: ac64.uncoveredConsumerPairs.filter(pair => !pair.dynamic).length, dynamic: ac64.uncoveredConsumerPairs.filter(pair => pair.dynamic).length };
  check('ac64-pair-counts', pairCounts.expected === 147 && pairCounts.anchored === 131 && pairCounts.unknown === 16 && pairCounts.static === 9 && pairCounts.dynamic === 7 && input.stats.ac64ConsumerPairs === 147 && input.stats.ac64StaticAnchors === 131 && input.stats.ac64UnknownPairs === 16 && input.stats.ac64UnknownStatic === 9 && input.stats.ac64UnknownDynamic === 7, { actual: pairCounts });
  const matrixPairs = input.ac64Evidence?.pairs ?? [];
  const pairIds = matrixPairs.map(pair => pair.pairId);
  const pairContentValid = matrixPairs.length === 16 && new Set(pairIds).size === 16 && matrixPairs.every(pair => { const expected = expectedPairMap.get(pair.pairId); const content = pairContentFromMatrix(pair); return expected && canonical(content) === canonical(expected.content) && pair.pairContentSha256 === sha256(canonical(content)); });
  const expectedPairIds = [...expectedPairMap.keys()].sort();
  check('ac64-pair-content-integrity', pairContentValid && canonical([...new Set(pairIds)].sort()) === canonical(expectedPairIds), {});
  check('ac64-pair-set-hash', input.ac64PairSetSha256 === expectedPairSetSha256 && input.ac64Evidence?.pairSetSha256 === expectedPairSetSha256, { actual: input.ac64PairSetSha256, expected: expectedPairSetSha256 });
  check('ac64-unknown-pair-ids', canonical([...(input.ac64Evidence?.unknownPairIds ?? [])].sort()) === canonical(expectedPairIds), {});
  check('ac64-pair-evidence', input.ac64Evidence?.expectedPairs === 147 && input.ac64Evidence?.anchoredPairs === 131 && input.ac64Evidence?.unknownPairs === 16 && input.ac64Evidence?.unknownStatic === 9 && input.ac64Evidence?.unknownDynamic === 7 && pairContentValid, {});
  check('ac64-pair-status-counts', matrixPairs.filter(pair => !pair.dynamic).length === 9 && matrixPairs.filter(pair => pair.dynamic).length === 7, {});
  const platformChecks = input.offsetEvidence?.platformChecks ?? [];
  const platformInputs = input.offsetEvidence?.platformInputs ?? [];
  const requiredPlatformFields = ['platform', 'sourcePath', 'inputArtifactSha256', 'coreSha', 'projectRevisionSha', 'runnerId', 'evidenceLevel', 'observedIndependently'];
  const provenanceShape = platformInputs.length === 2 && platformInputs.every(item => requiredPlatformFields.every(field => Object.prototype.hasOwnProperty.call(item, field)));
  const independentProvenance = provenanceShape && platformInputs.every(item => item.observedIndependently === true && typeof item.inputArtifactSha256 === 'string' && item.inputArtifactSha256.length > 0 && typeof item.sourcePath === 'string' && item.sourcePath.length > 0 && typeof item.coreSha === 'string' && typeof item.runnerId === 'string') && platformInputs[0]?.runnerId !== platformInputs[1]?.runnerId && platformInputs[0]?.inputArtifactSha256 !== platformInputs[1]?.inputArtifactSha256;
  const reconciliation = input.offsetEvidence?.externalReconciliationObservation;
  check('offset-reconciliation-observation', reconciliation?.status === 'externally-observed-not-replayed' && reconciliation?.rowsChecked === 123 && reconciliation?.differingRows === 123 && reconciliation?.relation === 'CRLF/LF line-ending offset drift reported by independent external review' && reconciliation?.linuxArtifactId === 12801358049 && reconciliation?.linuxArtifactSha256 === '8074527bc50fe7400f79a4dbe9c556634b1298cf39ab3ea83dcf1a591e5fb42c' && reconciliation?.linuxReportSha256 === '7aee05647b185743663d4a4e5dee5996eea971a6de556944e8eb51d99782297b' && reconciliation?.evidenceLevel === 'external-review-report-only' && reconciliation?.promotesProof === false, {});
  let platformPass = false;
  if (input.offsetEvidence?.crossPlatformStatus === 'unavailable') {
    platformPass = input.offsetEvidence?.proofLevel === 'not-proven' && provenanceShape && platformChecks.length === 123 && platformChecks.every(item => item.linux?.offset === null && item.linux?.byteOffset === null && item.windows?.offset === item.sourceRef?.offset && item.windows?.byteOffset === item.sourceRef?.byteOffset && item.comparison?.status === 'unavailable') && canonical([...(input.offsetEvidence?.notProvenRows ?? [])].sort()) === canonical(ids.sort());
  } else if (input.offsetEvidence?.crossPlatformStatus === 'independent-equal') {
    platformPass = input.offsetEvidence?.proofLevel === 'proven' && independentProvenance && platformChecks.length === 123 && platformChecks.every(item => Number.isInteger(item.linux?.offset) && Number.isInteger(item.linux?.byteOffset) && item.linux.offset === item.windows.offset && item.linux.byteOffset === item.windows.byteOffset && item.comparison?.status === 'independent-equal' && item.comparison.offsetDelta === 0 && item.comparison.byteOffsetDelta === 0) && (input.offsetEvidence?.driftRows ?? []).length === 0;
  } else if (input.offsetEvidence?.crossPlatformStatus === 'independent-drift-explained') {
    const expectedDriftRows = platformChecks.filter(item => Number.isInteger(item.linux?.offset) && Number.isInteger(item.linux?.byteOffset) && Number.isInteger(item.windows?.offset) && Number.isInteger(item.windows?.byteOffset) && (item.linux.offset !== item.windows.offset || item.linux.byteOffset !== item.windows.byteOffset)).map(item => ({ rowId: item.rowId, offsetDelta: item.linux.offset - item.windows.offset, byteOffsetDelta: item.linux.byteOffset - item.windows.byteOffset })).sort((left, right) => left.rowId.localeCompare(right.rowId));
    const reportedDriftRows = Array.isArray(input.offsetEvidence?.driftRows) ? [...input.offsetEvidence.driftRows].sort((left, right) => String(left.rowId).localeCompare(String(right.rowId))) : [];
    const rowComparisonsValid = platformChecks.length === 123 && platformChecks.every(item => Number.isInteger(item.linux?.offset) && Number.isInteger(item.linux?.byteOffset) && Number.isInteger(item.windows?.offset) && Number.isInteger(item.windows?.byteOffset) && item.comparison?.status === 'independent-drift-explained' && item.comparison.offsetDelta === item.linux.offset - item.windows.offset && item.comparison.byteOffsetDelta === item.linux.byteOffset - item.windows.byteOffset);
    platformPass = input.offsetEvidence?.proofLevel === 'proven' && independentProvenance && rowComparisonsValid && expectedDriftRows.length > 0 && canonical(reportedDriftRows) === canonical(expectedDriftRows);
  }
  check('platform-offsets', platformPass, { status: input.offsetEvidence?.crossPlatformStatus, proofLevel: input.offsetEvidence?.proofLevel });
  const orderInvariantActual = { rowIds: ids.slice().sort(), covered: covered.length, uncovered: uncovered.length, gapClassCounts: gapCounts, rawGapClassCounts: rawCounts };
  const orderInvariantExpected = { rowIds: [...expectedCoveredIds, ...expectedUncoveredIds].sort(), covered: 85, uncovered: 38, gapClassCounts: { 'global-or-theme-selector': 3, 'no-static-element-anchor': 21, 'dynamic-or-ambiguous-class': 8, 'candidate-without-source-edge': 4, 'pseudo-element-or-generated-content': 2 }, rawGapClassCounts: { 'selector-owner-unresolved': 24, 'dynamic-className': 9, 'candidate-without-strict-edge': 4, 'theme-cascade-ambiguity': 1 } };
  check('order-stability', canonical(orderInvariantActual) === canonical(orderInvariantExpected), { actual: orderInvariantActual, expected: orderInvariantExpected });
  const passed = checks.every(value => value.pass);
  return { pass: passed, checks, summary: { rows: rows.length, covered: covered.length, uncovered: uncovered.length, gapClassCounts: gapCounts, ac64: pairCounts, platformStatus: input.offsetEvidence?.crossPlatformStatus } };
}

const input = applyMutation(clone(matrix), negativeName);
const validation = validate(input);
const expectedPass = negativeName === 'shuffle-order';
const exitPass = negativeName ? (expectedPass ? validation.pass : !validation.pass) : validation.pass;
const result = { schemaVersion: 'acp6-v06-phase0-validation/v4', generatedAt: '2026-10-29', matrixPath, sourcePath, negativeName, expectedPass, validation, exitPass };
console.log(JSON.stringify(result, null, 2));
process.exitCode = exitPass ? 0 : 1;
