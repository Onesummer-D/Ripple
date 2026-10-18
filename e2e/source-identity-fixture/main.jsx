import { useState } from 'react'
import { createRoot } from 'react-dom/client'

function ProductCard({ product }) {
  return <article data-testid={`card-${product.id}`}><span>{product.name}</span></article>
}

function App() {
  const [products, setProducts] = useState([{ id: 'a', name: 'Alpha' }, { id: 'b', name: 'Beta' }])
  const [visible, setVisible] = useState(true)
  const [page, setPage] = useState('catalog')
  return <main>
    <button id="reorder" onClick={() => setProducts(current => [...current].reverse())}>Reorder</button>
    <button id="toggle" onClick={() => setVisible(current => !current)}>Toggle</button>
    <button id="page" onClick={() => setPage(current => current === 'catalog' ? 'featured' : 'catalog')}>Switch page</button>
    {visible && page === 'catalog' && <section>{products.map(product => <ProductCard key={product.id} product={product} />)}</section>}
    {visible && page === 'featured' && <section>{products.filter(product => product.id === 'a').map(product => <ProductCard key={product.id} product={product} />)}</section>}
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
