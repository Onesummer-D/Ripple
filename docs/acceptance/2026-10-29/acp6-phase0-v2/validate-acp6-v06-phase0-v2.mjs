import fs from 'node:fs';
import crypto from 'node:crypto';

const [matrixPath, sourcePath, ...args] = process.argv.slice(2);
if (!matrixPath || !sourcePath) {
  console.error('usage: node validate-acp6-v06-phase0-v2.mjs <matrix.json> <source.json> [--negative=name]');
  process.exit(2);
}
const negativeName = args.find(value => value.startsWith('--negative='))?.slice('--negative='.length) ?? null;
const matrix = JSON.parse(fs.readFileSync(matrixPath, 'utf8'));
const sourceBytes = fs.readFileSync(sourcePath);
const source = JSON.parse(sourceBytes.toString('utf8'));
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
const expectedByKey = new Map(expectedRows.map(row => [key(row), row]));
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
  if (isPseudo) {
    const gapClasses = ['pseudo-element-or-generated-content'];
    if (isDynamic) gapClasses.push('dynamic-or-ambiguous-class');
    if (isCandidate) gapClasses.push('candidate-without-source-edge');
    if (raws.includes('selector-owner-unresolved')) gapClasses.push('no-static-element-anchor');
    return { gapClass: gapClasses[0], gapClasses, mappingRuleId: isDynamic ? 'MAP-DYN-PSEUDO-001' : 'MAP-SOU-PSEUDO-001', taxonomyVersion, rawGapClass: raw, rawGapClasses: raws, secondaryReasons: ['pseudo-element-or-generated-content', ...(isDynamic ? ['dynamic-className-unresolved'] : []), ...(isCandidate ? ['candidate-without-source-edge'] : []), ...(raws.includes('selector-owner-unresolved') ? ['no-unique-owner'] : [])] };
  }
  if (isGlobal || isTheme) {
    const gapClasses = ['global-or-theme-selector'];
    if (raws.includes('selector-owner-unresolved')) gapClasses.push('no-static-element-anchor');
    return { gapClass: gapClasses[0], gapClasses, mappingRuleId: isTheme ? 'MAP-THEME-001' : 'MAP-SOU-GLOBAL-001', taxonomyVersion, rawGapClass: raw, rawGapClasses: raws, secondaryReasons: ['global-selector-unresolved', ...(isTheme ? ['theme-cascade-unresolved'] : []), ...(raws.includes('selector-owner-unresolved') ? ['no-unique-owner'] : [])] };
  }
  if (isDynamic) {
    const gapClasses = ['dynamic-or-ambiguous-class'];
    if (isCandidate) gapClasses.push('candidate-without-source-edge');
    return { gapClass: gapClasses[0], gapClasses, mappingRuleId: 'MAP-DYN-001', taxonomyVersion, rawGapClass: raw, rawGapClasses: raws, secondaryReasons: ['dynamic-className-unresolved', ...(isCandidate ? ['candidate-without-source-edge'] : [])] };
  }
  if (isCandidate) return { gapClass: 'candidate-without-source-edge', gapClasses: ['candidate-without-source-edge'], mappingRuleId: 'MAP-CAND-001', taxonomyVersion, rawGapClass: raw, rawGapClasses: raws, secondaryReasons: ['candidate-without-source-edge'] };
  if (isComplex) return { gapClass: 'no-static-element-anchor', gapClasses: ['no-static-element-anchor'], mappingRuleId: 'MAP-COMPLEX-001', taxonomyVersion, rawGapClass: raw, rawGapClasses: raws, secondaryReasons: ['selector-normalization-unresolved'] };
  return { gapClass: 'no-static-element-anchor', gapClasses: ['no-static-element-anchor'], mappingRuleId: 'MAP-SOU-OWNER-001', taxonomyVersion, rawGapClass: raw, rawGapClasses: raws, secondaryReasons: ['no-unique-owner'] };
}

function applyMutation(input, name) {
  if (!name) return input;
  if (name === 'duplicate-id') input.rows[1].rowId = input.rows[0].rowId;
  else if (name === 'unknown-raw-class') input.rows.find(row => row.coverageStatus === 'uncovered').rawGapClass = 'unknown-raw-class';
  else if (name === 'unknown-canonical-class') input.rows.find(row => row.coverageStatus === 'uncovered').gapClass = 'unknown-canonical-class';
  else if (name === 'deleted-classification') { const row = input.rows.find(value => value.coverageStatus === 'uncovered'); delete row.rawGapClass; delete row.rawGapClasses; delete row.gapClass; delete row.gapClasses; delete row.mappingRuleId; delete row.taxonomyVersion; delete row.secondaryReasons; }
  else if (name === 'wrong-mapping-rule') input.rows.find(row => row.coverageStatus === 'uncovered').mappingRuleId = 'MAP-CAND-001';
  else if (name === 'tampered-source-location') input.rows.find(row => row.coverageStatus === 'uncovered').sourceRef.byteOffset += 1;
  else if (name === 'tampered-input-hash') input.source.acceptanceJsonSha256 = '0'.repeat(64);
  else if (name === 'tampered-counts') input.stats.coveredRows = 84;
  else if (name === 'graph-node-present') input.rows.find(row => row.coverageStatus === 'uncovered').sourceUseGraphNodeIds = { status: 'present', value: ['invented-node'] };
  else if (name === 'offset-platform-mismatch') input.offsetEvidence.platformChecks[0].windows.byteOffset += 1;
  else if (name === 'source-row-mutation') input.rows.find(row => row.coverageStatus === 'uncovered').originalEvidence.candidateConsumers += 1;
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
  check('schema-version', input.schemaVersion === 'acp6-v06-phase0-gap-matrix/v3', { actual: input.schemaVersion });
  check('mapping-version', input.generationRuleVersion === mappingVersion && input.classification?.mappingVersion === mappingVersion, {});
  check('taxonomy-version', input.classification?.taxonomyVersion === taxonomyVersion && input.rows.filter(row => row.coverageStatus === 'uncovered').every(row => row.taxonomyVersion === taxonomyVersion), {});
  check('canonical-class-vocabulary', canonical(input.classification?.allowedGapClasses) === canonical(canonicalClasses), { actual: input.classification?.allowedGapClasses });
  check('stable-id-unique', new Set(ids).size === ids.length, { rows: ids.length, unique: new Set(ids).size });
  check('stable-id-reproducible', rows.every(row => row.rowId === stableId(row)), {});
  check('source-location-shape', rows.every(row => row.sourceRef && typeof row.sourceRef.file === 'string' && Number.isInteger(row.sourceRef.offset) && Number.isInteger(row.sourceRef.byteOffset) && typeof row.sourceRef.selector === 'string'), {});
  check('covered-rows-have-no-gap-fields', covered.every(row => !('rawGapClass' in row) && !('rawGapClasses' in row) && !('gapClass' in row) && !('gapClasses' in row) && !('mappingRuleId' in row) && !('taxonomyVersion' in row) && !('secondaryReasons' in row)), {});
  check('uncovered-classifications-legal', uncovered.every(row => { const mapped = expectedMapping(row); return mapped && canonical(mapped) === canonical({ rawGapClass: row.rawGapClass, rawGapClasses: row.rawGapClasses, gapClass: row.gapClass, gapClasses: row.gapClasses, mappingRuleId: row.mappingRuleId, taxonomyVersion: row.taxonomyVersion, secondaryReasons: row.secondaryReasons }); }), {});
  check('source-use-graph-node-ids-explicit-missing', rows.every(row => row.sourceUseGraphNodeIds?.status === 'missing' && row.sourceUseGraphNodeIds.value === null), {});
  check('source-hash', sha256(sourceBytes) === input.source?.acceptanceJsonSha256 && input.source?.acceptanceJsonSha256 === '0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a', { actual: sha256(sourceBytes), recorded: input.source?.acceptanceJsonSha256 });
  check('source-json-parse', input.source?.jsonParse === 'pass', {});
  check('source-not-overwritten', input.source?.overwritten === false, {});
  check('row-counts', rows.length === 123 && covered.length === 85 && uncovered.length === 38 && input.stats?.sourceUseRows === 123 && input.stats?.coveredRows === 85 && input.stats?.uncoveredRows === 38, { actual: { rows: rows.length, covered: covered.length, uncovered: uncovered.length, stats: input.stats } });
  check('token-counts', input.stats?.tokenCount === 8 && input.stats?.uncoveredTokenCount === 7 && input.stats?.coveredTokenCount === 1, {});
  const expectedById = new Map(expectedRows.map(row => [stableId(row), row]));
  const sourceCompare = rows.length === expectedRows.length && rows.every(row => {
    const expected = expectedById.get(row.rowId);
    if (!expected) return false;
    return canonical({ token: row.token, sourceRef: row.sourceRef, originalEvidence: row.originalEvidence, declarationRefs: row.declarationRefs, coverageStatus: row.coverageStatus }) === canonical(expected);
  });
  check('source-use-full-row-comparison', sourceCompare && input.sourceComparison?.matchedRows === 123 && Array.isArray(input.sourceComparison?.sourceRowDiffs) && input.sourceComparison.sourceRowDiffs.length === 0, {});
  const gapCounts = {}; for (const row of uncovered) gapCounts[row.gapClass] = (gapCounts[row.gapClass] ?? 0) + 1;
  const rawCounts = {}; for (const row of uncovered) rawCounts[row.rawGapClass] = (rawCounts[row.rawGapClass] ?? 0) + 1;
  check('canonical-counts', canonical(input.stats?.gapClassCounts) === canonical({ 'global-or-theme-selector': 3, 'no-static-element-anchor': 21, 'dynamic-or-ambiguous-class': 8, 'candidate-without-source-edge': 4, 'pseudo-element-or-generated-content': 2 }) && canonical(gapCounts) === canonical(input.stats.gapClassCounts), { actual: gapCounts });
  check('raw-counts', canonical(rawCounts) === canonical(input.stats.rawGapClassCounts) && rawCounts['selector-owner-unresolved'] === 24 && rawCounts['dynamic-className'] === 9 && rawCounts['candidate-without-strict-edge'] === 4 && rawCounts['theme-cascade-ambiguity'] === 1 && (rawCounts['complex-selector-normalization'] ?? 0) === 0, { actual: rawCounts });
  check('row-indexes', new Set(input.coveredRowIds ?? []).size === 85 && new Set(input.uncoveredRowIds ?? []).size === 38 && new Set(input.coveredRowIds ?? []).size + new Set(input.uncoveredRowIds ?? []).size === 123, {});
  const pairCounts = { expected: ac64.expectedStaticAndDynamicConsumerPairs, anchored: ac64.anchoredConsumerPairs.filter(pair => pair.anchored).length, unknown: ac64.uncoveredConsumerPairs.length, static: ac64.uncoveredConsumerPairs.filter(pair => !pair.dynamic).length, dynamic: ac64.uncoveredConsumerPairs.filter(pair => pair.dynamic).length };
  check('ac64-pair-counts', pairCounts.expected === 147 && pairCounts.anchored === 131 && pairCounts.unknown === 16 && pairCounts.static === 9 && pairCounts.dynamic === 7 && input.stats.ac64ConsumerPairs === 147 && input.stats.ac64StaticAnchors === 131 && input.stats.ac64UnknownPairs === 16 && input.stats.ac64UnknownStatic === 9 && input.stats.ac64UnknownDynamic === 7, { actual: pairCounts });
  check('ac64-pair-evidence', input.ac64Evidence?.expectedPairs === 147 && input.ac64Evidence?.anchoredPairs === 131 && input.ac64Evidence?.unknownPairs === 16 && input.ac64Evidence?.unknownStatic === 9 && input.ac64Evidence?.unknownDynamic === 7 && input.ac64Evidence?.pairs?.length === 16, {});
  const platformChecks = input.offsetEvidence?.platformChecks ?? [];
  check('platform-offsets', platformChecks.length === 123 && platformChecks.every(item => item.linux?.byteOffset === item.sourceRef?.byteOffset && item.windows?.byteOffset === item.sourceRef?.byteOffset && item.linux?.offset === item.sourceRef?.offset && item.windows?.offset === item.sourceRef?.offset) && Array.isArray(input.offsetEvidence?.driftRows) && input.offsetEvidence.driftRows.length === 0, {});
  const stableRows = rows.map(row => row.rowId).sort();
  const reversed = clone(input); reversed.rows.reverse();
  check('order-stability', canonical(stableRows) === canonical(reversed.rows.map(row => row.rowId).sort()) && canonical({ rows: rows.length, covered: covered.length, uncovered: uncovered.length, gapCounts }) === canonical({ rows: reversed.rows.length, covered: reversed.rows.filter(row => row.coverageStatus === 'covered').length, uncovered: reversed.rows.filter(row => row.coverageStatus === 'uncovered').length, gapCounts: reversed.rows.filter(row => row.coverageStatus === 'uncovered').reduce((acc, row) => { acc[row.gapClass] = (acc[row.gapClass] ?? 0) + 1; return acc; }, {}) }), {});
  const passed = checks.every(value => value.pass);
  return { pass: passed, checks, summary: { rows: rows.length, covered: covered.length, uncovered: uncovered.length, gapClassCounts: gapCounts, ac64: pairCounts } };
}

const input = applyMutation(clone(matrix), negativeName);
const validation = validate(input);
const expectedPass = negativeName === 'shuffle-order';
const exitPass = negativeName ? (expectedPass ? validation.pass : !validation.pass) : validation.pass;
const result = { schemaVersion: 'acp6-v06-phase0-validation/v3', generatedAt: '2026-10-29', matrixPath, sourcePath, negativeName, expectedPass, validation, exitPass };
console.log(JSON.stringify(result, null, 2));
process.exitCode = exitPass ? 0 : 1;
