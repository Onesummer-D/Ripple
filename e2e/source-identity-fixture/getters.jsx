import { StrictMode, useState } from 'react'
import { createRoot } from 'react-dom/client'

// Every key below runs observable code when it is read or converted. The page must see
// exactly the same number of reads with and without Ripple's annotation.
const reads = (window.__keyReads = { getter: 0, element: 0, proxy: 0, toString: 0, toPrimitive: 0, template: 0, optional: 0, nested: 0 })
const makeItem = id => ({
  get id() { reads.getter += 1; return id },
  get code() { reads.element += 1; return `code-${id}` },
  get slug() { reads.template += 1; return `slug-${id}` },
  get meta() { reads.optional += 1; return { uid: `uid-${id}` } },
  token: { toString() { reads.toString += 1; return `token-${id}` } },
  prim: { [Symbol.toPrimitive]() { reads.toPrimitive += 1; return `prim-${id}` } },
  get cells() { return [{ get id() { reads.nested += 1; return `${id}-x` } }] },
})
const proxied = id => new Proxy({ id }, { get(target, property) { if (property === 'id') reads.proxy += 1; return target[property] } })

function Card({ label }) {
  const [clicks, setClicks] = useState(0)
  return <button type="button" data-testid={`card-${label}`} onClick={() => setClicks(value => value + 1)}>{label}:{clicks}</button>
}

function App() {
  const [items, setItems] = useState(() => ['a', 'b'].map(makeItem))
  const [proxies, setProxies] = useState(() => ['x', 'y'].map(proxied))
  const [count, setCount] = useState(0)
  return <main>
    <button type="button" onClick={() => setCount(value => value + 1)}>Bump</button>
    <button type="button" onClick={() => { setItems(list => [...list].reverse()); setProxies(list => [...list].reverse()) }}>Reverse</button>
    <ul>{items.map(item => <li key={item.id} data-testid={`getter-${item.id === 'a' ? 'a' : 'b'}`}><span>{count}</span></li>)}</ul>
    <ol>{items.map(item => <li key={item['code']}>code</li>)}</ol>
    <dl>{items.map(item => <dt key={item.token} data-testid="token-key">token</dt>)}</dl>
    <dl>{items.map(item => <dd key={item.prim}>prim</dd>)}</dl>
    <p>{items.map(item => <i key={`${item.slug}`}>slug</i>)}</p>
    <p>{items.map(item => <b key={item.meta?.uid}>meta</b>)}</p>
    <table><tbody>{items.map(item => <tr key={item.id}>{item.cells.map(cell => <td key={cell.id}>cell</td>)}</tr>)}</tbody></table>
    <section>{proxies.map(entry => <Card key={entry.id} label={entry.id} />)}</section>
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
