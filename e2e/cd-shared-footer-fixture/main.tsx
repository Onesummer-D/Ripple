import { useState } from 'react'
import { createRoot } from 'react-dom/client'

function Footer() {
  return <footer><p data-testid="shared-footer">Shared footer text</p></footer>
}

function HomePage() {
  return <main><h1>Home Title</h1><Footer /></main>
}

function AboutPage() {
  return <main><h1>About Title</h1><Footer /></main>
}

export function App() {
  const [page, setPage] = useState('home')
  return <div>
    <button data-testid="switch-page" onClick={() => setPage(current => current === 'home' ? 'about' : 'home')}>Switch page</button>
    {page === 'home' && <HomePage />}
    {page === 'about' && <AboutPage />}
  </div>
}

createRoot(document.getElementById('root')).render(<App />)
