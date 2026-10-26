// 版本胶片组件级测试：交互结构（无嵌套按钮）与 Real 无截图的诚实占位。
// 对应 RC1 审查 P1-1 / P1-2 的补正验证。
import { cleanup, render, screen } from '@testing-library/react'
import { afterEach, describe, expect, it } from 'vitest'
import { VersionFilmstrip } from './version-filmstrip'
import type { ExperienceViewModel, VersionItemXp } from '../view-model'

afterEach(cleanup)

function modelWith(versions: VersionItemXp[]): ExperienceViewModel {
  return {
    dataProvenance: 'real',
    pages: [],
    versions,
    selectedElement: null,
    draftAfterText: '',
  } as unknown as ExperienceViewModel
}

const base: VersionItemXp = {
  id: 'candidate-1',
  title: '候选 a1b2c3d4',
  lifecycle: 'applied',
  updatedAt: '刚刚',
  summary: '验证已通过',
  pageRef: '',
  evidenceAvailable: true,
  evidenceState: 'metadata',
  evidenceList: ['2 项验证断言（未归档截图）'],
}

describe('VersionFilmstrip · 交互结构（P1-1）', () => {
  it('卡片为 article，内部两个独立 button，无 button 套 button / role=button 嵌套', () => {
    render(<VersionFilmstrip model={modelWith([base])} activeVersionId="candidate-1" onSelect={() => {}} />)
    const card = screen.getByTestId('version-card-candidate-1')
    expect(card.tagName).toBe('ARTICLE')
    const buttons = Array.from(card.querySelectorAll('button'))
    expect(buttons.map(item => item.getAttribute('data-testid'))).toEqual(['version-candidate-1', 'evidence-toggle-candidate-1'])
    for (const button of buttons) {
      expect(button.parentElement?.tagName).not.toBe('BUTTON')
      expect(button.getAttribute('role')).toBeNull() // 原生 button，不叠 role=button
    }
  })
})

describe('VersionFilmstrip · Real 无截图诚实占位（P1-2）', () => {
  it('evidenceState=metadata 时显示「仅有证据元数据 · 截图未归档」与「未归档真实截图」占位，绝不渲染任何 img', () => {
    render(<VersionFilmstrip model={modelWith([base])} activeVersionId="candidate-1" onSelect={() => {}} />)
    const card = screen.getByTestId('version-card-candidate-1')
    expect(card.textContent).toContain('仅有证据元数据')
    expect(card.textContent).toContain('截图未归档')
    expect(screen.getByTestId('film-shot-none-candidate-1').textContent).toBe('未归档真实截图')
    // 禁止任何图像：无归档截图时不得回退 Demo 素材图，也不得留 broken img
    expect(card.querySelectorAll('img').length).toBe(0)
  })

  it('evidenceState=archived 时缩略图 source 必须是 real-artifact，且带「真实截图」来源标注', () => {
    const withShot: VersionItemXp = {
      ...base,
      evidenceState: 'archived',
      thumbnail: { url: '/__ripple/api/candidate/candidate-1/evidence/ev-1', source: 'real-artifact' },
    }
    render(<VersionFilmstrip model={modelWith([withShot])} activeVersionId="candidate-1" onSelect={() => {}} />)
    const card = screen.getByTestId('version-card-candidate-1')
    const img = card.querySelector('img')
    expect(img).not.toBeNull()
    expect(img!.getAttribute('src')).toContain('/__ripple/api/')
    expect(img!.getAttribute('src')).not.toContain('demo-assets')
    expect(screen.getByTestId('film-src-real-candidate-1').textContent).toBe('真实截图')
  })

  it('真实模式下即使 thumbnail.source=demo-art 也不得渲染图片（防 Demo 素材混入真实历史）', () => {
    const polluted: VersionItemXp = {
      ...base,
      evidenceState: 'archived',
      thumbnail: { url: 'demo-assets/workshop.jpg', source: 'demo-art' },
    }
    render(<VersionFilmstrip model={modelWith([polluted])} activeVersionId="candidate-1" onSelect={() => {}} />)
    const card = screen.getByTestId('version-card-candidate-1')
    expect(card.querySelectorAll('img').length).toBe(0)
    expect(screen.getByTestId('film-shot-none-candidate-1')).not.toBeNull()
  })
})
