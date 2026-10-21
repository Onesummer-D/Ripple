import { useState } from 'react'
import { createRoot } from 'react-dom/client'
import { Row } from './Row'
import { Cell } from './cells'
import { Badge } from './Badge'

function CrossApp() {
  const [items, setItems] = useState([{ id: 'a', label: 'A' }])
  return <main>
    <button type="button" onClick={() => setItems(list => [...list, { id: `n${list.length}`, label: `N${list.length}` }])}>Add row</button>
    <ul>{items.map(Row)}</ul>
    <table><tbody><tr>{items.map(Cell)}</tr></tbody></table>
    <Badge text={`${items.length} rows`} />
  </main>
}

createRoot(document.getElementById('root')!).render(<CrossApp />)
