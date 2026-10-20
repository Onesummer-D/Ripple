import { describe, expect, it } from 'vitest'
import { snapshotCoverageFailure } from './verification-runner'

describe('snapshot coverage failure gate', () => {
  it('returns undefined when at least one resource was snapshotted', () => {
    expect(snapshotCoverageFailure({ snapshots: [{}], unavailable: [{ url: 'https://a.example/x.css', reason: 'dns' }] })).toBeUndefined()
  })

  it('returns undefined when nothing was authorized and nothing failed', () => {
    expect(snapshotCoverageFailure({ snapshots: [], unavailable: [] })).toBeUndefined()
  })

  it('fails fast when every authorized resource is unavailable, with reasons', () => {
    const unavailable = [
      { url: 'https://fonts.googleapis.com/css2?family=Roboto', reason: 'Resource host does not resolve exclusively to public IP addresses.' },
      { url: 'https://images.pexels.com/photos/1/p.jpeg', reason: 'Authorized resource request timed out.' },
    ]
    const message = snapshotCoverageFailure({ snapshots: [], unavailable })
    expect(message).toContain('全部 2 个授权外部资源快照失败')
    expect(message).toContain('https://fonts.googleapis.com/css2?family=Roboto')
    expect(message).toContain('public IP')
    expect(message).toContain('pexels')
  })

  it('bounds the reason list and points at the full fetch log', () => {
    const unavailable = Array.from({ length: 12 }, (_, index) => ({ url: `https://images.pexels.com/photos/${index}/p.jpeg`, reason: 'boom' }))
    const message = snapshotCoverageFailure({ snapshots: [], unavailable })!
    expect(message).toContain('全部 12 个授权外部资源快照失败')
    expect(message).toContain('另外 4 条')
    expect(message).toContain('resource-fetch-log.json')
  })
})
