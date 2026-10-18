export const projectPreviewViewports = [
  { name: 'desktop', label: '桌面', width: 1440, height: 900 },
  { name: 'tablet', label: '平板', width: 768, height: 1024 },
  { name: 'mobile-375', label: '手机 · 375', width: 375, height: 812 },
  { name: 'mobile-390', label: '手机 · 390', width: 390, height: 844 },
] as const

export type ProjectPreviewViewport = (typeof projectPreviewViewports)[number]
