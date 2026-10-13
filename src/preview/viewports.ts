export const previewViewports = [
  { width: 375, height: 812, label: '375 × 812' },
  { width: 768, height: 1024, label: '768 × 1024' },
  { width: 1440, height: 900, label: '1440 × 900' },
] as const

export type PreviewViewport = (typeof previewViewports)[number]

export const viewportForEvidence = (value: string): PreviewViewport | undefined => {
  const width = /^(375|768|1440)(?:\s*[x×]\s*\d+)?$/.exec(value)?.[1]
  return previewViewports.find((viewport) => String(viewport.width) === width)
}
