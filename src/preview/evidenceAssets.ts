export const evidenceAssetHref = (value?: string): string | undefined => {
  if (!value || value.startsWith('unknown://')) return undefined
  if (/^https?:\/\//i.test(value)) return value
  if (/^[a-z]+:/i.test(value) || value.startsWith('//') || value.includes('\\')) return undefined
  return '/' + value.replace(/^\.\//, '').replace(/^\/+/, '')
}
