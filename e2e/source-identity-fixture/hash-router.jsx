import { memo, useState } from 'react'
import { createRoot } from 'react-dom/client'
import { HashRouter, useLocation, useNavigate } from 'react-router-dom'

function Pinned({ epoch }) {
  window.__hashPinnedRenders = (window.__hashPinnedRenders ?? 0) + 1
  return <b data-testid="hash-pinned">Pinned {epoch}</b>
}
const MemoPinned = memo(Pinned)

function RouteControls() {
  const location = useLocation()
  const navigate = useNavigate()
  return <>
    <output data-testid="hash-route">{location.pathname}</output>
    <button type="button" onClick={() => navigate('/products')}>Go products</button>
  </>
}

function App() {
  const [epoch, setEpoch] = useState(0)
  return <main>
    <output data-testid="hash-document-location">{window.location.hash}</output>
    <button type="button" onClick={() => setEpoch(value => value + 1)}>Render memo again</button>
    <MemoPinned epoch={epoch} />
    <HashRouter><RouteControls /></HashRouter>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
