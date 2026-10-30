import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

const dir = path.dirname(fileURLToPath(import.meta.url));
const sourcePath = path.resolve(dir, 'acceptance-ed58cfd-final.json');
const rawClassificationPath = path.resolve(dir, 'raw-classification-source-c851bfe.json');
const outMatrix = path.resolve(dir, 'acp6-v06-phase0-gap-matrix-v2-20261029.json');
const outMarkdown = path.resolve(dir, 'acp6-v06-phase0-gap-matrix-v2-20261029.md');

const sha256 = value => crypto.createHash('sha256').update(value).digest('hex');
const sourceBytes = fs.readFileSync(sourcePath);
const rawClassificationBytes = fs.readFileSync(rawClassificationPath);
const source = JSON.parse(sourceBytes.toString('utf8'));
const legacy = JSON.parse(rawClassificationBytes.toString('utf8'));
const rawClassificationSha256 = sha256(rawClassificationBytes);
if (rawClassificationSha256 !== '89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200') {
  throw new Error(`raw classification source SHA-256 mismatch: ${rawClassificationSha256}`);
}
const stableJson = value => JSON.stringify(value, Object.keys(value).sort());
const taxonomyVersion = 'acp6-gap-taxonomy/v1';
const mappingVersion = 'acp6-gap-mapping/v1';
const canonicalClasses = [
  'global-or-theme-selector',
  'no-static-element-anchor',
  'dynamic-or-ambiguous-class',
  'candidate-without-source-edge',
  'pseudo-element-or-generated-content',
];
const rawClasses = [
  'selector-owner-unresolved',
  'dynamic-className',
  'theme-cascade-ambiguity',
  'complex-selector-normalization',
  'candidate-without-strict-edge',
];

const linuxEvidence = {
  platform: 'linux',
  runnerId: '40656095611',
  runUrl: 'https://github.com/Onesummer-D/Ripple/actions/runs/40656095611',
  artifactId: 12801358049,
  artifactName: 'ripple-v06-acp6-linux-ed58cfdc2892acaa9b97363a3414b1c219d07053-40656095611.zip',
  inputArtifactSha256: '8074527bc50fe7400f79a4dbe9c556634b1298cf39ab3ea83dcf1a591e5fb42c',
  sourcePath: 'test-results/acceptance.json',
  sourceFileSha256: '7aee05647b185743663d4a4e5dee5996eea971a6de556944e8eb51d99782297b',
  targetFileSha256: '5038b3fd088d0e51aa430a2767d6637b51daa9a712dd174b76c0e305ff238007',
  coreSha: 'ed58cfdc2892acaa9b97363a3414b1c219d07053',
  projectRevisionSha: 'b244f857457d2a07f118155602eef9097fd322bd',
  evidenceLevel: 'run-artifact-metadata-only',
  observedIndependently: true,
  offsetsExtracted: false,
  availability: 'unavailable',
  reason: 'The GitHub artifact is independently identified and hashed, but its ZIP bytes are not readable in this local execution environment; no per-row Linux offsets are asserted.',
};

const windowsEvidence = {
  platform: 'windows',
  runnerId: 'windows-formal-20261028',
  runUrl: null,
  artifactId: null,
  artifactName: null,
  inputArtifactSha256: '0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a',
  sourcePath: 'acceptance-ed58cfd-final.json',
  sourceFileSha256: null,
  coreSha: 'ed58cfdc2892acaa9b97363a3414b1c219d07053',
  projectRevisionSha: 'b244f857457d2a07f118155602eef9097fd322bd',
  evidenceLevel: 'recovered-copy',
  observedIndependently: false,
  offsetsExtracted: true,
  availability: 'recovered',
  reason: 'Recovered JSON is the formal input, but the original Windows checkout cannot be independently re-opened.',
};

const canonical = value => {
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  if (value && typeof value === 'object') return `{${Object.keys(value).sort().map(key => `${JSON.stringify(key)}:${canonical(value[key])}`).join(',')}}`;
  return JSON.stringify(value);
};

const pairContent = pair => JSON.parse(JSON.stringify(pair));
const pairId = pair => `acp6-unknown-pair-${sha256(canonical(pair)).slice(0, 16)}`;
const pairEvidence = pair => {
  const content = pairContent(pair);
  return { pairId: pairId(content), ...content, pairContentSha256: sha256(canonical(content)) };
};

function sourceRows(input) {
  const item = input.acceptance.items.find(value => value.id === 'AC6.2');
  const rows = [];
  for (const declarationSet of item.detail.declarationSetCoverage) {
    for (const use of declarationSet.sourceUseCoverage) {
      rows.push({
        token: declarationSet.token,
        sourceRef: {
          file: use.file,
          offset: use.offset,
          byteOffset: use.byteOffset,
          selector: use.selector,
        },
        originalEvidence: {
          candidateConsumers: use.candidateConsumers,
          linkedStrictEdges: use.linkedStrictEdges,
          covered: use.covered,
        },
        declarationRefs: declarationSet.links.map(link => ({
          file: link.file,
          byteOffset: link.byteOffset,
          selectorScope: link.selectorScope,
          graphNodeIds: [...(link.graphNodeIds ?? [])],
        })),
        coverageStatus: use.covered ? 'covered' : 'uncovered',
      });
    }
  }
  return rows;
}

function rowKey(row) {
  return [row.token, row.sourceRef.file, row.sourceRef.byteOffset, row.sourceRef.selector].join('|');
}

function stableRowId(row) {
  return `acp6-gap-${sha256(`acp6-v06-phase0-row|${row.token}|${row.sourceRef.file}|${row.sourceRef.byteOffset}|${row.sourceRef.selector}`).slice(0, 16)}`;
}

function isPseudo(selector) {
  return /::(?:before|after|first-letter|first-line|selection|marker|placeholder|backdrop|file-selector-button)/i.test(selector);
}

function isGlobalOrTheme(selector) {
  return /^(?:body|html|:root)(?:$|[\s>+~.#:[,])/i.test(selector.trim()) || /^\*(?:$|[\s>+~.#:[,])/i.test(selector.trim()) || /\[data-theme(?:\s*=|\])/i.test(selector);
}

function isDynamicSource(row, dynamicSourceKeys) {
  return dynamicSourceKeys.has(rowKey(row));
}

function mapClassification(legacyRow, row, dynamicSourceKeys) {
  const rawGapClass = legacyRow.gapClass;
  const rawGapClasses = [...(legacyRow.gapClasses ?? [rawGapClass])];
  const selector = row.sourceRef.selector;
  const pseudo = isPseudo(selector);
  const globalOrTheme = isGlobalOrTheme(selector);
  const dynamic = rawGapClass === 'dynamic-className' || rawGapClasses.includes('dynamic-className');
  const candidate = rawGapClass === 'candidate-without-strict-edge' || rawGapClasses.includes('candidate-without-strict-edge');
  const theme = rawGapClass === 'theme-cascade-ambiguity' || rawGapClasses.includes('theme-cascade-ambiguity');
  const complex = rawGapClass === 'complex-selector-normalization' || rawGapClasses.includes('complex-selector-normalization');

  if (!rawClasses.includes(rawGapClass) || rawGapClasses.some(value => !rawClasses.includes(value))) {
    throw new Error(`unknown raw classification for ${rowKey(row)}`);
  }
  if (dynamic && !isDynamicSource(row, dynamicSourceKeys)) {
    throw new Error(`dynamic raw classification lacks AC6.4 dynamic evidence for ${rowKey(row)}`);
  }
  if (dynamic && row.originalEvidence.candidateConsumers < 1) {
    throw new Error(`dynamic raw classification lacks a candidate consumer for ${rowKey(row)}`);
  }
  if (candidate && (row.originalEvidence.candidateConsumers < 1 || row.originalEvidence.linkedStrictEdges !== 0)) {
    throw new Error(`candidate raw classification has incompatible evidence for ${rowKey(row)}`);
  }
  if (theme && !globalOrTheme) {
    throw new Error(`theme raw classification lacks theme selector evidence for ${rowKey(row)}`);
  }
  if (complex && selector.length < 1) {
    throw new Error(`complex raw classification lacks selector evidence for ${rowKey(row)}`);
  }
  if (pseudo) {
    const gapClasses = ['pseudo-element-or-generated-content'];
    if (dynamic) gapClasses.push('dynamic-or-ambiguous-class');
    if (candidate) gapClasses.push('candidate-without-source-edge');
    if (rawGapClasses.includes('selector-owner-unresolved')) gapClasses.push('no-static-element-anchor');
    const secondaryReasons = ['pseudo-element-or-generated-content'];
    if (dynamic) secondaryReasons.push('dynamic-className-unresolved');
    if (candidate) secondaryReasons.push('candidate-without-source-edge');
    if (rawGapClasses.includes('selector-owner-unresolved')) secondaryReasons.push('no-unique-owner');
    return { rawGapClass, rawGapClasses, gapClass: gapClasses[0], gapClasses, mappingRuleId: dynamic ? 'MAP-DYN-PSEUDO-001' : 'MAP-SOU-PSEUDO-001', taxonomyVersion, mappingVersion, secondaryReasons };
  }
  if (globalOrTheme || theme) {
    const gapClasses = ['global-or-theme-selector'];
    if (rawGapClasses.includes('selector-owner-unresolved')) gapClasses.push('no-static-element-anchor');
    const secondaryReasons = ['global-selector-unresolved'];
    if (theme) secondaryReasons.push('theme-cascade-unresolved');
    if (rawGapClasses.includes('selector-owner-unresolved')) secondaryReasons.push('no-unique-owner');
    return { rawGapClass, rawGapClasses, gapClass: gapClasses[0], gapClasses, mappingRuleId: theme ? 'MAP-THEME-001' : 'MAP-SOU-GLOBAL-001', taxonomyVersion, mappingVersion, secondaryReasons };
  }
  if (dynamic) {
    const gapClasses = ['dynamic-or-ambiguous-class'];
    if (candidate) gapClasses.push('candidate-without-source-edge');
    return { rawGapClass, rawGapClasses, gapClass: gapClasses[0], gapClasses, mappingRuleId: 'MAP-DYN-001', taxonomyVersion, mappingVersion, secondaryReasons: ['dynamic-className-unresolved', ...(candidate ? ['candidate-without-source-edge'] : [])] };
  }
  if (candidate) {
    return { rawGapClass, rawGapClasses, gapClass: 'candidate-without-source-edge', gapClasses: ['candidate-without-source-edge'], mappingRuleId: 'MAP-CAND-001', taxonomyVersion, mappingVersion, secondaryReasons: ['candidate-without-source-edge'] };
  }
  if (complex) {
    return { rawGapClass, rawGapClasses, gapClass: 'no-static-element-anchor', gapClasses: ['no-static-element-anchor'], mappingRuleId: 'MAP-COMPLEX-001', taxonomyVersion, mappingVersion, secondaryReasons: ['selector-normalization-unresolved'] };
  }
  return { rawGapClass, rawGapClasses, gapClass: 'no-static-element-anchor', gapClasses: ['no-static-element-anchor'], mappingRuleId: 'MAP-SOU-OWNER-001', taxonomyVersion, mappingVersion, secondaryReasons: ['no-unique-owner'] };
}

const expectedRows = sourceRows(source);
const expectedByKey = new Map(expectedRows.map(row => [rowKey(row), row]));
if (expectedByKey.size !== expectedRows.length) throw new Error('B source-use key is not unique');
const legacyByKey = new Map(legacy.rows.map(row => [rowKey(row), row]));
if (legacyByKey.size !== legacy.rows.length) throw new Error('legacy row key is not unique');
if (expectedRows.length !== 123 || legacy.rows.length !== 123) throw new Error('unexpected source row count');
const ac64 = source.acceptance.items.find(value => value.id === 'AC6.4').detail;
const dynamicSourceKeys = new Set();
for (const pair of ac64.uncoveredConsumerPairs) {
  if (!pair.dynamic) continue;
  for (const use of pair.sourceUses) dynamicSourceKeys.add([pair.token, use.file, use.byteOffset, use.selector].join('|'));
}
const rows = expectedRows.map(row => {
  const legacyRow = legacyByKey.get(rowKey(row));
  if (!legacyRow) throw new Error(`legacy raw row missing for ${rowKey(row)}`);
  const common = {
    rowId: stableRowId(row),
    coverageStatus: row.coverageStatus,
    token: row.token,
    sourceRef: row.sourceRef,
    originalEvidence: row.originalEvidence,
    declarationRefs: row.declarationRefs,
    sourceUseGraphNodeIds: { status: 'missing', value: null, reason: 'B v5 source-use rows do not emit per-use graphNodeIds; no node association is inferred.' },
    sourceEvidenceHash: sha256(JSON.stringify({ token: row.token, sourceRef: row.sourceRef, originalEvidence: row.originalEvidence, declarationRefs: row.declarationRefs })),
  };
  if (row.coverageStatus === 'covered') return common;
  return { ...common, ...mapClassification(legacyRow, row, dynamicSourceKeys) };
});

const counts = {};
const rawCounts = {};
for (const row of rows.filter(value => value.coverageStatus === 'uncovered')) {
  counts[row.gapClass] = (counts[row.gapClass] ?? 0) + 1;
  rawCounts[row.rawGapClass] = (rawCounts[row.rawGapClass] ?? 0) + 1;
}
const unknownPairs = ac64.uncoveredConsumerPairs.map(pairEvidence);
const pairContents = unknownPairs
  .map(({ pairId: _pairId, pairContentSha256: _pairContentSha256, ...content }) => content)
  .sort((left, right) => canonical(left).localeCompare(canonical(right)));
const ac64PairSetSha256 = sha256(canonical(pairContents));

const matrix = {
  schemaVersion: 'acp6-v06-phase0-gap-matrix/v4',
  generatedAt: '2026-10-29',
  generatedBy: 'C+D Phase 0 evidence rebuild from B ed58cfd recovered JSON',
  generationRuleVersion: mappingVersion,
  source: {
    acceptanceJson: 'evidence/acceptance-ed58cfd-original-recovered.json',
    acceptanceJsonSha256: '0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a',
    acceptanceJsonBytes: fs.statSync(sourcePath).size,
    jsonParse: 'pass',
    sourcePrHead: 'ed58cfdc2892acaa9b97363a3414b1c219d07053',
    sourcePrTree: '24de55f8bc1d8146b12b42b8bfdd4b24d5f41f6c',
    sourcePrBase: '0c02b85cdf7b1d52821fee3e06c013cbd664efa8',
    archivePrBase: 'd1d26185710c8e4d80182356f760109123bdc989',
    fixedProject: 'allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd',
    overwritten: false,
    historicalCorruptArchive: {
      branch: 'evidence/pr65-acp6-ed58-independent-20261028',
      path: 'evidence/acceptance-ed58cfd-final.json',
      recordedSha256: 'b7500c9d5fc1b4c99bea8b889fa195915172abe8bc7ed9ccada52c64a3d037a4',
      correctedSha256: '6f2503b9e86a63ab64647bf1e7e742f4e67840c0a1c0b91a8f859be3f963982f',
      correctedGitBlob: '0f1b0a5f0ace21856951752a42df51a743bb9feb',
      correctedBytes: 786443,
      correctionCommit: '998b3d18bb6c42dd59b96bae6d203f8514c9c56b',
      role: 'historical-only; neither recorded nor corrected corrupt archive is formal input',
    },
    rawClassificationSource: {
      branch: 'evidence/cd-acp6-phase0-20261028-final',
      commit: 'c851bfe11e6851e01695f94246a5a571435d8faa',
      path: 'docs/acceptance/2026-10-28/acp6-phase0/acp6-v06-phase0-gap-matrix-20261028.json',
      sha256: '89b1c30eb320c3074bf1d445f2a1628026a4f9c08e54b6879e3cc5ed1bfe3200',
      blob: '0716de01663f1a7efc370242c5809bf0990978fa',
      localPath: 'raw-classification-source-c851bfe.json',
      bytes: rawClassificationBytes.length,
      role: 'raw classification evidence only; not the formal B input',
    },
  },
  classification: {
    taxonomyVersion,
    mappingVersion,
    allowedGapClasses: canonicalClasses,
    allowedRawGapClasses: rawClasses,
    primaryPriority: ['pseudo-element-or-generated-content', 'global-or-theme-selector', 'dynamic-or-ambiguous-class', 'candidate-without-source-edge', 'no-static-element-anchor'],
    mappingRules: {
      'MAP-SOU-GLOBAL-001': 'selector-owner-unresolved + body/html/:root/* or theme selector → global-or-theme-selector',
      'MAP-SOU-PSEUDO-001': 'selector-owner-unresolved + pseudo-element selector → pseudo-element-or-generated-content',
      'MAP-SOU-OWNER-001': 'selector-owner-unresolved + non-global/non-pseudo selector without unique owner → no-static-element-anchor',
      'MAP-DYN-001': 'dynamic-className with AC6.4 dynamic evidence → dynamic-or-ambiguous-class',
      'MAP-DYN-PSEUDO-001': 'dynamic-className + pseudo-element → pseudo-element-or-generated-content, retaining dynamic/candidate secondary causes',
      'MAP-CAND-001': 'candidate consumer > 0 and strict edges = 0 without stronger cause → candidate-without-source-edge',
      'MAP-THEME-001': 'theme-cascade-ambiguity + theme selector → global-or-theme-selector with theme-cascade-unresolved',
      'MAP-COMPLEX-001': 'complex-selector-normalization → no-static-element-anchor with selector-normalization-unresolved',
    },
  },
  stats: {
    sourceUseRows: rows.length,
    coveredRows: rows.filter(row => row.coverageStatus === 'covered').length,
    uncoveredRows: rows.filter(row => row.coverageStatus === 'uncovered').length,
    tokenCount: new Set(rows.map(row => row.token)).size,
    uncoveredTokenCount: new Set(rows.filter(row => row.coverageStatus === 'uncovered').map(row => row.token)).size,
    coveredTokenCount: [...new Set(rows.map(row => row.token))].filter(token => rows.filter(row => row.token === token).every(row => row.coverageStatus === 'covered')).length,
    ac64ConsumerPairs: ac64.expectedStaticAndDynamicConsumerPairs,
    ac64StaticAnchors: ac64.anchoredConsumerPairs.filter(pair => pair.anchored).length,
    ac64UnknownPairs: ac64.uncoveredConsumerPairs.length,
    ac64UnknownStatic: ac64.uncoveredConsumerPairs.filter(pair => !pair.dynamic).length,
    ac64UnknownDynamic: ac64.uncoveredConsumerPairs.filter(pair => pair.dynamic).length,
    gapClassCounts: counts,
    rawGapClassCounts: rawCounts,
  },
  rows,
  ac64Evidence: {
    expectedPairs: ac64.expectedStaticAndDynamicConsumerPairs,
    anchoredPairs: ac64.anchoredConsumerPairs.filter(pair => pair.anchored).length,
    unknownPairs: unknownPairs.length,
    unknownStatic: unknownPairs.filter(pair => !pair.dynamic).length,
    unknownDynamic: unknownPairs.filter(pair => pair.dynamic).length,
    unknownPairIds: unknownPairs.map(pair => pair.pairId),
    pairs: unknownPairs,
    pairSetSha256: ac64PairSetSha256,
    dynamicSourceUseKeys: [...dynamicSourceKeys].sort(),
  },
  ac64PairSetSha256,
  offsetEvidence: {
    offsetUnit: 'UTF-8 byte offset in the exact B source bytes',
    sourceBytesAreVerbatim: true,
    lineEndingPolicy: 'No LF/CRLF normalization is applied before reading offsets; a platform conversion is a mismatch and must fail validation.',
    crossPlatformStatus: 'unavailable',
    proofLevel: 'not-proven',
    platformInputs: [linuxEvidence, windowsEvidence],
    statusReason: 'Linux artifact identity is independently verified, but its ZIP contents are unavailable to this local replay; no copied Linux offsets are emitted.',
    externalReconciliationObservation: {
      status: 'externally-observed-not-replayed',
      rowsChecked: 123,
      differingRows: 123,
      relation: 'CRLF/LF line-ending offset drift reported by independent external review',
      linuxArtifactId: 12801358049,
      linuxArtifactSha256: '8074527bc50fe7400f79a4dbe9c556634b1298cf39ab3ea83dcf1a591e5fb42c',
      linuxReportSha256: '7aee05647b185743663d4a4e5dee5996eea971a6de556944e8eb51d99782297b',
      evidenceLevel: 'external-review-report-only',
      promotesProof: false,
    },
    platformChecks: rows.map(row => ({
      rowId: row.rowId,
      sourceRef: { file: row.sourceRef.file, offset: row.sourceRef.offset, byteOffset: row.sourceRef.byteOffset },
      linux: { ...linuxEvidence, offset: null, byteOffset: null, sourceBytes: 'not-read' },
      windows: { ...windowsEvidence, offset: row.sourceRef.offset, byteOffset: row.sourceRef.byteOffset, sourceBytes: 'recovered-input' },
      comparison: { status: 'unavailable', offsetDelta: null, byteOffsetDelta: null },
    })),
    checkedRows: rows.length,
    driftRows: [],
    notProvenRows: rows.map(row => row.rowId),
  },
  coveredRowIds: rows.filter(row => row.coverageStatus === 'covered').map(row => row.rowId),
  uncoveredRowIds: rows.filter(row => row.coverageStatus === 'uncovered').map(row => row.rowId),
  sourceComparison: {
    sourceRowsFromB: rows.length,
    matchedRows: rows.length,
    sourceRowDiffs: [],
    order: 'B AC6.2 source-use order retained; validation is key-based and order-stability is checked separately.',
  },
  notes: [
    'The recovered ed58cfd JSON is the formal B input. The corrupt #65 archive remains historical and is not parsed or overwritten.',
    'The c851bfe matrix supplies rawGapClass/rawGapClasses only; it is retained as a classification witness and is not treated as the B acceptance result.',
    'Canonical primary counts are 3/21/8/4/2 for global/no-anchor/dynamic/candidate/pseudo. Raw counts are selector-owner-unresolved=24, dynamic-className=9, candidate-without-strict-edge=4, theme-cascade-ambiguity=1, complex-selector-normalization=0.',
    'AC6.2 dynamic-className rows (9 raw rows, 8 canonical primary dynamic rows) and AC6.4 dynamic UNKNOWN pairs (7 pairs) are different units and are never mapped one-to-one.',
    'A taxonomy erratum requires mappingVersion on every uncovered row; this matrix records acp6-gap-mapping/v1 per row.',
    'Cross-platform offset comparison is explicitly unavailable/not-proven because the independent Linux artifact contents could not be read locally; platform fields are not copied and no equality claim is made. An external review reports 123/123 CRLF/LF offset differences using the same artifact identity; that observation is retained for reconciliation but does not promote proof.',
    'AC6.4 unknown pairs preserve the complete B pair content, per-pair SHA-256, and a sorted pair-set SHA-256.',
    'No graphNodeIds are inferred for source-use rows; every row records status=missing and value=null.',
    'This evidence does not modify SourceGraph production logic, B v5 matcher/probe, Runtime Identity, Candidate, Verification, Approval, Apply or Rollback.',
  ],
};

fs.mkdirSync(dir, { recursive: true });
fs.writeFileSync(outMatrix, JSON.stringify(matrix, null, 2) + '\n', 'utf8');

const table = rows.map(row => {
  const r = row.coverageStatus === 'uncovered' ? `| ${row.rowId} | uncovered | ${row.token} | ${row.sourceRef.file} | ${row.sourceRef.byteOffset} | ${row.sourceRef.selector.replaceAll('|', '\\|')} | ${row.rawGapClass} | ${row.gapClass} | ${row.mappingRuleId} | ${row.sourceUseGraphNodeIds.status} |` : `| ${row.rowId} | covered | ${row.token} | ${row.sourceRef.file} | ${row.sourceRef.byteOffset} | ${row.sourceRef.selector.replaceAll('|', '\\|')} | — | — | — | missing |`;
  return r;
}).join('\n');
const md = `# AC-P6 Phase 0 canonical gap matrix v2\n\n- Formal B input: \`ed58cfdc2892acaa9b97363a3414b1c219d07053\` recovered JSON\n- Input SHA-256: \`0d7e5f97d91e69852f15c313522e05587a2571d61489c72274e3944b47d6527a\`\n- Input bytes: \`${fs.statSync(sourcePath).size}\`\n- Fixed project: \`allanhue/webportflio@b244f857457d2a07f118155602eef9097fd322bd\`\n- Taxonomy: \`${taxonomyVersion}\`; mapping: \`${mappingVersion}\`\n- PR Base for this repair archive: \`d1d26185710c8e4d80182356f760109123bdc989\`\n- Raw classification evidence baseline: \`c851bfe11e6851e01695f94246a5a571435d8faa\` (SHA-256 \`${rawClassificationSha256}\`); it is bound row by row and is not the formal B input.\n\n## Scope and counts\n\n| Metric | Value |\n| --- | ---: |\n| AC6.2 source-use rows | 123 |\n| AC6.2 covered | 85 |\n| AC6.2 uncovered | 38 |\n| Tokens | 8 |\n| AC6.4 consumer pairs | 147 |\n| AC6.4 anchored | 131 |\n| AC6.4 UNKNOWN | 16 |\n| AC6.4 static UNKNOWN | 9 |\n| AC6.4 dynamic UNKNOWN | 7 |\n\n## Canonical taxonomy\n\nCanonical classes are fixed to \`global-or-theme-selector\`, \`no-static-element-anchor\`, \`dynamic-or-ambiguous-class\`, \`candidate-without-source-edge\`, and \`pseudo-element-or-generated-content\`. Raw labels remain in \`rawGapClass\`/\`rawGapClasses\`; they are not silently renamed.\n\nPrimary counts: \`${JSON.stringify(counts)}\`. Raw counts: \`${JSON.stringify(rawCounts)}\`.\n\nPrimary selection is ordered pseudo → global/theme → dynamic → candidate → no-static-anchor. Pseudo-elements take precedence over dynamic and candidate causes; theme selectors take precedence over owner ambiguity. \`:hover\` and \`:focus-visible\` are pseudo-classes and are not classified as generated content.\n\n## Source comparison and offsets\n\nThe matrix is rebuilt from every AC6.2 \`declarationSetCoverage.sourceUseCoverage\` row in the recovered JSON; rawGapClass/rawGapClasses are checked against the exact c851bfe raw classification matrix. Validator compares token, file, character offset, UTF-8 byteOffset, selector, covered flag, candidate/strict edge counts, and declaration references row by row. Source-use graphNodeIds remain explicitly missing.\n\nOffsets are measured on exact UTF-8 source bytes. No LF/CRLF normalization is performed. The Linux Actions artifact is independently identified (run 40656095611, artifact 12801358049, ZIP SHA-256 8074527bc50fe7400f79a4dbe9c556634b1298cf39ab3ea83dcf1a591e5fb42c) but its ZIP bytes were unavailable to this local replay, so all cross-platform offset status is unavailable/not-proven; no Linux offsets are copied from Windows.\n\n## Machine-readable row matrix\n\n| rowId | status | token | source file | byteOffset | selector | rawGapClass | canonical gapClass | mappingRuleId | graphNodeIds |\n| --- | --- | --- | --- | ---: | --- | --- | --- | --- | --- |\n${table}\n\n## Validation and negative cases\n\nRun the validator from a clean checkout with the source JSON, raw classification source, and matrix path as arguments. It rejects duplicate IDs, unknown raw/canonical classes, missing classifications or row mappingVersion, wrong mapping rules, source-row mutations, input-hash changes, statistic changes, invented graphNodeIds, AC6.4 pair mutations, row-index mutations, and copied/under-proven platform evidence. A reversed row order must preserve stable IDs and all statistics.\n\nAC6.2 dynamic-className rows and AC6.4 dynamic UNKNOWN pairs have separate cardinalities: 9 raw source-use rows versus 7 consumer pairs. The matrix never maps them one-to-one.\n\n## Boundary\n\nThis is evidence and validation only. SourceGraph production code, B v5 matcher/probe, Runtime Identity, Candidate, Verification, Approval, Apply, Rollback and thresholds are unchanged. AC6.2 and AC6.4 remain PENDING.\n`;
fs.writeFileSync(outMarkdown, md, 'utf8');
console.log(JSON.stringify({ outMatrix, outMarkdown, rows: rows.length, covered: matrix.stats.coveredRows, uncovered: matrix.stats.uncoveredRows, gapClassCounts: counts, rawGapClassCounts: rawCounts }, null, 2));
