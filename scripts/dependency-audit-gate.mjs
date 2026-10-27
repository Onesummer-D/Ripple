import fs from 'node:fs'

const SEVERITIES = ['info', 'low', 'moderate', 'high', 'critical', 'total']

export function validateAuditReport(report, { label, outcome }) {
  const failures = []

  if (outcome !== 'success') failures.push(`audit step outcome was ${outcome ?? 'missing'}`)
  if (!report || typeof report !== 'object' || Array.isArray(report)) {
    failures.push('report is not a JSON object')
  }

  const counts = report?.metadata?.vulnerabilities
  if (!counts || typeof counts !== 'object' || Array.isArray(counts)) {
    failures.push('metadata.vulnerabilities is missing')
  } else {
    for (const severity of SEVERITIES) {
      if (!Number.isInteger(counts[severity]) || counts[severity] < 0) {
        failures.push(`metadata.vulnerabilities.${severity} is not a non-negative integer`)
      }
    }

    if (SEVERITIES.every((severity) => Number.isInteger(counts[severity]) && counts[severity] >= 0)) {
      const sum = SEVERITIES.slice(0, -1).reduce((total, severity) => total + counts[severity], 0)
      if (counts.total !== sum) failures.push(`metadata.vulnerabilities.total ${counts.total} does not equal severity sum ${sum}`)
      if (counts.total !== 0) failures.push(`vulnerability total is ${counts.total}`)
    }
  }

  if (report?.error) failures.push(`audit endpoint error: ${report.error.summary ?? report.error.code ?? 'unknown error'}`)
  if (failures.length > 0) throw new Error(`${label}: ${failures.join('; ')}`)
}

function readReport(path, label) {
  let report
  try {
    report = JSON.parse(fs.readFileSync(path, 'utf8'))
  } catch (error) {
    throw new Error(`${label}: report is not valid JSON (${error.message})`)
  }
  return report
}

function validateFiles([allPath, productionPath], outcomes) {
  validateAuditReport(readReport(allPath, 'all dependencies'), {
    label: 'all dependencies',
    outcome: outcomes.all,
  })
  validateAuditReport(readReport(productionPath, 'production dependencies'), {
    label: 'production dependencies',
    outcome: outcomes.production,
  })
  console.log('Dependency audit gate passed: all and production vulnerability totals are 0.')
}

function expectRejected(label, report, outcome = 'success') {
  try {
    validateAuditReport(report, { label, outcome })
  } catch (error) {
    console.log(`Negative audit fixture rejected as expected: ${error.message}`)
    return
  }
  throw new Error(`Negative audit fixture was accepted unexpectedly: ${label}`)
}

export function runNegativeExamples() {
  const zeroCounts = { info: 0, low: 0, moderate: 0, high: 0, critical: 0, total: 0 }
  expectRejected('non-zero vulnerability fixture', {
    metadata: { vulnerabilities: { ...zeroCounts, critical: 1, total: 1 } },
  })
  expectRejected('audit endpoint error fixture', {
    error: { code: 'EAI_AGAIN', summary: 'registry unavailable' },
  })
}

if (process.argv[2] === '--self-test') {
  runNegativeExamples()
} else {
  const [allPath, productionPath] = process.argv.slice(2)
  if (!allPath || !productionPath) {
    console.error('Usage: node scripts/dependency-audit-gate.mjs <all-report.json> <production-report.json>')
    process.exitCode = 2
  } else {
    validateFiles([allPath, productionPath], {
      all: process.env.AUDIT_ALL_OUTCOME,
      production: process.env.AUDIT_PROD_OUTCOME,
    })
  }
}
