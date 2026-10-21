import React from 'react'
import ReactDOM from 'react-dom/client'
import { ExperienceWorkbench } from './app/experience/experience-workbench'
import './app/experience/ripple-xp.css'

ReactDOM.createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <ExperienceWorkbench />
  </React.StrictMode>,
)
