import React from 'react'
import ReactDOM from 'react-dom/client'
import { ExperienceWorkbench } from './app/experience/experience-workbench'
import { createDemoAdapter } from './app/experience/demo-adapter'
import { createRealAdapter } from './app/experience/real-adapter'
import { createStubRealAdapter } from './app/experience/stub-real-adapter'
import './app/experience/ripple-xp.css'

const params = new URLSearchParams(window.location.search)
const adapterParam = params.get('adapter')

// ?adapter=real-stub 仅用于真实/演示隔离的自动化验证（见 stub-real-adapter.ts 头注释）。
// ?adapter=real 启动真实适配器（连接 /__ripple/api），可用 &project=<本机工程目录> 直接打开工程；
// 未提供 project 时工作台显示"打开工程"入口，由用户在真实模式下选择 React/Vite 项目。
// 默认仍为青野演示适配器，旧体验与测试不受影响。
const adapter = adapterParam === 'real-stub'
  ? createStubRealAdapter()
  : adapterParam === 'real'
    ? createRealAdapter({ projectRoot: params.get('project') ?? undefined })
    : createDemoAdapter()

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExperienceWorkbench adapter={adapter} />
  </React.StrictMode>,
)
