const DEFAULT_SAMPLE_LIMIT = 25
const DEFAULT_MESSAGE_LIMIT = 500

export function redactMessage(value, limit = DEFAULT_MESSAGE_LIMIT) {
  // Bound the input before the patterns run: messages can be hundreds of KB.
  return String(value).slice(0, limit * 4)
    // Playwright messages embed full request URLs; their query strings and
    // fragments can carry signed tokens that a key-name pattern cannot catch.
    .replace(/\b(https?:\/\/[^\s?#'"<>]+)[?#][^\s'"<>]*/gi, '$1')
    .replace(/(authorization|bearer|token|secret|password|api[_-]?key)(\s*[:=]\s*|\s+)[^\s,;]+/gi, '$1=<redacted>')
    .slice(0, limit)
}

export function safeUrl(value) {
  if (!value) return ''
  try {
    const parsed = new URL(String(value))
    return `${parsed.origin}${parsed.pathname}`
  } catch {
    return ''
  }
}

export function createBrowserErrorAccumulator(options = {}) {
  const sampleLimit = Number.isInteger(options.sampleLimit) && options.sampleLimit > 0 ? options.sampleLimit : DEFAULT_SAMPLE_LIMIT
  const messageLimit = Number.isInteger(options.messageLimit) && options.messageLimit > 0 ? options.messageLimit : DEFAULT_MESSAGE_LIMIT
  let total = 0
  const byCategory = Object.create(null)
  const samples = []
  const sampleKeys = new Set()

  return {
    add(category, message, context = {}) {
      const normalizedCategory = String(category || 'unknown').slice(0, 80)
      const normalizedMessage = redactMessage(message, messageLimit)
      total += 1
      byCategory[normalizedCategory] = (byCategory[normalizedCategory] ?? 0) + 1
      const url = safeUrl(context.url)
      const viewport = context.viewport && Number.isInteger(context.viewport.width) && Number.isInteger(context.viewport.height)
        ? ` ${context.viewport.width}x${context.viewport.height}`
        : ''
      const phase = context.phase ? ` ${String(context.phase).slice(0, 80)}` : ''
      const sample = `[${normalizedCategory}]${viewport}${phase}${url ? ` ${url}` : ''}: ${normalizedMessage}`
      if (samples.length < sampleLimit && !sampleKeys.has(sample)) {
        sampleKeys.add(sample)
        samples.push(sample)
      }
    },
    snapshot() {
      return {
        total,
        byCategory: { ...byCategory },
        samples: [...samples],
        truncated: total > samples.length,
      }
    },
  }
}

