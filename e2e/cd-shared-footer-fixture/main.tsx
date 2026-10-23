import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HomePage } from './pages/HomePage'
import { AboutPage } from './pages/AboutPage'

export function App() {
  const [page, setPage] = useState('home')
  return <div>
    <button data-testid="switch-page" onClick={() => setPage(current => current === 'home' ? 'about' : 'home')}>Switch page</button>
    {page === 'home' && <HomePage />}
    {page === 'about' && <AboutPage />}
  </div>
}

createRoot(document.getElementById('root')!).render(<App />)
