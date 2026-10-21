import React from 'react'
import ReactDOM from 'react-dom/client'
import { ExperienceWorkbench } from './app/experience/experience-workbench'
import { createDemoAdapter } from './app/experience/demo-adapter'
import { createStubRealAdapter } from './app/experience/stub-real-adapter'
import './app/experience/ripple-xp.css'

// ?adapter=real-stub 仅用于真实/演示隔离的自动化验证（见 stub-real-adapter.ts 头注释）。
const stubReal = new URLSearchParams(window.location.search).get('adapter') === 'real-stub'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExperienceWorkbench adapter={stubReal ? createStubRealAdapter() : createDemoAdapter()} />
  </React.StrictMode>,
)
