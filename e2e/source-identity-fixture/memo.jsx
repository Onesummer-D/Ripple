import { memo, useState } from 'react'
import { createRoot } from 'react-dom/client'

// A deep-equal comparator over the element tree it receives: it bails out only when every
// prop of every child element is equal. Annotation must not defeat it or rewrite attributes.
const deepEqual = (left, right) => {
  if (Object.is(left, right)) return true
  if (typeof left !== 'object' || typeof right !== 'object' || !left || !right) return false
  if (Object.getPrototypeOf(left) !== Object.getPrototypeOf(right)) return false
  const keys = Object.keys(left)
  if (keys.length !== Object.keys(right).length) return false
  return keys.every(key => key === '_owner' || key === '_store' || deepEqual(left[key], right[key]))
}
window.__frameRenders = 0
const Frame = memo(function Frame({ rows }) {
  window.__frameRenders += 1
  return <section data-testid="stable-frame">{rows}</section>
}, (previous, next) => deepEqual(previous, next))

const items = [{ id: 'a' }, { id: 'b' }]
function App() {
  const [ticks, setTicks] = useState(0)
  return <main>
    <button type="button" onClick={() => setTicks(value => value + 1)}>Tick</button>
    <output data-testid="ticks">{ticks}</output>
    <Frame rows={items.map(item => <p key={item.id} data-testid={`memo-row-${item.id}`}><span>{item.id}</span></p>)} />
    <ul>{items.map(item => <li key={item.id}><b>{item.id}</b></li>)}</ul>
  </main>
}

createRoot(document.getElementById('root')).render(<App />)
