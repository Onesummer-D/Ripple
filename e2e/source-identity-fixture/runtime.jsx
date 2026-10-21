import { Children, StrictMode, cloneElement, isValidElement, memo, useState, useSyncExternalStore } from 'react'
import { createRoot } from 'react-dom/client'
import { Repeat } from './repeat.js'

const initialProducts = [{ id: 'p1', name: 'Pot' }, { id: 'p2', name: 'Vase' }, { id: 'p3', name: 'Bowl' }]
const moduleNote = <small data-testid="module-note">Module-level JSX</small>
const keyFor = product => product.id
const shelfArray = ['clay', 'glaze']
const shelfObject = { clay: 'Clay', glaze: 'Glaze' }
let pinnedRenders = 0

function Card({ prefix, product }) {
  return <article data-testid={`${prefix}-${product.id}`}><h3 data-testid={`${prefix}-title-${product.id}`}>{product.name}</h3></article>
}
function IndexCard({ product }) {
  return <article data-testid={`index-card-${product.id}`}>{product.name}</article>
}
function Leaf({ n }) {
  return <i data-testid={`leaf-${n}`}>Leaf {n}</i>
}
function Banner({ label }) {
  return <p data-testid={`banner-${label}`}>{label}</p>
}
function Pinned() {
  pinnedRenders += 1
  window.__pinnedRenders = pinnedRenders
  return <b data-testid="pinned">Pinned</b>
}
const MemoPinned = memo(Pinned)
function Twice({ children }) {
  return <div data-testid="twice">{children}{children}</div>
}
// Stand-ins for libraries that inspect their children or props elements
// (react-router <Routes>, tab lists, icon slots). Annotation must not change them.
function RouteStub() { return null }
function RouteList({ children }) {
  const paths = []
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    if (child.type !== RouteStub) throw new Error('RouteList only accepts RouteStub children')
    paths.push(child.props.path)
  })
  return <p data-testid="route-list">{paths.join(',')}</p>
}
function TabStub() { return null }
function TabList({ children }) {
  return <ul data-testid="tab-list">{Children.map(children, child => <li>{child.props.title}</li>)}</ul>
}
function Icon({ size = 'default' }) {
  return <i data-testid="icon-size">{size}</i>
}
function IconButton({ icon }) {
  return <button type="button">{cloneElement(icon, { size: 'small' })}</button>
}
// Hookless capitalized function the app calls as a plain function (legal React).
function PlainRow(product) {
  return <dt data-testid={`plain-${product.id}`}>{product.name}</dt>
}
// Concise arrow component returning a component, and siblings without whitespace:
// both put two annotation insertions at the same source offset.
const ConciseShell = () => <Banner label="concise" />
function Shadowed() {
  // eslint-disable-next-line no-unused-vars
  const Shadowed = 'shadowed'
  return <span data-testid="shadowed">shadowed</span>
}
function Panel({ label, children }) {
  return <section data-testid={`panel-${label}`}>{children}</section>
}
function Counter({ id }) {
  const [clicks, setClicks] = useState(0)
  return <button type="button" data-testid={`counter-${id}`} onClick={() => setClicks(value => value + 1)}>{id}:{clicks}</button>
}
function Frame({ children }) {
  return <span className="frame">{children}</span>
}
function Framed({ children }) {
  return <div data-testid="framed">{Children.map(children, child => <Frame>{child}</Frame>)}</div>
}

const subscribe = notify => {
  window.addEventListener('popstate', notify)
  window.addEventListener('ripple-fixture:navigate', notify)
  return () => {
    window.removeEventListener('popstate', notify)
    window.removeEventListener('ripple-fixture:navigate', notify)
  }
}
const navigate = to => {
  window.history.pushState(null, '', to)
  window.dispatchEvent(new Event('ripple-fixture:navigate'))
}
function CatalogPage({ products }) {
  return <section data-testid="catalog-page">{products.map(product => <Card key={product.id} prefix="route-card" product={product} />)}</section>
}
function FeaturedPage({ products }) {
  return <section data-testid="featured-page">{products.slice(0, 1).map(product => <Card key={product.id} prefix="route-card" product={product} />)}</section>
}

function App() {
  const path = useSyncExternalStore(subscribe, () => window.location.pathname)
  const [products, setProducts] = useState(initialProducts)
  const [labels, setLabels] = useState(['L1', 'L2', 'L3'])
  const [visible, setVisible] = useState(true)
  const [count, setCount] = useState(0)
  const renderRow = product => <u data-testid={`row-${product.id}`}>{product.name}</u>
  const repeatedBadge = <mark data-testid="dup-badge">Repeated</mark>
  const check = <span data-testid="check">✓</span>
  const looped = []
  for (const product of products) looped.push(<s key={product.id} data-testid={`loop-${product.id}`}>{product.name}</s>)
  return <main>
    <nav>
      <button onClick={() => setProducts(current => [...current].reverse())}>Reverse products</button>
      <button onClick={() => setLabels(current => [...current].reverse())}>Reverse labels</button>
      <button onClick={() => setVisible(current => !current)}>Toggle keyed</button>
      <button onClick={() => setCount(current => current + 1)}>Bump</button>
      <button onClick={() => setProducts(current => current.map(product => product.id === 'p1' ? { ...product, name: `${product.name}!` } : product))}>Rename p1</button>
      <button onClick={() => setProducts(current => [...current, { id: `p${current.length + 1}`, name: 'Added' }])}>Add product</button>
      <button onClick={() => navigate('/catalog')}>Go catalog</button>
      <button onClick={() => navigate('/featured')}>Go featured</button>
    </nav>
    <h1 data-testid="static-title">Runtime identity</h1>
    <output data-testid="count">{count}</output>
    {count > 0 ? <b data-testid="bumped">Bumped</b> : <i data-testid="not-bumped">Not bumped</i>}
    <MemoPinned />
    <Banner label="shell" />
    <section data-testid="adjacent"><Banner label="left" /><Banner label="right" /><ConciseShell /></section>
    {path === '/featured' ? <FeaturedPage products={products} /> : <CatalogPage products={products} />}
    {visible && <section data-testid="keyed">{products.map(product => <Card key={product.id} prefix="keyed" product={product} />)}</section>}
    <section data-testid="index-keys">
      {products.map((product, index) => <IndexCard key={index} product={product} />)}
      <ol>{products.map((product, index) => <li key={`row-${index}`} data-testid={`index-li-${product.id}`}>{product.name}</li>)}</ol>
    </section>
    <ul data-testid="raw">{labels.map(label => <li data-testid={`raw-${label}`}>{label}</li>)}</ul>
    <section data-testid="unproven-keys">
      {products.map(product => <em key={Math.random()} data-testid={`random-${product.id}`}>{product.name}</em>)}
      {products.map(product => <dfn key={keyFor(product)} data-testid={`helper-${product.id}`}>{product.name}</dfn>)}
      {products.map(product => {
        const position = products.indexOf(product)
        return <dd key={position} data-testid={`position-${product.id}`}>{product.name}</dd>
      })}
    </section>
    <section data-testid="state-keys">
      {products.flatMap(product => [<Counter key={product.id} id={`flat-${product.id}`} />, <hr key={`${product.id}-rule`} />])}
      {products.map(product => product.id === 'p2' ? <i data-testid="mixed-hidden">hidden</i> : <Counter key={product.id} id={`mixed-${product.id}`} />)}
      <Framed>{products.map(product => <Counter key={product.id} id={`framed-${product.id}`} />)}</Framed>
      {products.map(product => {
        const marker = product.id === 'p1' ? <small data-testid={`detached-${product.id}`}>first</small> : null
        return <p key={product.id} data-testid={`row-host-${product.id}`}>{product.name}{marker}</p>
      })}
    </section>
    <Panel label="outer"><Panel label="inner" /></Panel>
    <table><tbody>{[{ id: 'a/b', cells: ['c'] }, { id: 'a', cells: ['b/c'] }].map(row => <tr key={row.id}>{row.cells.map(cell => <td key={cell} data-testid={`slash-${row.id}|${cell}`}>{cell}</td>)}</tr>)}</tbody></table>
    <section data-testid="object-keys">
      {Object.keys(shelfArray).map(position => <s key={position} data-testid={`keys-array-${position}`}>{shelfArray[position]}</s>)}
      {Object.entries(shelfArray).map(([position, value]) => <s key={position} data-testid={`entries-array-${value}`}>{value}</s>)}
      {Object.keys(shelfObject).map(name => <s key={name} data-testid={`keys-object-${name}`}>{shelfObject[name]}</s>)}
      {Object.entries(shelfObject).map(([name, label]) => <s key={name} data-testid={`entries-object-${name}`}>{label}</s>)}
      {Object.keys(products).map(entry => <s key={entry} data-testid={`keys-unknown-${entry}`}>{entry}</s>)}
    </section>
    <section data-testid="inspected">
      <RouteList><RouteStub path="/a" /><RouteStub path="/b" /></RouteList>
      <TabList><TabStub title="One" /><TabStub title="Two" /></TabList>
      <IconButton icon={<Icon />} />
    </section>
    <section data-testid="fail-closed">
      <div>{products.map(renderRow)}</div>
      <dl data-testid="plain-rows">{products.map(PlainRow)}</dl>
      <div>{looped}</div>
      <Repeat component={Leaf} count={3} />
      <Twice><Banner label="twice" /><em data-testid="twice-host">twice</em></Twice>
      <ul>{products.map(product => <li key={product.id} data-testid={`option-${product.id}`}>{product.name}{product.id === 'p1' && check}</li>)}</ul>
      <div data-testid="dup-a">{repeatedBadge}</div><div data-testid="dup-b">{repeatedBadge}</div>
      <Shadowed />
      {moduleNote}
    </section>
  </main>
}

createRoot(document.getElementById('root')).render(<StrictMode><App /></StrictMode>)
