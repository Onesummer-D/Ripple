import { Children, StrictMode, isValidElement } from 'react'
import { createRoot } from 'react-dom/client'

// A root whose top-level component inspects its children (react-router <Routes> style).
function RouteStub() { return null }
function RootRoutes({ children }) {
  const paths = []
  Children.forEach(children, child => {
    if (!isValidElement(child)) return
    if (child.type !== RouteStub) throw new Error('RootRoutes only accepts RouteStub children')
    paths.push(child.props.path)
  })
  return <p data-testid="root-routes">{paths.join(',')}</p>
}
function Shell() {
  return <h2 data-testid="shell">Shell</h2>
}
function Widget({ id }) {
  return <output data-testid={`widget-${id}`}>{id}</output>
}

createRoot(document.getElementById('routes')).render(<RootRoutes><RouteStub path="/a" /><RouteStub path="/b" /></RootRoutes>)
createRoot(document.getElementById('shell')).render(<StrictMode><Shell /></StrictMode>)
// One JSX site mounted into several roots: never a provable single instance.
for (const id of ['w1', 'w2']) createRoot(document.getElementById(id)).render(<Widget id={id} />)
