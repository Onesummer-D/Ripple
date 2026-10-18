import { useState } from 'react'
import { createRoot } from 'react-dom/client'

function ProductCard({ product }) {
  return <article data-testid={`card-${product.id}`}><span>{product.name}</span></article>
}

function UnkeyedCard({ label }) {
  return <aside data-testid={`unkeyed-${label}`}>{label}</aside>
}

function App() {
  const [products, setProducts] = useState([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }])
  const [labels, setLabels] = useState(['Raw Alpha', 'Raw Beta'])
  const [unkeyedLabels, setUnkeyedLabels] = useState(['Component Alpha', 'Component Beta'])
  const [visible, setVisible] = useState(true)
  const [page, setPage] = useState('catalog')
  return <main>
    <button id="reorder" onClick={() => setProducts(current => [...current].reverse())}>Reorder</button>
    <button id="reorder-raw" onClick={() => setLabels(current => [...current].reverse())}>Reorder raw list</button>
    <button id="reorder-components" onClick={() => setUnkeyedLabels(current => [...current].reverse())}>Reorder unkeyed components</button>
    <button id="toggle" onClick={() => setVisible(current => !current)}>Toggle</button>
    <button id="page" onClick={() => setPage(current => current === 'catalog' ? 'featured' : 'catalog')}>Switch page</button>
    {visible && page === 'catalog' && <section>{products.map(product => <ProductCard key={product.id} product={product} />)}</section>}
    {visible && page === 'featured' && <section>{products.filter(product => product.id === 'a').map(product => <ProductCard key={product.id} product={product} />)}</section>}
    <aside>{labels.map(label => <div data-testid={`raw-${label}`}><span>{label}</span></div>)}</aside>
    <section>{unkeyedLabels.map(label => <UnkeyedCard label={label} />)}</section>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
