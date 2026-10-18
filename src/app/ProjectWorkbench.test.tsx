import { describe, expect, it } from 'vitest'
import { render, screen } from '@testing-library/react'
import ProjectWorkbench from './ProjectWorkbench'

describe('Project-first workbench surface', () => {
  it('starts with a real local-project flow and does not present Fixture data as project state', () => {
    render(<ProjectWorkbench />)
    expect(screen.getByRole('heading', { name: /从真实源码开始/ })).toBeTruthy()
    expect(screen.getByLabelText('Git 项目目录')).toBeTruthy()
    expect((screen.getByRole('button', { name: /分析工程/ }) as HTMLButtonElement).disabled).toBe(true)
    expect(screen.queryByText(/Qingye|Qiguang|第三方案例|CaseFixture/i)).toBeNull()
    expect(screen.queryByRole('button', { name: /应用|批准|浏览器预演/ })).toBeNull()
    expect(screen.queryByTestId('verification-contract')).toBeNull()
  })
})
